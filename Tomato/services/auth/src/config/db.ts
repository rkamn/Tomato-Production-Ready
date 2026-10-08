import mongoose from "mongoose";
import dns from "node:dns";
import Employee from "../model/Employee.js";
import Customer from "../model/Customer.js";
import Restaurant from "../model/Restaurant.js";
import Rider from "../model/Rider.js";
import Counter from "../model/Counter.js";
import Shop from "../model/Shop.js";
import ShopOrder from "../model/ShopOrder.js";
import { hashPassword } from "../modules/auth/authController.js";

try {
    dns.setDefaultResultOrder?.('ipv4first');
} catch {
    // Ignore if not supported in runtime
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const ensureCollectionIndexes = async (model: mongoose.Model<any>) => {
    try {
        for (const field of ['email', 'phone'] as const) {
            const indexName = `${field}_1`;
            const indexes = await model.collection.indexes();
            const existingIndex = indexes.find((index) => index.name === indexName);

            if (existingIndex) {
                await model.collection.dropIndex(indexName);
            }

            await model.collection.createIndex(
                { [field]: 1 },
                {
                    name: indexName,
                    unique: true,
                    partialFilterExpression: { [field]: { $type: 'string' } },
                },
            );
        }
    } catch (err: any) {
        console.warn(`[Index Setup] Notice on ${model.modelName} indexes:`, err?.message);
    }
};

const ensureIdentifierIndex = async (model: mongoose.Model<any>, field: string) => {
    try {
        const indexName = `${field}_1`;
        const indexes = await model.collection.indexes();
        const existingIndex = indexes.find((index) => index.name === indexName);
        if (!existingIndex) {
            await model.collection.createIndex(
                { [field]: 1 },
                {
                    name: indexName,
                    unique: true,
                    sparse: true,
                },
            );
        }
    } catch (err: any) {
        console.warn(`[Index Setup] Notice on ${model.modelName} ${field} index:`, err?.message);
    }
};

export const migrateUsersToEmployeesAndDropUsersTable = async () => {
    try {
        if (!mongoose.connection.db) return;
        const collections = await mongoose.connection.db.listCollections().toArray();
        const hasUsersCollection = collections.some((c) => c.name === 'users');

        if (hasUsersCollection) {
            const usersCol = mongoose.connection.db.collection('users');
            const employeesCol = mongoose.connection.db.collection('employees');
            const customersCol = mongoose.connection.db.collection('customers');
            const restaurantsCol = mongoose.connection.db.collection('restaurants');
            const ridersCol = mongoose.connection.db.collection('riders');

            const allUsers = await usersCol.find({}).toArray();
            console.log(`[DB Migration] Migrating ${allUsers.length} records from legacy 'users' collection...`);

            for (const u of allUsers) {
                // Clean name if it had '/<ID>'
                const cleanName = typeof u.name === 'string'
                    ? (u.name.split('/')[0] || '').trim()
                    : u.name;
                const docToSave = { ...u, name: cleanName };

                if (u.role === 'admin' || u.role === 'subadmin') {
                    await employeesCol.updateOne(
                        { _id: u._id },
                        { $set: docToSave },
                        { upsert: true },
                    );
                } else if (u.role === 'customer') {
                    await customersCol.updateOne(
                        { _id: u._id },
                        { $set: docToSave },
                        { upsert: true },
                    );
                } else if (u.role === 'restaurant') {
                    await restaurantsCol.updateOne(
                        { _id: u._id },
                        { $set: docToSave },
                        { upsert: true },
                    );
                } else if (u.role === 'deliveryPartner' || u.role === 'rider') {
                    await ridersCol.updateOne(
                        { _id: u._id },
                        { $set: docToSave },
                        { upsert: true },
                    );
                }
            }

            // Delete all records from users table
            await usersCol.deleteMany({});
            console.log("[DB Migration] All records deleted from 'users' table.");

            // Drop users collection
            try {
                await usersCol.drop();
                console.log("[DB Migration] 'users' table dropped successfully.");
            } catch (dropErr: any) {
                console.warn("[DB Migration] Could not drop 'users' collection (might already be dropped):", dropErr?.message);
            }
        }

        // Clean any existing names with '/<ID>' across all collections
        for (const colName of ['employees', 'customers', 'restaurants', 'riders']) {
            if (collections.some((c) => c.name === colName)) {
                const col = mongoose.connection.db.collection(colName);
                const docsWithSlash = await col.find({ name: { $regex: '/' } }).toArray();
                for (const doc of docsWithSlash) {
                    const cleanName = (doc.name || '').split('/')[0].trim();
                    await col.updateOne({ _id: doc._id }, { $set: { name: cleanName } });
                }
            }
        }

        // Ensure default platform admin exists in employees if empty
        const adminCount = await Employee.countDocuments({ role: 'admin' });
        if (adminCount === 0) {
            console.log("[DB Migration] No admin found in employees. Creating default Platform Administrator...");
            const defaultPassHash = await hashPassword('Admin@12345');
            await Employee.create({
                name: 'Platform Administrator',
                email: 'admin@tomato.com',
                phone: '+919876543210',
                role: 'admin',
                adminRoleTitle: 'Super Administrator',
                passwordHash: defaultPassHash,
                isApproved: true,
                isBlocked: false,
                permissions: ['*'],
                adminId: 'ADM-1001',
                createdBy: 'System Init',
            });
            console.log("[DB Migration] Default Platform Administrator (admin@tomato.com) created in employees table.");
        }

        // Migrate records from legacy 'fooditems' or 'food_items' into 'menuitems', then drop old tables
        const menuItemsCol = mongoose.connection.db.collection('menuitems');
        for (const oldColName of ['fooditems', 'food_items']) {
            if (collections.some((c) => c.name === oldColName)) {
                const oldCol = mongoose.connection.db.collection(oldColName);
                const oldDocs = await oldCol.find({}).toArray();
                if (oldDocs.length > 0) {
                    console.log(`[DB Migration] Migrating ${oldDocs.length} records from '${oldColName}' to 'menuitems'...`);
                    for (const doc of oldDocs) {
                        await menuItemsCol.updateOne(
                            { _id: doc._id },
                            { $set: doc },
                            { upsert: true },
                        );
                    }
                }
                await oldCol.deleteMany({});
                try {
                    await oldCol.drop();
                    console.log(`[DB Migration] '${oldColName}' table dropped successfully.`);
                } catch (dropErr: any) {
                    console.warn(`[DB Migration] Notice on dropping ${oldColName}:`, dropErr?.message);
                }
            }
        }
    } catch (migrationErr: any) {
        console.error('[DB Migration Error]:', migrationErr?.message || migrationErr);
    }
};

export const migrateCountersAndDropOldCounterTables = async () => {
    try {
        if (!mongoose.connection.db) return;
        const collections = await mongoose.connection.db.listCollections().toArray();
        const countersCol = mongoose.connection.db.collection<any>('counters');

        // 1. Migrate legacy partner_id_counters if present
        const hasPartnerIdCounters = collections.some((c) => c.name === 'partner_id_counters');
        if (hasPartnerIdCounters) {
            const partnerCountersCol = mongoose.connection.db.collection<any>('partner_id_counters');
            const partnerDocs = await partnerCountersCol.find({}).toArray();
            console.log(`[DB Migration] Migrating ${partnerDocs.length} records from 'partner_id_counters'...`);

            for (const doc of partnerDocs) {
                const lastNum = typeof doc.lastNumber === 'number' ? doc.lastNumber : 1000;
                const docId = String(doc._id);
                if (docId === 'customer') {
                    await countersCol.updateOne(
                        { _id: 'customerId' },
                        { $set: { seq: lastNum, lastNumber: lastNum, name: 'customerId', counterType: 'customerId' } },
                        { upsert: true },
                    );
                } else if (docId === 'rider') {
                    await countersCol.updateOne(
                        { _id: 'riderId' },
                        { $set: { seq: lastNum, lastNumber: lastNum, name: 'riderId', counterType: 'riderId' } },
                        { upsert: true },
                    );
                } else if (docId === 'restaurant') {
                    await countersCol.updateOne(
                        { _id: 'restaurentId' },
                        { $set: { seq: lastNum, lastNumber: lastNum, name: 'restaurentId', counterType: 'restaurentId' } },
                        { upsert: true },
                    );
                    await countersCol.updateOne(
                        { _id: 'restaurantId' },
                        { $set: { seq: lastNum, lastNumber: lastNum, name: 'restaurantId', counterType: 'restaurantId' } },
                        { upsert: true },
                    );
                }
            }

            // Delete all records and drop collection
            await partnerCountersCol.deleteMany({});
            try {
                await partnerCountersCol.drop();
                console.log("[DB Migration] 'partner_id_counters' table dropped successfully.");
            } catch (dropErr: any) {
                console.warn("[DB Migration] Notice on dropping partner_id_counters:", dropErr?.message);
            }
        }

        // 2. Migrate legacy order_counters if present
        const hasOrderCounters = collections.some((c) => c.name === 'order_counters');
        if (hasOrderCounters) {
            const orderCountersCol = mongoose.connection.db.collection<any>('order_counters');
            const orderDocs = await orderCountersCol.find({}).toArray();
            console.log(`[DB Migration] Migrating ${orderDocs.length} records from 'order_counters'...`);

            let maxOrderNum = 1000;
            for (const doc of orderDocs) {
                const lastNum = typeof doc.lastNumber === 'number' ? doc.lastNumber : 1000;
                if (lastNum > maxOrderNum) maxOrderNum = lastNum;
                await countersCol.updateOne(
                    { _id: `orderId_${String(doc._id)}` },
                    { $set: { seq: lastNum, lastNumber: lastNum, name: 'orderId', counterType: 'orderId' } },
                    { upsert: true },
                );
            }

            // Set general orderId counter to highest seen
            await countersCol.updateOne(
                { _id: 'orderId' },
                { $set: { seq: maxOrderNum, lastNumber: maxOrderNum, name: 'orderId', counterType: 'orderId' } },
                { upsert: true },
            );

            // Delete all records and drop collection
            await orderCountersCol.deleteMany({});
            try {
                await orderCountersCol.drop();
                console.log("[DB Migration] 'order_counters' table dropped successfully.");
            } catch (dropErr: any) {
                console.warn("[DB Migration] Notice on dropping order_counters:", dropErr?.message);
            }
        }

        // 3. Ensure required counters exist with default start 1000
        const defaultCounters = [
            { key: 'customerId', desc: 'Customer User ID counter' },
            { key: 'riderId', desc: 'Delivery Partner / Rider User ID counter' },
            { key: 'restaurentId', desc: 'Restaurant Partner ID counter' },
            { key: 'restaurantId', desc: 'Restaurant Partner ID counter alias' },
            { key: 'subadminId', desc: 'Operations Sub-Admin User ID counter' },
            { key: 'adminId', desc: 'Platform Administrator User ID counter' },
            { key: 'shopId', desc: 'Retail Shop Partner ID counter' },
            { key: 'orderId', desc: 'Platform Order Number ID counter' },
        ];

        for (const item of defaultCounters) {
            await countersCol.updateOne(
                { _id: item.key },
                {
                    $setOnInsert: {
                        seq: 1000,
                        lastNumber: 1000,
                        name: item.key,
                        counterType: item.key,
                        description: item.desc,
                    },
                },
                { upsert: true },
            );
        }

        // 4. Also maintain a summary document 'all_counters' for consolidated access
        const allDocs = await countersCol.find({}).toArray();
        const summary: Record<string, number> = {};
        for (const c of allDocs) {
            if (typeof c.seq === 'number') {
                summary[String(c._id)] = c.seq;
            }
        }
        await countersCol.updateOne(
            { _id: 'all_counters' },
            {
                $set: {
                    ...summary,
                    name: 'all_counters',
                    description: 'Consolidated overview of all system counters',
                },
            },
            { upsert: true },
        );

        console.log("[DB Migration] 'counters' table is ready in Tomato_clone database.");
    } catch (err: any) {
        console.error('[DB Counter Migration Error]:', err?.message || err);
    }
};

export const connectDB = async (attempts = 3) => {
    const mongoUri = process.env.MONGO_URI;
    if (!mongoUri) {
        throw new Error('MONGO_URI is not configured');
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            await mongoose.connect(mongoUri, {
                dbName: process.env.MONGO_DB_NAME || 'Tomato_clone',
                serverSelectionTimeoutMS: 15_000,
                family: 4,
            });
            await migrateUsersToEmployeesAndDropUsersTable();
            await migrateCountersAndDropOldCounterTables();
            await ensureCollectionIndexes(Employee);
            await ensureIdentifierIndex(Employee, 'adminId');
            await ensureIdentifierIndex(Employee, 'subadminId');
            await ensureCollectionIndexes(Customer);
            await ensureIdentifierIndex(Customer, 'customerId');
            await ensureCollectionIndexes(Restaurant);
            await ensureIdentifierIndex(Restaurant, 'restaurantId');
            await ensureCollectionIndexes(Rider);
            await ensureIdentifierIndex(Rider, 'riderId');

            // Ensure 'shop' collection exists in Tomato_clone database
            if (mongoose.connection.db) {
                const collections = await mongoose.connection.db.listCollections({ name: 'shop' }).toArray();
                if (collections.length === 0) {
                    await mongoose.connection.db.createCollection('shop');
                    console.log("[DB Setup] 'shop' collection created in Tomato_clone database.");
                }
            }
            await ensureCollectionIndexes(Shop as any);
            await ensureIdentifierIndex(Shop as any, 'shopId');
            await Shop.syncIndexes().catch(() => undefined);
            await ShopOrder.syncIndexes().catch(() => undefined);

            // Ensure a default active Shop partner exists for testing
            const shopCount = await Shop.countDocuments();
            if (shopCount === 0) {
                const passHash = await hashPassword('Shop@12345');
                await Shop.create({
                    name: 'Tomato Supermart & Daily Essentials',
                    email: 'shop@tomato.com',
                    phone: '+919876543299',
                    role: 'shop',
                    shopId: 'shop-1001',
                    passwordHash: passHash,
                    isApproved: true,
                    isBlocked: false,
                    shopAddress: '45 CMH Road, Indiranagar, Bengaluru, 560038',
                    shopLocation: { lat: 12.9784, lng: 77.6408 },
                    digipin: 'DGP-1298-7764',
                    category: 'Retail, Supermarket & Groceries',
                    isOpen: true,
                    isOnline: true,
                });
                console.log("[DB Setup] Default Shop partner (shop@tomato.com) created in 'shop' collection.");
            }

            console.log("Connected to MongoDB (Tomato_clone database ready)");
            return;
        } catch (error) {
            lastError = error;
            await mongoose.disconnect().catch(() => undefined);
            console.error(`MongoDB connection attempt ${attempt}/${attempts} failed.`);
            if (attempt < attempts) {
                await sleep(2_000);
            }
        }
    }

    const startupError = new Error(
        'Unable to connect to MongoDB Atlas. Add the current public IP to Atlas Network Access and verify MONGO_URI/MONGO_DB_NAME.',
    );
    (startupError as Error & { cause?: unknown }).cause = lastError;
    throw startupError;
};

export default connectDB;
import mongoose from "mongoose";
import User from "../model/User.js";

const ensureIdentifierIndexes = async () => {
    for (const field of ['email', 'phone'] as const) {
        const indexName = `${field}_1`;
        const indexes = await User.collection.indexes();
        const existingIndex = indexes.find((index) => index.name === indexName);

        if (existingIndex) {
            await User.collection.dropIndex(indexName);
        }

        await User.collection.createIndex(
            { [field]: 1 },
            {
                name: indexName,
                unique: true,
                partialFilterExpression: { [field]: { $type: 'string' } },
            },
        );
    }
};

export const connectDB = async () => {
    try {
        const mongoUri = process.env.MONGO_URI;
        if (!mongoUri) {
            throw new Error('MONGO_URI is not configured');
        }

        await mongoose.connect(mongoUri, { dbName: process.env.MONGO_DB_NAME || 'Tomato_clone' });
        await ensureIdentifierIndexes();
        console.log("Connected to MongoDB");
    } catch (error) {
        console.error("Error connecting to MongoDB:", error);
        //process.exit(1);
    }
};

export default connectDB;
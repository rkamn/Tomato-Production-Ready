import mongoose from "mongoose";
import User from "../model/User.js";

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
                serverSelectionTimeoutMS: 10_000,
            });
            await ensureIdentifierIndexes();
            console.log("Connected to MongoDB");
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
import mongoose from "mongoose";

export const connectDB = async () => {
    try {
        const mongoUri = process.env.MONGO_URI;
        if (!mongoUri) {
            throw new Error('MONGO_URI is not configured');
        }

        await mongoose.connect(mongoUri, { dbName: process.env.MONGO_DB_NAME || 'Tomato_clone' });
        console.log("Connected to MongoDB");
    } catch (error) {
        console.error("Error connecting to MongoDB:", error);
        //process.exit(1);
    }
};

export default connectDB;
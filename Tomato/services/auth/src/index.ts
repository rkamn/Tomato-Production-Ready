import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import outhRoute from './routes/auth.js';

dotenv.config();

const app = express();

app.use("/api/auth", outhRoute);


const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);

  connectDB();
});
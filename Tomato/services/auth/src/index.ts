import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import connectDB from './config/db.js';
import authRoute from './routes/auth.js';
import { adminRoutes, customerRoutes, restaurantRoutes, riderRoutes } from './routes/roleRoutes.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json());
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoute);
app.use('/api/customer', customerRoutes);
app.use('/api/restaurant', restaurantRoutes);
app.use('/api/rider', riderRoutes);
app.use('/api/admin', adminRoutes);
app.use((_req, res) => res.status(404).json({ message: 'Route not found.' }));

const PORT = process.env.PORT || 5050;

app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);

  connectDB();
});
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer, { type FileFilterCallback } from 'multer';
import type { Request } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import connectDB from './config/db.js';
import authRoute from './routes/auth.js';
import { adminRoutes, customerRoutes, restaurantRoutes, riderRoutes } from './routes/roleRoutes.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, '../uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => cb(null, uploadDir),
  filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const extension = path.extname(file.originalname) || '.png';
    const safeName = `${Date.now()}-${Math.random().toString(16).slice(2)}${extension}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
      return;
    }
    cb(new Error('Only image files are allowed'));
  },
});

const app = express();
const PORT = process.env.PORT || 5050;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json());
app.use('/uploads', express.static(uploadDir));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoute(upload));
app.use('/api/customer', customerRoutes);
app.use('/api/restaurant', restaurantRoutes);
app.use('/api/rider', riderRoutes);
app.use('/api/admin', adminRoutes);
app.use((_req, res) => res.status(404).json({ message: 'Route not found.' }));

app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
  connectDB();
});

export { PUBLIC_BASE_URL, upload };

import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../../.env');
dotenv.config({ path: envPath, quiet: true });

export const config = {
  port: Number(process.env.PORT || 5050),
  frontendPort: Number(process.env.FRONTEND_PORT || 3000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5050}`,
  corsOrigin: process.env.CORS_ORIGIN || true,
  jwtSecret: process.env.JWT_SECRET || 'tomato-local-development-secret',
  mongoUri: process.env.MONGO_URI || '',
  mongoDbName: process.env.MONGO_DB_NAME || 'Tomato_clone',
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_TjUFioCQLtVxJn',
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || '',
};

export default config;


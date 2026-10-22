import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import connectDB from './config/index.js';
import {
  authRoute,
  notificationRoutes,
  adminRoutes,
  customerRoutes,
  restaurantRoutes,
  shopRoutes,
  riderRoutes,
  supportRoutes,
} from './routes/index.js';
import { cleanupExpiredClosedComplaints, Restaurant, Shop } from './model/index.js';
import { attachWebSocketServer } from './utils/websocket.js';

import { upload, uploadDir } from './middleware/index.js';
import {
  applySecurityMiddleware,
  corsOptions,
  apiRateLimiter,
  isReverseProxyEnabled,
  getCachedReverseProxyConfig,
} from './security/index.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, '../../../frontend');

const app = express();
const PORT = process.env.PORT || 5050;
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT || 3000);
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

// 1. Configure CORS with explicit trusted origins
app.use(cors(corsOptions));

// 2. Appropriate Request-Size Limits to prevent payload flooding / DoS
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 3. Apply comprehensive security layers (Helmet, CSP, XSS, NoSQL/SQL Injection Guard, Output Scrubber)
applySecurityMiddleware(app);

// 4. Global API rate limiter on all API routes
app.use('/api', apiRateLimiter);
app.use('/uploads', express.static(uploadDir));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get(['/reverse-proxy/status', '/api/reverse-proxy/status'], (_req, res) =>
  res.json({ success: true, enabled: isReverseProxyEnabled(), reverseProxy: getCachedReverseProxyConfig() })
);

app.use('/api/auth', authRoute(upload));
app.use('/api/customer', customerRoutes);
app.use(['/api/restaurant', '/api/restaurants', '/api/restaurent', '/api/restaurents'], restaurantRoutes);
app.use(['/api/shop', '/api/shops'], shopRoutes);
app.use('/api/rider', riderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/frontend', express.static(frontendDir));
app.use(express.static(frontendDir));
app.use((_req, res) => res.status(404).json({ message: 'Route not found.' }));

// Global Security & Operational Error Handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.message?.includes('CORS blocked')) {
    return res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: err.message,
    });
  }
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({
      success: false,
      error: 'Payload Too Large',
      message: 'Request payload exceeded maximum allowed size limit (1MB).',
    });
  }
  console.error('[Unhandled Error]:', err?.message || err);
  return res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'An unexpected internal error occurred' : (err.message || 'Error'),
  });
});

const startServer = async () => {
  try {
    await connectDB();

    // Ensure all restaurant and shop partners have default GSN number 'NA' if not updated
    await Promise.all([
      Restaurant.updateMany(
        { $or: [{ gsnNumber: { $exists: false } }, { gsnNumber: '' }, { gsnNumber: null }] },
        { $set: { gsnNumber: 'NA' } },
      ).catch(() => null),
      Shop.updateMany(
        { $or: [{ gsnNumber: { $exists: false } }, { gsnNumber: '' }, { gsnNumber: null }] },
        { $set: { gsnNumber: 'NA' } },
      ).catch(() => null),
    ]);

    // Auto-delete closed complaints inactive for > 1 week on server startup
    await cleanupExpiredClosedComplaints();

    // Recurring 1-hour interval for automatic deletion of expired closed tickets
    setInterval(() => {
      cleanupExpiredClosedComplaints().catch((err) =>
        console.error('[Complaint Cleanup Interval Error]:', err)
      );
    }, 60 * 60 * 1000);

    const mainServer = app.listen(PORT, () => {
      console.log(`\n==================================================`);
      console.log(`🚀 Server started successfully!`);
      console.log(`🔗 Localhost URL: http://localhost:${PORT}`);
      console.log(`📡 WebSocket: ws://localhost:${PORT}/ws`);
      console.log(`==================================================\n`);
    });
    attachWebSocketServer(mainServer);

    const frontendServer = app.listen(FRONTEND_PORT, '127.0.0.1', () => {
      console.log(`🌐 Frontend running at: http://localhost:${FRONTEND_PORT}\n`);
    });
    attachWebSocketServer(frontendServer);
    frontendServer.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.warn(
          `ℹ️ Frontend port ${FRONTEND_PORT} is occupied; frontend is also accessible at http://localhost:${PORT}`,
        );
        return;
      }
      console.error('Frontend server startup aborted:', error);
    });
  } catch (error) {
    console.error('Auth service startup aborted:', error);
    process.exitCode = 1;
  }
};

startServer();

export { PUBLIC_BASE_URL, upload };

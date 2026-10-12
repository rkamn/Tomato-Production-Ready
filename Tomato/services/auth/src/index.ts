import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer, { type FileFilterCallback } from 'multer';
import type { Request } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import axios from 'axios';
import connectDB from './config/db.js';
import {
  authRoute,
  notificationRoutes,
  adminRoutes,
  customerRoutes,
  restaurantRoutes,
  shopRoutes,
  riderRoutes,
  supportRoutes,
} from './modules/index.js';
import { cleanupExpiredClosedComplaints } from './model/index.js';

import { upload, uploadDir } from './middleware/upload.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, '../../../frontend');

const app = express();
const PORT = process.env.PORT || 5050;
const FRONTEND_PORT = Number(process.env.FRONTEND_PORT || 3000);
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json());
app.use('/uploads', express.static(uploadDir));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

/**
 * Arattai OAuth 2.0 Redirect Callback Handler
 * Automatically captures authorization code, exchanges it for access & refresh tokens, and saves them to .env
 */
app.get('/oauth/callback', async (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const error = req.query.error;

  if (error) {
    return res.status(400).send(`
      <div style="font-family:sans-serif;max-width:600px;margin:50px auto;padding:24px;border:1px solid #f87171;border-radius:12px;background:#fef2f2;">
        <h2 style="color:#b91c1c;margin-top:0;">OAuth Authorization Failed</h2>
        <p><strong>Error:</strong> ${error}</p>
        <p>User declined or authorization was aborted.</p>
      </div>
    `);
  }

  if (!code) {
    return res.status(400).send(`
      <div style="font-family:sans-serif;max-width:600px;margin:50px auto;padding:24px;border:1px solid #f87171;border-radius:12px;background:#fef2f2;">
        <h2 style="color:#b91c1c;margin-top:0;">Missing Authorization Code</h2>
        <p>No <code>code</code> query parameter was received from Arattai.</p>
      </div>
    `);
  }

  try {
    const clientId = process.env.ARATTAI_CLIENT_ID || '1000.4L22DK7R2KQEERGW4BQGO7JFOPDQ8Y';
    const clientSecret = process.env.ARATTAI_CLIENT_SECRET || '9deb72dac06f9af8648483572d04762a101b47c8bc';
    const redirectUri = process.env.ARATTAI_REDIRECT_URI || `http://localhost:${PORT}/oauth/callback`;

    console.log('[Arattai OAuth Callback] Exchanging authorization code for tokens...');
    const tokenResponse = await axios.post(
      'https://accounts.arattai.in/oauth/v2/token',
      null,
      {
        params: {
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 10000,
      }
    );

    const tokenData = tokenResponse.data;
    console.log('[Arattai OAuth Callback] Token exchange successful:', tokenData);

    if (tokenData.access_token) {
      const envPath = fileURLToPath(new URL('../.env', import.meta.url));
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf-8');
        const updateEnvKey = (k: string, v: string) => {
          const regex = new RegExp(`^${k}=.*$`, 'm');
          if (regex.test(envContent)) envContent = envContent.replace(regex, `${k}="${v}"`);
          else envContent += `\n${k}="${v}"`;
        };

        updateEnvKey('ARATTAI_ACCESS_TOKEN', tokenData.access_token);
        if (tokenData.refresh_token) {
          updateEnvKey('ARATTAI_REFRESH_TOKEN', tokenData.refresh_token);
        }
        updateEnvKey('ARATTAI_CLIENT_ID', clientId);
        updateEnvKey('ARATTAI_CLIENT_SECRET', clientSecret);
        updateEnvKey('ARATTAI_REDIRECT_URI', redirectUri);

        fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf-8');
      }

      process.env.ARATTAI_ACCESS_TOKEN = tokenData.access_token;
      if (tokenData.refresh_token) {
        process.env.ARATTAI_REFRESH_TOKEN = tokenData.refresh_token;
      }

      return res.send(`
        <div style="font-family:sans-serif;max-width:620px;margin:60px auto;padding:32px;border:1px solid #86efac;border-radius:16px;background:#f0fdf4;box-shadow:0 10px 25px rgba(0,0,0,0.05);text-align:center;">
          <div style="font-size:48px;margin-bottom:12px;">🎉</div>
          <h2 style="color:#15803d;margin:0 0 10px 0;">Arattai Connected Successfully!</h2>
          <p style="color:#166534;font-size:15px;line-height:1.6;">
            Your OAuth <strong>Access Token</strong> and <strong>Refresh Token</strong> have been acquired and saved into your Tomato backend environment.
          </p>
          <div style="margin:24px 0;padding:14px;background:#ffffff;border:1px dashed #bbf7d0;border-radius:10px;text-align:left;font-size:13px;color:#334155;">
            <div><strong>Expires In:</strong> ${tokenData.expires_in || 3600} seconds (Auto-refresh enabled)</div>
            <div><strong>Token Type:</strong> ${tokenData.token_type || 'Bearer'}</div>
            <div><strong>Status:</strong> Ready to dispatch Indian mobile notifications 🚀</div>
          </div>
          <p style="font-size:13px;color:#64748b;">You can close this tab and return to Tomato.</p>
        </div>
      `);
    }

    return res.status(500).send(`<h2>Received invalid response from Arattai token endpoint.</h2>`);
  } catch (err: any) {
    const errorDetails = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error('[Arattai OAuth Callback Error]:', errorDetails);
    return res.status(500).send(`
      <div style="font-family:sans-serif;max-width:600px;margin:50px auto;padding:24px;border:1px solid #f87171;border-radius:12px;background:#fef2f2;">
        <h2 style="color:#b91c1c;margin-top:0;">Token Exchange Failed</h2>
        <p><strong>Error details:</strong></p>
        <pre style="background:#fee2e2;padding:12px;border-radius:6px;overflow-x:auto;">${errorDetails}</pre>
      </div>
    `);
  }
});
app.use('/api/auth', authRoute(upload));
app.use('/api/customer', customerRoutes);
app.use('/api/restaurant', restaurantRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/rider', riderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/frontend', express.static(frontendDir));
app.use(express.static(frontendDir));
app.use((_req, res) => res.status(404).json({ message: 'Route not found.' }));

const startServer = async () => {
  try {
    await connectDB();

    // Auto-delete closed complaints inactive for > 1 week on server startup
    await cleanupExpiredClosedComplaints();

    // Recurring 1-hour interval for automatic deletion of expired closed tickets
    setInterval(() => {
      cleanupExpiredClosedComplaints().catch((err) =>
        console.error('[Complaint Cleanup Interval Error]:', err)
      );
    }, 60 * 60 * 1000);

    app.listen(PORT, () => {
      console.log(`Auth service running on port ${PORT}`);
    });
    const frontendServer = app.listen(FRONTEND_PORT, '127.0.0.1', () => {
      console.log(`Frontend running on http://127.0.0.1:${FRONTEND_PORT}`);
    });
    frontendServer.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.warn(
          `Frontend port ${FRONTEND_PORT} is occupied; frontend is also available on port ${PORT}.`,
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

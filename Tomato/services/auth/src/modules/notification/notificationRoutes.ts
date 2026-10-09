import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Notification from '../../model/Notification.js';
import notificationService from './notificationService.js';
import { authenticate, AuthenticatedRequest } from '../../middleware/authenticate.js';
import { UserRole } from '../../model/Employee.js';

const router = express.Router();

/**
 * Server-Sent Events (SSE) live notification stream
 */
router.get('/stream', (req: Request, res: Response) => {
  const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
  const authHeader = req.header('authorization');
  const token = queryToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '');
  const jwtSecret = process.env.JWT_SECRET;

  if (!token || !jwtSecret) {
    return res.status(401).json({ message: 'Authentication token required for notification stream' });
  }

  try {
    const payload = jwt.verify(token, jwtSecret) as { userId: string; role: UserRole };
    if (!payload?.userId || !payload?.role) {
      return res.status(401).json({ message: 'Invalid token' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    notificationService.addSSEClient(payload.userId, payload.role, res);
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
});

/**
 * Get user notifications and unread count
 */
router.get('/', authenticate, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user?.userId) return res.status(401).json({ message: 'Authentication required' });

    await (Notification as any).cleanExpiredAndExcess(user.userId);

    const notifications = await Notification.find({ userId: user.userId })
      .sort({ createdAt: -1 })
      .limit(15)
      .lean();

    const unreadCount = await Notification.countDocuments({ userId: user.userId, isRead: false });

    return res.json({ notifications, unreadCount });
  } catch (err) {
    console.error('Fetch notifications error:', err);
    return res.status(500).json({ message: 'Unable to fetch notifications' });
  }
});

/**
 * Mark a single notification as read
 */
router.put('/:notificationId/read', authenticate, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user?.userId) return res.status(401).json({ message: 'Authentication required' });
    const notificationId = String(req.params.notificationId || '');
    if (!notificationId || !mongoose.isValidObjectId(notificationId)) {
      return res.status(400).json({ message: 'Valid notification ID required' });
    }

    await Notification.findOneAndUpdate(
      { _id: new mongoose.Types.ObjectId(notificationId), userId: user.userId },
      { $set: { isRead: true } },
    );

    return res.json({ message: 'Notification marked as read' });
  } catch {
    return res.status(500).json({ message: 'Unable to update notification' });
  }
});

/**
 * Mark all notifications as read
 */
router.put('/read-all', authenticate, async (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user?.userId) return res.status(401).json({ message: 'Authentication required' });

    await Notification.updateMany({ userId: user.userId, isRead: false }, { $set: { isRead: true } });
    return res.json({ message: 'All notifications marked as read' });
  } catch {
    return res.status(500).json({ message: 'Unable to update notifications' });
  }
});

/**
 * Test Arattai Notification Dispatch to an Indian Mobile Number
 * POST /api/notifications/arattai/test
 */
router.post('/arattai/test', authenticate, async (req: Request, res: Response) => {
  try {
    const { phone, message, templateId, params } = req.body;
    const user = (req as AuthenticatedRequest).user;

    const targetPhone = phone || user?.phone;
    if (!targetPhone) {
      return res.status(400).json({ message: 'Indian mobile phone number is required (e.g. 9876543210 or +919876543210)' });
    }

    const { arattaiNotificationService } = await import('./arattaiService.js');
    const result = await arattaiNotificationService.sendNotification({
      phoneNumber: targetPhone,
      templateId,
      params,
      message: message || `Tomato Alert: Test notification dispatched successfully via Arattai API.`,
    });

    return res.json({
      message: result.success
        ? 'Arattai notification processed successfully'
        : 'Arattai notification dispatch failed',
      result,
    });
  } catch (err: any) {
    console.error('Arattai test error:', err);
    return res.status(500).json({ message: 'Arattai test failed', error: err.message });
  }
});

/**
 * Inbound Webhook from Arattai Business Platform
 * POST /api/notifications/arattai/webhook
 */
router.post('/arattai/webhook', async (req: Request, res: Response) => {
  try {
    const webhookData = req.body;
    console.log('[Arattai Inbound Webhook Received]:', JSON.stringify(webhookData, null, 2));

    // Acknowledge receipt to Arattai platform immediately
    return res.status(200).json({ status: 'success', received: true });
  } catch (err: any) {
    console.error('Arattai webhook processing error:', err);
    return res.status(500).json({ status: 'error' });
  }
});

export default router;

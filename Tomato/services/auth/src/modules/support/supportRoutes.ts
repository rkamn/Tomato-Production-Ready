import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import Complaint, { IComplaint, cleanupExpiredClosedComplaints } from '../../model/Complaint.js';
import Notification from '../../model/Notification.js';
import { arattaiNotificationService } from '../notification/index.js';
import {
  authenticate,
  AuthenticatedRequest,
} from '../../middleware/authenticate.js';

export const createSupportRouter = () => {
  const router = express.Router();
  router.use(authenticate);

  /**
   * GET /api/support/tickets
   * Returns tickets created by the logged-in user (customer, restaurant, shop, rider).
   * If admin or subadmin, returns all tickets.
   */
  router.get('/tickets', async (req: Request, res: Response) => {
    try {
      // Auto-purge closed complaints inactive for > 1 week before returning tickets
      await cleanupExpiredClosedComplaints();

      const user = (req as AuthenticatedRequest).user;
      if (!user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      let query: any = {};
      const isAdminOrSub = user.role === 'admin' || user.role === 'subadmin';

      if (!isAdminOrSub) {
        const uid =
          user.userId ||
          user.customerId ||
          user.restaurantId ||
          user.shopId ||
          user.riderId;
        const conditions: any[] = [];
        if (uid) {
          conditions.push({ userId: uid });
        }
        if (user.email) {
          conditions.push({ userEmail: new RegExp(`^${user.email.trim()}$`, 'i') });
        }
        if (conditions.length > 0) {
          query.$or = conditions;
        } else {
          query.userRole = user.role;
        }
      }

      const tickets = await Complaint.find(query).sort({ createdAt: -1 });
      return res.json({
        tickets,
        total: tickets.length,
      });
    } catch (error) {
      console.error('Fetch support tickets failed:', error);
      return res.status(500).json({ message: 'Unable to fetch support tickets' });
    }
  });

  /**
   * POST /api/support/tickets
   * Submits a new support ticket / complaint from customer, restaurant, shop, or rider.
   * This ticket is saved directly to the Complaint collection, ensuring it shows up in
   * the Admin & Sub-Admin Complaint Review Desk immediately!
   */
  router.post('/tickets', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const { category, priority, orderRef, subject, description } = req.body;

      if (!subject || !description) {
        return res.status(400).json({ message: 'Subject and detailed description are required.' });
      }

      const uid =
        user.userId ||
        user.customerId ||
        user.restaurantId ||
        user.shopId ||
        user.riderId ||
        `USER-${Date.now()}`;
      const name = user.name || user.email?.split('@')[0] || `${user.role} user`;
      const email = user.email || '';
      const phone = user.phone || '';
      const role = user.role || 'customer';

      const ticketId = `TKT-${Math.floor(100000 + Math.random() * 900000)}`;

      const newComplaint = new Complaint({
        ticketId,
        userId: uid,
        userName: name,
        userEmail: email,
        userPhone: phone,
        userRole: role,
        category: category || 'General Inquiry',
        priority: priority || 'Normal',
        orderRef: orderRef ? String(orderRef).trim() : '',
        subject: String(subject).trim(),
        description: String(description).trim(),
        status: 'Open',
        createdAt: new Date(),
      });

      await newComplaint.save();

      // Trigger notification for Admin & Sub-Admins
      try {
        await (Notification as any).create({
          userId: 'ADMIN',
          role: 'admin',
          title: `New ${role.toUpperCase()} Ticket: ${ticketId}`,
          message: `${name} (${role}) raised a complaint: "${String(subject).trim()}". Check the Complaint Review Desk.`,
          type: 'system',
        });
      } catch (notifErr) {
        console.warn('Failed to send admin notification for ticket:', notifErr);
      }

      // Real-time mobile notification to user via Arattai API
      if (phone) {
        arattaiNotificationService
          .notifyTicketCreated({
            phoneNumber: phone,
            userName: name,
            ticketId: ticketId,
            category: category,
          })
          .catch((arErr) => console.warn('Arattai ticket creation alert error:', arErr));
      }

      return res.status(201).json({
        message: 'Support ticket submitted successfully and sent to Complaint Review Desk',
        ticket: newComplaint,
      });
    } catch (error) {
      console.error('Submit support ticket failed:', error);
      return res.status(500).json({ message: 'Unable to submit support ticket' });
    }
  });

  /**
   * PATCH /api/support/tickets/:id/toggle
   * Allows complainant or admin to toggle ticket status between Open and Resolved
   */
  router.patch('/tickets/:id/toggle', async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const idStr = String(id || '');

      let ticket = null;
      if (mongoose.Types.ObjectId.isValid(idStr)) {
        ticket = await (Complaint as any).findById(idStr);
      }
      if (!ticket) {
        ticket = await (Complaint as any).findOne({ ticketId: idStr });
      }

      if (!ticket) {
        return res.status(404).json({ message: 'Ticket not found' });
      }

      const isCurrentlyClosed = ticket.status === 'Resolved' || ticket.status === 'Closed';
      ticket.status = isCurrentlyClosed ? 'Open' : 'Resolved';
      await ticket.save();

      return res.json({
        message: `Ticket status updated to ${ticket.status}`,
        ticket,
      });
    } catch (error) {
      console.error('Toggle ticket status failed:', error);
      return res.status(500).json({ message: 'Unable to toggle ticket status' });
    }
  });

  return router;
};

export const supportRoutes = createSupportRouter();
export default supportRoutes;


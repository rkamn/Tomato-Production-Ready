import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import Complaint, { cleanupExpiredClosedComplaints } from '../../../model/Complaint.js';
import Customer from '../../../model/Customer.js';
import Restaurant from '../../../model/Restaurant.js';
import Shop from '../../../model/Shop.js';
import Rider from '../../../model/Rider.js';
import Notification from '../../../model/Notification.js';
import { AuthenticatedRequest } from '../../../middleware/authenticate.js';
import { transferCreditPoints } from '../../wallet/walletService.js';
import { createNotificationForRole } from '../../../utils/orderHelpers.js';
import { arattaiNotificationService } from '../../notification/index.js';

const router = Router();

    // =========================================================================
    // COMPLAINTS & TICKETS REVIEW
    // =========================================================================
    router.get('/complaints', async (req: Request, res: Response) => {
      try {
        const { status, search, user, role } = req.query;

        // Auto-delete closed complaints inactive for > 1 week before querying
        await cleanupExpiredClosedComplaints();

        // Auto-seed initial demo complaints if collection is empty
        const count = await Complaint.countDocuments();
        if (count === 0) {
          const sampleComplaints = [
            {
              ticketId: 'TKT-821940',
              userId: 'CUST-1002',
              userName: 'Rahul Sharma',
              userEmail: 'rahul.sharma@example.com',
              userPhone: '+91 9876543210',
              userRole: 'customer',
              category: 'Order Delay / Live Tracking Issue',
              priority: 'High',
              orderRef: 'ORD-10492',
              subject: 'Order delayed by over 45 minutes from Green Bowl',
              description: 'My lunch order has been in cooking stage for over 45 minutes and no rider is assigned. Please expedite or refund.',
              status: 'Open',
              adminComment: '',
              createdAt: new Date(Date.now() - 3600000 * 2),
            },
            {
              ticketId: 'TKT-654120',
              userId: 'REST-5001',
              userName: 'Spice Symphony Bistro',
              userEmail: 'manager@spicesymphony.com',
              userPhone: '+91 9845012345',
              userRole: 'restaurant',
              category: 'Rider Pickup Coordination Delay',
              priority: 'Urgent',
              orderRef: 'ORD-10488',
              subject: 'Food packed and ready on counter, rider arrived 30 mins late',
              description: 'Dishes have cooled down because assigned rider was stalled. Need replacement rider dispatch workflow review.',
              status: 'In Review',
              adminComment: 'Operations dispatched priority rider. Checking rider dispatch radius.',
              reviewedBy: { userId: 'ADM-001', name: 'Super Admin', role: 'admin' },
              reviewedAt: new Date(Date.now() - 3600000),
              createdAt: new Date(Date.now() - 3600000 * 4),
            },
            {
              ticketId: 'TKT-410982',
              userId: 'SHOP-2004',
              userName: 'Daily Fresh Grocers',
              userEmail: 'contact@dailyfresh.com',
              userPhone: '+91 9740112233',
              userRole: 'shop',
              category: 'Weekly Payouts & Settlement Query',
              priority: 'Normal',
              orderRef: 'BATCH-W40',
              subject: 'Discrepancy in weekly payout settlement summary for Week 40',
              description: 'The weekly statement shows 48 orders, but our daily counter had 51 dispatched orders. Please verify settlement transaction report.',
              status: 'Open',
              adminComment: '',
              createdAt: new Date(Date.now() - 3600000 * 12),
            },
            {
              ticketId: 'TKT-319084',
              userId: 'CUST-1005',
              userName: 'Priya Patel',
              userEmail: 'priya.patel@example.com',
              userPhone: '+91 9988776655',
              userRole: 'customer',
              category: 'Missing or Incorrect Food Items',
              priority: 'High',
              orderRef: 'ORD-10450',
              subject: 'Delivered bag was missing 2 Garlic Naans and Beverage',
              description: 'The delivery bag was unsealed and 2 items listed on the invoice were missing. Requesting instant refund to Tomato Wallet.',
              status: 'Resolved',
              adminComment: 'Refund of ₹140 processed back to customer wallet. Warning issued to kitchen packaging counter.',
              reviewedBy: { userId: 'SUB-101', name: 'Support Lead', role: 'subadmin' },
              reviewedAt: new Date(Date.now() - 3600000 * 5),
              createdAt: new Date(Date.now() - 3600000 * 18),
            },
            {
              ticketId: 'TKT-192031',
              userId: 'CUST-1008',
              userName: 'Amit Verma',
              userEmail: 'amit.verma@example.com',
              userPhone: '+91 9123456789',
              userRole: 'customer',
              category: 'Payment Deducted / Refund & Wallet Query',
              priority: 'Normal',
              orderRef: 'TXN-99812',
              subject: 'UPI deduction succeeded but checkout showed timeout',
              description: 'Bank account was debited ₹380 but order confirmation screen timed out.',
              status: 'Closed',
              adminComment: 'Payment reconciled. Order was generated and delivered successfully.',
              reviewedBy: { userId: 'ADM-001', name: 'Super Admin', role: 'admin' },
              reviewedAt: new Date(Date.now() - 3600000 * 24),
              createdAt: new Date(Date.now() - 3600000 * 36),
            },
          ];
          await (Complaint as any).insertMany(sampleComplaints);
        }

        const query: any = {};

        // Status filter
        if (status && typeof status === 'string' && status.toLowerCase() !== 'all') {
          query.status = new RegExp(`^${status.trim()}$`, 'i');
        }

        // Search specifically by user (name, email, or userId)
        if (user && typeof user === 'string' && user.trim()) {
          const userRegex = new RegExp(user.trim(), 'i');
          query.$or = [
            { userName: userRegex },
            { userEmail: userRegex },
            { userId: userRegex },
          ];
        }

        // General text search
        if (search && typeof search === 'string' && search.trim()) {
          const searchRegex = new RegExp(search.trim(), 'i');
          const searchConditions = [
            { ticketId: searchRegex },
            { userName: searchRegex },
            { userEmail: searchRegex },
            { userId: searchRegex },
            { subject: searchRegex },
            { description: searchRegex },
            { category: searchRegex },
            { orderRef: searchRegex },
          ];
          if (query.$or) {
            query.$and = [{ $or: query.$or }, { $or: searchConditions }];
            delete query.$or;
          } else {
            query.$or = searchConditions;
          }
        }

        // Role filter
        if (role && typeof role === 'string' && role.toLowerCase() !== 'all') {
          query.userRole = role.trim();
        }

        const complaints = await Complaint.find(query).sort({ createdAt: -1 });

        const [totalCount, openCount, inReviewCount, resolvedCount] = await Promise.all([
          Complaint.countDocuments(),
          Complaint.countDocuments({ status: 'Open' }),
          Complaint.countDocuments({ status: 'In Review' }),
          Complaint.countDocuments({ status: { $in: ['Resolved', 'Closed'] } }),
        ]);

        return res.json({
          complaints,
          total: complaints.length,
          counts: {
            total: totalCount,
            open: openCount,
            inReview: inReviewCount,
            resolved: resolvedCount,
          },
        });
      } catch (error) {
        console.error('Fetch complaints failed:', error);
        return res.status(500).json({ message: 'Unable to fetch complaints' });
      }
    });

    router.patch('/complaints/:id', async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const { status, adminComment } = req.body;
        const user = (req as AuthenticatedRequest).user;
        const idStr = String(id || '');

        let complaint = null;
        if (mongoose.Types.ObjectId.isValid(idStr)) {
          complaint = await (Complaint as any).findById(idStr);
        }
        if (!complaint) {
          complaint = await (Complaint as any).findOne({ ticketId: idStr });
        }

        if (!complaint) {
          return res.status(404).json({ message: 'Complaint not found' });
        }

        const validStatuses = ['Open', 'In Review', 'Resolved', 'Closed'];
        if (status) {
          const matchedStatus = validStatuses.find(
            (s) => s.toLowerCase() === String(status).trim().toLowerCase()
          );
          if (matchedStatus) {
            complaint.status = matchedStatus as any;
            if (matchedStatus === 'Closed') {
              complaint.closedAt = new Date();
            } else {
              complaint.closedAt = null;
            }
          }
        }

        if (typeof adminComment === 'string') {
          complaint.adminComment = adminComment.trim();
        }

        complaint.reviewedBy = {
          userId: user?.userId || 'ADMIN',
          name: user?.name || user?.email || 'Admin',
          role: user?.role || 'admin',
        };
        complaint.reviewedAt = new Date();

        await complaint.save();

        // Optionally send notification to the user if user ID exists
        if (complaint.userId) {
          try {
            await (Notification as any).create({
              userId: complaint.userId,
              role: complaint.userRole || 'customer',
              title: `Complaint ${complaint.ticketId} ${complaint.status}`,
              message: `Your complaint regarding "${complaint.subject}" has been marked as ${complaint.status}.${complaint.adminComment ? ` Note: ${complaint.adminComment}` : ''}`,
              type: 'system',
            });
          } catch (notifErr) {
            console.warn('Failed to send notification for complaint update:', notifErr);
          }
        }

        // Real-time telecom / app notification to Indian mobile number via Arattai API
        if (complaint.userPhone) {
          arattaiNotificationService
            .notifyComplaintUpdate({
              phoneNumber: complaint.userPhone,
              userName: complaint.userName,
              ticketId: complaint.ticketId,
              status: complaint.status,
              adminComment: complaint.adminComment,
            })
            .catch((arError: any) => console.warn('Arattai complaint dispatch error:', arError));
        }

        return res.json({
          message: `Complaint ${complaint.ticketId} updated successfully`,
          complaint,
        });
      } catch (error) {
        console.error('Update complaint failed:', error);
        return res.status(500).json({ message: 'Unable to update complaint' });
      }
    });

    router.post('/complaints', async (req: Request, res: Response) => {
      try {
        const {
          userId,
          userName,
          userEmail,
          userPhone,
          userRole,
          category,
          priority,
          orderRef,
          subject,
          description,
        } = req.body;

        if (!subject || !description) {
          return res.status(400).json({ message: 'Subject and description are required' });
        }

        const ticketId = `TKT-${Math.floor(100000 + Math.random() * 900000)}`;

        const complaint = new Complaint({
          ticketId,
          userId: userId || 'CUST-ANON',
          userName: userName || 'Anonymous User',
          userEmail: userEmail || 'user@example.com',
          userPhone: userPhone || '',
          userRole: userRole || 'customer',
          category: category || 'General Inquiry',
          priority: priority || 'Normal',
          orderRef: orderRef || '',
          subject,
          description,
          status: 'Open',
        });

        await complaint.save();

        return res.status(201).json({
          message: 'Complaint created successfully',
          complaint,
        });
      } catch (error) {
        console.error('Create complaint failed:', error);
        return res.status(500).json({ message: 'Unable to create complaint' });
      }
    });


export default router;

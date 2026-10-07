import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import Address from '../../model/Address.js';
import FoodItem from '../../model/FoodItem.js';
import Notification from '../../model/Notification.js';
import Order, { IOrder, OrderStatus } from '../../model/Order.js';
import Restaurant, { IRestaurant } from '../../model/Restaurant.js';
import Customer, { ICustomer } from '../../model/Customer.js';
import Rider, { IRider } from '../../model/Rider.js';
import {
  authenticate,
  AuthenticatedRequest,
  requireRole,
  requirePermission,
} from '../../middleware/authenticate.js';
import notificationService from '../notification/notificationService.js';
import {
  formatBill,
  buildOrderLiveTrackingData,
  createNotificationForRole,
} from '../../utils/orderHelpers.js';

const createRiderRouter = () => {
  const router = express.Router();
  router.use(authenticate, requireRole('deliveryPartner'));

  router.get('/overview', (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    return res.json({
      role: 'deliveryPartner',
      title: 'Delivery partner',
      userId: user?.userId,
      message: 'Rider API ready',
    });
  });

  router.get('/notifications', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const notifications = await Notification.find({
        userId: user.userId,
        role: 'deliveryPartner',
      })
        .sort({ createdAt: -1 })
        .limit(200);
      return res.json({ notifications });
    } catch (error) {
      console.error('Rider notification fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch notifications' });
    }
  });

  // Update Rider live GPS location & online status
  router.put('/location', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const { lat, lng, isOnline } = req.body;
      const numLat = Number(lat);
      const numLng = Number(lng);
      if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) {
        return res
          .status(400)
          .json({ message: 'Valid lat and lng coordinates are required' });
      }

      const updated: any = await Rider.findByIdAndUpdate(
        user.userId,
        {
          $set: {
            currentLocation: { lat: numLat, lng: numLng },
            isOnline: isOnline !== undefined ? Boolean(isOnline) : true,
            lastLocationUpdated: new Date(),
          },
        },
        { new: true },
      ).lean();

      const displayName = updated ? updated.name : '';
      const riderIdStr = updated?.riderId || '';

      return res.json({
        message: 'Live GPS location updated',
        riderId: riderIdStr,
        displayName,
        currentLocation: { lat: numLat, lng: numLng },
        isOnline: updated?.isOnline ?? true,
        lastLocationUpdated: updated?.lastLocationUpdated || new Date(),
      });
    } catch (error) {
      console.error('Update rider location failed:', error);
      return res
        .status(500)
        .json({ message: 'Unable to update rider location' });
    }
  });

  // Rider Live Duty Status (Online / Offline) Toggle
  router.get('/status', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });

      const rider = await Rider.findById(user.userId)
        .select('isOnline lastLocationUpdated name riderId')
        .lean();
      if (!rider) return res.status(404).json({ message: 'Rider not found' });
      return res.json({ isOnline: rider.isOnline ?? true });
    } catch (error) {
      return res
        .status(500)
        .json({ message: 'Unable to fetch rider duty status' });
    }
  });

  router.put('/status', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });

      const rawVal =
        req.body?.isOnline !== undefined ? req.body.isOnline : req.body?.isOpen;
      const isOnline = Boolean(rawVal);

      const updated: any = await Rider.findByIdAndUpdate(
        user.userId,
        {
          $set: {
            isOnline,
            lastLocationUpdated: new Date(),
          },
        },
        { new: true },
      ).lean();

      return res.json({
        message: isOnline
          ? 'You are now ONLINE and ready to take delivery orders.'
          : 'You are now OFFLINE and will not receive order requests.',
        isOnline: updated?.isOnline ?? isOnline,
        lastLocationUpdated: updated?.lastLocationUpdated || new Date(),
      });
    } catch (error) {
      console.error('Update rider duty status failed:', error);
      return res.status(500).json({ message: 'Unable to update duty status' });
    }
  });

  // Get current rider live location & status
  router.get('/location', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });

      const rider = await Rider.findById(user.userId)
        .select(
          'name riderId currentLocation isOnline lastLocationUpdated phone deliveryVehicle',
        )
        .lean();
      if (!rider) return res.status(404).json({ message: 'Rider not found' });

      const riderIdStr = rider.riderId || '';
      return res.json({
        riderId: riderIdStr,
        displayName: rider.name,
        currentLocation: rider.currentLocation || {
          lat: 12.9716,
          lng: 77.5946,
        },
        isOnline: rider.isOnline ?? true,
        lastLocationUpdated: rider.lastLocationUpdated || new Date(),
      });
    } catch (error) {
      return res
        .status(500)
        .json({ message: 'Unable to fetch rider location' });
    }
  });

  // 1. Check orders available for pickup (excludes orders this rider rejected)
  router.get('/orders/available', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const riderObjId =
        user?.userId && mongoose.isValidObjectId(user.userId)
          ? new mongoose.Types.ObjectId(user.userId)
          : null;

      const riderDoc = user?.userId
        ? await Rider.findById(user.userId).select('isOnline').lean()
        : null;
      if (riderDoc && riderDoc.isOnline === false) {
        return res.json({
          orders: [],
          isOnline: false,
          message:
            'You are currently OFFLINE. Toggle your duty status to ONLINE in the sidebar to view and accept orders.',
        });
      }

      const filter: Record<string, unknown> = {
        status: { $in: ['accepted', 'preparing', 'ready_for_pickup'] },
        $or: [{ riderId: { $exists: false } }, { riderId: null }],
      };

      if (riderObjId) {
        filter.rejectedByRiders = { $ne: riderObjId };
      }

      const orders = await Order.find(filter).sort({ createdAt: -1 });

      return res.json({ orders, isOnline: true });
    } catch (error) {
      console.error('Fetch available orders failed:', error);
      return res
        .status(500)
        .json({ message: 'Unable to fetch available orders' });
    }
  });

  // Rider rejects incoming delivery offer
  router.post(
    '/orders/:orderId/reject',
    async (req: Request, res: Response) => {
      try {
        const user = (req as AuthenticatedRequest).user;
        if (!user?.userId)
          return res.status(401).json({ message: 'Authentication required' });
        const orderId = String(req.params.orderId || '');
        if (!orderId || !mongoose.isValidObjectId(orderId)) {
          return res
            .status(400)
            .json({ message: 'Valid order ID is required' });
        }

        const order = await Order.findById(orderId);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        if (order.riderId && String(order.riderId) !== String(user.userId)) {
          return res.status(409).json({
            message: 'This order has already been accepted by another rider',
          });
        }

        const result = await notificationService.handleRiderRejectOrder(
          order,
          user.userId,
        );
        return res.json({
          message: result.message,
          reassignedCount: result.reassignedCount,
        });
      } catch (error) {
        console.error('Rider reject order failed:', error);
        return res.status(500).json({ message: 'Unable to reject order' });
      }
    },
  );

  // 2. Accept the order after restaurant accepts the order
  router.post(
    '/orders/:orderId/accept',
    async (req: Request, res: Response) => {
      try {
        const user = (req as AuthenticatedRequest).user;
        if (!user?.userId)
          return res.status(401).json({ message: 'Authentication required' });
        const orderId = String(req.params.orderId || '');
        if (!orderId || !mongoose.isValidObjectId(orderId)) {
          return res
            .status(400)
            .json({ message: 'Valid order ID is required' });
        }

        const order = await Order.findById(orderId);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        if (order.riderId && String(order.riderId) !== String(user.userId)) {
          return res.status(409).json({
            message: 'This order has already been accepted by another rider',
          });
        }

        if (
          !['accepted', 'preparing', 'ready_for_pickup'].includes(order.status)
        ) {
          return res.status(400).json({
            message: `Order cannot be accepted in current status (${order.status})`,
          });
        }

        const riderUser = await Rider.findById(user.userId).lean();
        if (riderUser && riderUser.isOnline === false) {
          return res.status(400).json({
            message:
              'You are currently OFFLINE. Please toggle your duty status to ONLINE in the sidebar to accept orders.',
          });
        }
        const riderCode = riderUser?.riderId || '';
        const riderDisplayName = riderUser ? riderUser.name : 'Tomato Rider';

        order.riderId = new mongoose.Types.ObjectId(user.userId);
        order.riderCode = riderCode;
        order.riderName = riderDisplayName;
        order.riderPhone = riderUser?.phone || '';
        order.status = 'out_for_delivery';
        order.statusHistory.push({
          status: 'out_for_delivery',
          at: new Date(),
          by: String(user.userId),
          note: `Delivery partner ${riderDisplayName} accepted delivery and is on route`,
        });

        await order.save();

        await notificationService.notifyOnRiderAccepted(
          order,
          riderDisplayName,
          riderUser?.phone,
        );

        return res.json({ message: 'Delivery accepted successfully', order });
      } catch (error) {
        console.error('Rider accept order failed:', error);
        return res.status(500).json({ message: 'Unable to accept order' });
      }
    },
  );

  // 3. View active delivery in progress
  router.get('/orders/active', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });

      const orders = await Order.find({
        riderId: new mongoose.Types.ObjectId(user.userId),
        status: 'out_for_delivery',
      }).sort({ updatedAt: -1 });

      return res.json({ orders });
    } catch (error) {
      console.error('Fetch active deliveries failed:', error);
      return res.status(500).json({ message: 'Unable to fetch active orders' });
    }
  });

  // 4. Change status to delivered
  router.post(
    '/orders/:orderId/deliver',
    async (req: Request, res: Response) => {
      try {
        const user = (req as AuthenticatedRequest).user;
        if (!user?.userId)
          return res.status(401).json({ message: 'Authentication required' });
        const orderId = String(req.params.orderId || '');
        if (!orderId || !mongoose.isValidObjectId(orderId)) {
          return res
            .status(400)
            .json({ message: 'Valid order ID is required' });
        }

        const order = await Order.findOne({
          _id: new mongoose.Types.ObjectId(orderId),
          riderId: new mongoose.Types.ObjectId(user.userId),
        });
        if (!order)
          return res
            .status(404)
            .json({ message: 'Order not found or not assigned to you' });

        order.status = 'delivered';
        if (order.paymentMethod === 'cod') {
          order.paymentStatus = 'paid';
          order.paidAt = new Date();
        }

        order.statusHistory.push({
          status: 'delivered',
          at: new Date(),
          by: String(user.userId),
          note: 'Order safely delivered to customer address',
        });

        await order.save();

        await notificationService.notifyOnDelivered(order);

        return res.json({
          message: 'Order marked as delivered successfully',
          order,
        });
      } catch (error) {
        console.error('Deliver order failed:', error);
        return res.status(500).json({ message: 'Unable to deliver order' });
      }
    },
  );

  // 5. Rider completed deliveries & earnings history
  router.get('/orders/history', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });

      const completedOrders = await Order.find({
        riderId: new mongoose.Types.ObjectId(user.userId),
        status: 'delivered',
      }).sort({ updatedAt: -1 });

      const deliveryEarnings = completedOrders.length * 40;

      return res.json({
        totalDeliveries: completedOrders.length,
        totalEarnings: deliveryEarnings,
        orders: completedOrders,
      });
    } catch (error) {
      console.error('Fetch rider history failed:', error);
      return res
        .status(500)
        .json({ message: 'Unable to fetch delivery history' });
    }
  });

  // 6. Rider live tracking view
  router.get(
    '/orders/:orderId/live-tracking',
    async (req: Request, res: Response) => {
      try {
        const user = (req as AuthenticatedRequest).user;
        if (!user?.userId)
          return res.status(401).json({ message: 'Authentication required' });
        const orderId = String(req.params.orderId || '');
        if (!orderId || !mongoose.isValidObjectId(orderId)) {
          return res
            .status(400)
            .json({ message: 'Valid order ID is required' });
        }

        const tracking = await buildOrderLiveTrackingData(orderId);
        if (!tracking)
          return res.status(404).json({ message: 'Order not found' });

        return res.json({ tracking });
      } catch (error) {
        console.error('Rider live tracking fetch failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to fetch live tracking' });
      }
    },
  );

  return router;
};

export const riderRoutes = createRiderRouter();
export default riderRoutes;

import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import Address from '../../model/Address.js';
import MenuItem, { FoodItem } from '../../model/MenuItem.js';
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

const createRestaurantRouter = () => {
  const router = express.Router();
  router.use(authenticate, requireRole('restaurant'));

  router.get('/overview', (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    return res.json({
      role: 'restaurant',
      title: 'Restaurant',
      userId: user?.userId,
      message: 'Restaurant API ready',
    });
  });

  router.get('/notifications', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const notifications = await Notification.find({
        userId: user.userId,
        role: 'restaurant',
      })
        .sort({ createdAt: -1 })
        .limit(200);
      return res.json({ notifications });
    } catch (error) {
      console.error('Restaurant notification fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch notifications' });
    }
  });

  // 1. Restaurant Live Status (Open / Close) Toggle
  router.get('/status', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const rest = await Restaurant.findById(user.userId)
        .select('isOpen isOnline name restaurantId')
        .lean();
      if (!rest)
        return res.status(404).json({ message: 'Restaurant not found' });
      const isOpen = rest.isOpen ?? rest.isOnline ?? true;
      return res.json({ isOpen, isOnline: isOpen });
    } catch (error) {
      return res
        .status(500)
        .json({ message: 'Unable to fetch restaurant status' });
    }
  });

  router.put('/status', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });

      const rawVal =
        req.body?.isOpen !== undefined ? req.body.isOpen : req.body?.isOnline;
      const isOpen = Boolean(rawVal);

      const updated = await Restaurant.findByIdAndUpdate(
        user.userId,
        { $set: { isOpen, isOnline: isOpen } },
        { new: true },
      ).lean();

      return res.json({
        message: isOpen
          ? 'Restaurant is now OPEN and accepting orders.'
          : 'Restaurant is now CLOSED and cannot accept orders.',
        isOpen: updated?.isOpen ?? isOpen,
        isOnline: updated?.isOnline ?? isOpen,
      });
    } catch (error) {
      console.error('Restaurant status update error:', error);
      return res
        .status(500)
        .json({ message: 'Unable to update restaurant status' });
    }
  });

  // 2. Restaurant profile
  router.get('/profile', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const profile = await Restaurant.findById(user.userId)
        .select(
          'name restaurantId digipin email phone restaurantAddress restaurantLocation cuisine isApproved isBlocked isOpen isOnline',
        )
        .lean();
      const displayName = profile ? profile.name : '';
      return res.json({
        profile: profile
          ? {
              ...profile,
              displayName,
              isOpen: profile.isOpen ?? profile.isOnline ?? true,
              isOnline: profile.isOnline ?? profile.isOpen ?? true,
            }
          : null,
      });
    } catch (error) {
      return res
        .status(500)
        .json({ message: 'Unable to fetch restaurant profile' });
    }
  });

  router.put('/profile', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const { name, phone, restaurantAddress, cuisine, digipin, lat, lng } =
        req.body;
      const updates: Record<string, unknown> = {};
      if (typeof name === 'string' && name.trim()) updates.name = name.trim();
      if (typeof phone === 'string' && phone.trim())
        updates.phone = phone.trim();
      if (typeof restaurantAddress === 'string')
        updates.restaurantAddress = restaurantAddress.trim();
      if (typeof cuisine === 'string') updates.cuisine = cuisine.trim();
      if (typeof digipin === 'string' && digipin.trim())
        updates.digipin = digipin.trim().toUpperCase();
      if (
        lat !== undefined &&
        lng !== undefined &&
        !isNaN(Number(lat)) &&
        !isNaN(Number(lng))
      ) {
        updates.restaurantLocation = { lat: Number(lat), lng: Number(lng) };
      }

      const updated = await Restaurant.findByIdAndUpdate(
        user.userId,
        { $set: updates },
        { new: true },
      );
      return res.json({
        message: 'Restaurant profile updated',
        profile: updated,
      });
    } catch (error) {
      return res
        .status(500)
        .json({ message: 'Unable to update restaurant profile' });
    }
  });

  // 2. Manage Menu: List, Add, Edit, Delete
  router.get('/menu', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const menu = await FoodItem.find({
        restaurantId: new mongoose.Types.ObjectId(user.userId),
      }).sort({ createdAt: -1 });
      return res.json({ menu });
    } catch (error) {
      console.error('Restaurant menu fetch failed:', error);
      return res
        .status(500)
        .json({ message: 'Unable to fetch restaurant menu' });
    }
  });

  router.post('/menu', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });

      const name =
        typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const category =
        typeof req.body?.category === 'string'
          ? req.body.category.trim()
          : 'Main Course';
      const description =
        typeof req.body?.description === 'string'
          ? req.body.description.trim()
          : '';
      const dietary = ['veg', 'non-veg', 'vegan'].includes(req.body?.dietary)
        ? req.body.dietary
        : 'veg';
      const quantity = Number(req.body?.quantity ?? 10);
      const price = Number(req.body?.price ?? 0);
      const image =
        typeof req.body?.image === 'string' ? req.body.image.trim() : '';

      if (
        !name ||
        !Number.isFinite(quantity) ||
        quantity < 0 ||
        !Number.isFinite(price) ||
        price < 0
      ) {
        return res.status(400).json({
          message: 'Valid food item name, quantity, and price are required',
        });
      }

      const restUser = await Restaurant.findById(user.userId).lean();

      const item = await FoodItem.create({
        restaurantId: new mongoose.Types.ObjectId(user.userId),
        restaurantName: restUser?.name || 'Partner Kitchen',
        name,
        category,
        description,
        dietary,
        quantity,
        price,
        image,
        isActive: true,
      });

      await Notification.create({
        userId: user.userId,
        role: 'restaurant',
        title: 'Menu item added',
        message: `${name} (${category}) is now available at ₹${price}.`,
        type: 'menu',
        entityId: String(item._id),
      });

      return res
        .status(201)
        .json({ message: 'Food item added successfully', item });
    } catch (error) {
      console.error('Restaurant menu save failed:', error);
      return res.status(500).json({ message: 'Unable to add food item' });
    }
  });

  router.put('/menu/:itemId', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const itemId = String(req.params.itemId || '');
      if (!itemId || !mongoose.isValidObjectId(itemId)) {
        return res
          .status(400)
          .json({ message: 'Valid menu item ID is required' });
      }

      const updates: Record<string, unknown> = {};
      if (typeof req.body.name === 'string' && req.body.name.trim())
        updates.name = req.body.name.trim();
      if (typeof req.body.category === 'string')
        updates.category = req.body.category.trim();
      if (typeof req.body.description === 'string')
        updates.description = req.body.description.trim();
      if (req.body.quantity !== undefined)
        updates.quantity = Number(req.body.quantity);
      if (req.body.price !== undefined) updates.price = Number(req.body.price);
      if (['veg', 'non-veg', 'vegan'].includes(req.body.dietary))
        updates.dietary = req.body.dietary;
      if (req.body.isActive !== undefined)
        updates.isActive = Boolean(req.body.isActive);
      if (typeof req.body.image === 'string')
        updates.image = req.body.image.trim();

      const updated = await FoodItem.findOneAndUpdate(
        {
          _id: new mongoose.Types.ObjectId(itemId),
          restaurantId: new mongoose.Types.ObjectId(user.userId),
        },
        { $set: updates },
        { new: true, runValidators: true },
      );

      if (!updated)
        return res.status(404).json({ message: 'Menu item not found' });
      return res.json({ message: 'Menu item updated', item: updated });
    } catch (error) {
      console.error('Menu item update failed:', error);
      return res.status(500).json({ message: 'Unable to update menu item' });
    }
  });

  router.delete('/menu/:itemId', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const itemId = String(req.params.itemId || '');
      if (!itemId || !mongoose.isValidObjectId(itemId)) {
        return res
          .status(400)
          .json({ message: 'Valid menu item ID is required' });
      }

      const deleted = await FoodItem.findOneAndDelete({
        _id: new mongoose.Types.ObjectId(itemId),
        restaurantId: new mongoose.Types.ObjectId(user.userId),
      });
      if (!deleted)
        return res.status(404).json({ message: 'Menu item not found' });
      return res.json({ message: 'Menu item deleted successfully' });
    } catch (error) {
      console.error('Menu delete failed:', error);
      return res.status(500).json({ message: 'Unable to delete menu item' });
    }
  });

  // 3. View incoming orders for this restaurant
  router.get('/orders', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });

      const restaurantObjId = new mongoose.Types.ObjectId(user.userId);
      const orders = await Order.find({
        $or: [
          { restaurantId: restaurantObjId },
          { restaurantId: { $exists: false } },
        ],
      }).sort({ createdAt: -1 });

      return res.json({ orders });
    } catch (error) {
      console.error('Restaurant orders fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch orders' });
    }
  });

  // 4. Accept the order & update order status
  router.put('/orders/:orderId/status', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const orderId = String(req.params.orderId || '');
      if (!orderId || !mongoose.isValidObjectId(orderId)) {
        return res.status(400).json({ message: 'Valid order ID is required' });
      }
      const { status, note } = req.body;

      const allowedStatuses: OrderStatus[] = [
        'accepted',
        'preparing',
        'ready_for_pickup',
        'cancelled',
      ];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
          message: `Status must be one of: ${allowedStatuses.join(', ')}`,
        });
      }

      const order = await Order.findById(orderId);
      if (!order) return res.status(404).json({ message: 'Order not found' });

      if (status === 'accepted') {
        const restUser = await Restaurant.findById(user.userId).lean();
        if (
          restUser &&
          (restUser.isOpen === false || restUser.isOnline === false)
        ) {
          return res.status(400).json({
            message:
              'Your restaurant is currently CLOSED. Please toggle your status to OPEN in the sidebar to accept orders.',
          });
        }
      }

      order.status = status;
      order.statusHistory.push({
        status,
        at: new Date(),
        by: String(user.userId),
        note: note || `Restaurant changed status to ${status}`,
      });
      await order.save();

      if (status === 'accepted') {
        await notificationService.notifyRidersAndCustomerOnOrderAccepted(order);
      } else {
        const customerStatusMessages: Record<string, string> = {
          preparing: `Your order #${order.orderNumber} is now on the stove / being freshly cooked.`,
          ready_for_pickup: `Order #${order.orderNumber} is packaged and waiting for rider pickup.`,
          cancelled: `Your order #${order.orderNumber} could not be accepted and was cancelled.`,
        };

        if (order.customerId) {
          await notificationService.createNotification({
            userId: String(order.customerId),
            role: 'customer',
            title: `Order Status: ${status.replace(/_/g, ' ').toUpperCase()}`,
            message:
              customerStatusMessages[status] ||
              `Order status updated to ${status}.`,
            type: 'order',
            entityId: String(order._id),
            metadata: {
              orderId: String(order._id),
              orderNumber: order.orderNumber,
              status,
            },
          });
        }
      }

      return res.json({ message: `Order status updated to ${status}`, order });
    } catch (error) {
      console.error('Restaurant order status update failed:', error);
      return res.status(500).json({ message: 'Unable to update order status' });
    }
  });

  // 5. Generate the bill of order
  router.get('/orders/:orderId/bill', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const orderId = String(req.params.orderId || '');
      if (!orderId || !mongoose.isValidObjectId(orderId)) {
        return res.status(400).json({ message: 'Valid order ID is required' });
      }

      const order = await Order.findById(orderId);
      if (!order) return res.status(404).json({ message: 'Order not found' });

      const [restaurantUser, customerUser] = await Promise.all([
        Restaurant.findById(user.userId).lean(),
        order.customerId
          ? Customer.findById(order.customerId).lean()
          : null,
      ]);

      const bill = formatBill(order, restaurantUser as any, customerUser as any);
      return res.json({ message: 'Bill generated successfully', bill });
    } catch (error) {
      console.error('Restaurant generate bill failed:', error);
      return res.status(500).json({ message: 'Unable to generate bill' });
    }
  });

  // 6. Restaurant live tracking of assigned rider
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
        console.error('Restaurant live tracking fetch failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to fetch live tracking' });
      }
    },
  );

  return router;
};

export const restaurantRoutes = createRestaurantRouter();
export default restaurantRoutes;

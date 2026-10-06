import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import Address from '../../model/Address.js';
import FoodItem from '../../model/FoodItem.js';
import Notification from '../../model/Notification.js';
import Order, { IOrder } from '../../model/Order.js';
import OrderCounter from '../../model/OrderCounter.js';
import User from '../../model/User.js';
import Restaurant from '../../model/Restaurant.js';
import Customer from '../../model/Customer.js';
import { authenticate, AuthenticatedRequest, requireRole } from '../../middleware/authenticate.js';
import notificationService from '../../services/notificationService.js';
import { formatBill, buildOrderLiveTrackingData } from '../../utils/orderHelpers.js';

const createCustomerRouter = () => {
  const router = express.Router();
  router.use(authenticate, requireRole('customer'));

  router.get('/overview', (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    return res.json({
      role: 'customer',
      title: 'Customer',
      userId: user?.userId,
      message: 'Customer API ready',
    });
  });

  router.get('/notifications', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const notifications = await Notification.find({
        userId: user.userId,
        role: 'customer',
      })
        .sort({ createdAt: -1 })
        .limit(200);
      return res.json({ notifications });
    } catch (error) {
      console.error('Customer notification fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch notifications' });
    }
  });

  // 1. View all restaurants
  router.get('/restaurants', async (_req: Request, res: Response) => {
    try {
      const restaurants = await Restaurant.find({
        isBlocked: { $ne: true },
      })
        .select(
          'name restaurantId digipin email phone image restaurantAddress restaurantLocation cuisine isApproved isOpen isOnline',
        )
        .lean();

      return res.json({
        restaurants: restaurants.map((r) => {
          const restId = r.restaurantId || '';
          const displayName = `${r.name}${restId ? '/' + restId : ''}`;
          const isOpen = r.isOpen ?? r.isOnline ?? true;
          return {
            id: r._id,
            _id: r._id,
            name: r.name,
            restaurantId: restId,
            displayName,
            digipin: r.digipin || '',
            email: r.email,
            phone: r.phone,
            image: r.image,
            address: r.restaurantAddress || 'Bengaluru Food Quarter',
            location: r.restaurantLocation || { lat: 12.9716, lng: 77.5946 },
            cuisine: r.cuisine || 'North Indian, Continental, Fast Food',
            isApproved: r.isApproved ?? true,
            isOpen,
            isOnline: isOpen,
          };
        }),
      });
    } catch (error) {
      console.error('Fetch restaurants failed:', error);
      return res.status(500).json({ message: 'Unable to fetch restaurants' });
    }
  });

  // 2. View menu items (across all restaurants or filtered by restaurant)
  router.get('/menu', async (req: Request, res: Response) => {
    try {
      const { restaurantId, category, search } = req.query;
      const query: Record<string, unknown> = { isActive: true };

      if (
        typeof restaurantId === 'string' &&
        mongoose.isValidObjectId(restaurantId)
      ) {
        query.restaurantId = new mongoose.Types.ObjectId(restaurantId);
      }

      if (typeof category === 'string' && category.trim()) {
        query.category = new RegExp(category.trim(), 'i');
      }

      if (typeof search === 'string' && search.trim()) {
        query.$or = [
          { name: new RegExp(search.trim(), 'i') },
          { description: new RegExp(search.trim(), 'i') },
          { category: new RegExp(search.trim(), 'i') },
        ];
      }

      const menu = await FoodItem.find(query).sort({ createdAt: -1 }).lean();

      const restaurantIds = [
        ...new Set(menu.map((m) => String(m.restaurantId)).filter(Boolean)),
      ];
      const restaurants = await Restaurant.find({ _id: { $in: restaurantIds } })
        .select('name restaurantAddress')
        .lean();
      const restaurantMap = new Map(restaurants.map((r) => [String(r._id), r]));

      const enrichedMenu = menu.map((item) => {
        const rest = restaurantMap.get(String(item.restaurantId));
        return {
          ...item,
          restaurantName:
            item.restaurantName || rest?.name || 'Partner Kitchen',
          restaurantAddress: rest?.restaurantAddress || 'Bengaluru Central',
        };
      });

      return res.json({ menu: enrichedMenu });
    } catch (error) {
      console.error('Customer menu fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch menu' });
    }
  });

  // 3. Addresses
  router.get('/addresses', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const addresses = await Address.find({ userId: user.userId }).sort({
        isDefault: -1,
        createdAt: -1,
      });
      return res.json({ addresses });
    } catch (error) {
      console.error('Customer address fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch addresses' });
    }
  });

  router.post('/addresses', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });

      const payload = req.body ?? {};
      const label =
        typeof payload.label === 'string' ? payload.label.trim() : 'Home';
      const line1 =
        typeof payload.line1 === 'string' ? payload.line1.trim() : '';
      const city = typeof payload.city === 'string' ? payload.city.trim() : '';
      const phone =
        typeof payload.phone === 'string' ? payload.phone.trim() : '';
      const state =
        typeof payload.state === 'string' ? payload.state.trim() : '';
      const postalCode =
        typeof payload.postalCode === 'string' ? payload.postalCode.trim() : '';
      const line2 =
        typeof payload.line2 === 'string' ? payload.line2.trim() : '';
      const isDefault = Boolean(payload.isDefault);
      const coordinates =
        Array.isArray(payload.coordinates) && payload.coordinates.length === 2
          ? [Number(payload.coordinates[0]), Number(payload.coordinates[1])]
          : [77.5946, 12.9716];

      if (!line1 || !city) {
        return res
          .status(400)
          .json({ message: 'Address line and city are required' });
      }

      const existingCount = await Address.countDocuments({
        userId: user.userId,
      });
      const shouldBeDefault = isDefault || existingCount === 0;

      if (shouldBeDefault) {
        await Address.updateMany(
          { userId: user.userId },
          { $set: { isDefault: false } },
        );
      }

      const address = await Address.create({
        userId: user.userId,
        label: label || 'Home',
        line1,
        city,
        state,
        postalCode,
        line2,
        phone: phone || undefined,
        isDefault: shouldBeDefault,
        location: {
          type: 'Point',
          coordinates: coordinates as [number, number],
        },
      });

      return res.status(201).json({ message: 'Address saved', address });
    } catch (error) {
      console.error('Customer address save failed:', error);
      return res.status(500).json({ message: 'Unable to save address' });
    }
  });

  router.put('/addresses/:addressId', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const addressId = String(req.params.addressId || '');
      if (!addressId || !mongoose.isValidObjectId(addressId)) {
        return res
          .status(400)
          .json({ message: 'Valid address ID is required' });
      }

      const payload = req.body ?? {};
      const update: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(payload)) {
        if (value !== undefined && value !== null && value !== '') {
          update[key] = value;
        }
      }

      if (update.isDefault === true) {
        await Address.updateMany(
          { userId: user.userId },
          { $set: { isDefault: false } },
        );
      }

      const address = await Address.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(addressId), userId: user.userId },
        { $set: update },
        { new: true, runValidators: true },
      );

      if (!address)
        return res.status(404).json({ message: 'Address not found' });
      return res.json({ message: 'Address updated', address });
    } catch (error) {
      console.error('Customer address update failed:', error);
      return res.status(500).json({ message: 'Unable to update address' });
    }
  });

  // Set address as default
  router.post(
    '/addresses/:addressId/default',
    async (req: Request, res: Response) => {
      try {
        const user = (req as AuthenticatedRequest).user;
        if (!user?.userId)
          return res.status(401).json({ message: 'Authentication required' });
        const addressId = String(req.params.addressId || '');
        if (!addressId || !mongoose.isValidObjectId(addressId)) {
          return res
            .status(400)
            .json({ message: 'Valid address ID is required' });
        }

        await Address.updateMany(
          { userId: user.userId },
          { $set: { isDefault: false } },
        );
        const address = await Address.findOneAndUpdate(
          { _id: new mongoose.Types.ObjectId(addressId), userId: user.userId },
          { $set: { isDefault: true } },
          { new: true },
        );

        if (!address)
          return res.status(404).json({ message: 'Address not found' });
        return res.json({
          message: 'Default delivery address updated successfully',
          address,
        });
      } catch (error) {
        console.error('Customer set default address failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to set default address' });
      }
    },
  );

  router.delete(
    '/addresses/:addressId',
    async (req: Request, res: Response) => {
      try {
        const user = (req as AuthenticatedRequest).user;
        if (!user?.userId)
          return res.status(401).json({ message: 'Authentication required' });
        const addressId = String(req.params.addressId || '');
        if (!addressId || !mongoose.isValidObjectId(addressId)) {
          return res
            .status(400)
            .json({ message: 'Valid address ID is required' });
        }

        const deleted = await Address.findOneAndDelete({
          _id: new mongoose.Types.ObjectId(addressId),
          userId: user.userId,
        });
        if (!deleted)
          return res.status(404).json({ message: 'Address not found' });

        // If deleted was default, promote another address to default
        if (deleted.isDefault) {
          const remaining = await Address.findOne({ userId: user.userId }).sort(
            { createdAt: -1 },
          );
          if (remaining) {
            remaining.isDefault = true;
            await remaining.save();
          }
        }

        return res.json({ message: 'Address removed successfully' });
      } catch (error) {
        console.error('Address delete failed:', error);
        return res.status(500).json({ message: 'Unable to delete address' });
      }
    },
  );

  // 4. Payment Gateway integration endpoint
  router.post('/payment/process', async (req: Request, res: Response) => {
    try {
      const { amount, paymentMethod, cardDetails, upiId } = req.body;
      const numAmount = Number(amount);

      if (!numAmount || numAmount <= 0) {
        return res
          .status(400)
          .json({ message: 'Valid payment amount is required' });
      }

      const method = ['card', 'upi', 'netbanking', 'cod'].includes(
        paymentMethod,
      )
        ? paymentMethod
        : 'card';

      if (method === 'card') {
        const cardNumber = String(cardDetails?.number || '').replace(
          /\s+/g,
          '',
        );
        if (cardNumber.length < 12) {
          return res.status(400).json({ message: 'Invalid card number' });
        }
      } else if (method === 'upi') {
        const upi = String(upiId || '').trim();
        if (!upi || !upi.includes('@')) {
          return res
            .status(400)
            .json({ message: 'Invalid UPI ID format (e.g. name@okhdfcbank)' });
        }
      }

      const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      return res.json({
        success: true,
        message: 'Payment verified and approved by payment gateway',
        transactionId,
        paymentMethod: method,
        amount: numAmount,
        currency: 'INR',
        paidAt: new Date(),
      });
    } catch (error) {
      console.error('Payment gateway process failed:', error);
      return res
        .status(500)
        .json({ message: 'Payment gateway transaction failed' });
    }
  });

  // 5. Place order to restaurant with payment info
  router.post('/orders', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });

      const customer =
        (await Customer.findById(user.userId).lean()) ||
        (await User.findById(user.userId).lean());
      const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!rawItems.length)
        return res.status(400).json({ message: 'Order items are required' });

      interface SanitizedOrderItem {
        foodItemId: mongoose.Types.ObjectId;
        name: string;
        quantity: number;
        price: number;
        totalPrice: number;
      }

      const sanitizedItems: SanitizedOrderItem[] = rawItems
        .map((entry: Record<string, unknown>): SanitizedOrderItem => {
          const foodItemId = String(
            entry.foodItemId || entry.itemId || entry._id || '',
          );
          const name = typeof entry.name === 'string' ? entry.name.trim() : '';
          const quantity = Number(entry.quantity ?? 1);
          const price = Number(entry.price ?? 0);
          return {
            foodItemId: mongoose.isValidObjectId(foodItemId)
              ? new mongoose.Types.ObjectId(foodItemId)
              : new mongoose.Types.ObjectId(),
            name,
            quantity,
            price,
            totalPrice: quantity * price,
          };
        })
        .filter(
          (item: SanitizedOrderItem) =>
            Boolean(item.name) && item.quantity > 0 && item.price >= 0,
        );

      if (!sanitizedItems.length) {
        return res
          .status(400)
          .json({ message: 'Valid food items are required' });
      }

      const subtotal = sanitizedItems.reduce<number>(
        (sum: number, item: SanitizedOrderItem) => sum + item.totalPrice,
        0,
      );
      const tax = Number((subtotal * 0.05).toFixed(2));
      const deliveryFee = 40;
      const totalAmount = Number((subtotal + tax + deliveryFee).toFixed(2));

      const restaurantIdStr =
        typeof req.body?.restaurantId === 'string' ? req.body.restaurantId : '';
      let restaurantUser: any = null;

      if (restaurantIdStr && mongoose.isValidObjectId(restaurantIdStr)) {
        restaurantUser =
          (await Restaurant.findById(restaurantIdStr)) ||
          (await User.findById(restaurantIdStr));
      }

      if (!restaurantUser && sanitizedItems[0]) {
        const itemDoc = await FoodItem.findById(sanitizedItems[0].foodItemId);
        if (itemDoc?.restaurantId) {
          restaurantUser =
            (await Restaurant.findById(itemDoc.restaurantId)) ||
            (await User.findById(itemDoc.restaurantId));
        }
      }

      if (!restaurantUser) {
        restaurantUser =
          (await Restaurant.findOne()) ||
          (await User.findOne({ role: 'restaurant' }));
      }

      if (
        restaurantUser &&
        (restaurantUser.isOpen === false || restaurantUser.isOnline === false)
      ) {
        return res.status(400).json({
          message: `${restaurantUser.name} is currently closed and not accepting orders. Please choose another restaurant or try again later.`,
        });
      }

      const restaurantId = restaurantUser
        ? (restaurantUser._id as mongoose.Types.ObjectId)
        : undefined;
      const restaurantCode = restaurantUser?.restaurantId || '';
      const digipin = restaurantUser?.digipin || '';
      const restaurantName = restaurantUser
        ? `${restaurantUser.name}${restaurantUser.restaurantId ? '/' + restaurantUser.restaurantId : ''}`
        : 'Tomato Partner Restaurant';
      const restaurantAddress =
        restaurantUser?.restaurantAddress ||
        '12 Indiranagar 100ft Road, Bengaluru, 560038';
      const restaurantLocation = restaurantUser?.restaurantLocation || {
        lat: 12.9716,
        lng: 77.5946,
      };

      let deliveryAddress = req.body?.deliveryAddress;
      const addressId = req.body?.addressId;

      if (!deliveryAddress || !deliveryAddress.line1) {
        const savedAddress =
          (addressId && mongoose.isValidObjectId(addressId)
            ? await Address.findOne({
                _id: new mongoose.Types.ObjectId(addressId),
                userId: user.userId,
              }).lean()
            : null) ||
          (await Address.findOne({
            userId: user.userId,
            isDefault: true,
          }).lean()) ||
          (await Address.findOne({ userId: user.userId }).lean());

        if (savedAddress) {
          deliveryAddress = {
            label: savedAddress.label || 'Home',
            phone: savedAddress.phone || customer?.phone || '',
            line1: savedAddress.line1,
            line2: savedAddress.line2 || '',
            city: savedAddress.city,
            state: savedAddress.state || '',
            postalCode: savedAddress.postalCode || '',
            coordinates: savedAddress.location?.coordinates || [
              77.5946, 12.9716,
            ],
          };
        } else {
          deliveryAddress = {
            label: 'Home',
            phone: customer?.phone || '+91 99000 00001',
            line1: 'Customer delivery address',
            city: 'Bengaluru',
            postalCode: '560001',
            coordinates: [77.5946, 12.9716],
          };
        }
      }

      const paymentMethod = ['card', 'upi', 'netbanking', 'cod'].includes(
        req.body?.paymentMethod,
      )
        ? req.body.paymentMethod
        : 'card';
      const paymentTransactionId =
        req.body?.paymentTransactionId ||
        (paymentMethod === 'cod'
          ? 'COD-PAY-ON-DELIVERY'
          : `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`);
      const paymentStatus = paymentMethod === 'cod' ? 'pending' : 'paid';

      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      try {
        await OrderCounter.updateOne(
          { _id: dateStr },
          { $setOnInsert: { lastNumber: 1000 } },
          { upsert: true },
        );
      } catch (error) {
        if (
          typeof error !== 'object' ||
          error === null ||
          !('code' in error) ||
          error.code !== 11000
        ) {
          throw error;
        }
      }

      const orderCounter = await OrderCounter.findOneAndUpdate(
        { _id: dateStr },
        { $inc: { lastNumber: 1 } },
        { new: true },
      );
      if (!orderCounter) {
        throw new Error(`Unable to allocate order number for ${dateStr}`);
      }

      const orderNumberSuffix = orderCounter.lastNumber;
      const orderNumber = `TOM-${dateStr}-${orderNumberSuffix}`;
      const billNumber = `BILL-TOM-${dateStr}-${orderNumberSuffix}`;

      const orderData: Record<string, unknown> = {
        orderNumber,
        billNumber,
        customerId: new mongoose.Types.ObjectId(user.userId),
        customerName: customer?.name || 'Customer',
        customerPhone: customer?.phone || '',
        restaurantCode,
        digipin,
        restaurantName,
        restaurantAddress,
        restaurantLocation,
        items: sanitizedItems,
        subtotal,
        tax,
        deliveryFee,
        totalAmount,
        deliveryAddress,
        paymentStatus,
        paymentMethod,
        paymentTransactionId,
        status: 'placed',
        statusHistory: [
          {
            status: 'placed',
            at: new Date(),
            by: String(user.userId),
            note: `Order placed and paid via ${paymentMethod.toUpperCase()}`,
          },
        ],
      };

      if (restaurantId) {
        orderData.restaurantId = restaurantId;
      }
      if (paymentStatus === 'paid') {
        orderData.paidAt = new Date();
      }

      const order = (await Order.create(orderData)) as unknown as IOrder;

      await notificationService.notifyRestaurantOnOrderPlaced(order);

      return res.status(201).json({
        message: 'Order placed successfully and sent to restaurant',
        order,
      });
    } catch (error) {
      console.error('Customer order placement failed:', error);
      return res.status(500).json({ message: 'Unable to place order' });
    }
  });

  // 6. Customer order history & live tracking
  router.get('/orders', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });

      const orders = await Order.find({
        customerId: new mongoose.Types.ObjectId(user.userId),
      }).sort({ createdAt: -1 });
      return res.json({ orders });
    } catch (error) {
      console.error('Customer orders fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch orders' });
    }
  });

  router.get('/orders/:orderId', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const orderId = String(req.params.orderId || '');
      if (!orderId || !mongoose.isValidObjectId(orderId)) {
        return res.status(400).json({ message: 'Valid order ID is required' });
      }

      const order = await Order.findOne({
        _id: new mongoose.Types.ObjectId(orderId),
        customerId: new mongoose.Types.ObjectId(user.userId),
      });
      if (!order) return res.status(404).json({ message: 'Order not found' });
      return res.json({ order });
    } catch (error) {
      console.error('Customer order detail fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch order detail' });
    }
  });

  // 7. Customer bill view
  router.get('/orders/:orderId/bill', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const orderId = String(req.params.orderId || '');
      if (!orderId || !mongoose.isValidObjectId(orderId)) {
        return res.status(400).json({ message: 'Valid order ID is required' });
      }

      const order = await Order.findOne({
        _id: new mongoose.Types.ObjectId(orderId),
        customerId: new mongoose.Types.ObjectId(user.userId),
      });
      if (!order) return res.status(404).json({ message: 'Order not found' });

      const [restaurantUser, customerUser] = await Promise.all([
        order.restaurantId
          ? (await Restaurant.findById(order.restaurantId).lean()) ||
            (await User.findById(order.restaurantId).lean())
          : null,
        order.customerId
          ? (await Customer.findById(order.customerId).lean()) ||
            (await User.findById(order.customerId).lean())
          : null,
      ]);

      const bill = formatBill(order, restaurantUser, customerUser);
      return res.json({ bill });
    } catch (error) {
      console.error('Customer bill fetch failed:', error);
      return res.status(500).json({ message: 'Unable to generate bill' });
    }
  });

  // 8. Customer live tracking of assigned rider and order
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
        console.error('Customer live tracking fetch failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to fetch live tracking' });
      }
    },
  );

  return router;
};

export const customerRoutes = createCustomerRouter();
export default customerRoutes;

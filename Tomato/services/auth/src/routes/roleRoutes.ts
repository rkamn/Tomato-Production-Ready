import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import Address from '../model/Address.js';
import FoodItem from '../model/FoodItem.js';
import Notification from '../model/Notification.js';
import Order, { IOrder, OrderStatus } from '../model/Order.js';
import User, { IUser, USER_ROLES, UserRole } from '../model/User.js';
import Restaurant, { IRestaurant } from '../model/Restaurant.js';
import Customer, { ICustomer } from '../model/Customer.js';
import Rider, { IRider } from '../model/Rider.js';
import {
  authenticate,
  AuthenticatedRequest,
  requireRole,
  requirePermission,
} from '../middleware/authenticate.js';
import {
  hashPassword,
  userResponse,
  generateRestaurantId,
  generateRiderId,
  generateCustomerId,
  generateSubAdminId,
  getPartnerDisplayName,
} from '../controllers/auth.js';
import notificationService from '../services/notificationService.js';

export const createNotificationForRole = async (args: {
  userId: string;
  role: 'customer' | 'restaurant' | 'deliveryPartner' | 'admin' | 'subadmin';
  title: string;
  message: string;
  type?: 'order' | 'menu' | 'service' | 'system';
  entityId?: string;
  metadata?: Record<string, unknown>;
}) => {
  return await notificationService.createNotification(args);
};

const formatBill = (
  order: IOrder,
  restaurantUser?: IUser | null,
  customerUser?: IUser | null,
) => {
  const subtotal = order.subtotal || 0;
  const cgst = Number((subtotal * 0.025).toFixed(2));
  const sgst = Number((subtotal * 0.025).toFixed(2));
  const tax = Number((cgst + sgst).toFixed(2));
  const deliveryFee = order.deliveryFee ?? 40;
  const totalAmount = order.totalAmount || subtotal + tax + deliveryFee;

  return {
    invoiceNumber: order.billNumber || `BILL-${order.orderNumber}`,
    orderNumber: order.orderNumber,
    date: order.createdAt || new Date(),
    restaurant: {
      name: order.restaurantName || restaurantUser?.name || 'Tomato Restaurant',
      address:
        order.restaurantAddress ||
        restaurantUser?.restaurantAddress ||
        '12 MG Road, Bengaluru, Karnataka 560001',
      phone: restaurantUser?.phone || '+91 98765 43210',
      gstin: '29AABCT1337M1Z4',
    },
    customer: {
      name: order.customerName || customerUser?.name || 'Customer',
      phone: order.customerPhone || customerUser?.phone || '',
      address: order.deliveryAddress || {
        line1: 'Delivery address',
        city: 'Bengaluru',
      },
    },
    items: (order.items || []).map((item) => ({
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      totalPrice: item.totalPrice || item.price * item.quantity,
    })),
    subtotal,
    cgst,
    sgst,
    tax,
    deliveryFee,
    totalAmount,
    paymentMethod: order.paymentMethod || 'cod',
    paymentStatus: order.paymentStatus || 'pending',
    paymentTransactionId: order.paymentTransactionId || 'N/A',
    orderStatus: order.status,
    rider: order.riderName
      ? { name: order.riderName, phone: order.riderPhone }
      : null,
  };
};

export const buildOrderLiveTrackingData = async (orderId: string) => {
  const order = await Order.findById(orderId).lean();
  if (!order) return null;

  let riderData: {
    riderId: string;
    displayName: string;
    phone: string;
    currentLocation: { lat: number; lng: number };
    lastLocationUpdated: Date;
    isOnline: boolean;
  } | null = null;

  if (order.riderId) {
    const rider =
      (await Rider.findById(order.riderId).lean()) ||
      (await User.findById(order.riderId).lean());
    if (rider) {
      const riderIdStr = rider.riderId || '';
      riderData = {
        riderId: riderIdStr,
        displayName: `${rider.name}${riderIdStr ? '/' + riderIdStr : ''}`,
        phone: rider.phone || '',
        currentLocation: rider.currentLocation || {
          lat: 12.9716,
          lng: 77.5946,
        },
        lastLocationUpdated: rider.lastLocationUpdated || new Date(),
        isOnline: rider.isOnline ?? true,
      };
    }
  }

  let restaurantData: {
    restaurantId: string;
    displayName: string;
    address: string;
    location: { lat: number; lng: number };
    digipin: string;
    phone: string;
  } | null = null;

  if (order.restaurantId) {
    const rest =
      (await Restaurant.findById(order.restaurantId).lean()) ||
      (await User.findById(order.restaurantId).lean());
    if (rest) {
      const restIdStr = rest.restaurantId || '';
      restaurantData = {
        restaurantId: restIdStr,
        displayName: `${rest.name}${restIdStr ? '/' + restIdStr : ''}`,
        address: rest.restaurantAddress || order.restaurantAddress || '',
        location: rest.restaurantLocation ||
          order.restaurantLocation || { lat: 12.9716, lng: 77.5946 },
        digipin: rest.digipin || order.digipin || '',
        phone: rest.phone || '',
      };
    }
  }

  if (!restaurantData) {
    restaurantData = {
      restaurantId: order.restaurantCode || '',
      displayName: order.restaurantName || 'Restaurant',
      address: order.restaurantAddress || 'Bengaluru',
      location: order.restaurantLocation || { lat: 12.9716, lng: 77.5946 },
      digipin: order.digipin || '',
      phone: '',
    };
  }

  let distanceToPickupKm: number | null = null;
  let distanceToDeliveryKm: number | null = null;

  if (riderData && restaurantData) {
    const dLat =
      (restaurantData.location.lat - riderData.currentLocation.lat) *
      (Math.PI / 180);
    const dLng =
      (restaurantData.location.lng - riderData.currentLocation.lng) *
      (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(riderData.currentLocation.lat * (Math.PI / 180)) *
        Math.cos(restaurantData.location.lat * (Math.PI / 180)) *
        Math.sin(dLng / 2) ** 2;
    distanceToPickupKm = Number(
      (6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2),
    );
  }

  if (
    riderData &&
    order.deliveryAddress?.coordinates &&
    Array.isArray(order.deliveryAddress.coordinates)
  ) {
    const custLng = order.deliveryAddress.coordinates[0];
    const custLat = order.deliveryAddress.coordinates[1];
    const dLat = (custLat - riderData.currentLocation.lat) * (Math.PI / 180);
    const dLng = (custLng - riderData.currentLocation.lng) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(riderData.currentLocation.lat * (Math.PI / 180)) *
        Math.cos(custLat * (Math.PI / 180)) *
        Math.sin(dLng / 2) ** 2;
    distanceToDeliveryKm = Number(
      (6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2),
    );
  }

  return {
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    status: order.status,
    restaurant: restaurantData,
    rider: riderData,
    deliveryAddress: order.deliveryAddress,
    distanceToPickupKm,
    distanceToDeliveryKm,
    estimatedMinutes: distanceToDeliveryKm
      ? Math.max(5, Math.round(distanceToDeliveryKm * 3.5))
      : 15,
  };
};

/* =========================================================================
   CUSTOMER ROUTES
   ========================================================================= */
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

      let restaurantIdStr =
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

      if (
        (!deliveryAddress || !deliveryAddress.line1) &&
        addressId &&
        mongoose.isValidObjectId(addressId)
      ) {
        const chosenAddr = await Address.findOne({
          _id: new mongoose.Types.ObjectId(addressId),
          userId: user.userId,
        }).lean();
        if (chosenAddr) {
          deliveryAddress = {
            label: chosenAddr.label || 'Home',
            phone: chosenAddr.phone || customer?.phone || '',
            line1: chosenAddr.line1,
            line2: chosenAddr.line2 || '',
            city: chosenAddr.city,
            state: chosenAddr.state || '',
            postalCode: chosenAddr.postalCode || '',
            coordinates: chosenAddr.location?.coordinates || [77.5946, 12.9716],
          };
        }
      }

      if (!deliveryAddress || !deliveryAddress.line1) {
        const defaultAddr =
          (await Address.findOne({
            userId: user.userId,
            isDefault: true,
          }).lean()) || (await Address.findOne({ userId: user.userId }).lean());
        if (defaultAddr) {
          deliveryAddress = {
            label: defaultAddr.label || 'Home',
            phone: defaultAddr.phone || customer?.phone || '',
            line1: defaultAddr.line1,
            line2: defaultAddr.line2 || '',
            city: defaultAddr.city,
            state: defaultAddr.state || '',
            postalCode: defaultAddr.postalCode || '',
            coordinates: defaultAddr.location?.coordinates || [
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

      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const orderNumber = `TOM-${dateStr}-${randomSuffix}`;
      const billNumber = `BILL-TOM-${dateStr}-${randomSuffix}`;

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

/* =========================================================================
   RESTAURANT ROUTES
   ========================================================================= */
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
      const rest =
        (await Restaurant.findById(user.userId)
          .select('isOpen isOnline name restaurantId')
          .lean()) ||
        (await User.findById(user.userId)
          .select('isOpen isOnline name restaurantId')
          .lean());
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

      let updated: any = await Restaurant.findByIdAndUpdate(
        user.userId,
        { $set: { isOpen, isOnline: isOpen } },
        { new: true },
      ).lean();

      if (!updated) {
        updated = await User.findByIdAndUpdate(
          user.userId,
          { $set: { isOpen, isOnline: isOpen } },
          { new: true },
        ).lean();
      }

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
      const profile =
        (await Restaurant.findById(user.userId)
          .select(
            'name restaurantId digipin email phone restaurantAddress restaurantLocation cuisine isApproved isBlocked isOpen isOnline',
          )
          .lean()) ||
        (await User.findById(user.userId)
          .select(
            'name restaurantId digipin email phone restaurantAddress restaurantLocation cuisine isApproved isBlocked isOpen isOnline',
          )
          .lean());
      const restId = profile?.restaurantId || '';
      const displayName = profile
        ? `${profile.name}${restId ? '/' + restId : ''}`
        : '';
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

      let updated = await Restaurant.findByIdAndUpdate(
        user.userId,
        { $set: updates },
        { new: true },
      );
      if (!updated) {
        updated = await User.findByIdAndUpdate(
          user.userId,
          { $set: updates },
          { new: true },
        );
      }
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

      const restUser =
        (await Restaurant.findById(user.userId).lean()) ||
        (await User.findById(user.userId).lean());

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
        const restUser =
          (await Restaurant.findById(user.userId).lean()) ||
          (await User.findById(user.userId).lean());
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
        (await Restaurant.findById(user.userId).lean()) ||
          (await User.findById(user.userId).lean()),
        order.customerId
          ? (await Customer.findById(order.customerId).lean()) ||
            (await User.findById(order.customerId).lean())
          : null,
      ]);

      const bill = formatBill(order, restaurantUser, customerUser);
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

/* =========================================================================
   RIDER / DELIVERY PARTNER ROUTES
   ========================================================================= */
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

      let updated: any = await Rider.findByIdAndUpdate(
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
      if (!updated) {
        updated = await User.findByIdAndUpdate(
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
      }

      const riderIdStr = updated?.riderId || '';
      const displayName = updated
        ? `${updated.name}${riderIdStr ? '/' + riderIdStr : ''}`
        : '';

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

      const rider =
        (await Rider.findById(user.userId)
          .select('isOnline lastLocationUpdated name riderId')
          .lean()) ||
        (await User.findById(user.userId)
          .select('isOnline lastLocationUpdated name riderId')
          .lean());
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

      let updated: any = await Rider.findByIdAndUpdate(
        user.userId,
        {
          $set: {
            isOnline,
            lastLocationUpdated: new Date(),
          },
        },
        { new: true },
      ).lean();
      if (!updated) {
        updated = await User.findByIdAndUpdate(
          user.userId,
          {
            $set: {
              isOnline,
              lastLocationUpdated: new Date(),
            },
          },
          { new: true },
        ).lean();
      }

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

      const rider =
        (await Rider.findById(user.userId)
          .select(
            'name riderId currentLocation isOnline lastLocationUpdated phone deliveryVehicle',
          )
          .lean()) ||
        (await User.findById(user.userId)
          .select(
            'name riderId currentLocation isOnline lastLocationUpdated phone deliveryVehicle',
          )
          .lean());
      if (!rider) return res.status(404).json({ message: 'Rider not found' });

      const riderIdStr = rider.riderId || '';
      return res.json({
        riderId: riderIdStr,
        displayName: `${rider.name}${riderIdStr ? '/' + riderIdStr : ''}`,
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
        ? (await Rider.findById(user.userId).select('isOnline').lean()) ||
          (await User.findById(user.userId).select('isOnline').lean())
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

        const riderUser =
          (await Rider.findById(user.userId).lean()) ||
          (await User.findById(user.userId).lean());
        if (riderUser && riderUser.isOnline === false) {
          return res.status(400).json({
            message:
              'You are currently OFFLINE. Please toggle your duty status to ONLINE in the sidebar to accept orders.',
          });
        }
        const riderCode = riderUser?.riderId || '';
        const riderDisplayName = riderUser
          ? `${riderUser.name}${riderCode ? '/' + riderCode : ''}`
          : 'Tomato Rider';

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

/* =========================================================================
   ADMIN ROUTES
   ========================================================================= */
const createAdminRouter = () => {
  const router = express.Router();
  router.use(authenticate, requireRole('admin', 'subadmin'));

  router.get('/overview', (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    return res.json({
      role: user?.role || 'admin',
      title:
        user?.adminRoleTitle ||
        (user?.role === 'subadmin' ? 'Sub-Admin' : 'Admin'),
      userId: user?.userId,
      permissions: user?.permissions || [],
      message: 'Admin API ready',
    });
  });

  router.get('/notifications', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const notifications = await Notification.find({
        $or: [{ userId: user.userId }, { role: user.role }, { role: 'admin' }],
      })
        .sort({ createdAt: -1 })
        .limit(200);
      return res.json({ notifications });
    } catch (error) {
      console.error('Admin notification fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch notifications' });
    }
  });

  // 1. Dashboard summary and analytics
  router.get(
    '/dashboard',
    requirePermission('dashboard_view'),
    async (_req: Request, res: Response) => {
      try {
        const [
          totalOrders,
          activeOrders,
          deliveredOrders,
          cancelledOrders,
          customersCount,
          restaurants,
          riders,
          orders,
        ] = await Promise.all([
          Order.countDocuments(),
          Order.countDocuments({
            status: {
              $in: [
                'placed',
                'accepted',
                'preparing',
                'ready_for_pickup',
                'out_for_delivery',
              ],
            },
          }),
          Order.countDocuments({ status: 'delivered' }),
          Order.countDocuments({ status: 'cancelled' }),
          Promise.all([
            Customer.countDocuments(),
            User.countDocuments({ role: 'customer' }),
          ]).then(([c, u]) => c + u),
          Restaurant.find().lean(),
          Promise.all([
            Rider.find().lean(),
            User.find({ role: 'deliveryPartner' }).lean(),
          ]).then(([r, u]) => [...r, ...u]),
          Order.find().sort({ createdAt: -1 }).limit(200).lean(),
        ]);

        const totalRevenue = orders
          .filter((o) => o.paymentStatus === 'paid' || o.status === 'delivered')
          .reduce((sum, o) => sum + (o.totalAmount || 0), 0);

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        todayEnd.setHours(23, 59, 59, 999);

        const todayRevenue = orders
          .filter((o) => {
            const cDate = new Date(o.createdAt);
            if (cDate < todayStart || cDate > todayEnd) return false;
            if (o.status === 'cancelled') return false;
            return (
              o.paymentStatus === 'paid' ||
              o.status === 'delivered' ||
              o.paymentMethod === 'cod'
            );
          })
          .reduce((sum, o) => sum + (o.totalAmount || 0), 0);

        const pendingRestaurants = restaurants.filter(
          (r) => r.isApproved === false,
        ).length;
        const pendingRiders = riders.filter(
          (r) => r.isApproved === false,
        ).length;

        const ordersByStatus = {
          placed: orders.filter((o) => o.status === 'placed').length,
          accepted: orders.filter((o) => o.status === 'accepted').length,
          preparing: orders.filter((o) => o.status === 'preparing').length,
          ready_for_pickup: orders.filter(
            (o) => o.status === 'ready_for_pickup',
          ).length,
          out_for_delivery: orders.filter(
            (o) => o.status === 'out_for_delivery',
          ).length,
          delivered: orders.filter((o) => o.status === 'delivered').length,
          cancelled: orders.filter((o) => o.status === 'cancelled').length,
        };

        const revenueByRestaurantMap = new Map<
          string,
          { name: string; revenue: number; orderCount: number }
        >();
        for (const order of orders) {
          const rName = order.restaurantName || 'Other Kitchen';
          const entry = revenueByRestaurantMap.get(rName) || {
            name: rName,
            revenue: 0,
            orderCount: 0,
          };
          entry.revenue += order.totalAmount || 0;
          entry.orderCount += 1;
          revenueByRestaurantMap.set(rName, entry);
        }

        const revenueByRestaurant = Array.from(revenueByRestaurantMap.values())
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 5);

        return res.json({
          kpis: {
            totalOrders,
            activeOrders,
            deliveredOrders,
            cancelledOrders,
            totalRevenue,
            todayRevenue,
            totalCustomers: customersCount,
            totalRestaurants: restaurants.length,
            pendingRestaurants,
            totalRiders: riders.length,
            pendingRiders,
          },
          ordersByStatus,
          revenueByRestaurant,
          recentOrders: orders.slice(0, 10),
        });
      } catch (error) {
        console.error('Admin dashboard fetch failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to fetch dashboard statistics' });
      }
    },
  );

  // 2. View all platform orders with 1-day paging (Page 1 = Today, Page 2 = Yesterday, etc.), date range, search, status, and archive filters
  router.get(
    '/orders',
    requirePermission('orders_manage'),
    async (req: Request, res: Response) => {
      try {
        const {
          status,
          startDate,
          endDate,
          search,
          archived,
          page,
          date,
          byRange,
        } = req.query;
        const baseFilter: Record<string, any> = {};

        if (typeof status === 'string' && status !== 'all' && status.trim()) {
          baseFilter.status = status.trim();
        }

        // Archive filter: 'active' (default), 'archived', 'all'
        if (archived === 'archived' || archived === 'true') {
          baseFilter.isArchived = true;
        } else if (archived === 'all') {
          // do not filter by isArchived
        } else {
          // default: show active orders
          baseFilter.isArchived = { $ne: true };
        }

        // Search term
        if (typeof search === 'string' && search.trim()) {
          const term = search.trim();
          const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          baseFilter.$or = [
            { orderNumber: { $regex: escaped, $options: 'i' } },
            { customerName: { $regex: escaped, $options: 'i' } },
            { customerPhone: { $regex: escaped, $options: 'i' } },
            { restaurantName: { $regex: escaped, $options: 'i' } },
            { riderName: { $regex: escaped, $options: 'i' } },
          ];
        }

        // If byRange === 'true' and both startDate & endDate are given, support full range query (e.g. for bulk period actions)
        if (
          byRange === 'true' &&
          typeof startDate === 'string' &&
          startDate.trim() &&
          typeof endDate === 'string' &&
          endDate.trim()
        ) {
          const start = new Date(`${startDate.trim()}T00:00:00+05:30`);
          const end = new Date(`${endDate.trim()}T23:59:59.999+05:30`);
          const rangeFilter = {
            ...baseFilter,
            createdAt: { $gte: start, $lte: end },
          };
          const orders = await Order.find(rangeFilter).sort({ createdAt: -1 });
          const totalMatching = await Order.countDocuments(rangeFilter);
          return res.json({
            orders,
            totalMatching,
            isRangeQuery: true,
            startDate,
            endDate,
          });
        }

        // Determine Today & Yesterday in +05:30
        const now = new Date();
        const todayStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Kolkata',
        }).format(now);
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const yesterdayStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Kolkata',
        }).format(yesterday);

        // Find all distinct dates with orders matching baseFilter
        const dateAggregation = await Order.aggregate([
          { $match: baseFilter },
          {
            $project: {
              dateStr: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$createdAt',
                  timezone: '+05:30',
                },
              },
            },
          },
          { $group: { _id: '$dateStr', count: { $sum: 1 } } },
          { $sort: { _id: -1 } },
        ]);

        const dateCountsMap = new Map<string, number>();
        dateAggregation.forEach((item: any) => {
          if (item._id) dateCountsMap.set(item._id, item.count);
        });

        // Distinct dates list in descending order
        const availableDatesSet = new Set<string>();
        // Page 1 is ALWAYS Today (current page shows today's orders)
        availableDatesSet.add(todayStr);
        dateAggregation.forEach((item: any) => {
          if (item._id) availableDatesSet.add(item._id);
        });

        const availableDatesList = Array.from(availableDatesSet);
        // Sort descending (today first, then yesterday, then earlier dates)
        availableDatesList.sort((a, b) => b.localeCompare(a));

        // Resolve requested date / page
        let targetDateStr = '';
        let pageNum = 1;

        if (
          typeof date === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(date.trim())
        ) {
          targetDateStr = date.trim();
          const foundIndex = availableDatesList.indexOf(targetDateStr);
          if (foundIndex >= 0) {
            pageNum = foundIndex + 1;
          } else {
            // If a custom date was selected that has 0 orders, insert in sorted list
            availableDatesList.push(targetDateStr);
            availableDatesList.sort((a, b) => b.localeCompare(a));
            pageNum = availableDatesList.indexOf(targetDateStr) + 1;
          }
        } else {
          const rawPage = parseInt(String(page || '1'), 10);
          pageNum = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
          if (pageNum > availableDatesList.length) {
            pageNum = availableDatesList.length || 1;
          }
          targetDateStr = availableDatesList[pageNum - 1] || todayStr;
        }

        // Query orders for this 1 target day only
        const startOfDay = new Date(`${targetDateStr}T00:00:00+05:30`);
        const endOfDay = new Date(`${targetDateStr}T23:59:59.999+05:30`);

        const dayFilter = {
          ...baseFilter,
          createdAt: { $gte: startOfDay, $lte: endOfDay },
        };

        const orders = await Order.find(dayFilter).sort({ createdAt: -1 });
        const ordersOnThisDate = orders.length;

        // Helper to format friendly date label
        const formatDateLabel = (dStr: string) => {
          try {
            const parts = dStr.split('-');
            const dObj = new Date(
              Number(parts[0]),
              Number(parts[1]) - 1,
              Number(parts[2]),
            );
            const formatted = dObj.toLocaleDateString('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            });
            if (dStr === todayStr) return `Today (${formatted})`;
            if (dStr === yesterdayStr) return `Yesterday (${formatted})`;
            return formatted;
          } catch {
            if (dStr === todayStr) return `Today (${dStr})`;
            if (dStr === yesterdayStr) return `Yesterday (${dStr})`;
            return dStr;
          }
        };

        const paginationDates = availableDatesList.map((dStr, idx) => ({
          page: idx + 1,
          date: dStr,
          label: formatDateLabel(dStr),
          orderCount: dateCountsMap.get(dStr) || 0,
          isToday: dStr === todayStr,
          isYesterday: dStr === yesterdayStr,
        }));

        const totalAllOrders = await Order.countDocuments(baseFilter);

        return res.json({
          orders,
          totalMatching: ordersOnThisDate,
          pagination: {
            currentPage: pageNum,
            totalPages: availableDatesList.length,
            currentDate: targetDateStr,
            currentDateLabel: formatDateLabel(targetDateStr),
            isToday: targetDateStr === todayStr,
            isYesterday: targetDateStr === yesterdayStr,
            ordersOnThisDate,
            totalAllOrders,
            hasNextPage: pageNum < availableDatesList.length,
            hasPrevPage: pageNum > 1,
            dates: paginationDates,
          },
        });
      } catch (error) {
        console.error('Admin orders fetch failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to fetch platform orders' });
      }
    },
  );

  // 2a. Archive / unarchive single platform order
  router.put(
    '/orders/:orderId/archive',
    requirePermission('orders_manage'),
    async (req: Request, res: Response) => {
      try {
        const orderId = req.params.orderId;
        if (!mongoose.isValidObjectId(orderId)) {
          return res.status(400).json({ message: 'Invalid order ID' });
        }

        const order = await Order.findById(orderId);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        const targetArchived =
          req.body?.isArchived !== undefined
            ? Boolean(req.body.isArchived)
            : !order.isArchived;
        const updated = await Order.findByIdAndUpdate(
          orderId,
          {
            $set: {
              isArchived: targetArchived,
              archivedAt: targetArchived ? new Date() : null,
              archivedBy:
                (req as AuthenticatedRequest).user?.name || 'Platform Admin',
            },
          },
          { new: true },
        );

        const orderDisplayNum =
          updated?.orderNumber || String(updated?._id).slice(-6).toUpperCase();

        return res.json({
          message: `Order #${orderDisplayNum} ${targetArchived ? 'archived' : 'unarchived'} successfully`,
          order: updated,
        });
      } catch (error) {
        console.error('Archive order failed:', error);
        return res.status(500).json({ message: 'Unable to archive order' });
      }
    },
  );

  // 2b. Permanently delete single platform order
  router.delete(
    '/orders/:orderId',
    requirePermission('orders_manage'),
    async (req: Request, res: Response) => {
      try {
        const orderId = req.params.orderId;
        if (!mongoose.isValidObjectId(orderId)) {
          return res.status(400).json({ message: 'Invalid order ID' });
        }

        const order = await Order.findByIdAndDelete(orderId);
        if (!order) return res.status(404).json({ message: 'Order not found' });

        return res.json({
          message: `Order #${order.orderNumber} deleted permanently`,
          orderId,
        });
      } catch (error) {
        console.error('Delete order failed:', error);
        return res.status(500).json({ message: 'Unable to delete order' });
      }
    },
  );

  // 2c. Bulk archive / unarchive orders (by IDs or by date range)
  router.post(
    '/orders/bulk-archive',
    requirePermission('orders_manage'),
    async (req: Request, res: Response) => {
      try {
        const { orderIds, startDate, endDate, isArchived, status } = req.body;
        const targetArchived =
          isArchived !== undefined ? Boolean(isArchived) : true;
        const filter: Record<string, any> = {};

        if (Array.isArray(orderIds) && orderIds.length > 0) {
          filter._id = {
            $in: orderIds
              .filter((id: string) => mongoose.isValidObjectId(id))
              .map((id: string) => new mongoose.Types.ObjectId(id)),
          };
        } else if (startDate || endDate) {
          if (startDate) {
            filter.createdAt = {
              ...(filter.createdAt || {}),
              $gte: new Date(`${startDate}T00:00:00`),
            };
          }
          if (endDate) {
            filter.createdAt = {
              ...(filter.createdAt || {}),
              $lte: new Date(`${endDate}T23:59:59.999`),
            };
          }
          if (status && status !== 'all') {
            filter.status = status;
          }
        } else {
          return res
            .status(400)
            .json({
              message: 'Specify orderIds or date range for bulk archive',
            });
        }

        const result = await Order.updateMany(filter, {
          $set: {
            isArchived: targetArchived,
            archivedAt: targetArchived ? new Date() : null,
            archivedBy:
              (req as AuthenticatedRequest).user?.name || 'Platform Admin',
          },
        });

        return res.json({
          message: `Successfully ${targetArchived ? 'archived' : 'unarchived'} ${result.modifiedCount} order(s)`,
          modifiedCount: result.modifiedCount,
        });
      } catch (error) {
        console.error('Bulk archive failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to perform bulk archive' });
      }
    },
  );

  // 2d. Bulk permanently delete orders (by IDs or by date range)
  router.post(
    '/orders/bulk-delete',
    requirePermission('orders_manage'),
    async (req: Request, res: Response) => {
      try {
        const { orderIds, startDate, endDate, status } = req.body;
        const filter: Record<string, any> = {};

        if (Array.isArray(orderIds) && orderIds.length > 0) {
          filter._id = {
            $in: orderIds
              .filter((id: string) => mongoose.isValidObjectId(id))
              .map((id: string) => new mongoose.Types.ObjectId(id)),
          };
        } else if (startDate || endDate) {
          if (startDate) {
            filter.createdAt = {
              ...(filter.createdAt || {}),
              $gte: new Date(`${startDate}T00:00:00`),
            };
          }
          if (endDate) {
            filter.createdAt = {
              ...(filter.createdAt || {}),
              $lte: new Date(`${endDate}T23:59:59.999`),
            };
          }
          if (status && status !== 'all') {
            filter.status = status;
          }
        } else {
          return res
            .status(400)
            .json({
              message: 'Specify orderIds or date range for bulk deletion',
            });
        }

        const result = await Order.deleteMany(filter);

        return res.json({
          message: `Successfully deleted ${result.deletedCount} order(s) permanently`,
          deletedCount: result.deletedCount,
        });
      } catch (error) {
        console.error('Bulk delete failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to perform bulk deletion' });
      }
    },
  );

  // 3. User management: List, Add, Update, Approve, Block (with pagination)
  router.get('/users', async (req: Request, res: Response) => {
    try {
      const currentUser = (req as AuthenticatedRequest).user;
      const { role, search, page, limit, all } = req.query;

      const pageParam = parseInt(String(page || '1'), 10);
      const pageNum =
        Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
      const limitParam = parseInt(String(limit || '10'), 10);
      const pageSize =
        Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 10;
      const isAll = all === 'true';

      const paginateList = (list: any[]) => {
        const totalItems = list.length;
        if (isAll) {
          return {
            users: list,
            totalMatching: totalItems,
            pagination: {
              currentPage: 1,
              totalPages: 1,
              totalItems,
              pageSize: totalItems,
              hasNextPage: false,
              hasPrevPage: false,
            },
          };
        }
        const totalPages = Math.ceil(totalItems / pageSize) || 1;
        const safePage = Math.min(pageNum, totalPages);
        const paginatedUsers = list.slice(
          (safePage - 1) * pageSize,
          safePage * pageSize,
        );
        return {
          users: paginatedUsers,
          totalMatching: totalItems,
          pagination: {
            currentPage: safePage,
            totalPages,
            totalItems,
            pageSize,
            hasNextPage: safePage < totalPages,
            hasPrevPage: safePage > 1,
          },
        };
      };

      if (currentUser?.role === 'subadmin') {
        const perms = currentUser.permissions || [];
        if (role === 'restaurant' && !perms.includes('restaurants_manage')) {
          return res
            .status(403)
            .json({
              message: 'Access denied. Requires restaurants_manage permission.',
            });
        }
        if (role === 'deliveryPartner' && !perms.includes('riders_manage')) {
          return res
            .status(403)
            .json({
              message: 'Access denied. Requires riders_manage permission.',
            });
        }
        if (role === 'customer' && !perms.includes('customers_manage')) {
          return res
            .status(403)
            .json({
              message: 'Access denied. Requires customers_manage permission.',
            });
        }
        if (role === 'subadmin' && !perms.includes('subadmins_manage')) {
          return res
            .status(403)
            .json({
              message: 'Access denied. Requires subadmins_manage permission.',
            });
        }
      }

      if (role === 'restaurant') {
        const restFilter: Record<string, unknown> = {};
        if (typeof search === 'string' && search.trim()) {
          const term = search.trim();
          const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const orConditions: any[] = [
            { name: { $regex: escaped, $options: 'i' } },
            { email: { $regex: escaped, $options: 'i' } },
            { phone: { $regex: escaped, $options: 'i' } },
            { restaurantId: { $regex: escaped, $options: 'i' } },
            { digipin: { $regex: escaped, $options: 'i' } },
            {
              $expr: {
                $regexMatch: {
                  input: { $toString: '$_id' },
                  regex: escaped,
                  options: 'i',
                },
              },
            },
          ];
          if (mongoose.isValidObjectId(term)) {
            orConditions.push({ _id: new mongoose.Types.ObjectId(term) });
          }
          restFilter.$or = orConditions;
        }
        const [restaurants, legacyRestaurants] = await Promise.all([
          Restaurant.find(restFilter).sort({ createdAt: -1 }),
          User.find({ ...restFilter, role: 'restaurant' }).sort({
            createdAt: -1,
          }),
        ]);
        const combined = [
          ...restaurants.map((r) => userResponse(r as any)),
          ...legacyRestaurants.map((u) => userResponse(u)),
        ];
        return res.json({ users: combined });
        return res.json(paginateList(combined));
      }

      if (role === 'customer') {
        const custFilter: Record<string, unknown> = {};
        if (typeof search === 'string' && search.trim()) {
          const term = search.trim();
          const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const orConditions: any[] = [
            { name: { $regex: escaped, $options: 'i' } },
            { email: { $regex: escaped, $options: 'i' } },
            { phone: { $regex: escaped, $options: 'i' } },
            { customerId: { $regex: escaped, $options: 'i' } },
            {
              $expr: {
                $regexMatch: {
                  input: { $toString: '$_id' },
                  regex: escaped,
                  options: 'i',
                },
              },
            },
          ];
          if (mongoose.isValidObjectId(term)) {
            orConditions.push({ _id: new mongoose.Types.ObjectId(term) });
          }
          custFilter.$or = orConditions;
        }
        const [customers, legacyCustomers] = await Promise.all([
          Customer.find(custFilter).sort({ createdAt: -1 }),
          User.find({ ...custFilter, role: 'customer' }).sort({
            createdAt: -1,
          }),
        ]);
        const combined = [
          ...customers.map((c) => userResponse(c as any)),
          ...legacyCustomers.map((u) => userResponse(u)),
        ];
        return res.json({ users: combined });
        return res.json(paginateList(combined));
      }

      if (role === 'deliveryPartner') {
        const riderFilter: Record<string, unknown> = {};
        if (typeof search === 'string' && search.trim()) {
          const term = search.trim();
          const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const orConditions: any[] = [
            { name: { $regex: escaped, $options: 'i' } },
            { email: { $regex: escaped, $options: 'i' } },
            { phone: { $regex: escaped, $options: 'i' } },
            { riderId: { $regex: escaped, $options: 'i' } },
            {
              $expr: {
                $regexMatch: {
                  input: { $toString: '$_id' },
                  regex: escaped,
                  options: 'i',
                },
              },
            },
          ];
          if (mongoose.isValidObjectId(term)) {
            orConditions.push({ _id: new mongoose.Types.ObjectId(term) });
          }
          riderFilter.$or = orConditions;
        }
        const [riders, legacyRiders] = await Promise.all([
          Rider.find(riderFilter).sort({ createdAt: -1 }),
          User.find({ ...riderFilter, role: 'deliveryPartner' }).sort({
            createdAt: -1,
          }),
        ]);
        const combined = [
          ...riders.map((r) => userResponse(r as any)),
          ...legacyRiders.map((u) => userResponse(u)),
        ];
        return res.json({ users: combined });
        return res.json(paginateList(combined));
      }

      const filter: Record<string, unknown> = {};
      if (typeof role === 'string' && USER_ROLES.includes(role as UserRole)) {
        filter.role = role;
      }

      if (typeof search === 'string' && search.trim()) {
        const term = search.trim();
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const orConditions: any[] = [
          { name: { $regex: escaped, $options: 'i' } },
          { email: { $regex: escaped, $options: 'i' } },
          { phone: { $regex: escaped, $options: 'i' } },
          { restaurantId: { $regex: escaped, $options: 'i' } },
          { riderId: { $regex: escaped, $options: 'i' } },
          { customerId: { $regex: escaped, $options: 'i' } },
          { subadminId: { $regex: escaped, $options: 'i' } },
          {
            $expr: {
              $regexMatch: {
                input: { $toString: '$_id' },
                regex: escaped,
                options: 'i',
              },
            },
          },
        ];
        if (mongoose.isValidObjectId(term)) {
          orConditions.push({ _id: new mongoose.Types.ObjectId(term) });
        }
        filter.$or = orConditions;
      }

      if (!role) {
        const restFilter: Record<string, unknown> = {};
        const riderFilter: Record<string, unknown> = {};
        const custFilter: Record<string, unknown> = {};

        if (typeof search === 'string' && search.trim()) {
          const term = search.trim();
          const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const commonOr: any[] = [
            { name: { $regex: escaped, $options: 'i' } },
            { email: { $regex: escaped, $options: 'i' } },
            { phone: { $regex: escaped, $options: 'i' } },
            {
              $expr: {
                $regexMatch: {
                  input: { $toString: '$_id' },
                  regex: escaped,
                  options: 'i',
                },
              },
            },
          ];
          if (mongoose.isValidObjectId(term)) {
            commonOr.push({ _id: new mongoose.Types.ObjectId(term) });
          }

          restFilter.$or = [
            ...commonOr,
            { restaurantId: { $regex: escaped, $options: 'i' } },
            { digipin: { $regex: escaped, $options: 'i' } },
          ];
          riderFilter.$or = [
            ...commonOr,
            { riderId: { $regex: escaped, $options: 'i' } },
          ];
          custFilter.$or = [
            ...commonOr,
            { customerId: { $regex: escaped, $options: 'i' } },
          ];
        }

        const [users, restaurants, riders, customers] = await Promise.all([
          User.find(filter).sort({ createdAt: -1 }),
          Restaurant.find(restFilter).sort({ createdAt: -1 }),
          Rider.find(riderFilter).sort({ createdAt: -1 }),
          Customer.find(custFilter).sort({ createdAt: -1 }),
        ]);

        const combined = [
          ...users.map((u) => userResponse(u)),
          ...restaurants.map((r) => userResponse(r as any)),
          ...riders.map((r) => userResponse(r as any)),
          ...customers.map((c) => userResponse(c as any)),
        ];
        combined.sort(
          (a: any, b: any) =>
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime(),
        );
        return res.json({ users: combined });
        return res.json(paginateList(combined));
      }

      const users = await User.find(filter).sort({ createdAt: -1 });
      return res.json({
        users: users.map((u) => userResponse(u)),
      });
      return res.json(paginateList(users.map((u) => userResponse(u))));
    } catch (error) {
      console.error('Admin users fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch users' });
    }
  });

  // Add new user / restaurant / rider directly by Admin
  router.post('/users', async (req: Request, res: Response) => {
    try {
      const {
        name,
        email,
        phone,
        password,
        role,
        restaurantAddress,
        cuisine,
        deliveryVehicle,
      } = req.body;
      if (!name || (!email && !phone) || !password || !role) {
        return res.status(400).json({
          message: 'Name, email/phone, password, and role are required',
        });
      }

      const duplicateQuery = {
        $or: [
          ...(email ? [{ email: email.trim().toLowerCase() }] : []),
          ...(phone ? [{ phone: phone.trim() }] : []),
        ],
      };

      const [
        existingUser,
        existingRestaurant,
        existingRider,
        existingCustomer,
      ] = await Promise.all([
        User.findOne(duplicateQuery),
        Restaurant.findOne(duplicateQuery),
        Rider.findOne(duplicateQuery),
        Customer.findOne(duplicateQuery),
      ]);

      if (
        existingUser ||
        existingRestaurant ||
        existingRider ||
        existingCustomer
      ) {
        return res
          .status(409)
          .json({ message: 'Account with that email or phone already exists' });
      }

      if (role === 'restaurant') {
        const restaurantId = await generateRestaurantId();
        let digipin =
          typeof req.body?.digipin === 'string'
            ? req.body.digipin.trim().toUpperCase()
            : '';
        let restaurantLocation: { lat: number; lng: number } = {
          lat: 12.9716,
          lng: 77.5946,
        };
        const rawLat = req.body?.restaurantLocation?.lat ?? req.body?.lat;
        const rawLng = req.body?.restaurantLocation?.lng ?? req.body?.lng;
        if (
          rawLat !== undefined &&
          rawLng !== undefined &&
          !isNaN(Number(rawLat)) &&
          !isNaN(Number(rawLng))
        ) {
          restaurantLocation = { lat: Number(rawLat), lng: Number(rawLng) };
        }
        if (!digipin) {
          digipin = `DGP-${Math.round(restaurantLocation.lat * 100)}-${Math.round(restaurantLocation.lng * 100)}`;
        }

        const restaurant = await Restaurant.create({
          name: name.trim(),
          email: email ? email.trim().toLowerCase() : undefined,
          phone: phone ? phone.trim() : undefined,
          passwordHash: await hashPassword(password),
          role: 'restaurant',
          isApproved: true,
          isBlocked: false,
          restaurantId,
          digipin,
          restaurantAddress: restaurantAddress ? restaurantAddress.trim() : '',
          restaurantLocation,
          cuisine: cuisine ? cuisine.trim() : 'Multi-cuisine',
          isOpen: true,
          isOnline: true,
        });

        return res.status(201).json({
          message: 'Restaurant created successfully',
          user: userResponse(restaurant as any),
        });
      }

      if (role === 'customer') {
        const customerId = await generateCustomerId();
        const customer = await Customer.create({
          name: name.trim(),
          email: email ? email.trim().toLowerCase() : undefined,
          phone: phone ? phone.trim() : undefined,
          passwordHash: await hashPassword(password),
          role: 'customer',
          isApproved: true,
          isBlocked: false,
          customerId,
        } as unknown as ICustomer);

        return res.status(201).json({
          message: 'Customer created successfully',
          user: userResponse(customer as any),
        });
      }

      if (role === 'deliveryPartner') {
        const riderId = await generateRiderId();
        let currentLocation: { lat: number; lng: number } = {
          lat: 12.9716,
          lng: 77.5946,
        };
        const rLat = req.body?.currentLocation?.lat ?? req.body?.lat;
        const rLng = req.body?.currentLocation?.lng ?? req.body?.lng;
        if (rLat !== undefined && rLng !== undefined && !isNaN(Number(rLat))) {
          currentLocation = { lat: Number(rLat), lng: Number(rLng) };
        }

        const rider = await Rider.create({
          name: name.trim(),
          email: email ? email.trim().toLowerCase() : undefined,
          phone: phone ? phone.trim() : undefined,
          passwordHash: await hashPassword(password),
          role: 'deliveryPartner',
          isApproved: true,
          isBlocked: false,
          riderId,
          deliveryVehicle: deliveryVehicle
            ? deliveryVehicle.trim()
            : 'motorcycle',
          currentLocation,
          isOnline: true,
          lastLocationUpdated: new Date(),
        } as unknown as IRider);

        return res.status(201).json({
          message: 'Delivery partner created successfully',
          user: userResponse(rider as any),
        });
      }

      const userData: Record<string, unknown> = {
        name: name.trim(),
        email: email ? email.trim().toLowerCase() : undefined,
        phone: phone ? phone.trim() : undefined,
        passwordHash: await hashPassword(password),
        role,
        isApproved: true,
        isBlocked: false,
      };

      const user = await User.create(userData);

      return res.status(201).json({
        message: 'User created successfully',
        user: userResponse(user),
      });
    } catch (error) {
      console.error('Admin create user failed:', error);
      return res.status(500).json({ message: 'Unable to create user' });
    }
  });

  // Update user
  router.put('/users/:userId', async (req: Request, res: Response) => {
    try {
      const userId = String(req.params.userId || '');
      if (!userId || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: 'Valid user ID is required' });
      }

      const {
        name,
        email,
        phone,
        role,
        restaurantAddress,
        cuisine,
        deliveryVehicle,
        digipin,
      } = req.body;

      const updates: Record<string, unknown> = {};
      if (name) updates.name = name.trim();
      if (email) updates.email = email.trim().toLowerCase();
      if (phone) updates.phone = phone.trim();
      if (role && USER_ROLES.includes(role)) updates.role = role;
      if (restaurantAddress !== undefined)
        updates.restaurantAddress = restaurantAddress.trim();
      if (cuisine !== undefined) updates.cuisine = cuisine.trim();
      if (deliveryVehicle !== undefined)
        updates.deliveryVehicle = deliveryVehicle.trim();
      if (typeof digipin === 'string')
        updates.digipin = digipin.trim().toUpperCase();
      if (
        req.body?.lat !== undefined &&
        req.body?.lng !== undefined &&
        !isNaN(Number(req.body.lat))
      ) {
        updates.restaurantLocation = {
          lat: Number(req.body.lat),
          lng: Number(req.body.lng),
        };
      }

      let user: any = await Restaurant.findByIdAndUpdate(
        userId,
        { $set: updates },
        { new: true, runValidators: true },
      );
      if (!user) {
        user = await Rider.findByIdAndUpdate(
          userId,
          { $set: updates },
          { new: true, runValidators: true },
        );
      }
      if (!user) {
        user = await Customer.findByIdAndUpdate(
          userId,
          { $set: updates },
          { new: true, runValidators: true },
        );
      }
      if (!user) {
        user = await User.findByIdAndUpdate(
          userId,
          { $set: updates },
          { new: true, runValidators: true },
        );
      }
      if (!user) return res.status(404).json({ message: 'User not found' });

      return res.json({
        message: 'User updated successfully',
        user: userResponse(user),
      });
    } catch (error) {
      console.error('Admin update user failed:', error);
      return res.status(500).json({ message: 'Unable to update user' });
    }
  });

  // Live Rider Fleet Tracking for Admin
  router.get(
    '/riders/live-locations',
    requirePermission('riders_manage'),
    async (_req: Request, res: Response) => {
      try {
        const [riders, legacyRiders] = await Promise.all([
          Rider.find()
            .select(
              'name riderId phone email currentLocation isOnline lastLocationUpdated deliveryVehicle isApproved isBlocked',
            )
            .lean(),
          User.find({ role: 'deliveryPartner' })
            .select(
              'name riderId phone email currentLocation isOnline lastLocationUpdated deliveryVehicle isApproved isBlocked',
            )
            .lean(),
        ]);
        const allRiders = [...riders, ...legacyRiders];

        // Find active orders assigned to riders
        const activeOrders = await Order.find({
          status: {
            $in: [
              'accepted',
              'preparing',
              'ready_for_pickup',
              'out_for_delivery',
            ],
          },
          riderId: { $ne: null },
        })
          .select(
            'orderNumber status riderId restaurantName restaurantLocation deliveryAddress totalAmount',
          )
          .lean();

        const orderMap = new Map();
        activeOrders.forEach((o) => {
          if (o.riderId) orderMap.set(String(o.riderId), o);
        });

        return res.json({
          riders: allRiders.map((r) => {
            const riderIdStr = r.riderId || '';
            return {
              ...userResponse(r as unknown as IUser),
              displayName: `${r.name}${riderIdStr ? '/' + riderIdStr : ''}`,
              activeOrder: orderMap.get(String(r._id)) || null,
            };
          }),
        });
      } catch (error) {
        console.error('Fetch live rider locations failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to fetch rider live locations' });
      }
    },
  );

  // Live order tracking for Admin
  router.get(
    '/orders/:orderId/live-tracking',
    requirePermission('orders_manage'),
    async (req: Request, res: Response) => {
      try {
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
        console.error('Admin order live tracking fetch failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to fetch live tracking' });
      }
    },
  );

  // Approve rider or restaurant
  router.post('/users/:userId/approve', async (req: Request, res: Response) => {
    try {
      const userId = String(req.params.userId || '');
      if (!userId || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: 'Valid user ID is required' });
      }

      let user: any = await Restaurant.findByIdAndUpdate(
        userId,
        { $set: { isApproved: true } },
        { new: true },
      );
      if (!user) {
        user = await Rider.findByIdAndUpdate(
          userId,
          { $set: { isApproved: true } },
          { new: true },
        );
      }
      if (!user) {
        user = await Customer.findByIdAndUpdate(
          userId,
          { $set: { isApproved: true } },
          { new: true },
        );
      }
      if (!user) {
        user = await User.findByIdAndUpdate(
          userId,
          { $set: { isApproved: true } },
          { new: true },
        );
      }
      if (!user) return res.status(404).json({ message: 'User not found' });

      await Notification.create({
        userId: String(user._id),
        role: user.role,
        title: 'Account Approved!',
        message:
          'Your Tomato partner profile has been approved by the platform administrator.',
        type: 'service',
      });

      return res.json({
        message: `${user.name} approved successfully`,
        user: userResponse(user),
      });
    } catch (error) {
      console.error('Approve user failed:', error);
      return res.status(500).json({ message: 'Unable to approve user' });
    }
  });

  // Reject rider or restaurant
  router.post('/users/:userId/reject', async (req: Request, res: Response) => {
    try {
      const userId = String(req.params.userId || '');
      if (!userId || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: 'Valid user ID is required' });
      }

      let user: any = await Restaurant.findByIdAndUpdate(
        userId,
        { $set: { isApproved: false } },
        { new: true },
      );
      if (!user) {
        user = await Rider.findByIdAndUpdate(
          userId,
          { $set: { isApproved: false } },
          { new: true },
        );
      }
      if (!user) {
        user = await Customer.findByIdAndUpdate(
          userId,
          { $set: { isApproved: false } },
          { new: true },
        );
      }
      if (!user) {
        user = await User.findByIdAndUpdate(
          userId,
          { $set: { isApproved: false } },
          { new: true },
        );
      }
      if (!user) return res.status(404).json({ message: 'User not found' });

      return res.json({
        message: `${user.name} approval revoked / rejected`,
        user: userResponse(user),
      });
    } catch (error) {
      console.error('Reject user failed:', error);
      return res.status(500).json({ message: 'Unable to reject user' });
    }
  });

  // Block any rider, restaurant, or customer
  router.post('/users/:userId/block', async (req: Request, res: Response) => {
    try {
      const userId = String(req.params.userId || '');
      if (!userId || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: 'Valid user ID is required' });
      }

      let user: any = await Restaurant.findByIdAndUpdate(
        userId,
        { $set: { isBlocked: true } },
        { new: true },
      );
      if (!user) {
        user = await Rider.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: true } },
          { new: true },
        );
      }
      if (!user) {
        user = await Customer.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: true } },
          { new: true },
        );
      }
      if (!user) {
        user = await User.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: true } },
          { new: true },
        );
      }
      if (!user) return res.status(404).json({ message: 'User not found' });

      await Notification.create({
        userId: String(user._id),
        role: user.role,
        title: 'Account Notice',
        message:
          'Your account access has been restricted by the administrator.',
        type: 'system',
      });

      return res.json({
        message: `${user.name} blocked successfully`,
        user: userResponse(user),
      });
    } catch (error) {
      console.error('Block user failed:', error);
      return res.status(500).json({ message: 'Unable to block user' });
    }
  });

  // Unblock user
  router.post('/users/:userId/unblock', async (req: Request, res: Response) => {
    try {
      const userId = String(req.params.userId || '');
      if (!userId || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: 'Valid user ID is required' });
      }

      let user: any = await Restaurant.findByIdAndUpdate(
        userId,
        { $set: { isBlocked: false } },
        { new: true },
      );
      if (!user) {
        user = await Rider.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: false } },
          { new: true },
        );
      }
      if (!user) {
        user = await Customer.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: false } },
          { new: true },
        );
      }
      if (!user) {
        user = await User.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: false } },
          { new: true },
        );
      }
      if (!user) return res.status(404).json({ message: 'User not found' });

      await Notification.create({
        userId: String(user._id),
        role: user.role,
        title: 'Account Restored',
        message: 'Your account has been unblocked. Welcome back to Tomato!',
        type: 'service',
      });

      return res.json({
        message: `${user.name} unblocked successfully`,
        user: userResponse(user),
      });
    } catch (error) {
      console.error('Unblock user failed:', error);
      return res.status(500).json({ message: 'Unable to unblock user' });
    }
  });

  // =========================================================================
  // SUB-ADMIN MANAGEMENT & ROLE-BASED ACCESS CONTROL (RBAC)
  // =========================================================================

  // List all sub-admins with their permissions
  router.get(
    '/subadmins',
    requirePermission('subadmins_manage'),
    async (req: Request, res: Response) => {
      try {
        const { search } = req.query;
        const filter: Record<string, any> = { role: 'subadmin' };

        if (typeof search === 'string' && search.trim()) {
          const term = search.trim();
          const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const orConditions: any[] = [
            { name: { $regex: escaped, $options: 'i' } },
            { email: { $regex: escaped, $options: 'i' } },
            { phone: { $regex: escaped, $options: 'i' } },
            { adminRoleTitle: { $regex: escaped, $options: 'i' } },
            { subadminId: { $regex: escaped, $options: 'i' } },
            {
              $expr: {
                $regexMatch: {
                  input: { $toString: '$_id' },
                  regex: escaped,
                  options: 'i',
                },
              },
            },
          ];
          if (mongoose.isValidObjectId(term)) {
            orConditions.push({ _id: new mongoose.Types.ObjectId(term) });
          }
          filter.$or = orConditions;
        }

        const subadmins = await User.find(filter).sort({ createdAt: -1 });
        return res.json({
          subadmins: subadmins.map((u) => userResponse(u)),
          total: subadmins.length,
        });
      } catch (error) {
        console.error('Fetch sub-admins failed:', error);
        return res.status(500).json({ message: 'Unable to fetch sub-admins' });
      }
    },
  );

  // Create new sub-admin and assign operational role + permissions
  router.post(
    '/subadmins',
    requirePermission('subadmins_manage'),
    async (req: Request, res: Response) => {
      try {
        const creator = (req as AuthenticatedRequest).user;
        const { name, email, phone, password, adminRoleTitle, permissions } =
          req.body;

        if (!name || (!email && !phone) || !password) {
          return res
            .status(400)
            .json({
              message: 'Name, email or phone, and password are required',
            });
        }

        if (typeof password !== 'string' || password.length < 8) {
          return res
            .status(400)
            .json({ message: 'Password must be at least 8 characters long' });
        }

        const cleanEmail =
          typeof email === 'string' ? email.trim().toLowerCase() : '';
        const cleanPhone = typeof phone === 'string' ? phone.trim() : '';

        const existing = await User.findOne({
          $or: [
            ...(cleanEmail ? [{ email: cleanEmail }] : []),
            ...(cleanPhone ? [{ phone: cleanPhone }] : []),
          ],
        });

        if (existing) {
          return res
            .status(409)
            .json({
              message: 'An account with that email or phone already exists',
            });
        }

        const allowedPermissions = [
          'dashboard_view',
          'orders_manage',
          'restaurants_manage',
          'riders_manage',
          'customers_manage',
          'subadmins_manage',
        ];

        const safePermissions = Array.isArray(permissions)
          ? permissions.filter(
              (p: unknown) =>
                typeof p === 'string' &&
                (allowedPermissions.includes(p) || p === '*'),
            )
          : ['orders_manage'];

        const subAdminData: Record<string, any> = {
          name: name.trim(),
          subadminId: await generateSubAdminId(),
          passwordHash: await hashPassword(password),
          role: 'subadmin',
          isApproved: true,
          isBlocked: false,
          adminRoleTitle:
            adminRoleTitle && typeof adminRoleTitle === 'string'
              ? adminRoleTitle.trim()
              : 'Operations Sub-Admin',
          permissions: safePermissions,
          createdBy: creator?.name || creator?.email || 'Platform Admin',
        };
        if (cleanEmail) subAdminData.email = cleanEmail;
        if (cleanPhone) subAdminData.phone = cleanPhone;

        const subAdmin = await User.create(subAdminData);

        await Notification.create({
          userId: String(subAdmin._id),
          role: 'subadmin',
          title: 'Welcome to Tomato Administration',
          message: `Your sub-admin account (${subAdmin.adminRoleTitle}) has been created with assigned permissions.`,
          type: 'system',
        });

        return res.status(201).json({
          message: `Sub-admin "${subAdmin.name}" created successfully with assigned role`,
          subadmin: userResponse(subAdmin),
        });
      } catch (error) {
        console.error('Create sub-admin failed:', error);
        return res.status(500).json({ message: 'Unable to create sub-admin' });
      }
    },
  );

  // Update sub-admin permissions and role title
  router.put(
    '/subadmins/:id/permissions',
    requirePermission('subadmins_manage'),
    async (req: Request, res: Response) => {
      try {
        const subAdminId = req.params.id;
        if (!mongoose.isValidObjectId(subAdminId)) {
          return res.status(400).json({ message: 'Invalid sub-admin ID' });
        }

        const targetUser = await User.findById(subAdminId);
        if (!targetUser) {
          return res.status(404).json({ message: 'Sub-admin not found' });
        }

        if (targetUser.role !== 'subadmin') {
          return res
            .status(400)
            .json({
              message: 'Cannot modify permissions for non-subadmin users',
            });
        }

        const { permissions, adminRoleTitle } = req.body;
        const allowedPermissions = [
          'dashboard_view',
          'orders_manage',
          'restaurants_manage',
          'riders_manage',
          'customers_manage',
          'subadmins_manage',
        ];

        const updates: Record<string, unknown> = {};
        if (Array.isArray(permissions)) {
          updates.permissions = permissions.filter(
            (p: unknown) =>
              typeof p === 'string' &&
              (allowedPermissions.includes(p) || p === '*'),
          );
        }
        if (typeof adminRoleTitle === 'string' && adminRoleTitle.trim()) {
          updates.adminRoleTitle = adminRoleTitle.trim();
        }

        const updated = await User.findByIdAndUpdate(
          subAdminId,
          { $set: updates },
          { new: true },
        );

        return res.json({
          message: 'Sub-admin permissions updated successfully',
          subadmin: userResponse(updated!),
        });
      } catch (error) {
        console.error('Update sub-admin permissions failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to update sub-admin permissions' });
      }
    },
  );

  // Toggle sub-admin block/unblock status
  router.put(
    '/subadmins/:id/status',
    requirePermission('subadmins_manage'),
    async (req: Request, res: Response) => {
      try {
        const subAdminId = req.params.id;
        const currentUser = (req as AuthenticatedRequest).user;
        if (!mongoose.isValidObjectId(subAdminId)) {
          return res.status(400).json({ message: 'Invalid sub-admin ID' });
        }

        if (currentUser?.userId === subAdminId) {
          return res
            .status(400)
            .json({
              message: 'You cannot block your own administrator account',
            });
        }

        const target = await User.findById(subAdminId);
        if (!target)
          return res.status(404).json({ message: 'Sub-admin not found' });
        if (target.role !== 'subadmin') {
          return res
            .status(400)
            .json({
              message: 'Cannot block super-admin through sub-admin management',
            });
        }

        const nextBlocked =
          req.body.isBlocked !== undefined
            ? Boolean(req.body.isBlocked)
            : !target.isBlocked;
        target.isBlocked = nextBlocked;
        await target.save();

        return res.json({
          message: `Sub-admin account ${nextBlocked ? 'blocked' : 'unblocked'} successfully`,
          subadmin: userResponse(target),
        });
      } catch (error) {
        console.error('Toggle sub-admin status failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to change sub-admin status' });
      }
    },
  );

  // Delete sub-admin permanently
  router.delete(
    '/subadmins/:id',
    requirePermission('subadmins_manage'),
    async (req: Request, res: Response) => {
      try {
        const subAdminId = req.params.id;
        const currentUser = (req as AuthenticatedRequest).user;
        if (!mongoose.isValidObjectId(subAdminId)) {
          return res.status(400).json({ message: 'Invalid sub-admin ID' });
        }

        if (currentUser?.userId === subAdminId) {
          return res
            .status(400)
            .json({
              message: 'You cannot delete your own administrator account',
            });
        }

        const target = await User.findById(subAdminId);
        if (!target)
          return res.status(404).json({ message: 'Sub-admin not found' });
        if (target.role !== 'subadmin') {
          return res
            .status(400)
            .json({ message: 'Cannot delete super-admin account' });
        }

        await User.findByIdAndDelete(subAdminId);

        return res.json({
          message: `Sub-admin "${target.name}" deleted successfully`,
          deletedId: subAdminId,
        });
      } catch (error) {
        console.error('Delete sub-admin failed:', error);
        return res.status(500).json({ message: 'Unable to delete sub-admin' });
      }
    },
  );

  // 4. Analytics with Date Range Period Filter (Default: Today)
  router.get(
    '/analytics',
    requirePermission('dashboard_view'),
    async (req: Request, res: Response) => {
      try {
        const { startDate, endDate, allTime } = req.query;

        const allOrders = await Order.find().lean();
        const users = await User.find().lean();
        const restaurants = await Restaurant.find().lean();
        const customers = await Customer.find().lean();
        const riders = await Rider.find().lean();

        const isCountableForGMV = (o: any) => {
          if (o.status === 'cancelled') return false;
          return (
            o.paymentStatus === 'paid' ||
            o.status === 'delivered' ||
            o.paymentMethod === 'cod'
          );
        };

        const lifetimeGMV = allOrders
          .filter(isCountableForGMV)
          .reduce((sum, o) => sum + (o.totalAmount || 0), 0);

        // Parse date boundaries
        let start: Date | null = null;
        let end: Date | null = null;
        let isDefaultToday = false;
        const isAllTime = allTime === 'true' || allTime === '1';

        if (!isAllTime) {
          if (typeof startDate === 'string' && startDate.trim()) {
            const sStr = startDate.trim();
            start = new Date(`${sStr}T00:00:00`);
          }
          if (typeof endDate === 'string' && endDate.trim()) {
            const eStr = endDate.trim();
            end = new Date(`${eStr}T23:59:59.999`);
          }

          // If neither is provided, default to today
          isDefaultToday = !startDate && !endDate;
          if (isDefaultToday) {
            const now = new Date();
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            const d = String(now.getDate()).padStart(2, '0');
            const todayStr = `${y}-${m}-${d}`;
            start = new Date(`${todayStr}T00:00:00`);
            end = new Date(`${todayStr}T23:59:59.999`);
          }
        }

        // Filter orders by selected date period
        const filteredOrders = allOrders.filter((o) => {
          if (!start && !end) return true;
          const cDate = new Date(o.createdAt);
          if (start && cDate < start) return false;
          if (end && cDate > end) return false;
          return true;
        });

        // Filter users by selected date period
        const filteredUsers = users.filter((u: any) => {
          if (!start && !end) return true;
          if (!u.createdAt) return false;
          const uDate = new Date(u.createdAt);
          if (start && uDate < start) return false;
          if (end && uDate > end) return false;
          return true;
        });

        const filteredRestaurants = restaurants.filter((r: any) => {
          if (!start && !end) return true;
          if (!r.createdAt) return false;
          const rDate = new Date(r.createdAt);
          if (start && rDate < start) return false;
          if (end && rDate > end) return false;
          return true;
        });

        const allCustomersCombined = [
          ...customers,
          ...users.filter((u) => u.role === 'customer'),
        ];
        const filteredCustomers = allCustomersCombined.filter((c: any) => {
          if (!start && !end) return true;
          if (!c.createdAt) return false;
          const cDate = new Date(c.createdAt);
          if (start && cDate < start) return false;
          if (end && cDate > end) return false;
          return true;
        });

        const allRidersCombined = [
          ...riders,
          ...users.filter((u) => u.role === 'deliveryPartner'),
        ];
        const filteredRiders = allRidersCombined.filter((r: any) => {
          if (!start && !end) return true;
          if (!r.createdAt) return false;
          const rDate = new Date(r.createdAt);
          if (start && rDate < start) return false;
          if (end && rDate > end) return false;
          return true;
        });

        // Period GMV
        const periodGMV = filteredOrders
          .filter(isCountableForGMV)
          .reduce((sum, o) => sum + (o.totalAmount || 0), 0);

        // Average Order Value in period
        const avgOrderValue =
          filteredOrders.length > 0 ? periodGMV / filteredOrders.length : 0;

        // Total units of food ordered in period
        let totalUnitsSold = 0;
        for (const o of filteredOrders) {
          for (const item of o.items || []) {
            totalUnitsSold += item.quantity || 1;
          }
        }

        // Order status breakdown in period
        const ordersByStatus = {
          placed: filteredOrders.filter((o) => o.status === 'placed').length,
          accepted: filteredOrders.filter((o) => o.status === 'accepted')
            .length,
          preparing: filteredOrders.filter((o) => o.status === 'preparing')
            .length,
          ready_for_pickup: filteredOrders.filter(
            (o) => o.status === 'ready_for_pickup',
          ).length,
          out_for_delivery: filteredOrders.filter(
            (o) => o.status === 'out_for_delivery',
          ).length,
          delivered: filteredOrders.filter((o) => o.status === 'delivered')
            .length,
          cancelled: filteredOrders.filter((o) => o.status === 'cancelled')
            .length,
        };

        const deliveredOrdersCount = ordersByStatus.delivered;
        const cancelledOrdersCount = ordersByStatus.cancelled;
        const activeOrdersCount =
          filteredOrders.length - deliveredOrdersCount - cancelledOrdersCount;
        const fulfillmentRate =
          filteredOrders.length > 0
            ? Math.round(
                ((filteredOrders.length - cancelledOrdersCount) /
                  filteredOrders.length) *
                  100,
              )
            : 100;

        // User registrations in period vs lifetime
        const periodCustomersCount = filteredCustomers.length;
        const periodRestaurantsCount = filteredRestaurants.length;
        const periodRidersCount = filteredRiders.length;
        const periodUsersCount =
          periodCustomersCount +
          periodRestaurantsCount +
          periodRidersCount +
          filteredUsers.length;

        const totalCustomers = allCustomersCombined.length;
        const totalRestaurants = restaurants.length;
        const totalRiders = allRidersCombined.length;

        // Payment method distribution in period
        const paymentDistribution: Record<
          string,
          { count: number; volume: number }
        > = {};
        for (const o of filteredOrders) {
          const method = (o.paymentMethod || 'cod').toLowerCase();
          if (!paymentDistribution[method]) {
            paymentDistribution[method] = { count: 0, volume: 0 };
          }
          paymentDistribution[method].count += 1;
          if (isCountableForGMV(o)) {
            paymentDistribution[method].volume += o.totalAmount || 0;
          }
        }

        // Top selling dishes in period
        const itemMap = new Map<
          string,
          { name: string; quantity: number; revenue: number }
        >();
        for (const o of filteredOrders) {
          for (const item of o.items || []) {
            const entry = itemMap.get(item.name) || {
              name: item.name,
              quantity: 0,
              revenue: 0,
            };
            entry.quantity += item.quantity || 1;
            entry.revenue +=
              item.totalPrice || item.price * (item.quantity || 1);
            itemMap.set(item.name, entry);
          }
        }

        const topDishes = Array.from(itemMap.values())
          .sort((a, b) => b.quantity - a.quantity)
          .slice(0, 8);

        // Top restaurants by sales in period
        const restMap = new Map<
          string,
          { name: string; orderCount: number; revenue: number }
        >();
        for (const o of filteredOrders) {
          const rName = o.restaurantName || 'Other Kitchen';
          const entry = restMap.get(rName) || {
            name: rName,
            orderCount: 0,
            revenue: 0,
          };
          entry.orderCount += 1;
          if (isCountableForGMV(o)) {
            entry.revenue += o.totalAmount || 0;
          }
          restMap.set(rName, entry);
        }
        const topRestaurants = Array.from(restMap.values())
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 6);

        // Fleet activity in period
        const ridersActiveSet = new Set<string>();
        for (const o of filteredOrders) {
          if (o.riderName) ridersActiveSet.add(o.riderName);
          else if (o.riderId) ridersActiveSet.add(String(o.riderId));
        }
        const activeRidersInPeriod = ridersActiveSet.size;

        const toDateOnly = (d: Date) => {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${y}-${m}-${day}`;
        };

        const now = new Date();
        const todayDateStr = toDateOnly(now);
        const isRangeToday =
          start &&
          end &&
          toDateOnly(start) === todayDateStr &&
          toDateOnly(end) === todayDateStr;

        return res.json({
          analytics: {
            totalGMV: periodGMV, // Period GMV
            periodGMV,
            lifetimeGMV,
            startDate: start ? toDateOnly(start) : null,
            endDate: end ? toDateOnly(end) : null,
            isToday: Boolean(isDefaultToday || isRangeToday),
            isAllTime: Boolean(isAllTime),
            periodOrdersCount: filteredOrders.length,
            totalOrdersCount: allOrders.length,
            deliveredOrdersCount,
            activeOrdersCount,
            cancelledOrdersCount,
            fulfillmentRate,
            avgOrderValue,
            totalUnitsSold,
            ordersByStatus,
            periodUsersCount,
            periodCustomersCount,
            periodRestaurantsCount,
            periodRidersCount,
            totalUsersCount: users.length + restaurants.length,
            totalCustomers,
            totalRestaurants,
            totalRiders,
            activeRidersInPeriod,
            paymentDistribution,
            topDishes,
            topRestaurants,
          },
        });
      } catch (error) {
        console.error('Analytics fetch failed:', error);
        return res.status(500).json({ message: 'Unable to fetch analytics' });
      }
    },
  );

  return router;
};

export const customerRoutes = createCustomerRouter();
export const restaurantRoutes = createRestaurantRouter();
export const riderRoutes = createRiderRouter();
export const adminRoutes = createAdminRouter();

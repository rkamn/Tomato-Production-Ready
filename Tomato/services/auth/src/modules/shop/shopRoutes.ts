import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import MenuItem, { FoodItem } from '../../model/MenuItem.js';
import Notification from '../../model/Notification.js';
import Shop, { IShop } from '../../model/Shop.js';
import ShopOrder, { IShopOrder } from '../../model/ShopOrder.js';
import Customer from '../../model/Customer.js';
import Rider from '../../model/Rider.js';
import {
  authenticate,
  AuthenticatedRequest,
  requireRole,
} from '../../middleware/authenticate.js';
import { formatBill, resolveAdminGsnNumber } from '../../utils/orderHelpers.js';
import Order, { OrderStatus } from '../../model/Order.js';
import notificationService from '../notification/notificationService.js';
import { productImageUpload } from '../../middleware/upload.js';
import { validateBankAndPanDetails } from '../../utils/bankHelpers.js';
import Payment from '../../model/Payment.js';
import Coupon, {
  COUPON_TYPES,
  COUPON_TYPE_LABELS,
  SPONSOR_TYPES,
  SPONSOR_TYPE_LABELS,
  CouponType,
  SponsorType,
} from '../../model/Coupon.js';

const createShopRouter = () => {
  const router = express.Router();
  router.use(authenticate, requireRole('shop'));

  // 1. Overview
  router.get('/overview', (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    return res.json({
      role: 'shop',
      title: 'Retail Shop',
      userId: user?.userId,
      shopId: user?.shopId,
      message: 'Shop API ready',
    });
  });

  // 2. Notifications
  router.get('/notifications', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      await (Notification as any).cleanExpiredAndExcess(user.userId);
      const notifications = await Notification.find({
        userId: user.userId,
        role: 'shop',
      })
        .sort({ createdAt: -1 })
        .limit(15);
      return res.json({ notifications });
    } catch (error) {
      console.error('Shop notification fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch notifications' });
    }
  });

  // 3. Shop Live Status (Open / Close) Toggle
  router.get('/status', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const shop = await Shop.findById(user.userId)
        .select('isOpen isOnline name shopId')
        .lean();
      if (!shop)
        return res.status(404).json({ message: 'Shop not found' });
      const isOpen = shop.isOpen ?? shop.isOnline ?? true;
      return res.json({ isOpen, isOnline: isOpen });
    } catch (error) {
      return res
        .status(500)
        .json({ message: 'Unable to fetch shop status' });
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

      const updated = await Shop.findByIdAndUpdate(
        user.userId,
        { $set: { isOpen, isOnline: isOpen } },
        { returnDocument: 'after' },
      ).lean();

      return res.json({
        message: isOpen
          ? 'Shop is now OPEN and accepting orders.'
          : 'Shop is now CLOSED and cannot accept orders.',
        isOpen: updated?.isOpen ?? isOpen,
        isOnline: updated?.isOnline ?? isOpen,
      });
    } catch (error) {
      console.error('Shop status update error:', error);
      return res
        .status(500)
        .json({ message: 'Unable to update shop status' });
    }
  });

  // 4. Shop profile
  router.get('/profile', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const profile = await Shop.findById(user.userId)
        .select(
          'name shopId digipin gsnNumber dob email phone shopAddress shopLocation category isApproved isBlocked isOpen isOnline walletBalance creditPoint bankDetails',
        )
        .lean();
      const cleanName = profile && typeof profile.name === 'string'
        ? (profile.name.split('/')[0] ?? '').trim()
        : '';
      const displayName = cleanName || (profile ? profile.name : '');
      return res.json({
        profile: profile
          ? {
              ...profile,
              name: displayName,
              displayName,
              gsnNumber: (profile.gsnNumber && profile.gsnNumber.trim()) ? profile.gsnNumber.trim() : 'NA',
              isOpen: profile.isOpen ?? profile.isOnline ?? true,
              isOnline: profile.isOnline ?? profile.isOpen ?? true,
            }
          : null,
      });
    } catch (error) {
      return res
        .status(500)
        .json({ message: 'Unable to fetch shop profile' });
    }
  });

  router.put('/profile', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const { name, phone, shopAddress, category, digipin, gsnNumber, lat, lng } = req.body;
      const updates: Record<string, unknown> = {};
      if (typeof name === 'string' && name.trim()) updates.name = name.trim();
      if (typeof phone === 'string' && phone.trim()) updates.phone = phone.trim();
      if (typeof shopAddress === 'string') updates.shopAddress = shopAddress.trim();
      if (typeof category === 'string') updates.category = category.trim();
      if (typeof digipin === 'string' && digipin.trim())
        updates.digipin = digipin.trim().toUpperCase();
      if (typeof gsnNumber === 'string')
        updates.gsnNumber = gsnNumber.trim().toUpperCase() || 'NA';
      if (
        lat !== undefined &&
        lng !== undefined &&
        !isNaN(Number(lat)) &&
        !isNaN(Number(lng))
      ) {
        updates.shopLocation = { lat: Number(lat), lng: Number(lng) };
      }

      const updated = await Shop.findByIdAndUpdate(
        user.userId,
        { $set: updates },
        { returnDocument: 'after' },
      );
      return res.json({
        message: 'Shop profile updated',
        profile: updated,
      });
    } catch (error) {
      return res
        .status(500)
        .json({ message: 'Unable to update shop profile' });
    }
  });

  // 5. Manage Shop Items / Inventory
  router.get('/items', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const items = await FoodItem.find({
        restaurantId: new mongoose.Types.ObjectId(user.userId),
      }).sort({ createdAt: -1 });
      return res.json({ items });
    } catch (error) {
      console.error('Shop items fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch shop items' });
    }
  });

  router.post('/items', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });

      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const category = typeof req.body?.category === 'string'
        ? req.body.category.trim()
        : 'Packaged Goods';
      const description = typeof req.body?.description === 'string'
        ? req.body.description.trim()
        : '';
      const dietary = ['veg', 'non-veg', 'vegan'].includes(req.body?.dietary)
        ? req.body.dietary
        : 'veg';
      const quantity = Number(req.body?.quantity ?? 10);
      const price = Number(req.body?.price ?? 0);
      const image = typeof req.body?.image === 'string' ? req.body.image.trim() : '';

      if (
        !name ||
        !Number.isFinite(quantity) ||
        quantity < 0 ||
        !Number.isFinite(price) ||
        price < 0
      ) {
        return res.status(400).json({
          message: 'Valid item name, quantity, and price are required',
        });
      }

      const shopUser = await Shop.findById(user.userId).lean();

      const item = await FoodItem.create({
        restaurantId: new mongoose.Types.ObjectId(user.userId),
        restaurantName: shopUser?.name || 'Partner Shop',
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
        role: 'shop',
        title: 'Shop item added',
        message: `${name} (${category}) is now in stock at ₹${price}.`,
        type: 'menu',
        entityId: String(item._id),
      });

      return res
        .status(201)
        .json({ message: 'Shop item added successfully', item });
    } catch (error) {
      console.error('Shop item create failed:', error);
      return res.status(500).json({ message: 'Unable to add shop item' });
    }
  });

  router.post('/upload-image', productImageUpload.single('image'), (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No image file uploaded' });
      }
      const imageUrl = `/uploads/${req.file.filename}`;
      return res.json({ message: 'Image uploaded successfully', imageUrl });
    } catch (error: any) {
      console.error('Shop image upload error:', error);
      return res.status(500).json({ message: error.message || 'Image upload failed' });
    }
  });

  router.put('/items/:itemId', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const itemId = String(req.params.itemId || '');
      if (!itemId || !mongoose.isValidObjectId(itemId)) {
        return res.status(400).json({ message: 'Valid item ID is required' });
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
        { returnDocument: 'after', runValidators: true },
      );

      if (!updated)
        return res.status(404).json({ message: 'Shop item not found' });
      return res.json({ message: 'Shop item updated', item: updated });
    } catch (error) {
      console.error('Shop item update failed:', error);
      return res.status(500).json({ message: 'Unable to update shop item' });
    }
  });

  router.delete('/items/:itemId', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const itemId = String(req.params.itemId || '');
      if (!itemId || !mongoose.isValidObjectId(itemId)) {
        return res.status(400).json({ message: 'Valid item ID is required' });
      }

      const deleted = await FoodItem.findOneAndDelete({
        _id: new mongoose.Types.ObjectId(itemId),
        restaurantId: new mongoose.Types.ObjectId(user.userId),
      });
      if (!deleted)
        return res.status(404).json({ message: 'Shop item not found' });
      return res.json({ message: 'Shop item deleted successfully' });
    } catch (error) {
      console.error('Shop item delete failed:', error);
      return res.status(500).json({ message: 'Unable to delete shop item' });
    }
  });

  // 6. View Shop Orders (stored in 'shop_orders' collection of Tomato_clone database)
  router.get('/orders', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });

      const shopObjId = new mongoose.Types.ObjectId(user.userId);
      const { startDate, endDate } = req.query;
      const baseQuery: Record<string, unknown> = {
        $or: [
          { shopId: shopObjId },
          { shopId: { $exists: false } },
        ],
      };

      const hasDateFilter = Boolean(startDate || endDate);
      if (hasDateFilter) {
        const createdAtFilter: Record<string, Date> = {};
        if (typeof startDate === 'string' && startDate.trim()) {
          const parsedStart = new Date(`${startDate.trim()}T00:00:00.000`);
          if (!Number.isNaN(parsedStart.getTime())) {
            createdAtFilter.$gte = parsedStart;
          }
        }
        if (typeof endDate === 'string' && endDate.trim()) {
          const parsedEnd = new Date(`${endDate.trim()}T23:59:59.999`);
          if (!Number.isNaN(parsedEnd.getTime())) {
            createdAtFilter.$lte = parsedEnd;
          }
        }
        if (Object.keys(createdAtFilter).length > 0) {
          baseQuery.createdAt = createdAtFilter;
        }
      }

      let orders = await ShopOrder.find(baseQuery).sort({ createdAt: -1 });

      // If no shop orders exist yet for this shop (and no date filter was applied), seed initial realistic packaged/retail orders
      if (orders.length === 0 && !hasDateFilter) {
        const shopUser = await Shop.findById(user.userId).lean();
        const cleanName = shopUser && typeof shopUser.name === 'string'
          ? (shopUser.name.split('/')[0] ?? '').trim()
          : '';
        const shopName = cleanName || (shopUser ? shopUser.name : 'Tomato Supermart & Daily Essentials');
        const shopAddr = shopUser?.shopAddress || '45 CMH Road, Indiranagar, Bengaluru, 560038';
        const shopCode = shopUser?.shopId || 'shop-1001';
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');

        const initialShopOrders = [
          {
            orderNumber: `SHOP-${dateStr}-1001`,
            billNumber: `BILL-SHOP-${dateStr}-1001`,
            shopId: shopObjId,
            shopCode: shopCode,
            shopName: shopName,
            shopAddress: shopAddr,
            customerName: 'Aarav Sharma',
            customerPhone: '+91 98450 11223',
            items: [
              { name: 'Organic Cold-Pressed Almond Milk (500ml)', quantity: 2, price: 180, totalPrice: 360 },
              { name: 'Artisan Multigrain Sourdough Loaf', quantity: 1, price: 150, totalPrice: 150 },
            ],
            subtotal: 510,
            tax: 25.5,
            deliveryFee: 40,
            totalAmount: 575.5,
            deliveryAddress: {
              label: 'Home',
              line1: 'Flat 402, Sunshine Heights, Indiranagar',
              city: 'Bengaluru',
              postalCode: '560038',
            },
            paymentStatus: 'paid',
            paymentMethod: 'upi',
            status: 'placed',
            statusHistory: [
              { status: 'placed', at: new Date(), by: 'System Seed', note: 'New incoming shop retail order' },
            ],
          },
          {
            orderNumber: `SHOP-${dateStr}-1002`,
            billNumber: `BILL-SHOP-${dateStr}-1002`,
            shopId: shopObjId,
            shopCode: shopCode,
            shopName: shopName,
            shopAddress: shopAddr,
            customerName: 'Priya Sundaram',
            customerPhone: '+91 99801 44556',
            items: [
              { name: 'Gourmet Dark Chocolate Box (Pack of 12)', quantity: 1, price: 420, totalPrice: 420 },
              { name: 'Cold Brew Concentrate (750ml)', quantity: 1, price: 290, totalPrice: 290 },
            ],
            subtotal: 710,
            tax: 35.5,
            deliveryFee: 40,
            totalAmount: 785.5,
            deliveryAddress: {
              label: 'Office',
              line1: '9th Main Road, HAL 2nd Stage',
              city: 'Bengaluru',
              postalCode: '560008',
            },
            paymentStatus: 'paid',
            paymentMethod: 'card',
            status: 'preparing',
            statusHistory: [
              { status: 'placed', at: new Date(Date.now() - 30 * 60000), by: 'System Seed', note: 'Order placed' },
              { status: 'accepted', at: new Date(Date.now() - 25 * 60000), by: 'System Seed', note: 'Order accepted' },
              { status: 'preparing', at: new Date(Date.now() - 20 * 60000), by: 'System Seed', note: 'Packing goods in parcel' },
            ],
          },
          {
            orderNumber: `SHOP-${dateStr}-1003`,
            billNumber: `BILL-SHOP-${dateStr}-1003`,
            shopId: shopObjId,
            shopCode: shopCode,
            shopName: shopName,
            shopAddress: shopAddr,
            customerName: 'Karthik Rao',
            customerPhone: '+91 97412 88990',
            items: [
              { name: 'Raw Forest Honey (400g Glass Jar)', quantity: 2, price: 340, totalPrice: 680 },
            ],
            subtotal: 680,
            tax: 34,
            deliveryFee: 40,
            totalAmount: 754,
            deliveryAddress: {
              label: 'Home',
              line1: 'Villa 14, Palm Meadows, Whitefield',
              city: 'Bengaluru',
              postalCode: '560066',
            },
            paymentStatus: 'paid',
            paymentMethod: 'upi',
            status: 'accepted',
            statusHistory: [
              { status: 'placed', at: new Date(Date.now() - 15 * 60000), by: 'System Seed', note: 'Order placed' },
              { status: 'accepted', at: new Date(Date.now() - 10 * 60000), by: 'System Seed', note: 'Order accepted' },
            ],
          },
        ];

        try {
          await ShopOrder.insertMany(initialShopOrders);
          orders = await ShopOrder.find({
            $or: [
              { shopId: shopObjId },
              { shopId: { $exists: false } },
            ],
          }).sort({ createdAt: -1 });
        } catch (seedErr) {
          console.warn('Initial shop orders seeding notice:', seedErr);
        }
      }

      return res.json({ orders });
    } catch (error) {
      console.error('Shop orders fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch shop orders' });
    }
  });

  // 7. Accept shop order & update status
  router.put('/orders/:orderId/status', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const orderId = String(req.params.orderId || '');
      if (!orderId || !mongoose.isValidObjectId(orderId)) {
        return res.status(400).json({ message: 'Valid shop order ID is required' });
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

      const order = await ShopOrder.findById(orderId);
      if (!order) return res.status(404).json({ message: 'Shop order not found' });

      if (status === 'accepted') {
        const shopUser = await Shop.findById(user.userId).lean();
        if (
          shopUser &&
          (shopUser.isOpen === false || shopUser.isOnline === false)
        ) {
          return res.status(400).json({
            message:
              'Your shop is currently CLOSED. Please toggle your status to OPEN in the sidebar to accept orders.',
          });
        }
      }

      order.status = status;
      order.statusHistory.push({
        status,
        at: new Date(),
        by: String(user.userId),
        note: note || `Shop changed status to ${status}`,
      });
      await order.save();

      // Also sync to platform Order if matching orderNumber exists
      const platformOrder = await Order.findOne({ orderNumber: order.orderNumber });
      if (platformOrder) {
        platformOrder.status = status;
        platformOrder.statusHistory.push({
          status,
          at: new Date(),
          by: String(user.userId),
          note: note || `Shop changed status to ${status}`,
        });
        await platformOrder.save();

        if (status === 'accepted') {
          await notificationService.notifyRidersAndCustomerOnOrderAccepted(platformOrder);
        } else if (platformOrder.customerId) {
          const customerMsg: Record<string, string> = {
            preparing: `Your shop order #${order.orderNumber} is being packaged by the store.`,
            ready_for_pickup: `Shop order #${order.orderNumber} is packed and waiting for rider pickup.`,
            cancelled: `Your shop order #${order.orderNumber} was cancelled by the shop.`,
          };
          if (customerMsg[status]) {
            await notificationService.createNotification({
              userId: String(platformOrder.customerId),
              role: 'customer',
              title: `Shop Order: ${status.replace(/_/g, ' ').toUpperCase()}`,
              message: customerMsg[status],
              type: 'order',
              entityId: String(platformOrder._id),
              metadata: {
                orderId: String(platformOrder._id),
                orderNumber: order.orderNumber,
                status,
              },
            });
          }
        }
      }

      return res.json({ message: `Shop order status updated to ${status}`, order });
    } catch (error) {
      console.error('Shop order status update failed:', error);
      return res.status(500).json({ message: 'Unable to update shop order status' });
    }
  });

  // 8. Generate Bill for Shop Order
  router.get('/orders/:orderId/bill', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const orderId = String(req.params.orderId || '');
      if (!orderId || !mongoose.isValidObjectId(orderId)) {
        return res.status(400).json({ message: 'Valid shop order ID is required' });
      }

      const order = await ShopOrder.findById(orderId);
      if (!order) return res.status(404).json({ message: 'Shop order not found' });

      const [shopUser, customerUser, adminGsn] = await Promise.all([
        Shop.findById(user.userId).lean(),
        order.customerId
          ? Customer.findById(order.customerId).lean()
          : null,
        resolveAdminGsnNumber(),
      ]);

      const bill = formatBill(
        {
          ...order.toObject(),
          restaurantName: order.shopName || shopUser?.name || 'Tomato Partner Shop',
          restaurantAddress: order.shopAddress || shopUser?.shopAddress || '',
        } as any,
        shopUser as any,
        customerUser as any,
        adminGsn,
      );
      return res.json({ message: 'Shop bill generated successfully', bill });
    } catch (error) {
      console.error('Shop generate bill failed:', error);
      return res.status(500).json({ message: 'Unable to generate shop bill' });
    }
  });

  // 9. Live tracking of assigned rider for shop order
  router.get(
    '/orders/:orderId/live-tracking',
    async (req: Request, res: Response) => {
      try {
        const user = (req as AuthenticatedRequest).user;
        if (!user?.userId)
          return res.status(401).json({ message: 'Authentication required' });
        const orderId = String(req.params.orderId || '');
        if (!orderId || !mongoose.isValidObjectId(orderId)) {
          return res.status(400).json({ message: 'Valid shop order ID is required' });
        }

        const shopOrder = await ShopOrder.findById(orderId).lean();
        if (!shopOrder)
          return res.status(404).json({ message: 'Shop order not found' });

        if (shopOrder.riderId) {
          const rider = await Rider.findById(shopOrder.riderId).lean();
          if (rider) {
            const tracking = {
              orderId: String(shopOrder._id),
              orderNumber: shopOrder.orderNumber,
              status: shopOrder.status,
              rider: {
                riderId: rider.riderId || '',
                displayName: rider.name,
                phone: rider.phone || '',
                currentLocation: rider.currentLocation || { lat: 12.9716, lng: 77.5946 },
                lastLocationUpdated: rider.lastLocationUpdated || new Date(),
                isOnline: rider.isOnline ?? true,
              },
              restaurant: {
                name: shopOrder.shopName || 'Tomato Partner Shop',
                location: shopOrder.shopLocation || { lat: 12.9784, lng: 77.6408 },
                address: shopOrder.shopAddress || '',
              },
              destination: shopOrder.deliveryAddress || null,
              polyline: [],
            };
            return res.json({ tracking });
          }
        }

        return res.status(404).json({ message: 'Rider not assigned yet to this shop order' });
      } catch (error) {
        console.error('Shop live tracking fetch failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to fetch shop live tracking' });
      }
    },
  );

  // 10. Shop Bank & PAN Details (Non-editable once approved; only Admin can edit)
  router.get('/bank-details', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const shop = await Shop.findById(user.userId)
        .select('name shopId isApproved walletBalance creditPoint bankDetails')
        .lean();
      if (!shop) return res.status(404).json({ message: 'Shop not found' });

      const payouts = await Payment.find({ partnerId: String(user.userId) })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      const isLocked = Boolean(
        shop.isApproved ||
          shop.bankDetails?.isApproved ||
          shop.bankDetails?.isLocked,
      );

      return res.json({
        bankDetails: {
          ...(shop.bankDetails || {}),
          isLocked,
        },
        isApproved: shop.isApproved,
        walletBalance: shop.walletBalance || 0,
        payouts,
      });
    } catch (error) {
      console.error('Shop bank details fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch bank details' });
    }
  });

  router.put('/bank-details', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });

      const shop = await Shop.findById(user.userId).lean();
      if (!shop) return res.status(404).json({ message: 'Shop not found' });

      if (
        shop.isApproved ||
        shop.bankDetails?.isApproved ||
        shop.bankDetails?.isLocked
      ) {
        return res.status(403).json({
          message:
            'Bank details are locked and non-editable once approved. Only the Admin can edit your bank details upon request.',
        });
      }

      const validation = validateBankAndPanDetails(req.body);
      if (!validation.valid || !validation.sanitized) {
        return res.status(400).json({
          message: validation.message || 'Invalid bank or PAN details',
        });
      }

      const updatedBankDetails = {
        ...(shop.bankDetails || {}),
        ...validation.sanitized,
        isSubmitted: true,
        isApproved: false,
        isLocked: false,
        agreementCommissionPercent:
          shop.bankDetails?.agreementCommissionPercent ?? 12,
        adminNote:
          typeof req.body.adminNote === 'string'
            ? req.body.adminNote.trim()
            : shop.bankDetails?.adminNote || '',
        submittedAt: new Date(),
      };

      const updatedShop = await Shop.findByIdAndUpdate(
        user.userId,
        { $set: { bankDetails: updatedBankDetails } },
        { returnDocument: 'after' },
      ).lean();

      try {
        await Notification.create({
          userId: 'ADMIN',
          role: 'admin',
          title: 'Shop Bank & PAN Details Submitted',
          message: `${shop.name} (${shop.shopId || shop._id}) submitted bank details & PAN (${validation.sanitized.panNumber}) for verification and approval.`,
          type: 'system',
          entityId: String(shop._id),
        });
      } catch (notifErr) {
        console.warn('Admin notification on shop bank submit failed:', notifErr);
      }

      return res.json({
        message:
          'Bank details and PAN card submitted successfully! Pending Admin verification & approval.',
        bankDetails: updatedShop?.bankDetails || updatedBankDetails,
      });
    } catch (error) {
      console.error('Shop bank details save failed:', error);
      return res.status(500).json({ message: 'Unable to save bank details' });
    }
  });

  // ==========================================
  // Shop Specific Coupon Routes
  // ==========================================

  // Helper to resolve shop partner and query filters robustly
  const resolveShopPartner = async (user: AuthenticatedRequest['user']) => {
    if (!user) return null;
    let shop: any = null;
    if (user.userId && mongoose.isValidObjectId(user.userId)) {
      shop = await Shop.findById(user.userId).lean();
    }
    if (!shop && (user as any).shopId) {
      shop = await Shop.findOne({ shopId: (user as any).shopId }).lean();
    }
    if (!shop && user.userId) {
      shop = await Shop.findOne({
        $or: [{ shopId: user.userId }, { email: user.email }, { phone: user.phone }],
      } as any).lean();
    }
    return shop;
  };

  const getShopPartnerFilter = (shop: any, user: AuthenticatedRequest['user']) => {
    const rawId = shop?._id || user?.userId;
    const objId = rawId && mongoose.isValidObjectId(rawId) ? new mongoose.Types.ObjectId(rawId) : null;
    const conditions: Record<string, any>[] = [];

    if (objId) conditions.push({ partnerId: objId });
    if (rawId) conditions.push({ partnerId: String(rawId) });
    if (shop?.shopId) conditions.push({ partnerId: shop.shopId });
    if ((user as any)?.shopId) conditions.push({ partnerId: (user as any).shopId });
    if (shop?.name) conditions.push({ partnerName: shop.name });

    return conditions.length ? { $or: conditions } : {};
  };

  // 1. Get coupons created by this shop
  router.get(['/coupons', '/coupon'], async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId) return res.status(401).json({ message: 'Unauthorized' });

      const shop = await resolveShopPartner(user);
      const partnerFilter = getShopPartnerFilter(shop, user);

      const coupons = await Coupon.find({
        ...partnerFilter,
        sponsorType: 'shop',
      })
        .sort({ createdAt: -1 })
        .lean();

      let activeCoupons = 0;
      let totalRedemptions = 0;
      let totalDiscountGiven = 0;

      for (const c of coupons) {
        if (c.isActive) activeCoupons++;
        totalRedemptions += Number(c.usedCount || 0);
        for (const u of c.usedBy || []) {
          totalDiscountGiven += Number(u.discountAmount || 0);
        }
      }

      return res.json({
        shopName: shop?.name || 'Shop',
        coupons: coupons.map((c) => ({
          ...c,
          id: String(c._id),
          couponTypeLabel: COUPON_TYPE_LABELS[c.couponType] || c.couponType,
          sponsorType: c.sponsorType || 'shop',
          sponsorTypeLabel: SPONSOR_TYPE_LABELS['shop'],
        })),
        summary: {
          totalCoupons: coupons.length,
          activeCoupons,
          inactiveCoupons: coupons.length - activeCoupons,
          totalRedemptions,
          totalDiscountGiven: Number(totalDiscountGiven.toFixed(2)),
        },
      });
    } catch (error) {
      console.error('Shop coupons fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch coupons' });
    }
  });

  // 2. Create coupon by shop
  router.post(['/coupons', '/coupon'], async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId) return res.status(401).json({ message: 'Unauthorized' });

      const shop = await resolveShopPartner(user);
      if (!shop) return res.status(404).json({ message: 'Shop partner profile not found' });

      const body = req.body ?? {};
      const code = String(body.code || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '');
      const title = String(body.title || '').trim();
      const description = String(body.description || '').trim();
      const discountType = body.discountType === 'flat' ? 'flat' : 'percentage';
      const discountValue = Number(body.discountValue ?? 0);
      const maxDiscountAmount = Math.max(0, Number(body.maxDiscountAmount ?? 0));
      const minOrderAmount = Math.max(0, Number(body.minOrderAmount ?? 0));
      const targetItemCategory = String(body.targetItemCategory || '').trim();
      const occasionName = String(body.occasionName || '').trim();
      const usageLimitPerUser = Math.max(1, Number(body.usageLimitPerUser ?? 1));
      const totalUsageLimit = Math.max(0, Number(body.totalUsageLimit ?? 0));
      const validFrom = body.validFrom ? new Date(body.validFrom) : new Date();
      const validUntil = body.validUntil ? new Date(body.validUntil) : null;
      const isActive = body.isActive !== undefined ? Boolean(body.isActive) : true;

      if (!code || code.length < 3) {
        return res.status(400).json({ message: 'Coupon code must be at least 3 characters' });
      }
      if (!title) {
        return res.status(400).json({ message: 'Coupon title is required' });
      }
      if (!discountValue || discountValue <= 0) {
        return res.status(400).json({ message: 'Discount value must be greater than 0' });
      }
      if (discountType === 'percentage' && discountValue > 100) {
        return res.status(400).json({ message: 'Percentage discount cannot exceed 100%' });
      }

      const existing = await Coupon.findOne({ code });
      if (existing) {
        return res.status(409).json({ message: `Coupon code "${code}" already exists` });
      }

      const partnerIdToSave = shop._id && mongoose.isValidObjectId(shop._id)
        ? new mongoose.Types.ObjectId(shop._id)
        : (user.userId && mongoose.isValidObjectId(user.userId) ? new mongoose.Types.ObjectId(user.userId) : shop._id || user.userId);

      const created = await Coupon.create({
        code,
        title,
        description,
        couponType: 'shop',
        sponsorType: 'shop',
        partnerId: partnerIdToSave,
        partnerName: shop.name,
        discountType,
        discountValue,
        maxDiscountAmount,
        minOrderAmount,
        targetItemCategory,
        occasionName,
        applicableStoreType: 'shop',
        usageLimitPerUser,
        totalUsageLimit,
        validFrom,
        validUntil,
        isActive,
        createdBy: shop.name || 'Shop',
      });

      return res.status(201).json({
        message: `Coupon "${created.code}" created successfully for ${shop.name}`,
        coupon: {
          ...created.toObject(),
          id: String(created._id),
          couponTypeLabel: COUPON_TYPE_LABELS[created.couponType] || created.couponType,
          sponsorType: 'shop',
          sponsorTypeLabel: SPONSOR_TYPE_LABELS['shop'],
        },
      });
    } catch (error) {
      console.error('Shop create coupon failed:', error);
      return res.status(500).json({ message: 'Unable to create coupon' });
    }
  });

  // 3. Update coupon by shop
  router.put(['/coupons/:couponId', '/coupon/:couponId'], async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId) return res.status(401).json({ message: 'Unauthorized' });

      const couponId = String(req.params.couponId || '');
      if (!mongoose.isValidObjectId(couponId)) {
        return res.status(400).json({ message: 'Valid coupon ID required' });
      }

      const shop = await resolveShopPartner(user);
      const partnerFilter = getShopPartnerFilter(shop, user);

      const coupon = await Coupon.findOne({
        _id: couponId,
        ...partnerFilter,
        sponsorType: 'shop',
      });

      if (!coupon) {
        return res.status(404).json({ message: 'Coupon not found or unauthorized' });
      }

      const body = req.body ?? {};
      if (body.code !== undefined) {
        const nextCode = String(body.code || '')
          .trim()
          .toUpperCase()
          .replace(/\s+/g, '');
        if (nextCode && nextCode !== coupon.code) {
          const dup = await Coupon.findOne({ code: nextCode, _id: { $ne: coupon._id } });
          if (dup) {
            return res.status(409).json({ message: `Coupon code "${nextCode}" already exists` });
          }
          coupon.code = nextCode;
        }
      }
      if (body.title !== undefined) coupon.title = String(body.title).trim();
      if (body.description !== undefined) coupon.description = String(body.description).trim();
      if (body.discountType === 'flat' || body.discountType === 'percentage') {
        coupon.discountType = body.discountType;
      }
      if (body.discountValue !== undefined) {
        coupon.discountValue = Math.max(1, Number(body.discountValue));
      }
      if (body.maxDiscountAmount !== undefined) {
        coupon.maxDiscountAmount = Math.max(0, Number(body.maxDiscountAmount));
      }
      if (body.minOrderAmount !== undefined) {
        coupon.minOrderAmount = Math.max(0, Number(body.minOrderAmount));
      }
      if (body.targetItemCategory !== undefined) {
        coupon.targetItemCategory = String(body.targetItemCategory).trim();
      }
      if (body.occasionName !== undefined) {
        coupon.occasionName = String(body.occasionName).trim();
      }
      if (body.usageLimitPerUser !== undefined) {
        coupon.usageLimitPerUser = Math.max(1, Number(body.usageLimitPerUser));
      }
      if (body.totalUsageLimit !== undefined) {
        coupon.totalUsageLimit = Math.max(0, Number(body.totalUsageLimit));
      }
      if (body.validFrom !== undefined) {
        coupon.validFrom = body.validFrom ? new Date(body.validFrom) : new Date();
      }
      if (body.validUntil !== undefined) {
        coupon.validUntil = body.validUntil ? new Date(body.validUntil) : null;
      }
      if (body.isActive !== undefined) {
        coupon.isActive = Boolean(body.isActive);
      }

      await coupon.save();
      return res.json({
        message: `Coupon "${coupon.code}" updated successfully`,
        coupon: {
          ...coupon.toObject(),
          id: String(coupon._id),
          couponTypeLabel: COUPON_TYPE_LABELS[coupon.couponType] || coupon.couponType,
          sponsorType: 'shop',
          sponsorTypeLabel: SPONSOR_TYPE_LABELS['shop'],
        },
      });
    } catch (error) {
      console.error('Shop update coupon failed:', error);
      return res.status(500).json({ message: 'Unable to update coupon' });
    }
  });

  // 4. Toggle coupon active state
  router.patch(['/coupons/:couponId/toggle', '/coupon/:couponId/toggle'], async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId) return res.status(401).json({ message: 'Unauthorized' });

      const couponId = String(req.params.couponId || '');
      if (!mongoose.isValidObjectId(couponId)) {
        return res.status(400).json({ message: 'Valid coupon ID required' });
      }

      const shop = await resolveShopPartner(user);
      const partnerFilter = getShopPartnerFilter(shop, user);

      const coupon = await Coupon.findOne({
        _id: couponId,
        ...partnerFilter,
        sponsorType: 'shop',
      });

      if (!coupon) {
        return res.status(404).json({ message: 'Coupon not found or unauthorized' });
      }

      coupon.isActive = !coupon.isActive;
      await coupon.save();

      return res.json({
        message: `Coupon "${coupon.code}" is now ${coupon.isActive ? 'Active' : 'Inactive'}`,
        coupon: {
          ...coupon.toObject(),
          id: String(coupon._id),
          couponTypeLabel: COUPON_TYPE_LABELS[coupon.couponType] || coupon.couponType,
          sponsorType: 'shop',
          sponsorTypeLabel: SPONSOR_TYPE_LABELS['shop'],
        },
      });
    } catch (error) {
      console.error('Shop toggle coupon failed:', error);
      return res.status(500).json({ message: 'Unable to toggle coupon' });
    }
  });

  // 5. Delete coupon by shop
  router.delete(['/coupons/:couponId', '/coupon/:couponId'], async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId) return res.status(401).json({ message: 'Unauthorized' });

      const couponId = String(req.params.couponId || '');
      if (!mongoose.isValidObjectId(couponId)) {
        return res.status(400).json({ message: 'Valid coupon ID required' });
      }

      const shop = await resolveShopPartner(user);
      const partnerFilter = getShopPartnerFilter(shop, user);

      const coupon = await Coupon.findOneAndDelete({
        _id: couponId,
        ...partnerFilter,
        sponsorType: 'shop',
      });

      if (!coupon) {
        return res.status(404).json({ message: 'Coupon not found or unauthorized' });
      }

      return res.json({
        message: `Coupon "${coupon.code}" deleted successfully`,
      });
    } catch (error) {
      console.error('Shop delete coupon failed:', error);
      return res.status(500).json({ message: 'Unable to delete coupon' });
    }
  });

  return router;
};

export const shopRoutes = createShopRouter();
export default shopRoutes;

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
import { formatBill } from '../../utils/orderHelpers.js';
import { OrderStatus } from '../../model/Order.js';

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
        { new: true },
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
          'name shopId digipin email phone shopAddress shopLocation category isApproved isBlocked isOpen isOnline',
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
      const { name, phone, shopAddress, category, digipin, lat, lng } = req.body;
      const updates: Record<string, unknown> = {};
      if (typeof name === 'string' && name.trim()) updates.name = name.trim();
      if (typeof phone === 'string' && phone.trim()) updates.phone = phone.trim();
      if (typeof shopAddress === 'string') updates.shopAddress = shopAddress.trim();
      if (typeof category === 'string') updates.category = category.trim();
      if (typeof digipin === 'string' && digipin.trim())
        updates.digipin = digipin.trim().toUpperCase();
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
        { new: true },
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
        { new: true, runValidators: true },
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
      let orders = await ShopOrder.find({
        $or: [
          { shopId: shopObjId },
          { shopId: { $exists: false } },
        ],
      }).sort({ createdAt: -1 });

      // If no shop orders exist yet for this shop, seed initial realistic packaged/retail orders
      if (orders.length === 0) {
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

      const [shopUser, customerUser] = await Promise.all([
        Shop.findById(user.userId).lean(),
        order.customerId
          ? Customer.findById(order.customerId).lean()
          : null,
      ]);

      const bill = formatBill(
        {
          ...order.toObject(),
          restaurantName: order.shopName || shopUser?.name || 'Tomato Partner Shop',
          restaurantAddress: order.shopAddress || shopUser?.shopAddress || '',
        } as any,
        shopUser as any,
        customerUser as any,
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

  return router;
};

export const shopRoutes = createShopRouter();
export default shopRoutes;

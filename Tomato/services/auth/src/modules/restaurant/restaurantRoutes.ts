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
  resolveAdminGsnNumber,
  buildOrderLiveTrackingData,
  createNotificationForRole,
} from '../../utils/orderHelpers.js';
import { productImageUpload } from '../../middleware/upload.js';
import {
  validateBankAndPanDetails,
  resolvePartnerPincode,
  getServiceablePincodes,
} from '../../utils/bankHelpers.js';
import Payment from '../../model/Payment.js';
import Coupon, {
  COUPON_TYPES,
  COUPON_TYPE_LABELS,
  SPONSOR_TYPES,
  SPONSOR_TYPE_LABELS,
  CouponType,
  SponsorType,
} from '../../model/Coupon.js';
import partnerFinanceRoutes from '../partner/partnerFinanceRoutes.js';

const createRestaurantRouter = () => {
  const router = express.Router();
  router.use(authenticate, requireRole('restaurant'));
  router.use('/finance', partnerFinanceRoutes);

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
      await (Notification as any).cleanExpiredAndExcess(user.userId);
      const notifications = await Notification.find({
        userId: user.userId,
        role: 'restaurant',
      })
        .sort({ createdAt: -1 })
        .limit(15);
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

      if (isOpen) {
        const restDoc = await Restaurant.findById(user.userId).lean();
        const restPin = resolvePartnerPincode(restDoc);
        const serviceablePincodes = await getServiceablePincodes();
        if (!restPin || !serviceablePincodes.includes(restPin)) {
          return res.status(400).json({
            message: 'your area is not in servicable range for now, update your address and pincode for orders.',
            code: 'AREA_NOT_SERVICEABLE',
            pincode: restPin,
            serviceablePincodes,
          });
        }
      }

      const updated = await Restaurant.findByIdAndUpdate(
        user.userId,
        { $set: { isOpen, isOnline: isOpen } },
        { returnDocument: 'after' },
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
          'name restaurantId digipin gsnNumber dob email phone restaurantAddress restaurantLocation cuisine isApproved isBlocked isOpen isOnline walletBalance creditPoint bankDetails',
        )
        .lean();
      const cleanName = profile && typeof profile.name === 'string' ? (profile.name.split('/')[0] ?? '').trim() : '';
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
        .json({ message: 'Unable to fetch restaurant profile' });
    }
  });

  router.put('/profile', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const { name, phone, restaurantAddress, cuisine, digipin, gsnNumber, lat, lng } =
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
      if (typeof gsnNumber === 'string')
        updates.gsnNumber = gsnNumber.trim().toUpperCase() || 'NA';
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
        { returnDocument: 'after' },
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
  router.get('/menu/categories', async (req: Request, res: Response) => {
    try {
      const distinctCategories: string[] = await FoodItem.distinct('category').exec();

      const defaultCategories = [
        'Main Course',
        'Starters',
        'Snacks',
        'Desserts',
        'Beverages',
        'Fast Food',
        'Breads & Rice',
        'Soups',
        'Salads',
        'Combos',
        'Breakfast',
        'Thali & Meals',
        'Chinese',
        'Biryani',
        'Pizza & Pasta',
      ];

      const categoryMap = new Map<string, string>();
      defaultCategories.forEach((cat) => {
        if (cat && cat.trim()) categoryMap.set(cat.trim().toLowerCase(), cat.trim());
      });

      distinctCategories.forEach((cat) => {
        if (typeof cat === 'string' && cat.trim()) {
          const trimmed = cat.trim();
          categoryMap.set(trimmed.toLowerCase(), trimmed);
        }
      });

      const categories = Array.from(categoryMap.values()).sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
      );

      return res.json({ categories });
    } catch (error) {
      console.error('Restaurant menu categories fetch failed:', error);
      return res
        .status(500)
        .json({ message: 'Unable to fetch menu categories' });
    }
  });

  router.post('/menu/categories', async (req: Request, res: Response) => {
    try {
      const categoryName = typeof req.body?.category === 'string' ? req.body.category.trim() : '';
      if (!categoryName) {
        return res.status(400).json({ message: 'Valid category name is required' });
      }

      return res.status(201).json({ message: 'Category added successfully', category: categoryName });
    } catch (error) {
      console.error('Restaurant add category failed:', error);
      return res.status(500).json({ message: 'Unable to add category' });
    }
  });

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
          : 'Chinese';
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

  router.post('/upload-image', productImageUpload.single('image'), (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'No image file uploaded' });
      }
      const imageUrl = `/uploads/${req.file.filename}`;
      return res.json({ message: 'Image uploaded successfully', imageUrl });
    } catch (error: any) {
      console.error('Restaurant image upload error:', error);
      return res.status(500).json({ message: error.message || 'Image upload failed' });
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
        { returnDocument: 'after', runValidators: true },
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
      const { startDate, endDate } = req.query;
      const query: Record<string, unknown> = {
        $or: [
          { restaurantId: restaurantObjId },
          { restaurantId: { $exists: false } },
        ],
      };

      if (startDate || endDate) {
        const createdAtFilter: Record<string, Date> = {};
        if (startDate) {
          const start = new Date(String(startDate));
          if (!Number.isNaN(start.getTime())) {
            start.setHours(0, 0, 0, 0);
            createdAtFilter.$gte = start;
          }
        }
        if (endDate) {
          const end = new Date(String(endDate));
          if (!Number.isNaN(end.getTime())) {
            end.setHours(23, 59, 59, 999);
            createdAtFilter.$lte = end;
          }
        }
        if (Object.keys(createdAtFilter).length > 0) {
          query.createdAt = createdAtFilter;
        }
      }

      const orders = await Order.find(query).sort({ createdAt: -1 });

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
        const restPin = resolvePartnerPincode(restUser);
        const serviceablePincodes = await getServiceablePincodes();
        if (!restPin || !serviceablePincodes.includes(restPin)) {
          return res.status(400).json({
            message: 'your area is not in servicable range for now, update your address and pincode for orders.',
            code: 'AREA_NOT_SERVICEABLE',
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

      const [restaurantUser, customerUser, adminGsn] = await Promise.all([
        Restaurant.findById(user.userId).lean(),
        order.customerId
          ? Customer.findById(order.customerId).lean()
          : null,
        resolveAdminGsnNumber(),
      ]);

      const bill = formatBill(
        order,
        restaurantUser as any,
        customerUser as any,
        adminGsn,
      );
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

  // 7. Restaurant Bank & PAN Details (Non-editable once approved; only Admin can edit)
  router.get('/bank-details', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const rest = await Restaurant.findById(user.userId)
        .select('name restaurantId isApproved walletBalance creditPoint bankDetails')
        .lean();
      if (!rest) return res.status(404).json({ message: 'Restaurant not found' });

      const payouts = await Payment.find({ partnerId: String(user.userId) })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      const isLocked = Boolean(
        rest.isApproved ||
          rest.bankDetails?.isApproved ||
          rest.bankDetails?.isLocked,
      );

      return res.json({
        bankDetails: {
          ...(rest.bankDetails || {}),
          isLocked,
        },
        isApproved: rest.isApproved,
        walletBalance: Math.max(0, Number(rest.walletBalance || 0)),
        creditPoint: Math.max(0, Number(rest.creditPoint || 0)),
        payouts,
      });
    } catch (error) {
      console.error('Restaurant bank details fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch bank details' });
    }
  });

  router.put('/bank-details', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });

      const rest = await Restaurant.findById(user.userId).lean();
      if (!rest) return res.status(404).json({ message: 'Restaurant not found' });

      if (
        rest.isApproved ||
        rest.bankDetails?.isApproved ||
        rest.bankDetails?.isLocked
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
        ...(rest.bankDetails || {}),
        ...validation.sanitized,
        isSubmitted: true,
        isApproved: false,
        isLocked: false,
        agreementCommissionPercent:
          rest.bankDetails?.agreementCommissionPercent ?? 15,
        adminNote:
          typeof req.body.adminNote === 'string'
            ? req.body.adminNote.trim()
            : rest.bankDetails?.adminNote || '',
        submittedAt: new Date(),
      };

      const updatedRest = await Restaurant.findByIdAndUpdate(
        user.userId,
        { $set: { bankDetails: updatedBankDetails } },
        { returnDocument: 'after' },
      ).lean();

      try {
        await Notification.create({
          userId: 'ADMIN',
          role: 'admin',
          title: 'Restaurant Bank & PAN Details Submitted',
          message: `${rest.name} (${rest.restaurantId || rest._id}) submitted bank details & PAN (${validation.sanitized.panNumber}) for verification and approval.`,
          type: 'system',
          entityId: String(rest._id),
        });
      } catch (notifErr) {
        console.warn('Admin notification on restaurant bank submit failed:', notifErr);
      }

      return res.json({
        message:
          'Bank details and PAN card submitted successfully! Pending Admin verification & approval.',
        bankDetails: updatedRest?.bankDetails || updatedBankDetails,
      });
    } catch (error) {
      console.error('Restaurant bank details save failed:', error);
      return res.status(500).json({ message: 'Unable to save bank details' });
    }
  });

  // ==========================================
  // Restaurant Specific Coupon Routes
  // ==========================================

  // Helper to resolve restaurant partner and query filters robustly
  const resolveRestaurantPartner = async (user: AuthenticatedRequest['user']) => {
    if (!user) return null;
    let rest: any = null;
    if (user.userId && mongoose.isValidObjectId(user.userId)) {
      rest = await Restaurant.findById(user.userId).lean();
    }
    if (!rest && (user as any).restaurantId) {
      rest = await Restaurant.findOne({ restaurantId: (user as any).restaurantId }).lean();
    }
    if (!rest && user.userId) {
      rest = await Restaurant.findOne({
        $or: [{ restaurantId: user.userId }, { email: user.email }, { phone: user.phone }],
      } as any).lean();
    }
    return rest;
  };

  const getRestaurantPartnerFilter = (rest: any, user: AuthenticatedRequest['user']) => {
    const rawId = rest?._id || user?.userId;
    const objId = rawId && mongoose.isValidObjectId(rawId) ? new mongoose.Types.ObjectId(rawId) : null;
    const conditions: Record<string, any>[] = [];

    if (objId) conditions.push({ partnerId: objId });
    if (rawId) conditions.push({ partnerId: String(rawId) });
    if (rest?.restaurantId) conditions.push({ partnerId: rest.restaurantId });
    if ((user as any)?.restaurantId) conditions.push({ partnerId: (user as any).restaurantId });
    if (rest?.name) conditions.push({ partnerName: rest.name });

    return conditions.length ? { $or: conditions } : {};
  };

  // 1. Get coupons created by this restaurant
  router.get(['/coupons', '/coupon'], async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId) return res.status(401).json({ message: 'Unauthorized' });

      const rest = await resolveRestaurantPartner(user);
      const partnerFilter = getRestaurantPartnerFilter(rest, user);

      const coupons = await Coupon.find({
        ...partnerFilter,
        sponsorType: 'restaurant',
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
        restaurantName: rest?.name || 'Restaurant',
        coupons: coupons.map((c) => ({
          ...c,
          id: String(c._id),
          couponTypeLabel: COUPON_TYPE_LABELS[c.couponType] || c.couponType,
          sponsorType: c.sponsorType || 'restaurant',
          sponsorTypeLabel: SPONSOR_TYPE_LABELS['restaurant'],
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
      console.error('Restaurant coupons fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch coupons' });
    }
  });

  // 2. Create coupon by restaurant
  router.post(['/coupons', '/coupon'], async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId) return res.status(401).json({ message: 'Unauthorized' });

      const rest = await resolveRestaurantPartner(user);
      if (!rest) return res.status(404).json({ message: 'Restaurant partner profile not found' });

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

      const partnerIdToSave = rest._id && mongoose.isValidObjectId(rest._id)
        ? new mongoose.Types.ObjectId(rest._id)
        : (user.userId && mongoose.isValidObjectId(user.userId) ? new mongoose.Types.ObjectId(user.userId) : rest._id || user.userId);

      const created = await Coupon.create({
        code,
        title,
        description,
        couponType: 'restaurant_item_category',
        sponsorType: 'restaurant',
        partnerId: partnerIdToSave,
        partnerName: rest.name,
        discountType,
        discountValue,
        maxDiscountAmount,
        minOrderAmount,
        targetItemCategory,
        occasionName,
        applicableStoreType: 'restaurant',
        usageLimitPerUser,
        totalUsageLimit,
        validFrom,
        validUntil,
        isActive,
        createdBy: rest.name || 'Restaurant',
      });

      return res.status(201).json({
        message: `Coupon "${created.code}" created successfully for ${rest.name}`,
        coupon: {
          ...created.toObject(),
          id: String(created._id),
          couponTypeLabel: COUPON_TYPE_LABELS[created.couponType] || created.couponType,
          sponsorType: 'restaurant',
          sponsorTypeLabel: SPONSOR_TYPE_LABELS['restaurant'],
        },
      });
    } catch (error) {
      console.error('Restaurant create coupon failed:', error);
      return res.status(500).json({ message: 'Unable to create coupon' });
    }
  });

  // 3. Update coupon by restaurant
  router.put(['/coupons/:couponId', '/coupon/:couponId'], async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId) return res.status(401).json({ message: 'Unauthorized' });

      const couponId = String(req.params.couponId || '');
      if (!mongoose.isValidObjectId(couponId)) {
        return res.status(400).json({ message: 'Valid coupon ID required' });
      }

      const rest = await resolveRestaurantPartner(user);
      const partnerFilter = getRestaurantPartnerFilter(rest, user);

      const coupon = await Coupon.findOne({
        _id: couponId,
        ...partnerFilter,
        sponsorType: 'restaurant',
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
          sponsorType: 'restaurant',
          sponsorTypeLabel: SPONSOR_TYPE_LABELS['restaurant'],
        },
      });
    } catch (error) {
      console.error('Restaurant update coupon failed:', error);
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

      const rest = await resolveRestaurantPartner(user);
      const partnerFilter = getRestaurantPartnerFilter(rest, user);

      const coupon = await Coupon.findOne({
        _id: couponId,
        ...partnerFilter,
        sponsorType: 'restaurant',
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
          sponsorType: 'restaurant',
          sponsorTypeLabel: SPONSOR_TYPE_LABELS['restaurant'],
        },
      });
    } catch (error) {
      console.error('Restaurant toggle coupon failed:', error);
      return res.status(500).json({ message: 'Unable to toggle coupon' });
    }
  });

  // 5. Delete coupon by restaurant
  router.delete(['/coupons/:couponId', '/coupon/:couponId'], async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId) return res.status(401).json({ message: 'Unauthorized' });

      const couponId = String(req.params.couponId || '');
      if (!mongoose.isValidObjectId(couponId)) {
        return res.status(400).json({ message: 'Valid coupon ID required' });
      }

      const rest = await resolveRestaurantPartner(user);
      const partnerFilter = getRestaurantPartnerFilter(rest, user);

      const coupon = await Coupon.findOneAndDelete({
        _id: couponId,
        ...partnerFilter,
        sponsorType: 'restaurant',
      });

      if (!coupon) {
        return res.status(404).json({ message: 'Coupon not found or unauthorized' });
      }

      return res.json({
        message: `Coupon "${coupon.code}" deleted successfully`,
      });
    } catch (error) {
      console.error('Restaurant delete coupon failed:', error);
      return res.status(500).json({ message: 'Unable to delete coupon' });
    }
  });

  return router;
};

export const restaurantRoutes = createRestaurantRouter();
export default restaurantRoutes;

import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import Address from '../../model/Address.js';
import MenuItem, { FoodItem } from '../../model/MenuItem.js';
import Notification from '../../model/Notification.js';
import Order, { IOrder, OrderStatus } from '../../model/Order.js';
import Employee, { IEmployee, USER_ROLES, UserRole } from '../../model/Employee.js';
import Restaurant, { IRestaurant } from '../../model/Restaurant.js';
import Shop, { IShop } from '../../model/Shop.js';
import ShopOrder from '../../model/ShopOrder.js';
import Customer, { ICustomer } from '../../model/Customer.js';
import Rider, { IRider } from '../../model/Rider.js';
import Payment from '../../model/Payment.js';
import WalletCreditTrack from '../../model/WalletCreditTrack.js';
import Complaint, { cleanupExpiredClosedComplaints } from '../../model/Complaint.js';
import Coupon, {
  COUPON_TYPES,
  COUPON_TYPE_LABELS,
  CouponType,
  SPONSOR_TYPES,
  SPONSOR_TYPE_LABELS,
  SponsorType,
  ensureDefaultCouponsSeeded,
} from '../../model/Coupon.js';
import {
  authenticate,
  AuthenticatedRequest,
  requireRole,
  requirePermission,
} from '../../middleware/authenticate.js';
import {
  hashPassword,
  userResponse,
  generateRestaurantId,
  generateShopId,
  generateRiderId,
  generateCustomerId,
  generateSubAdminId,
  generateAdminId,
} from '../auth/authController.js';
import { notificationService, arattaiNotificationService } from '../notification/index.js';
import {
  transferCreditPoints,
  WalletServiceError,
} from '../wallet/walletService.js';
import {
  formatBill,
  resolveAdminGsnNumber,
  buildOrderLiveTrackingData,
  createNotificationForRole,
} from '../../utils/orderHelpers.js';
import {
  validateBankAndPanDetails,
  checkPartnerCanBeApproved,
  syncOrderToTomatoPayment,
  adjustTomatoCentralBankBalance,
  extractPincodeFromText,
  resolvePartnerPincode,
  getServiceablePincodes,
  addServiceablePincodes,
  removeServiceablePincode,
} from '../../utils/bankHelpers.js';

const createAdminRouter = () => {
  const router = express.Router();
  router.use(authenticate, requireRole('admin', 'subadmin'));

  // Serviceable Delivery Pincodes Management (Admin can view, add, or remove pincodes anytime)
  router.get('/serviceable-pincodes', async (_req: Request, res: Response) => {
    try {
      const pincodes = await getServiceablePincodes();
      return res.json({ pincodes });
    } catch (error) {
      console.error('Fetch serviceable pincodes failed:', error);
      return res.status(500).json({ message: 'Unable to fetch serviceable pincodes' });
    }
  });

  router.post('/serviceable-pincodes', async (req: Request, res: Response) => {
    try {
      const raw = req.body?.pincode ?? req.body?.pincodes;
      const { added, pincodes } = await addServiceablePincodes(raw);
      if (added.length === 0) {
        return res.status(400).json({
          message: 'Please provide a valid 5 or 6 digit pincode (or comma-separated pincodes)',
          pincodes,
        });
      }
      return res.json({
        message: `Serviceable pincode(s) active: ${added.join(', ')}`,
        added,
        pincodes,
      });
    } catch (error) {
      console.error('Add serviceable pincodes failed:', error);
      return res.status(500).json({ message: 'Unable to add serviceable pincode' });
    }
  });

  router.delete('/serviceable-pincodes/:pincode', async (req: Request, res: Response) => {
    try {
      const pincode = String(req.params.pincode || '').trim();
      if (!pincode) {
        return res.status(400).json({ message: 'Pincode is required' });
      }
      const { pincodes, unapprovedPartnersCount } = await removeServiceablePincode(pincode);
      return res.json({
        message:
          unapprovedPartnersCount > 0
            ? `Pincode ${pincode} removed from serviceable range (${unapprovedPartnersCount} restaurant/shop(s) in this pincode were automatically marked unapproved)`
            : `Pincode ${pincode} removed from serviceable range`,
        pincodes,
        unapprovedCount: unapprovedPartnersCount,
        unapprovedPartnersCount,
      });
    } catch (error) {
      console.error('Remove serviceable pincode failed:', error);
      return res.status(500).json({ message: 'Unable to remove serviceable pincode' });
    }
  });

  // =========================================================================
  // COUPON & DISCOUNT MANAGEMENT (ADMIN PANEL)
  // =========================================================================
  router.get('/coupons', async (_req: Request, res: Response) => {
    try {
      await ensureDefaultCouponsSeeded();
      const [coupons, rawCategories, customers] = await Promise.all([
        Coupon.find().sort({ createdAt: -1 }).lean(),
        FoodItem.distinct('category'),
        Customer.find()
          .select('_id customerId name email phone')
          .sort({ createdAt: -1 })
          .limit(120)
          .lean(),
      ]);

      const defaultCats = [
        'Main Course',
        'Sweets',
        'Starters',
        'Desserts',
        'Biryani',
        'Beverages',
        'Breads',
        'Groceries',
        'Fresh Produce',
        'Dairy & Bakery',
        'Snacks & Packaged',
      ];
      const categorySet = new Set<string>(defaultCats);
      for (const c of rawCategories) {
        if (typeof c === 'string' && c.trim()) {
          categorySet.add(c.trim());
        }
      }

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
        coupons: coupons.map((c) => ({
          ...c,
          id: String(c._id),
          couponTypeLabel: COUPON_TYPE_LABELS[c.couponType] || c.couponType,
          sponsorType: c.sponsorType || 'tomato',
          sponsorTypeLabel:
            SPONSOR_TYPE_LABELS[(c.sponsorType as SponsorType) || 'tomato'] ||
            'Tomato Specific (Paid by Tomato)',
        })),
        summary: {
          totalCoupons: coupons.length,
          activeCoupons,
          inactiveCoupons: coupons.length - activeCoupons,
          totalRedemptions,
          totalDiscountGiven: Number(totalDiscountGiven.toFixed(2)),
          maxCouponsPerOrder: 1,
        },
        categories: Array.from(categorySet),
        customerDirectory: customers.map((cust: any) => ({
          id: String(cust._id),
          customerId:
            cust.customerId ||
            `cust-${String(cust._id).slice(-4).toLowerCase()}`,
          name: cust.name || 'Customer',
          email: cust.email || '',
          phone: cust.phone || '',
        })),
      });
    } catch (error) {
      console.error('Admin coupons fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch coupons' });
    }
  });

  router.post('/coupons', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const body = req.body ?? {};
      const code = String(body.code || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '');
      const title = String(body.title || '').trim();
      const description = String(body.description || '').trim();
      const couponType = String(body.couponType || 'restaurant_item_category') as CouponType;
      const discountType = body.discountType === 'flat' ? 'flat' : 'percentage';
      const discountValue = Number(body.discountValue ?? 0);
      const maxDiscountAmount = Math.max(0, Number(body.maxDiscountAmount ?? 0));
      const minOrderAmount = Math.max(0, Number(body.minOrderAmount ?? 0));
      const targetItemCategory = String(body.targetItemCategory || '').trim();
      const occasionName = String(body.occasionName || '').trim();
      const targetUserIdentifier = String(body.targetUserIdentifier || '').trim();
      const applicableStoreType = ['all', 'restaurant', 'shop'].includes(body.applicableStoreType)
        ? body.applicableStoreType
        : couponType === 'shop' || couponType === 'grocery'
        ? 'shop'
        : couponType === 'restaurant_item_category'
        ? 'restaurant'
        : 'all';
      const sponsorType: SponsorType = body.sponsorType === 'common' ? 'common' : 'tomato';
      const usageLimitPerUser = Math.max(0, Number(body.usageLimitPerUser ?? 1));
      const totalUsageLimit = Math.max(0, Number(body.totalUsageLimit ?? 0));
      const validFrom = body.validFrom ? new Date(body.validFrom) : new Date();
      const validUntil = body.validUntil ? new Date(body.validUntil) : null;
      const isActive = body.isActive !== undefined ? Boolean(body.isActive) : true;

      if (!code || code.length < 3) {
        return res.status(400).json({
          message: 'Coupon code must be at least 3 characters (e.g. DIWALI50, SWEETS20)',
        });
      }
      if (!title) {
        return res.status(400).json({ message: 'Coupon title is required' });
      }
      if (!COUPON_TYPES.includes(couponType)) {
        return res.status(400).json({ message: 'Invalid coupon category/type' });
      }
      if (!discountValue || discountValue <= 0) {
        return res.status(400).json({ message: 'Discount value must be greater than 0' });
      }
      if (discountType === 'percentage' && discountValue > 100) {
        return res.status(400).json({ message: 'Percentage discount cannot exceed 100%' });
      }
      if (couponType === 'specific_user' && !targetUserIdentifier) {
        return res.status(400).json({
          message: 'Please provide the Specific User ID, Email, or Mobile Number for this coupon',
        });
      }

      const existing = await Coupon.findOne({ code });
      if (existing) {
        return res.status(409).json({
          message: `A coupon with code "${code}" already exists`,
        });
      }

      const created = await Coupon.create({
        code,
        title,
        description,
        couponType,
        sponsorType,
        discountType,
        discountValue,
        maxDiscountAmount,
        minOrderAmount,
        targetItemCategory,
        occasionName,
        targetUserIdentifier,
        applicableStoreType,
        usageLimitPerUser,
        totalUsageLimit,
        validFrom,
        validUntil,
        isActive,
        createdBy: (user as any)?.name || user?.role || 'Admin',
      });

      return res.status(201).json({
        message: `Coupon "${created.code}" created successfully`,
        coupon: {
          ...created.toObject(),
          id: String(created._id),
          couponTypeLabel: COUPON_TYPE_LABELS[created.couponType] || created.couponType,
          sponsorType: created.sponsorType || 'tomato',
          sponsorTypeLabel:
            SPONSOR_TYPE_LABELS[(created.sponsorType as SponsorType) || 'tomato'] ||
            'Tomato Specific (Paid by Tomato)',
        },
      });
    } catch (error) {
      console.error('Create coupon failed:', error);
      return res.status(500).json({ message: 'Unable to create coupon' });
    }
  });

  router.put('/coupons/:couponId', async (req: Request, res: Response) => {
    try {
      const couponId = String(req.params.couponId || '');
      if (!mongoose.isValidObjectId(couponId)) {
        return res.status(400).json({ message: 'Valid coupon ID is required' });
      }

      const coupon = await Coupon.findById(couponId);
      if (!coupon) {
        return res.status(404).json({ message: 'Coupon not found' });
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
      if (body.couponType !== undefined && COUPON_TYPES.includes(body.couponType)) {
        coupon.couponType = body.couponType;
      }
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
      if (body.targetUserIdentifier !== undefined) {
        coupon.targetUserIdentifier = String(body.targetUserIdentifier).trim();
      }
      if (
        body.applicableStoreType !== undefined &&
        ['all', 'restaurant', 'shop'].includes(body.applicableStoreType)
      ) {
        coupon.applicableStoreType = body.applicableStoreType;
      }
      if (body.sponsorType !== undefined && (body.sponsorType === 'tomato' || body.sponsorType === 'common')) {
        coupon.sponsorType = body.sponsorType;
      }
      if (body.usageLimitPerUser !== undefined) {
        coupon.usageLimitPerUser = Math.max(0, Number(body.usageLimitPerUser));
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
          sponsorType: coupon.sponsorType || 'tomato',
          sponsorTypeLabel:
            SPONSOR_TYPE_LABELS[(coupon.sponsorType as SponsorType) || 'tomato'] ||
            'Tomato Specific (Paid by Tomato)',
        },
      });
    } catch (error) {
      console.error('Update coupon failed:', error);
      return res.status(500).json({ message: 'Unable to update coupon' });
    }
  });

  router.delete('/coupons/:couponId', async (req: Request, res: Response) => {
    try {
      const couponId = String(req.params.couponId || '');
      if (!mongoose.isValidObjectId(couponId)) {
        return res.status(400).json({ message: 'Valid coupon ID is required' });
      }
      const deleted = await Coupon.findByIdAndDelete(couponId);
      if (!deleted) {
        return res.status(404).json({ message: 'Coupon not found' });
      }
      return res.json({
        message: `Coupon "${deleted.code}" deleted successfully`,
      });
    } catch (error) {
      console.error('Delete coupon failed:', error);
      return res.status(500).json({ message: 'Unable to delete coupon' });
    }
  });

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
      await (Notification as any).cleanExpiredAndExcess(user.userId);
      const notifications = await Notification.find({
        $or: [{ userId: user.userId }, { role: user.role }, { role: 'admin' }],
      })
        .sort({ createdAt: -1 })
        .limit(15);
      return res.json({ notifications });
    } catch (error) {
      console.error('Admin notification fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch notifications' });
    }
  });

  router.get(
    '/wallet-credit-track',
    requireRole('admin'),
    async (req: Request, res: Response) => {
      try {
        const parsedLimit = Number.parseInt(String(req.query.limit || '50'), 10);
        const limit = Number.isFinite(parsedLimit)
          ? Math.min(Math.max(parsedLimit, 1), 100)
          : 50;
        const records = await WalletCreditTrack.find({
          recordType: 'transfer',
        })
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean();
        return res.json({ records });
      } catch (error) {
        console.error('Wallet credit history fetch failed:', error);
        return res.status(500).json({
          message: 'Unable to fetch wallet credit history',
        });
      }
    },
  );

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
          shops,
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
          Customer.countDocuments(),
          Restaurant.find().lean(),
          Shop.find().lean(),
          Rider.find().lean(),
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
        const pendingShops = shops.filter(
          (s) => s.isApproved === false,
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
            totalShops: shops.length,
            pendingShops,
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
          { returnDocument: 'after' },
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
        if (role === 'shop' && !perms.includes('shops_manage') && !perms.includes('restaurants_manage')) {
          return res
            .status(403)
            .json({
              message: 'Access denied. Requires shops_manage or restaurants_manage permission.',
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
        const restaurants = await Restaurant.find(restFilter).sort({ createdAt: -1 });
        return res.json(paginateList(restaurants.map((r) => userResponse(r as any))));
      }

      if (role === 'shop') {
        const shopFilter: Record<string, unknown> = {};
        if (typeof search === 'string' && search.trim()) {
          const term = search.trim();
          const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const orConditions: any[] = [
            { name: { $regex: escaped, $options: 'i' } },
            { email: { $regex: escaped, $options: 'i' } },
            { phone: { $regex: escaped, $options: 'i' } },
            { shopId: { $regex: escaped, $options: 'i' } },
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
          shopFilter.$or = orConditions;
        }
        const shops = await Shop.find(shopFilter).sort({ createdAt: -1 });
        return res.json(paginateList(shops.map((s) => userResponse(s as any))));
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
        const customers = await Customer.find(custFilter).sort({ createdAt: -1 });
        return res.json(paginateList(customers.map((c) => userResponse(c as any))));
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
        const riders = await Rider.find(riderFilter).sort({ createdAt: -1 });
        return res.json(paginateList(riders.map((r) => userResponse(r as any))));
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
        const shopFilter: Record<string, unknown> = {};
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
          shopFilter.$or = [
            ...commonOr,
            { shopId: { $regex: escaped, $options: 'i' } },
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

        const [employees, restaurants, shops, riders, customers] = await Promise.all([
          Employee.find(filter).sort({ createdAt: -1 }),
          Restaurant.find(restFilter).sort({ createdAt: -1 }),
          Shop.find(shopFilter).sort({ createdAt: -1 }),
          Rider.find(riderFilter).sort({ createdAt: -1 }),
          Customer.find(custFilter).sort({ createdAt: -1 }),
        ]);

        const combined = [
          ...employees.map((u) => userResponse(u as any)),
          ...restaurants.map((r) => userResponse(r as any)),
          ...shops.map((s) => userResponse(s as any)),
          ...riders.map((r) => userResponse(r as any)),
          ...customers.map((c) => userResponse(c as any)),
        ];
        combined.sort(
          (a: any, b: any) =>
            new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime(),
        );
        return res.json(paginateList(combined));
      }

      const employees = await Employee.find(filter).sort({ createdAt: -1 });
      return res.json(paginateList(employees.map((u) => userResponse(u as any))));
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

      const currentUser = (req as AuthenticatedRequest).user;
      if (currentUser?.role === 'subadmin' && role === 'admin') {
        return res.status(403).json({
          message: 'Access denied. Sub-admins cannot create administrator accounts.',
        });
      }

      const duplicateQuery = {
        $or: [
          ...(email ? [{ email: email.trim().toLowerCase() }] : []),
          ...(phone ? [{ phone: phone.trim() }] : []),
        ],
      };

      const [
        existingEmployee,
        existingRestaurant,
        existingShop,
        existingRider,
        existingCustomer,
      ] = await Promise.all([
        Employee.findOne(duplicateQuery),
        Restaurant.findOne(duplicateQuery),
        Shop.findOne(duplicateQuery),
        Rider.findOne(duplicateQuery),
        Customer.findOne(duplicateQuery),
      ]);

      if (
        existingEmployee ||
        existingRestaurant ||
        existingShop ||
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

        const rAddr = restaurantAddress ? restaurantAddress.trim() : '';
        const rPincode =
          extractPincodeFromText(req.body?.pincode) ||
          extractPincodeFromText(rAddr) ||
          '';
        const serviceablePincodes = await getServiceablePincodes();
        const isPincodeServiceable =
          Boolean(rPincode) && serviceablePincodes.includes(rPincode);
        const restBankCheck = validateBankAndPanDetails(req.body?.bankDetails);
        const canAutoApprove = restBankCheck.valid && isPincodeServiceable;

        const restaurant = await Restaurant.create({
          name: name.trim(),
          email: email ? email.trim().toLowerCase() : undefined,
          phone: phone ? phone.trim() : undefined,
          passwordHash: await hashPassword(password),
          role: 'restaurant',
          isApproved: canAutoApprove,
          isBlocked: false,
          restaurantId,
          digipin,
          pincode: rPincode,
          restaurantAddress: rAddr,
          restaurantLocation,
          cuisine: cuisine ? cuisine.trim() : 'Multi-cuisine',
          isOpen: true,
          isOnline: true,
          ...(restBankCheck.valid && restBankCheck.sanitized
            ? {
                bankDetails: {
                  ...restBankCheck.sanitized,
                  isSubmitted: true,
                  isApproved: canAutoApprove,
                  isLocked: canAutoApprove,
                  agreementCommissionPercent: 15,
                  submittedAt: new Date(),
                  ...(canAutoApprove
                    ? {
                        approvedAt: new Date(),
                        approvedBy: currentUser?.name || 'Admin',
                      }
                    : {}),
                },
              }
            : {}),
        });

        return res.status(201).json({
          message: canAutoApprove
            ? 'Restaurant created and approved with verified Bank, PAN & serviceable pincode'
            : restBankCheck.valid && !isPincodeServiceable
              ? `Restaurant created (Pending approval: pincode "${rPincode || 'N/A'}" is not in serviceable range)`
              : 'Restaurant created (Pending Bank & PAN submission and serviceable pincode check for approval)',
          user: userResponse(restaurant as any),
        });
      }

      if (role === 'shop') {
        const shopId = await generateShopId();
        let digipin =
          typeof req.body?.digipin === 'string'
            ? req.body.digipin.trim().toUpperCase()
            : '';
        let shopLocation: { lat: number; lng: number } = {
          lat: 12.9716,
          lng: 77.5946,
        };
        const rawLat = req.body?.shopLocation?.lat ?? req.body?.restaurantLocation?.lat ?? req.body?.lat;
        const rawLng = req.body?.shopLocation?.lng ?? req.body?.restaurantLocation?.lng ?? req.body?.lng;
        if (
          rawLat !== undefined &&
          rawLng !== undefined &&
          !isNaN(Number(rawLat)) &&
          !isNaN(Number(rawLng))
        ) {
          shopLocation = { lat: Number(rawLat), lng: Number(rawLng) };
        }
        if (!digipin) {
          digipin = `DGP-${Math.round(shopLocation.lat * 100)}-${Math.round(shopLocation.lng * 100)}`;
        }
        const sAddress = (req.body?.shopAddress || req.body?.restaurantAddress || '').trim();
        const sPincode =
          extractPincodeFromText(req.body?.pincode) ||
          extractPincodeFromText(sAddress) ||
          '';
        const serviceablePincodes = await getServiceablePincodes();
        const isPincodeServiceable =
          Boolean(sPincode) && serviceablePincodes.includes(sPincode);
        const sCategory = req.body?.category || req.body?.cuisine || 'Retail, Supermarket & Groceries';
        const shopBankCheck = validateBankAndPanDetails(req.body?.bankDetails);
        const canAutoApprove = shopBankCheck.valid && isPincodeServiceable;

        const shop = await Shop.create({
          name: name.trim(),
          email: email ? email.trim().toLowerCase() : undefined,
          phone: phone ? phone.trim() : undefined,
          passwordHash: await hashPassword(password),
          role: 'shop',
          isApproved: canAutoApprove,
          isBlocked: false,
          shopId,
          digipin,
          pincode: sPincode,
          shopAddress: sAddress,
          shopLocation,
          category: sCategory.trim(),
          isOpen: true,
          isOnline: true,
          ...(shopBankCheck.valid && shopBankCheck.sanitized
            ? {
                bankDetails: {
                  ...shopBankCheck.sanitized,
                  isSubmitted: true,
                  isApproved: canAutoApprove,
                  isLocked: canAutoApprove,
                  agreementCommissionPercent: 12,
                  submittedAt: new Date(),
                  ...(canAutoApprove
                    ? {
                        approvedAt: new Date(),
                        approvedBy: currentUser?.name || 'Admin',
                      }
                    : {}),
                },
              }
            : {}),
        });

        return res.status(201).json({
          message: canAutoApprove
            ? 'Shop created and approved with verified Bank, PAN & serviceable pincode'
            : shopBankCheck.valid && !isPincodeServiceable
              ? `Shop created (Pending approval: pincode "${sPincode || 'N/A'}" is not in serviceable range)`
              : 'Shop created (Pending Bank & PAN submission and serviceable pincode check for approval)',
          user: userResponse(shop as any),
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
        const riderBankCheck = validateBankAndPanDetails(req.body?.bankDetails);

        const rider = await Rider.create({
          name: name.trim(),
          email: email ? email.trim().toLowerCase() : undefined,
          phone: phone ? phone.trim() : undefined,
          passwordHash: await hashPassword(password),
          role: 'deliveryPartner',
          isApproved: riderBankCheck.valid,
          isBlocked: false,
          riderId,
          deliveryVehicle: deliveryVehicle
            ? deliveryVehicle.trim()
            : 'motorcycle',
          currentLocation,
          isOnline: true,
          lastLocationUpdated: new Date(),
          ...(riderBankCheck.valid && riderBankCheck.sanitized
            ? {
                bankDetails: {
                  ...riderBankCheck.sanitized,
                  isSubmitted: true,
                  isApproved: true,
                  isLocked: true,
                  riderPayoutPerOrder: 40,
                  submittedAt: new Date(),
                  approvedAt: new Date(),
                  approvedBy: currentUser?.name || 'Admin',
                },
              }
            : {}),
        } as unknown as IRider);

        return res.status(201).json({
          message: riderBankCheck.valid
            ? 'Delivery partner created and approved with verified Bank & PAN details'
            : 'Delivery partner created (Pending Bank & PAN submission for approval)',
          user: userResponse(rider as any),
        });
      }

      const adminId = role === 'admin' ? await generateAdminId() : undefined;
      const subadminId = role === 'subadmin' ? await generateSubAdminId() : undefined;
      const employeeData: Record<string, unknown> = {
        name: name.trim(),
        email: email ? email.trim().toLowerCase() : undefined,
        phone: phone ? phone.trim() : undefined,
        passwordHash: await hashPassword(password),
        role,
        adminRoleTitle:
          role === 'admin'
            ? 'Platform Administrator'
            : 'Operations Sub-Admin',
        isApproved: true,
        isBlocked: false,
        permissions: role === 'admin' ? ['*'] : ['orders_manage'],
        ...(adminId ? { adminId } : {}),
        ...(subadminId ? { subadminId } : {}),
      };

      const employee = await Employee.create(employeeData);

      return res.status(201).json({
        message: 'Account created successfully in Employees table',
        user: userResponse(employee as any),
      });
    } catch (error) {
      console.error('Admin create user failed:', error);
      return res.status(500).json({ message: 'Unable to create user' });
    }
  });

  // Update user
  router.post(
    '/users/:userId/credit-points',
    requireRole('admin'),
    async (req: Request, res: Response) => {
      const adminId = (req as AuthenticatedRequest).user?.userId;
      const recipientId = String(req.params.userId || '');

      if (!adminId) {
        return res.status(401).json({ message: 'Authentication required' });
      }
      if (!recipientId.trim() || recipientId.length > 128) {
        return res.status(400).json({ message: 'Recipient user ID is required' });
      }

      try {
        const transfer = await transferCreditPoints(
          adminId,
          recipientId,
          req.body?.creditPoints,
          req.body?.purpose,
          req.body?.orderNumber,
        );
        return res.json({
          message: `Transferred ${req.body.creditPoints} credit point(s) successfully`,
          ...transfer,
        });
      } catch (error: any) {
        if (error instanceof WalletServiceError || error?.name === 'WalletServiceError') {
          return res.status(error.statusCode || 400).json({ message: error.message });
        }
        console.error('Admin credit-point transfer failed:', error);
        return res.status(500).json({ message: 'Unable to transfer credit points' });
      }
    },
  );

  router.put('/users/:userId', async (req: Request, res: Response) => {
    try {
      const userId = String(req.params.userId || '');
      const currentUser = (req as AuthenticatedRequest).user;
      if (!userId || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: 'Valid user ID is required' });
      }

      // Sub-admin can NEVER modify or update permissions of an admin account:
      const targetUser = await Employee.findById(userId);
      if (targetUser && targetUser.role === 'admin') {
        if (currentUser?.role === 'subadmin') {
          return res.status(403).json({
            message: 'Access denied. Sub-admins can never delete, modify, or update permissions of administrator accounts.',
          });
        }
      }

      // Sub-admin can never elevate any account to admin role:
      if (currentUser?.role === 'subadmin' && req.body.role === 'admin') {
        return res.status(403).json({
          message: 'Access denied. Sub-admins cannot assign or elevate to the administrator role.',
        });
      }

      // Sub-admin can never modify permissions or operational titles:
      if (
        currentUser?.role === 'subadmin' &&
        (req.body.permissions !== undefined || req.body.adminRoleTitle !== undefined)
      ) {
        return res.status(403).json({
          message: 'Access denied. Sub-admins cannot modify administrator or operational permissions.',
        });
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
        pincode,
      } = req.body;

      const updates: Record<string, unknown> = {};
      if (name) updates.name = name.trim();
      if (email) updates.email = email.trim().toLowerCase();
      if (phone) updates.phone = phone.trim();
      if (role && USER_ROLES.includes(role)) updates.role = role;
      if (restaurantAddress !== undefined)
        updates.restaurantAddress = restaurantAddress.trim();
      if (pincode !== undefined) {
        updates.pincode =
          extractPincodeFromText(pincode) || String(pincode).trim();
      } else if (restaurantAddress !== undefined) {
        const extractedPin = extractPincodeFromText(restaurantAddress);
        if (extractedPin) updates.pincode = extractedPin;
      }
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
        { returnDocument: 'after', runValidators: true },
      );
      if (!user) {
        const shopUpdates: Record<string, unknown> = { ...updates };
        if (req.body.shopAddress !== undefined || req.body.restaurantAddress !== undefined) {
          const nextAddr = (req.body.shopAddress || req.body.restaurantAddress || '').trim();
          shopUpdates.shopAddress = nextAddr;
          if (pincode === undefined) {
            const extractedPin = extractPincodeFromText(nextAddr);
            if (extractedPin) shopUpdates.pincode = extractedPin;
          }
        }
        if (req.body.category !== undefined || req.body.cuisine !== undefined) {
          shopUpdates.category = (req.body.category || req.body.cuisine || '').trim();
        }
        if (updates.restaurantLocation) {
          shopUpdates.shopLocation = updates.restaurantLocation;
        }
        user = await Shop.findByIdAndUpdate(
          userId,
          { $set: shopUpdates },
          { returnDocument: 'after', runValidators: true },
        );
      }
      if (user && (user.role === 'restaurant' || user.role === 'shop') && user.isApproved) {
        const serviceablePincodes = await getServiceablePincodes();
        const currentPin = resolvePartnerPincode(user);
        if (!currentPin || !serviceablePincodes.includes(currentPin)) {
          user.isApproved = false;
          await user.save();
        }
      }
      if (!user) {
        user = await Rider.findByIdAndUpdate(
          userId,
          { $set: updates },
          { returnDocument: 'after', runValidators: true },
        );
      }
      if (!user) {
        user = await Customer.findByIdAndUpdate(
          userId,
          { $set: updates },
          { returnDocument: 'after', runValidators: true },
        );
      }
      if (!user) {
        user = await Employee.findByIdAndUpdate(
          userId,
          { $set: updates },
          { returnDocument: 'after', runValidators: true },
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
        const allRiders = await Rider.find()
          .select(
            'name riderId phone email currentLocation isOnline lastLocationUpdated deliveryVehicle isApproved isBlocked',
          )
          .lean();

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
            return {
              ...userResponse(r as any),
              displayName: r.name,
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

  // Admin order bill generation
  router.get(
    '/orders/:orderId/bill',
    requirePermission('orders_manage'),
    async (req: Request, res: Response) => {
      try {
        const orderId = String(req.params.orderId || '');
        if (!orderId || !mongoose.isValidObjectId(orderId)) {
          return res
            .status(400)
            .json({ message: 'Valid order ID is required' });
        }

        let order: any = await Order.findById(orderId);
        if (!order) {
          order = await ShopOrder.findById(orderId);
        }
        if (!order) return res.status(404).json({ message: 'Order not found' });

        const targetStoreId = order.restaurantId || order.shopId;
        const [restaurantUser, shopUser, customerUser, adminGsn] =
          await Promise.all([
            targetStoreId ? Restaurant.findById(targetStoreId).lean() : null,
            targetStoreId ? Shop.findById(targetStoreId).lean() : null,
            order.customerId
              ? Customer.findById(order.customerId).lean()
              : null,
            resolveAdminGsnNumber(),
          ]);

        const bill = formatBill(
          order,
          (restaurantUser || shopUser) as any,
          customerUser as any,
          adminGsn,
        );
        return res.json({ bill });
      } catch (error) {
        console.error('Admin bill fetch failed:', error);
        return res.status(500).json({ message: 'Unable to generate bill' });
      }
    },
  );

  // Approve rider or restaurant or shop (ONLY when bank details + IFSC + PAN are submitted and Account Holder Name matches PAN Card Name, AND for Restaurant/Shop its pincode is in Admin serviceable range)
  router.post('/users/:userId/approve', async (req: Request, res: Response) => {
    try {
      const userId = String(req.params.userId || '');
      const adminUser = (req as AuthenticatedRequest).user;
      if (!userId || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: 'Valid user ID is required' });
      }

      const adminIdentifier =
        adminUser?.name || adminUser?.email || adminUser?.userId || 'Admin';

      let user: any = await Restaurant.findById(userId);
      let partnerLabel = 'Restaurant';
      let isStorePartner = true;

      if (!user) {
        user = await Shop.findById(userId);
        partnerLabel = 'Shop';
      }
      if (!user) {
        user = await Rider.findById(userId);
        partnerLabel = 'Delivery Partner (Rider)';
        isStorePartner = false;
      }

      if (user) {
        if (isStorePartner) {
          const serviceablePincodes = await getServiceablePincodes();
          const partnerPincode = resolvePartnerPincode(user);
          if (!partnerPincode || !serviceablePincodes.includes(partnerPincode)) {
            return res.status(400).json({
              message: `${partnerLabel} "${user.name}" pincode ${partnerPincode ? `(${partnerPincode})` : '(missing)'} is not in the serviceable range. Active serviceable pincodes: ${serviceablePincodes.join(', ') || 'None'}.`,
              code: 'PINCODE_NOT_SERVICEABLE',
              pincode: partnerPincode || '',
              serviceablePincodes,
            });
          }
          if (!user.pincode && partnerPincode) {
            user.pincode = partnerPincode;
          }
        }

        const approvalCheck = checkPartnerCanBeApproved(user.bankDetails);
        if (!approvalCheck.canApprove) {
          return res.status(400).json({
            message: `Cannot approve ${partnerLabel} "${user.name}": ${approvalCheck.reason} Please verify or fill their Bank Details, IFSC Code, Bank Account Holder Name, and matching PAN Card in the Bank panel first.`,
            code: 'BANK_KYC_REQUIRED',
          });
        }

        const plainBd = (user.bankDetails as any)?.toObject
          ? (user.bankDetails as any).toObject()
          : user.bankDetails || {};
        user.isApproved = true;
        user.bankDetails = {
          ...plainBd,
          isSubmitted: true,
          isApproved: true,
          isLocked: true,
          approvedAt: new Date(),
          approvedBy: adminIdentifier,
        };
        await user.save();
      } else {
        user = await Customer.findByIdAndUpdate(
          userId,
          { $set: { isApproved: true } },
          { returnDocument: 'after' },
        );
        if (!user) {
          user = await Employee.findByIdAndUpdate(
            userId,
            { $set: { isApproved: true } },
            { returnDocument: 'after' },
          );
        }
      }

      if (!user) return res.status(404).json({ message: 'User not found' });

      await Notification.create({
        userId: String(user._id),
        role: user.role,
        title: 'Account & Bank Details Approved!',
        message:
          'Your Tomato partner profile and bank/PAN details have been verified and approved by the administrator. Your bank details are now locked for security.',
        type: 'service',
      });

      return res.json({
        message: `${user.name} approved successfully (Bank & PAN verified and locked)`,
        user: userResponse(user),
      });
    } catch (error) {
      console.error('Approve user failed:', error);
      return res.status(500).json({ message: 'Unable to approve user' });
    }
  });

  // Reject rider or restaurant or shop
  router.post('/users/:userId/reject', async (req: Request, res: Response) => {
    try {
      const userId = String(req.params.userId || '');
      if (!userId || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: 'Valid user ID is required' });
      }

      let user: any = await Restaurant.findByIdAndUpdate(
        userId,
        {
          $set: {
            isApproved: false,
            'bankDetails.isApproved': false,
            'bankDetails.isLocked': false,
          },
        },
        { returnDocument: 'after' },
      );
      if (!user) {
        user = await Shop.findByIdAndUpdate(
          userId,
          {
            $set: {
              isApproved: false,
              'bankDetails.isApproved': false,
              'bankDetails.isLocked': false,
            },
          },
          { returnDocument: 'after' },
        );
      }
      if (!user) {
        user = await Rider.findByIdAndUpdate(
          userId,
          {
            $set: {
              isApproved: false,
              'bankDetails.isApproved': false,
              'bankDetails.isLocked': false,
            },
          },
          { returnDocument: 'after' },
        );
      }
      if (!user) {
        user = await Customer.findByIdAndUpdate(
          userId,
          { $set: { isApproved: false } },
          { returnDocument: 'after' },
        );
      }
      if (!user) {
        user = await Employee.findByIdAndUpdate(
          userId,
          { $set: { isApproved: false } },
          { returnDocument: 'after' },
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

  // Block any rider, restaurant, shop, or customer
  router.post('/users/:userId/block', async (req: Request, res: Response) => {
    try {
      const userId = String(req.params.userId || '');
      const currentUser = (req as AuthenticatedRequest).user;
      if (!userId || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: 'Valid user ID is required' });
      }

      // Check if target is an administrator or sub-admin
      const targetUserRecord = await Employee.findById(userId);
      if (targetUserRecord) {
        if (targetUserRecord.role === 'admin') {
          return res.status(403).json({
            message: 'Access denied. Administrator accounts cannot be blocked or modified.',
          });
        }
        if (targetUserRecord.role === 'subadmin' && currentUser?.role !== 'admin') {
          return res.status(403).json({
            message: 'Access denied. Only the platform administrator can block sub-admin accounts.',
          });
        }
      }

      let user: any = await Restaurant.findByIdAndUpdate(
        userId,
        { $set: { isBlocked: true } },
        { returnDocument: 'after' },
      );
      if (!user) {
        user = await Shop.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: true } },
          { returnDocument: 'after' },
        );
      }
      if (!user) {
        user = await Rider.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: true } },
          { returnDocument: 'after' },
        );
      }
      if (!user) {
        user = await Customer.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: true } },
          { returnDocument: 'after' },
        );
      }
      if (!user) {
        user = await Employee.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: true } },
          { returnDocument: 'after' },
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
      const currentUser = (req as AuthenticatedRequest).user;
      if (!userId || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: 'Valid user ID is required' });
      }

      // Check if target is an administrator or sub-admin
      const targetUserRecord = await Employee.findById(userId);
      if (targetUserRecord) {
        if (targetUserRecord.role === 'admin') {
          return res.status(403).json({
            message: 'Access denied. Administrator accounts cannot be modified.',
          });
        }
        if (targetUserRecord.role === 'subadmin' && currentUser?.role !== 'admin') {
          return res.status(403).json({
            message: 'Access denied. Only the platform administrator can unblock sub-admin accounts.',
          });
        }
      }

      let user: any = await Restaurant.findByIdAndUpdate(
        userId,
        { $set: { isBlocked: false } },
        { returnDocument: 'after' },
      );
      if (!user) {
        user = await Shop.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: false } },
          { returnDocument: 'after' },
        );
      }
      if (!user) {
        user = await Rider.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: false } },
          { returnDocument: 'after' },
        );
      }
      if (!user) {
        user = await Customer.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: false } },
          { returnDocument: 'after' },
        );
      }
      if (!user) {
        user = await Employee.findByIdAndUpdate(
          userId,
          { $set: { isBlocked: false } },
          { returnDocument: 'after' },
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

  // Delete any partner, customer, or employee account permanently (with cascade menu item deletion for restaurants and shops)
  router.delete('/users/:userId', async (req: Request, res: Response) => {
    try {
      const userId = String(req.params.userId || '');
      const currentUser = (req as AuthenticatedRequest).user;
      if (!userId || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: 'Valid user ID is required' });
      }

      // Check if target is an administrator or sub-admin
      const targetUserRecord = await Employee.findById(userId);
      if (targetUserRecord) {
        if (targetUserRecord.role === 'admin') {
          return res.status(403).json({
            message: 'Access denied. Administrator accounts cannot be deleted.',
          });
        }
        if (targetUserRecord.role === 'subadmin' && currentUser?.role !== 'admin') {
          return res.status(403).json({
            message: 'Access denied. Only the platform administrator can delete sub-admin accounts.',
          });
        }
      }

      // 1. Try deleting Restaurant and cascade delete all its associated menu items
      let deletedType = '';
      let deletedName = '';
      let deletedDoc: any = await Restaurant.findByIdAndDelete(userId);
      if (deletedDoc) {
        deletedType = 'Restaurant';
        deletedName = deletedDoc.name;
        const menuResult = await FoodItem.deleteMany({ restaurantId: deletedDoc._id });
        console.log(`Cascade deleted ${menuResult.deletedCount} menu items for restaurant ${deletedDoc.name} (${deletedDoc._id})`);
      }

      // 1.5. Try deleting Shop and cascade delete all its associated items
      if (!deletedDoc) {
        deletedDoc = await Shop.findByIdAndDelete(userId);
        if (deletedDoc) {
          deletedType = 'Shop';
          deletedName = deletedDoc.name;
          const menuResult = await FoodItem.deleteMany({ restaurantId: deletedDoc._id });
          console.log(`Cascade deleted ${menuResult.deletedCount} items for shop ${deletedDoc.name} (${deletedDoc._id})`);
        }
      }

      // 2. Try deleting Rider
      if (!deletedDoc) {
        deletedDoc = await Rider.findByIdAndDelete(userId);
        if (deletedDoc) {
          deletedType = 'Delivery Partner';
          deletedName = deletedDoc.name;
        }
      }

      // 3. Try deleting Customer
      if (!deletedDoc) {
        deletedDoc = await Customer.findByIdAndDelete(userId);
        if (deletedDoc) {
          deletedType = 'Customer';
          deletedName = deletedDoc.name;
          await Address.deleteMany({ userId: String(deletedDoc._id) });
        }
      }

      // 4. Try deleting Employee (subadmin)
      if (!deletedDoc) {
        deletedDoc = await Employee.findByIdAndDelete(userId);
        if (deletedDoc) {
          deletedType = 'Sub-admin';
          deletedName = deletedDoc.name;
        }
      }

      if (!deletedDoc) {
        return res.status(404).json({ message: 'Account not found' });
      }

      return res.json({
        message: `${deletedType} "${deletedName}" and all associated data deleted successfully`,
        userId,
      });
    } catch (error) {
      console.error('Delete account failed:', error);
      return res.status(500).json({ message: 'Unable to delete account' });
    }
  });

  // Reset password for any Shop, Restaurant, Rider, Customer, or Sub-Admin account
  // Default password format: Tomato<DDMMYYYY> where <DDMMYYYY> is the user's DOB (or custom password provided by admin)
  router.post('/users/:userId/reset-password', async (req: Request, res: Response) => {
    try {
      const userId = String(req.params.userId || '').trim();
      const currentUser = (req as AuthenticatedRequest).user;
      if (!userId || !mongoose.isValidObjectId(userId)) {
        return res.status(400).json({ message: 'Valid user ID is required' });
      }

      // Locate user across Shop, Restaurant, Rider, Customer, Employee
      let targetDoc: any =
        (await Shop.findById(userId)) ||
        (await Restaurant.findById(userId)) ||
        (await Rider.findById(userId)) ||
        (await Customer.findById(userId)) ||
        (await Employee.findById(userId));

      if (!targetDoc) {
        return res.status(404).json({ message: 'User account not found' });
      }

      if (targetDoc.role === 'admin' && currentUser?.role !== 'admin') {
        return res.status(403).json({
          message: 'Access denied. Sub-admins cannot reset administrator passwords.',
        });
      }
      if (targetDoc.role === 'subadmin' && currentUser?.role !== 'admin') {
        return res.status(403).json({
          message: 'Access denied. Only the platform administrator can reset sub-admin passwords.',
        });
      }

      const providedDob = typeof req.body?.dob === 'string' ? req.body.dob.trim() : '';
      if (providedDob) {
        targetDoc.dob = providedDob;
      }

      const effectiveDob = String(targetDoc.dob || '').trim();

      // Convert YYYY-MM-DD or DD/MM/YYYY or DD-MM-YYYY into DDMMYYYY
      const formatDobToDDMMYYYY = (rawDob: string): string => {
        if (!rawDob) return '';
        const isoMatch = rawDob.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
        if (isoMatch) {
          return `${isoMatch[3]}${isoMatch[2]}${isoMatch[1]}`;
        }
        const dmyMatch = rawDob.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
        if (dmyMatch) {
          return `${dmyMatch[1]}${dmyMatch[2]}${dmyMatch[3]}`;
        }
        const digitsOnly = rawDob.replace(/\D/g, '');
        if (digitsOnly.length === 8) return digitsOnly;
        return '';
      };

      const ddmmyyyy = formatDobToDDMMYYYY(effectiveDob);
      const customPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword.trim() : '';

      const finalPassword = customPassword || (ddmmyyyy ? `Tomato${ddmmyyyy}` : '');
      if (!finalPassword) {
        return res.status(400).json({
          message: 'Please select the user\'s DOB to generate "Tomato<DDMMYYYY>" or enter a custom password.',
        });
      }

      if (finalPassword.length < 6) {
        return res.status(400).json({
          message: 'Password must be at least 6 characters long.',
        });
      }

      targetDoc.passwordHash = await hashPassword(finalPassword);
      targetDoc.resetPasswordTokenHash = undefined;
      targetDoc.resetPasswordExpiresAt = undefined;
      await targetDoc.save();

      await Notification.create({
        userId: String(targetDoc._id),
        role: targetDoc.role,
        title: 'Password Reset by Admin',
        message: 'Your account password has been reset by the platform administrator.',
        type: 'service',
      });

      return res.json({
        message: `Password for "${targetDoc.name}" has been reset successfully to "${finalPassword}".`,
        resetPassword: finalPassword,
        user: userResponse(targetDoc),
      });
    } catch (error) {
      console.error('Admin reset password failed:', error);
      return res.status(500).json({ message: 'Unable to reset user password' });
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

        const subadmins = await Employee.find(filter).sort({ createdAt: -1 });
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
        if (creator?.role !== 'admin') {
          return res.status(403).json({
            message: 'Access denied. Only the platform administrator can create sub-admin accounts.',
          });
        }

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

        const existing = await Employee.findOne({
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
          'shops_manage',
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

        const subAdmin = await Employee.create(subAdminData);

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
        const currentUser = (req as AuthenticatedRequest).user;
        if (currentUser?.role !== 'admin') {
          return res.status(403).json({
            message: 'Access denied. Only the platform administrator can update sub-admin roles and permissions.',
          });
        }

        const subAdminId = req.params.id;
        if (!mongoose.isValidObjectId(subAdminId)) {
          return res.status(400).json({ message: 'Invalid sub-admin ID' });
        }

        const targetUser = await Employee.findById(subAdminId);
        if (!targetUser) {
          return res.status(404).json({ message: 'Sub-admin not found' });
        }

        if (targetUser.role === 'admin') {
          return res.status(403).json({
            message: 'Access denied. Administrator permissions and roles cannot be modified.',
          });
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
          'shops_manage',
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

        const updated = await Employee.findByIdAndUpdate(
          subAdminId,
          { $set: updates },
          { returnDocument: 'after' },
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
        const currentUser = (req as AuthenticatedRequest).user;
        if (currentUser?.role !== 'admin') {
          return res.status(403).json({
            message: 'Access denied. Only the platform administrator can change sub-admin status.',
          });
        }

        const subAdminId = req.params.id;
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

        const target = await Employee.findById(subAdminId);
        if (!target)
          return res.status(404).json({ message: 'Sub-admin not found' });
        if (target.role !== 'subadmin') {
          return res
            .status(403)
            .json({
              message: 'Access denied. Cannot modify status of administrator accounts.',
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
        const currentUser = (req as AuthenticatedRequest).user;
        if (currentUser?.role !== 'admin') {
          return res.status(403).json({
            message: 'Access denied. Only the platform administrator can delete sub-admin accounts.',
          });
        }

        const subAdminId = req.params.id;
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

        const target = await Employee.findById(subAdminId);
        if (!target)
          return res.status(404).json({ message: 'Sub-admin not found' });
        if (target.role !== 'subadmin') {
          return res
            .status(403)
            .json({ message: 'Access denied. Administrator accounts cannot be deleted.' });
        }

        await Employee.findByIdAndDelete(subAdminId);

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

  // 4. Analytics with Date Range Period Filter (Default: Today) & Optional User ID Filter
  router.get(
    '/analytics',
    requirePermission('dashboard_view'),
    async (req: Request, res: Response) => {
      try {
        const { startDate, endDate, allTime, userId } = req.query;

        const allOrders = await Order.find().lean();
        const employees = await Employee.find().lean();
        const restaurants = await Restaurant.find().lean();
        const customers = await Customer.find().lean();
        const riders = await Rider.find().lean();
        const shops = await Shop.find().lean();

        // Optional User ID Filter resolution
        let targetUser: any = null;
        let ordersToAnalyze = allOrders;
        const trimmedUserId = typeof userId === 'string' ? userId.trim() : '';

        if (trimmedUserId) {
          const isObjId = mongoose.Types.ObjectId.isValid(trimmedUserId);
          const regex = new RegExp(
            `^${trimmedUserId.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`,
            'i',
          );

          const [matchedCust, matchedRest, matchedShop, matchedRider, matchedEmp] =
            await Promise.all([
              Customer.findOne({
                $or: [
                  ...(isObjId ? [{ _id: trimmedUserId }] : []),
                  { customerId: regex },
                  { email: regex },
                  { phone: trimmedUserId },
                ],
              }).lean(),
              Restaurant.findOne({
                $or: [
                  ...(isObjId ? [{ _id: trimmedUserId }] : []),
                  { restaurantId: regex },
                  { email: regex },
                  { phone: trimmedUserId },
                ],
              }).lean(),
              Shop.findOne({
                $or: [
                  ...(isObjId ? [{ _id: trimmedUserId }] : []),
                  { shopId: regex },
                  { email: regex },
                  { phone: trimmedUserId },
                ],
              }).lean(),
              Rider.findOne({
                $or: [
                  ...(isObjId ? [{ _id: trimmedUserId }] : []),
                  { riderId: regex },
                  { email: regex },
                  { phone: trimmedUserId },
                ],
              }).lean(),
              Employee.findOne({
                $or: [
                  ...(isObjId ? [{ _id: trimmedUserId }] : []),
                  { email: regex },
                ],
              }).lean(),
            ]);

          if (matchedCust) {
            targetUser = {
              ...matchedCust,
              matchedRole: 'customer',
              displayId: matchedCust.customerId || matchedCust._id?.toString(),
            };
          } else if (matchedRest) {
            targetUser = {
              ...matchedRest,
              matchedRole: 'restaurant',
              displayId: matchedRest.restaurantId || matchedRest._id?.toString(),
            };
          } else if (matchedShop) {
            targetUser = {
              ...matchedShop,
              matchedRole: 'shop',
              displayId: matchedShop.shopId || matchedShop._id?.toString(),
            };
          } else if (matchedRider) {
            targetUser = {
              ...matchedRider,
              matchedRole: 'rider',
              displayId: matchedRider.riderId || matchedRider._id?.toString(),
            };
          } else if (matchedEmp) {
            targetUser = {
              ...matchedEmp,
              matchedRole: matchedEmp.role || 'employee',
              displayId: matchedEmp._id?.toString(),
            };
          }

          const targetIdStr = targetUser?._id?.toString() || '';
          const targetDisplayId = targetUser?.displayId?.toString() || '';
          const searchLower = trimmedUserId.toLowerCase();

          ordersToAnalyze = allOrders.filter((o: any) => {
            const custId = o.customerId?.toString() || '';
            const restId = (o.restaurantId || o.shopId)?.toString() || '';
            const riderId = o.riderId?.toString() || '';
            const restCode = (o.restaurantCode || o.shopCode || '')?.toString().toLowerCase();
            const riderCode = (o.riderCode || '')?.toString().toLowerCase();
            const custPhone = (o.customerPhone || '')?.toString();
            const custName = (o.customerName || '')?.toString().toLowerCase();
            const restName = (o.restaurantName || o.shopName || '')?.toString().toLowerCase();
            const riderName = (o.riderName || '')?.toString().toLowerCase();

            if (targetUser) {
              if (targetUser.matchedRole === 'customer') {
                return custId === targetIdStr || custId === targetDisplayId;
              }
              if (
                targetUser.matchedRole === 'restaurant' ||
                targetUser.matchedRole === 'shop'
              ) {
                return (
                  restId === targetIdStr ||
                  restId === targetDisplayId ||
                  restCode === searchLower
                );
              }
              if (targetUser.matchedRole === 'rider') {
                return (
                  riderId === targetIdStr ||
                  riderId === targetDisplayId ||
                  riderCode === searchLower
                );
              }
            }

            return (
              custId === trimmedUserId ||
              custId === targetIdStr ||
              restId === trimmedUserId ||
              restId === targetIdStr ||
              riderId === trimmedUserId ||
              riderId === targetIdStr ||
              restCode === searchLower ||
              riderCode === searchLower ||
              custPhone === trimmedUserId ||
              custName.includes(searchLower) ||
              restName.includes(searchLower) ||
              riderName.includes(searchLower)
            );
          });
        }

        const isCountableForGMV = (o: any) => {
          if (o.status === 'cancelled') return false;
          return (
            o.paymentStatus === 'paid' ||
            o.status === 'delivered' ||
            o.paymentMethod === 'cod'
          );
        };

        const lifetimeGMV = ordersToAnalyze
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
        const filteredOrders = ordersToAnalyze.filter((o) => {
          if (!start && !end) return true;
          const cDate = new Date(o.createdAt);
          if (start && cDate < start) return false;
          if (end && cDate > end) return false;
          return true;
        });

        // Filter employees by selected date period
        const filteredEmployees = employees.filter((e: any) => {
          if (!start && !end) return true;
          if (!e.createdAt) return false;
          const eDate = new Date(e.createdAt);
          if (start && eDate < start) return false;
          if (end && eDate > end) return false;
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

        const filteredCustomers = customers.filter((c: any) => {
          if (!start && !end) return true;
          if (!c.createdAt) return false;
          const cDate = new Date(c.createdAt);
          if (start && cDate < start) return false;
          if (end && cDate > end) return false;
          return true;
        });

        const filteredRiders = riders.filter((r: any) => {
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
          filteredEmployees.length;

        const totalCustomers = customers.length;
        const totalRestaurants = restaurants.length;
        const totalRiders = riders.length;

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
            totalUsersCount: customers.length + restaurants.length + riders.length + employees.length,
            totalCustomers,
            totalRestaurants,
            totalRiders,
            activeRidersInPeriod,
            paymentDistribution,
            topDishes,
            topRestaurants,
            userFilter: trimmedUserId
              ? {
                  query: trimmedUserId,
                  matchedUser: targetUser
                    ? {
                        id: targetUser.displayId,
                        name: targetUser.name || targetUser.displayName,
                        role: targetUser.matchedRole,
                      }
                    : null,
                  matchingOrdersCount: ordersToAnalyze.length,
                }
              : null,
          },
        });
      } catch (error) {
        console.error('Analytics fetch failed:', error);
        return res.status(500).json({ message: 'Unable to fetch analytics' });
      }
    },
  );

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
            .catch((arError) => console.warn('Arattai complaint dispatch error:', arError));
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

    // =========================================================================
    // ADMIN BANK PANEL & TOMATO CENTRALIZED ORDER PAYMENT SETTLEMENTS
    // =========================================================================

    // 1. Get all Shops, Restaurants, and Riders with Bank & PAN Details + Agreement Config
    router.get('/bank/partners', async (req: Request, res: Response) => {
      try {
        const { role, status, search } = req.query;

        const [restaurants, shops, riders] = await Promise.all([
          Restaurant.find().sort({ createdAt: -1 }).lean(),
          Shop.find().sort({ createdAt: -1 }).lean(),
          Rider.find().sort({ createdAt: -1 }).lean(),
        ]);

        const formatPartnerBankRow = (doc: any, partnerRole: 'restaurant' | 'shop' | 'deliveryPartner') => {
          const bd = doc.bankDetails || {};
          const hasAnyField = Boolean(
            bd.accountNumber || bd.ifscCode || bd.accountHolderName || bd.panNumber || bd.panHolderName,
          );
          const validation = validateBankAndPanDetails(bd);
          const normAccHolder = String(bd.accountHolderName || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const normPanHolder = String(bd.panHolderName || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const nameMatched = Boolean(normAccHolder && normPanHolder && normAccHolder === normPanHolder);

          const isApproved = Boolean(doc.isApproved && (bd.isApproved || validation.valid));
          const isLocked = Boolean(doc.isApproved || bd.isApproved || bd.isLocked);

          return {
            id: String(doc._id),
            _id: String(doc._id),
            partnerCode:
              doc.restaurantId || doc.shopId || doc.riderId || String(doc._id).slice(-6),
            name: doc.name,
            displayName: doc.name,
            email: doc.email || '',
            phone: doc.phone || '',
            role: partnerRole,
            isApproved: Boolean(doc.isApproved),
            isBlocked: Boolean(doc.isBlocked),
            walletBalance: Number(doc.walletBalance || 0),
            namesMatch: nameMatched,
            bankDetails: {
              accountHolderName: bd.accountHolderName || '',
              bankName: bd.bankName || '',
              accountNumber: bd.accountNumber || '',
              ifscCode: bd.ifscCode || '',
              panNumber: bd.panNumber || '',
              panHolderName: bd.panHolderName || '',
              upiId: bd.upiId || '',
              isSubmitted: Boolean(bd.isSubmitted || hasAnyField),
              isApproved,
              isLocked,
              agreementCommissionPercent:
                bd.agreementCommissionPercent ?? (partnerRole === 'shop' ? 12 : 15),
              riderPayoutPerOrder: bd.riderPayoutPerOrder ?? 40,
              submittedAt: bd.submittedAt || null,
              approvedAt: bd.approvedAt || null,
              approvedBy: bd.approvedBy || '',
              adminNote: bd.adminNote || '',
            },
            verification: {
              hasSubmitted: Boolean(bd.isSubmitted || hasAnyField),
              isValid: validation.valid,
              nameMatched,
              validationMessage: hasAnyField
                ? validation.message || 'Bank & PAN verified (Holder Name matches PAN)'
                : 'Bank & PAN details not submitted yet',
            },
            createdAt: doc.createdAt,
          };
        };

        let partners = [
          ...restaurants.map((r) => formatPartnerBankRow(r, 'restaurant')),
          ...shops.map((s) => formatPartnerBankRow(s, 'shop')),
          ...riders.map((r) => formatPartnerBankRow(r, 'deliveryPartner')),
        ];

        if (typeof role === 'string' && role !== 'all' && role.trim()) {
          partners = partners.filter((p) => p.role === role.trim());
        }

        if (typeof status === 'string' && status !== 'all' && status.trim()) {
          if (status === 'approved') {
            partners = partners.filter((p) => p.isApproved && p.verification.isValid);
          } else if (status === 'pending_approval') {
            partners = partners.filter((p) => p.verification.hasSubmitted && !p.isApproved);
          } else if (status === 'not_submitted') {
            partners = partners.filter((p) => !p.verification.hasSubmitted);
          }
        }

        if (typeof search === 'string' && search.trim()) {
          const q = search.trim().toLowerCase();
          partners = partners.filter(
            (p) =>
              p.name.toLowerCase().includes(q) ||
              p.partnerCode.toLowerCase().includes(q) ||
              p.email.toLowerCase().includes(q) ||
              p.phone.toLowerCase().includes(q) ||
              p.bankDetails.accountNumber.toLowerCase().includes(q) ||
              p.bankDetails.ifscCode.toLowerCase().includes(q) ||
              p.bankDetails.panNumber.toLowerCase().includes(q) ||
              p.bankDetails.accountHolderName.toLowerCase().includes(q),
          );
        }

        const counts = {
          total: partners.length,
          approved: partners.filter((p) => p.isApproved && p.verification.isValid).length,
          pendingApproval: partners.filter((p) => p.verification.hasSubmitted && !p.isApproved).length,
          notSubmitted: partners.filter((p) => !p.verification.hasSubmitted).length,
        };

        return res.json({ partners, counts });
      } catch (error) {
        console.error('Admin bank partners fetch failed:', error);
        return res.status(500).json({ message: 'Unable to fetch partner bank details' });
      }
    });

    // 2. Admin Edit / Configure Agreement / Approve & Lock Partner Bank Details
    router.put('/bank/partners/:userId', async (req: Request, res: Response) => {
      try {
        const userId = String(req.params.userId || '');
        const adminUser = (req as AuthenticatedRequest).user;
        if (!userId || !mongoose.isValidObjectId(userId)) {
          return res.status(400).json({ message: 'Valid partner ID is required' });
        }

        let doc: any = await Restaurant.findById(userId);
        let partnerRole: 'restaurant' | 'shop' | 'deliveryPartner' = 'restaurant';
        if (!doc) {
          doc = await Shop.findById(userId);
          partnerRole = 'shop';
        }
        if (!doc) {
          doc = await Rider.findById(userId);
          partnerRole = 'deliveryPartner';
        }
        if (!doc) {
          return res.status(404).json({ message: 'Partner (Restaurant, Shop, or Rider) not found' });
        }

        const existingBd = (doc.bankDetails as any)?.toObject
          ? (doc.bankDetails as any).toObject()
          : doc.bankDetails || {};
        const mergedPayload = {
          accountHolderName:
            req.body.accountHolderName !== undefined
              ? req.body.accountHolderName
              : existingBd.accountHolderName,
          bankName:
            req.body.bankName !== undefined ? req.body.bankName : existingBd.bankName,
          accountNumber:
            req.body.accountNumber !== undefined
              ? req.body.accountNumber
              : existingBd.accountNumber,
          ifscCode:
            req.body.ifscCode !== undefined ? req.body.ifscCode : existingBd.ifscCode,
          panNumber:
            req.body.panNumber !== undefined ? req.body.panNumber : existingBd.panNumber,
          panHolderName:
            req.body.panHolderName !== undefined
              ? req.body.panHolderName
              : existingBd.panHolderName,
          upiId: req.body.upiId !== undefined ? req.body.upiId : existingBd.upiId,
        };

        const validation = validateBankAndPanDetails(mergedPayload);
        const rawApproveFlag =
          req.body.approvePartner !== undefined
            ? req.body.approvePartner
            : req.body.approve;
        const wantsApprove =
          rawApproveFlag !== undefined ? Boolean(rawApproveFlag) : Boolean(doc.isApproved);

        if (req.body.pincode !== undefined && (partnerRole === 'restaurant' || partnerRole === 'shop')) {
          doc.pincode = extractPincodeFromText(req.body.pincode) || String(req.body.pincode).trim();
        }

        const unlockForUserEdit =
          Boolean(req.body.unlockForUserEdit) || req.body.isLocked === false;

        if (wantsApprove && !unlockForUserEdit && (partnerRole === 'restaurant' || partnerRole === 'shop')) {
          const serviceablePincodes = await getServiceablePincodes();
          const partnerPincode = resolvePartnerPincode(doc);
          const partnerLabel = partnerRole === 'shop' ? 'Shop' : 'Restaurant';
          if (!partnerPincode || !serviceablePincodes.includes(partnerPincode)) {
            return res.status(400).json({
              message: `${partnerLabel} "${doc.name}" pincode ${partnerPincode ? `(${partnerPincode})` : '(missing)'} is not in the serviceable range. Active serviceable pincodes: ${serviceablePincodes.join(', ') || 'None'}.`,
              code: 'PINCODE_NOT_SERVICEABLE',
              pincode: partnerPincode || '',
              serviceablePincodes,
            });
          }
          if (!doc.pincode && partnerPincode) {
            doc.pincode = partnerPincode;
          }
        }

        if (wantsApprove && !validation.valid) {
          return res.status(400).json({
            message: `Cannot approve bank details for "${doc.name}": ${validation.message}`,
          });
        }

        // Even if only saving bank details, if bank & PAN fields are provided, enforce name match
        if (
          mergedPayload.accountHolderName &&
          mergedPayload.panHolderName &&
          !validation.valid
        ) {
          return res.status(400).json({
            message: validation.message || 'Invalid bank or PAN details',
          });
        }

        const agreementCommissionPercent =
          req.body.agreementCommissionPercent !== undefined
            ? Math.min(100, Math.max(0, Number(req.body.agreementCommissionPercent)))
            : (existingBd.agreementCommissionPercent ?? (partnerRole === 'shop' ? 12 : 15));

        const riderPayoutPerOrder =
          req.body.riderPayoutPerOrder !== undefined
            ? Math.max(0, Number(req.body.riderPayoutPerOrder))
            : (existingBd.riderPayoutPerOrder ?? 40);

        const adminIdentifier =
          adminUser?.name || adminUser?.email || adminUser?.userId || 'Admin';

        const nextApproved = unlockForUserEdit ? false : wantsApprove && validation.valid;
        const nextLocked = unlockForUserEdit ? false : nextApproved;

        doc.isApproved = nextApproved;
        doc.bankDetails = {
          ...existingBd,
          ...(validation.sanitized || {
            accountHolderName: String(mergedPayload.accountHolderName || '').trim(),
            bankName: String(mergedPayload.bankName || '').trim(),
            accountNumber: String(mergedPayload.accountNumber || '').trim(),
            ifscCode: String(mergedPayload.ifscCode || '').toUpperCase().trim(),
            panNumber: String(mergedPayload.panNumber || '').toUpperCase().trim(),
            panHolderName: String(mergedPayload.panHolderName || '').trim(),
            upiId: String(mergedPayload.upiId || '').trim(),
          }),
          isSubmitted: true,
          isApproved: nextApproved,
          isLocked: nextLocked,
          agreementCommissionPercent,
          riderPayoutPerOrder,
          submittedAt: existingBd.submittedAt || new Date(),
          ...(nextApproved
            ? {
                approvedAt: new Date(),
                approvedBy: adminIdentifier,
              }
            : {}),
          adminNote:
            typeof req.body.adminNote === 'string'
              ? req.body.adminNote.trim()
              : existingBd.adminNote || '',
        };

        await doc.save();

        await Notification.create({
          userId: String(doc._id),
          role: doc.role,
          title: nextApproved
            ? 'Bank Details & Agreement Approved'
            : 'Bank Details Updated by Admin',
          message: nextApproved
            ? `Your bank details (${doc.bankDetails.bankName} - ${doc.bankDetails.ifscCode}) and PAN card have been verified and approved by Admin. Your bank details are now locked.`
            : `Your bank details / payout agreement were updated by the platform administrator.`,
          type: 'service',
        });

        return res.json({
          message: nextApproved
            ? `${doc.name}'s bank details, PAN card, and payout agreement verified, approved & locked!`
            : `${doc.name}'s bank details updated by Admin.`,
          partner: userResponse(doc),
        });
      } catch (error) {
        console.error('Admin update partner bank details failed:', error);
        return res.status(500).json({ message: 'Unable to update partner bank details' });
      }
    });

    // 3. Get Tomato Central Account Receipts & Partner Payout Settlements (`payments` collection)
    router.get('/bank/settlements', async (req: Request, res: Response) => {
      try {
        const { status, orderType, search, fromDate, toDate, filterById, partnerId } = req.query;
        const idFilterVal = String(filterById || partnerId || '').trim();

        let fromBound: Date | null = null;
        let toBound: Date | null = null;
        if (typeof fromDate === 'string' && fromDate.trim()) {
          const parsedFrom = new Date(`${fromDate.trim()}T00:00:00.000`);
          if (!Number.isNaN(parsedFrom.getTime())) {
            fromBound = parsedFrom;
          }
        }
        if (typeof toDate === 'string' && toDate.trim()) {
          const parsedTo = new Date(`${toDate.trim()}T23:59:59.999`);
          if (!Number.isNaN(parsedTo.getTime())) {
            toBound = parsedTo;
          }
        }

        // Load partners & riders first so we can resolve IDs for historical order syncing & directory
        const [restaurants, shops, riders] = await Promise.all([
          Restaurant.find()
            .select('name email phone restaurantId isApproved bankDetails walletBalance')
            .sort({ name: 1 })
            .lean(),
          Shop.find()
            .select('name email phone shopId isApproved bankDetails walletBalance')
            .sort({ name: 1 })
            .lean(),
          Rider.find()
            .select('name email phone riderId isApproved bankDetails walletBalance')
            .sort({ name: 1 })
            .lean(),
        ]);

        const partnerMap = new Map<string, any>();
        restaurants.forEach((r) =>
          partnerMap.set(String(r._id), {
            ...r,
            role: 'restaurant',
            partnerCode: r.restaurantId || `REST-${String(r._id).slice(-6).toUpperCase()}`,
          }),
        );
        shops.forEach((s) =>
          partnerMap.set(String(s._id), {
            ...s,
            role: 'shop',
            partnerCode: s.shopId || `SHOP-${String(s._id).slice(-6).toUpperCase()}`,
          }),
        );
        const riderMap = new Map<string, any>();
        riders.forEach((r) =>
          riderMap.set(String(r._id), {
            ...r,
            riderCode: r.riderId || `RDR-${String(r._id).slice(-6).toUpperCase()}`,
          }),
        );

        const partnerDirectory = [
          ...restaurants.map((r) => ({
            id: String(r._id),
            code: r.restaurantId || `REST-${String(r._id).slice(-6).toUpperCase()}`,
            name: r.name,
            email: r.email || '',
            role: 'restaurant',
          })),
          ...shops.map((s) => ({
            id: String(s._id),
            code: s.shopId || `SHOP-${String(s._id).slice(-6).toUpperCase()}`,
            name: s.name,
            email: s.email || '',
            role: 'shop',
          })),
          ...riders.map((r) => ({
            id: String(r._id),
            code: r.riderId || `RDR-${String(r._id).slice(-6).toUpperCase()}`,
            name: r.name,
            email: r.email || '',
            role: 'deliveryPartner',
          })),
        ];

        const orderSyncFilter: Record<string, any> = { status: { $ne: 'cancelled' } };
        if (fromBound || toBound) {
          orderSyncFilter.createdAt = {};
          if (fromBound) orderSyncFilter.createdAt.$gte = fromBound;
          if (toBound) orderSyncFilter.createdAt.$lte = toBound;
        }

        // Sync orders into Tomato's `payments` table so both recent & historical orders are tracked
        const syncLimit = fromBound || toBound || idFilterVal ? 500 : 150;
        const [recentOrders, recentShopOrders] = await Promise.all([
          Order.find(orderSyncFilter).sort({ createdAt: -1 }).limit(syncLimit).lean(),
          ShopOrder.find(orderSyncFilter).sort({ createdAt: -1 }).limit(syncLimit).lean(),
        ]);

        for (const ord of recentOrders) {
          await syncOrderToTomatoPayment(ord, false);
        }
        for (const sOrd of recentShopOrders) {
          await syncOrderToTomatoPayment(sOrd, true);
        }

        const allPayments = await Payment.find({
          orderNumber: { $exists: true, $ne: '' },
        })
          .sort({ createdAt: -1 })
          .lean();

        // Filter by date range first (if From / To Date filter is applied)
        const dateFilteredPayments = allPayments.filter((p: any) => {
          if (!fromBound && !toBound) return true;
          const candidateDates = [
            p.tomatoReceivedAt,
            p.createdAt,
            p.partnerPaidAt,
            p.riderPaidAt,
          ]
            .filter(Boolean)
            .map((d) => new Date(d).getTime())
            .filter((t) => !Number.isNaN(t));

          if (!candidateDates.length) return false;
          return candidateDates.some((ts) => {
            if (fromBound && ts < fromBound.getTime()) return false;
            if (toBound && ts > toBound.getTime()) return false;
            return true;
          });
        });

        const enriched = dateFilteredPayments.map((p: any) => {
          const livePartner = p.partnerId ? partnerMap.get(String(p.partnerId)) : null;
          const liveRider = p.riderId ? riderMap.get(String(p.riderId)) : null;

          const partnerBankCheck = checkPartnerCanBeApproved(
            livePartner?.bankDetails || p.partnerBankSnapshot,
          );
          const riderBankCheck = checkPartnerCanBeApproved(
            liveRider?.bankDetails || p.riderBankSnapshot,
          );

          const resolvedPartnerCode =
            livePartner?.partnerCode ||
            livePartner?.restaurantId ||
            livePartner?.shopId ||
            p.partnerCode ||
            (p.partnerId
              ? `${p.orderType === 'shop' ? 'SHOP' : 'REST'}-${String(p.partnerId).slice(-6).toUpperCase()}`
              : '');

          const resolvedRiderCode =
            liveRider?.riderCode ||
            liveRider?.riderId ||
            p.riderCode ||
            (p.riderId ? `RDR-${String(p.riderId).slice(-6).toUpperCase()}` : '');

          return {
            ...p,
            partnerCode: resolvedPartnerCode,
            partnerEmail: livePartner?.email || '',
            riderCode: resolvedRiderCode,
            riderEmail: liveRider?.email || '',
            partnerBankReady: Boolean(livePartner?.isApproved && partnerBankCheck.canApprove),
            partnerBankDetails: livePartner?.bankDetails || p.partnerBankSnapshot || null,
            riderBankReady: Boolean(liveRider?.isApproved && riderBankCheck.canApprove),
            riderBankDetails: liveRider?.bankDetails || p.riderBankSnapshot || null,
          };
        });

        const statusFilterVal = String(req.query.payoutStatus || status || 'all').trim();
        let filtered = enriched;
        if (typeof orderType === 'string' && orderType !== 'all' && orderType.trim()) {
          filtered = filtered.filter((item) => item.orderType === orderType.trim());
        }
        if (idFilterVal) {
          const idQ = idFilterVal.toLowerCase();
          filtered = filtered.filter((item) => {
            const candidates = [
              item.partnerId,
              item.partnerCode,
              item.partnerEmail,
              item.partnerName,
              item.riderId,
              item.riderCode,
              item.riderEmail,
              item.riderName,
            ]
              .filter(Boolean)
              .map((v) => String(v).toLowerCase());
            return candidates.some((c) => c === idQ || c.includes(idQ));
          });
        }
        if (statusFilterVal && statusFilterVal !== 'all') {
          if (statusFilterVal === 'pending') {
            filtered = filtered.filter(
              (item) =>
                item.partnerPayoutStatus === 'pending_approval' ||
                item.riderPayoutStatus === 'pending_approval',
            );
          } else if (statusFilterVal === 'paid') {
            filtered = filtered.filter((item) => item.partnerPayoutStatus === 'approved_paid');
          }
        }
        if (typeof search === 'string' && search.trim()) {
          const q = search.trim().toLowerCase();
          filtered = filtered.filter(
            (item) =>
              String(item.orderNumber || '').toLowerCase().includes(q) ||
              String(item.partnerName || '').toLowerCase().includes(q) ||
              String(item.partnerCode || '').toLowerCase().includes(q) ||
              String(item.partnerId || '').toLowerCase().includes(q) ||
              String(item.riderName || '').toLowerCase().includes(q) ||
              String(item.riderCode || '').toLowerCase().includes(q) ||
              String(item.riderId || '').toLowerCase().includes(q) ||
              String(item.customerName || '').toLowerCase().includes(q) ||
              String(item.transactionId || '').toLowerCase().includes(q),
          );
        }

        // Summary calculations across the filtered settlements (by date range & user ID)
        let tomatoTotalReceived = 0;
        let pendingCodAmount = 0;
        let tomatoCommissionEarned = 0;
        let pendingPartnerPayouts = 0;
        let completedPartnerPayouts = 0;
        let pendingRiderPayouts = 0;
        let completedRiderPayouts = 0;

        filtered.forEach((p: any) => {
          const total = Number(p.totalAmount || p.amount || 0);
          if (p.tomatoAccountStatus === 'received') {
            tomatoTotalReceived += total;
          } else {
            pendingCodAmount += total;
          }

          tomatoCommissionEarned += Number(p.tomatoCommissionAmount || 0);

          if (p.partnerPayoutStatus === 'approved_paid') {
            completedPartnerPayouts += Number(p.partnerPayoutAmount || 0);
          } else {
            pendingPartnerPayouts += Number(p.partnerPayoutAmount || 0);
          }

          if (p.riderPayoutStatus === 'approved_paid') {
            completedRiderPayouts += Number(p.riderPayoutAmount || 0);
          } else if (p.riderId) {
            pendingRiderPayouts += Number(p.riderPayoutAmount || 0);
          }
        });

        return res.json({
          summary: {
            tomatoTotalReceived: Number(tomatoTotalReceived.toFixed(2)),
            totalReceivedInTomatoAccount: Number(tomatoTotalReceived.toFixed(2)),
            tomatoNetBankBalance: Number(
              (tomatoTotalReceived - completedPartnerPayouts - completedRiderPayouts).toFixed(2),
            ),
            pendingCodAmount: Number(pendingCodAmount.toFixed(2)),
            tomatoCommissionEarned: Number(tomatoCommissionEarned.toFixed(2)),
            totalTomatoCommission: Number(tomatoCommissionEarned.toFixed(2)),
            pendingPartnerPayouts: Number(pendingPartnerPayouts.toFixed(2)),
            completedPartnerPayouts: Number(completedPartnerPayouts.toFixed(2)),
            pendingRiderPayouts: Number(pendingRiderPayouts.toFixed(2)),
            completedRiderPayouts: Number(completedRiderPayouts.toFixed(2)),
            totalOrdersTracked: filtered.length,
            totalOrders: filtered.length,
            fromDate: typeof fromDate === 'string' ? fromDate.trim() : '',
            toDate: typeof toDate === 'string' ? toDate.trim() : '',
            filterById: idFilterVal,
          },
          partnerDirectory,
          settlements: filtered,
        });
      } catch (error) {
        console.error('Admin bank settlements fetch failed:', error);
        return res.status(500).json({ message: 'Unable to fetch payment settlements' });
      }
    });

    // 4. Configure Agreement Commission / Payout Split for an Order Settlement
    router.put('/bank/settlements/:paymentId/agreement', async (req: Request, res: Response) => {
      try {
        const paymentId = String(req.params.paymentId || '');
        if (!paymentId || !mongoose.isValidObjectId(paymentId)) {
          return res.status(400).json({ message: 'Valid payment settlement ID is required' });
        }

        const payment = await Payment.findById(paymentId);
        if (!payment) {
          return res.status(404).json({ message: 'Payment settlement record not found' });
        }

        const totalAmount = Number(payment.totalAmount || 0);
        const riderPayoutAmount =
          req.body.riderPayoutAmount !== undefined
            ? Math.max(0, Number(req.body.riderPayoutAmount))
            : Number(payment.riderPayoutAmount || 40);

        const agreementCommissionPercent =
          req.body.agreementCommissionPercent !== undefined
            ? Math.min(100, Math.max(0, Number(req.body.agreementCommissionPercent)))
            : Number(payment.agreementCommissionPercent || 15);

        const baseForPartner = Math.max(0, totalAmount - riderPayoutAmount);
        const tomatoCommissionAmount = Number(
          ((baseForPartner * agreementCommissionPercent) / 100).toFixed(2),
        );
        const partnerPayoutAmount =
          req.body.partnerPayoutAmount !== undefined
            ? Math.max(0, Number(req.body.partnerPayoutAmount))
            : Number(Math.max(0, baseForPartner - tomatoCommissionAmount).toFixed(2));

        payment.agreementCommissionPercent = agreementCommissionPercent;
        payment.riderPayoutAmount = riderPayoutAmount;
        payment.tomatoCommissionAmount = tomatoCommissionAmount;
        payment.partnerPayoutAmount = partnerPayoutAmount;
        const noteText = req.body.adminNote ?? req.body.adminNotes;
        if (typeof noteText === 'string') {
          payment.adminNotes = noteText.trim();
        }

        await payment.save();

        return res.json({
          message: `Payout agreement updated for Order #${payment.orderNumber} (Partner: ₹${partnerPayoutAmount}, Rider: ₹${riderPayoutAmount}, Tomato Commission: ₹${tomatoCommissionAmount})`,
          payment,
        });
      } catch (error) {
        console.error('Update settlement agreement failed:', error);
        return res.status(500).json({ message: 'Unable to update settlement agreement' });
      }
    });

    // 5. Approve & Send Payment from Tomato Account to Shop, Restaurant, or Rider
    router.post('/bank/settlements/:paymentId/payout', async (req: Request, res: Response) => {
      try {
        const paymentId = String(req.params.paymentId || '');
        const adminUser = (req as AuthenticatedRequest).user;
        if (!paymentId || !mongoose.isValidObjectId(paymentId)) {
          return res.status(400).json({ message: 'Valid payment settlement ID is required' });
        }

        const target: 'partner' | 'rider' | 'both' = ['partner', 'rider', 'both'].includes(
          req.body?.target,
        )
          ? req.body.target
          : 'partner';

        const payment = await Payment.findById(paymentId);
        if (!payment) {
          return res.status(404).json({ message: 'Payment settlement record not found' });
        }

        // Ensure Tomato has received the money (or mark COD collected)
        if (payment.tomatoAccountStatus !== 'received') {
          payment.tomatoAccountStatus = 'received';
          payment.tomatoReceivedAt = new Date();
          await adjustTomatoCentralBankBalance(Number(payment.totalAmount || 0));
        }

        const adminIdentifier =
          adminUser?.name || adminUser?.email || adminUser?.userId || 'Admin';
        const actionsCompleted: string[] = [];

        // Pay Partner (Shop or Restaurant)
        if (target === 'partner' || target === 'both') {
          if (payment.partnerPayoutStatus === 'approved_paid') {
            if (target === 'partner') {
              return res.status(400).json({
                message: `Payout to ${payment.partnerName} for Order #${payment.orderNumber} has already been approved and paid.`,
              });
            }
          } else {
            let partnerDoc: any = null;
            if (payment.partnerId && mongoose.isValidObjectId(payment.partnerId)) {
              partnerDoc =
                payment.partnerRole === 'shop'
                  ? await Shop.findById(payment.partnerId)
                  : await Restaurant.findById(payment.partnerId);
            }
            if (!partnerDoc) {
              partnerDoc =
                payment.partnerRole === 'shop'
                  ? await Shop.findOne({ name: payment.partnerName })
                  : await Restaurant.findOne({ name: payment.partnerName });
            }

            if (partnerDoc) {
              const bankCheck = checkPartnerCanBeApproved(partnerDoc.bankDetails);
              if (!partnerDoc.isApproved || !bankCheck.canApprove) {
                return res.status(400).json({
                  message: `Cannot send payout to ${payment.partnerRole === 'shop' ? 'Shop' : 'Restaurant'} "${partnerDoc.name}": ${bankCheck.reason || 'Partner bank details are not approved yet.'} Please verify and approve their Bank & PAN details in the Bank Panel first.`,
                });
              }

              const payoutAmt = Number(payment.partnerPayoutAmount || 0);
              partnerDoc.walletBalance = Number(
                ((partnerDoc.walletBalance || 0) + payoutAmt).toFixed(2),
              );
              await partnerDoc.save();
              await adjustTomatoCentralBankBalance(-payoutAmt);

              payment.partnerBankSnapshot = {
                accountHolderName: partnerDoc.bankDetails?.accountHolderName || '',
                bankName: partnerDoc.bankDetails?.bankName || '',
                accountNumber: partnerDoc.bankDetails?.accountNumber || '',
                ifscCode: partnerDoc.bankDetails?.ifscCode || '',
                panNumber: partnerDoc.bankDetails?.panNumber || '',
              };

              await WalletCreditTrack.create({
                recordType: 'transfer',
                senderUserId: adminUser?.userId || 'TOMATO-CENTRAL-BANK',
                senderEmail: adminUser?.email || 'treasury@tomato.com',
                receiverUserId: String(partnerDoc._id),
                receiverEmail: partnerDoc.email || '',
                receiverMobile: partnerDoc.phone || '',
                receiverCurrentWalletBalance: partnerDoc.walletBalance,
                creditTransferred: payoutAmt,
                purpose: `Tomato Order #${payment.orderNumber} Bank Payout (${100 - payment.agreementCommissionPercent}% agreement share to ${partnerDoc.bankDetails?.bankName || 'Bank'} A/C ${partnerDoc.bankDetails?.accountNumber || ''})`,
                orderNumber: payment.orderNumber,
              });

              await Notification.create({
                userId: String(partnerDoc._id),
                role: partnerDoc.role,
                title: `Payout Sent: ₹${payoutAmt} for Order #${payment.orderNumber}`,
                message: `Tomato has approved and transferred ₹${payoutAmt} to your bank account (${partnerDoc.bankDetails?.bankName} - ${partnerDoc.bankDetails?.ifscCode}) for Order #${payment.orderNumber}.`,
                type: 'service',
              });
            }

            payment.partnerPayoutStatus = 'approved_paid';
            payment.partnerPaidAt = new Date();
            payment.partnerPayoutRef = `UTR-TOM-${Date.now().toString().slice(-6)}`;
            actionsCompleted.push(
              `₹${payment.partnerPayoutAmount} sent to ${payment.partnerName}`,
            );
          }
        }

        // Pay Rider
        if (target === 'rider' || target === 'both') {
          if (payment.riderPayoutStatus === 'approved_paid') {
            if (target === 'rider') {
              return res.status(400).json({
                message: `Payout to rider for Order #${payment.orderNumber} has already been approved and paid.`,
              });
            }
          } else if (payment.riderId || target === 'rider') {
            let riderDoc: any = null;
            if (payment.riderId && mongoose.isValidObjectId(payment.riderId)) {
              riderDoc = await Rider.findById(payment.riderId);
            }
            if (!riderDoc && payment.riderName) {
              riderDoc = await Rider.findOne({ name: payment.riderName });
            }

            if (!riderDoc) {
              if (target === 'rider') {
                return res.status(400).json({
                  message: 'No rider is assigned to this order yet.',
                });
              }
            } else {
              const bankCheck = checkPartnerCanBeApproved(riderDoc.bankDetails);
              if (!riderDoc.isApproved || !bankCheck.canApprove) {
                return res.status(400).json({
                  message: `Cannot send payout to Rider "${riderDoc.name}": ${bankCheck.reason || 'Rider bank details are not approved yet.'} Please verify and approve their Bank & PAN details in the Bank Panel first.`,
                });
              }

              const riderAmt = Number(payment.riderPayoutAmount || 40);
              riderDoc.walletBalance = Number(
                ((riderDoc.walletBalance || 0) + riderAmt).toFixed(2),
              );
              await riderDoc.save();
              await adjustTomatoCentralBankBalance(-riderAmt);

              payment.riderBankSnapshot = {
                accountHolderName: riderDoc.bankDetails?.accountHolderName || '',
                bankName: riderDoc.bankDetails?.bankName || '',
                accountNumber: riderDoc.bankDetails?.accountNumber || '',
                ifscCode: riderDoc.bankDetails?.ifscCode || '',
                panNumber: riderDoc.bankDetails?.panNumber || '',
              };

              await WalletCreditTrack.create({
                recordType: 'transfer',
                senderUserId: adminUser?.userId || 'TOMATO-CENTRAL-BANK',
                senderEmail: adminUser?.email || 'treasury@tomato.com',
                receiverUserId: String(riderDoc._id),
                receiverEmail: riderDoc.email || '',
                receiverMobile: riderDoc.phone || '',
                receiverCurrentWalletBalance: riderDoc.walletBalance,
                creditTransferred: riderAmt,
                purpose: `Tomato Order #${payment.orderNumber} Rider Delivery Payout (to ${riderDoc.bankDetails?.bankName || 'Bank'} A/C ${riderDoc.bankDetails?.accountNumber || ''})`,
                orderNumber: payment.orderNumber,
              });

              await Notification.create({
                userId: String(riderDoc._id),
                role: 'deliveryPartner',
                title: `Delivery Payout Sent: ₹${riderAmt}`,
                message: `Tomato has approved and transferred ₹${riderAmt} to your bank account (${riderDoc.bankDetails?.bankName} - ${riderDoc.bankDetails?.ifscCode}) for delivering Order #${payment.orderNumber}.`,
                type: 'service',
              });

              payment.riderPayoutStatus = 'approved_paid';
              payment.riderPaidAt = new Date();
              payment.riderPayoutRef = `UTR-RID-${Date.now().toString().slice(-6)}`;
              actionsCompleted.push(`₹${riderAmt} sent to Rider ${riderDoc.name}`);
            }
          }
        }

        payment.approvedByAdmin = adminIdentifier;
        await payment.save();

        return res.json({
          message:
            actionsCompleted.length > 0
              ? `Payout approved & transferred from Tomato Account: ${actionsCompleted.join(' & ')}`
              : 'Settlement updated',
          payment,
        });
      } catch (error) {
        console.error('Approve settlement payout failed:', error);
        return res.status(500).json({ message: 'Unable to process partner payout' });
      }
    });

    // 6. Partners Weekly Billing & Payout Overview
    router.get('/billing/partners', async (req: Request, res: Response) => {
      try {
        const { week, role: filterRole, status: filterStatus, search } = req.query;
        const q = String(search || '').trim().toLowerCase();

        let weekStart: Date | null = null;
        let weekEnd: Date | null = null;
        const isAllTime = week === 'all';

        if (!isAllTime) {
          if (typeof week === 'string' && /^\d{4}-W\d{2}$/.test(week.trim())) {
            // Parse YYYY-Www format
            const parts = week.trim().split('-W');
            const year = parseInt(parts[0] || '2026', 10);
            const weekNo = parseInt(parts[1] || '1', 10);
            const simple = new Date(Date.UTC(year, 0, 1 + (weekNo - 1) * 7));
            const dow = simple.getUTCDay();
            const ISOweekStart = simple;
            if (dow <= 4) {
              ISOweekStart.setUTCDate(simple.getUTCDate() - simple.getUTCDay() + 1);
            } else {
              ISOweekStart.setUTCDate(simple.getUTCDate() + 8 - simple.getUTCDay());
            }
            weekStart = new Date(ISOweekStart);
            weekStart.setHours(0, 0, 0, 0);
            weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 6);
            weekEnd.setHours(23, 59, 59, 999);
          } else {
            // Default to current rolling 7 days or current ISO week
            const now = new Date();
            const day = now.getDay();
            const diffToMon = now.getDate() - day + (day === 0 ? -6 : 1);
            weekStart = new Date(now.setDate(diffToMon));
            weekStart.setHours(0, 0, 0, 0);
            weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 6);
            weekEnd.setHours(23, 59, 59, 999);
          }
        }

        // Sync orders into payments table so newly placed orders are automatically reflected
        const [recentOrders, recentShopOrders] = await Promise.all([
          Order.find({ status: { $ne: 'cancelled' } }).sort({ createdAt: -1 }).limit(300).lean(),
          ShopOrder.find({ status: { $ne: 'cancelled' } }).sort({ createdAt: -1 }).limit(300).lean(),
        ]);
        for (const ord of recentOrders) {
          await syncOrderToTomatoPayment(ord, false);
        }
        for (const sOrd of recentShopOrders) {
          await syncOrderToTomatoPayment(sOrd, true);
        }

        const paymentQuery: Record<string, any> = {};
        if (weekStart && weekEnd) {
          paymentQuery.createdAt = { $gte: weekStart, $lte: weekEnd };
        }

        // Fetch all partners & riders
        const [restaurants, shops, riders, allPayments] = await Promise.all([
          Restaurant.find().select('name email phone restaurantId isApproved bankDetails walletBalance').lean(),
          Shop.find().select('name email phone shopId isApproved bankDetails walletBalance').lean(),
          Rider.find().select('name email phone riderId isApproved bankDetails walletBalance').lean(),
          Payment.find(paymentQuery).lean(),
        ]);

        // Aggregate order payments per partner
        const billingMap = new Map<string, any>();
        const partnerAliasMap = new Map<string, string>(); // maps code or name to partner primary key
        const riderAliasMap = new Map<string, string>();

        // Initialize restaurants
        restaurants.forEach((r: any) => {
          const id = String(r._id);
          const pKey = `restaurant_${id}`;
          const pCode = r.restaurantId || `REST-${id.slice(-6).toUpperCase()}`;
          billingMap.set(pKey, {
            partnerId: id,
            partnerType: 'restaurant',
            partnerCode: pCode,
            name: r.name,
            phone: r.phone || '',
            email: r.email || '',
            bankDetails: r.bankDetails || null,
            isBankApproved: !!(r.isApproved && r.bankDetails?.isApproved),
            walletBalance: Number(r.walletBalance || 0),
            totalOrders: 0,
            grossVolume: 0,
            tomatoCommission: 0,
            discountsFunded: 0,
            totalPayable: 0,
            totalPaid: 0,
            totalPending: 0,
            unsettledPaymentIds: [] as string[],
            payoutStatus: 'settled',
          });
          partnerAliasMap.set(`restaurant_${id.toLowerCase()}`, pKey);
          if (pCode) partnerAliasMap.set(`restaurant_${pCode.toLowerCase()}`, pKey);
          if (r.name) partnerAliasMap.set(`restaurant_${r.name.trim().toLowerCase()}`, pKey);
        });

        // Initialize shops
        shops.forEach((s: any) => {
          const id = String(s._id);
          const pKey = `shop_${id}`;
          const pCode = s.shopId || `SHOP-${id.slice(-6).toUpperCase()}`;
          billingMap.set(pKey, {
            partnerId: id,
            partnerType: 'shop',
            partnerCode: pCode,
            name: s.name,
            phone: s.phone || '',
            email: s.email || '',
            bankDetails: s.bankDetails || null,
            isBankApproved: !!(s.isApproved && s.bankDetails?.isApproved),
            walletBalance: Number(s.walletBalance || 0),
            totalOrders: 0,
            grossVolume: 0,
            tomatoCommission: 0,
            discountsFunded: 0,
            totalPayable: 0,
            totalPaid: 0,
            totalPending: 0,
            unsettledPaymentIds: [] as string[],
            payoutStatus: 'settled',
          });
          partnerAliasMap.set(`shop_${id.toLowerCase()}`, pKey);
          if (pCode) partnerAliasMap.set(`shop_${pCode.toLowerCase()}`, pKey);
          if (s.name) partnerAliasMap.set(`shop_${s.name.trim().toLowerCase()}`, pKey);
        });

        // Initialize riders
        riders.forEach((rd: any) => {
          const id = String(rd._id);
          const rKey = `rider_${id}`;
          const rCode = rd.riderId || `RDR-${id.slice(-6).toUpperCase()}`;
          billingMap.set(rKey, {
            partnerId: id,
            partnerType: 'deliveryPartner',
            partnerCode: rCode,
            name: rd.name,
            phone: rd.phone || '',
            email: rd.email || '',
            bankDetails: rd.bankDetails || null,
            isBankApproved: !!(rd.isApproved && rd.bankDetails?.isApproved),
            walletBalance: Number(rd.walletBalance || 0),
            totalOrders: 0,
            grossVolume: 0,
            tomatoCommission: 0,
            discountsFunded: 0,
            totalPayable: 0,
            totalPaid: 0,
            totalPending: 0,
            unsettledPaymentIds: [] as string[],
            payoutStatus: 'settled',
          });
          riderAliasMap.set(id.toLowerCase(), rKey);
          if (rCode) riderAliasMap.set(rCode.toLowerCase(), rKey);
          if (rd.name) riderAliasMap.set(rd.name.trim().toLowerCase(), rKey);
        });

        // Process all payments for the period
        allPayments.forEach((p: any) => {
          const pType = p.orderType === 'shop' ? 'shop' : 'restaurant';
          let partnerKey = `${pType}_${String(p.partnerId || '')}`;
          if (!billingMap.has(partnerKey)) {
            const resolved =
              partnerAliasMap.get(`${pType}_${String(p.partnerId || '').toLowerCase()}`) ||
              partnerAliasMap.get(`${pType}_${String(p.partnerCode || '').toLowerCase()}`) ||
              partnerAliasMap.get(`${pType}_${String(p.partnerName || '').trim().toLowerCase()}`);
            if (resolved) partnerKey = resolved;
          }

          const partnerEntry = billingMap.get(partnerKey);
          if (partnerEntry) {
            partnerEntry.totalOrders += 1;
            const gross = Number(p.totalAmount || 0);
            partnerEntry.grossVolume += gross;
            partnerEntry.tomatoCommission += Number(p.tomatoCommissionAmount || 0);
            partnerEntry.discountsFunded += Number(p.partnerDiscountShare || 0);

            const partnerPayout = Number(p.partnerPayoutAmount || 0);
            partnerEntry.totalPayable += partnerPayout;

            if (p.partnerPayoutStatus === 'approved_paid') {
              partnerEntry.totalPaid += partnerPayout;
            } else {
              partnerEntry.totalPending += partnerPayout;
              partnerEntry.unsettledPaymentIds.push(String(p._id));
            }
          }

          // Rider payout aggregation
          if (p.riderId || p.riderCode || p.riderName) {
            let riderKey = `rider_${String(p.riderId || '')}`;
            if (!billingMap.has(riderKey)) {
              const resolvedRider =
                riderAliasMap.get(String(p.riderId || '').toLowerCase()) ||
                riderAliasMap.get(String(p.riderCode || '').toLowerCase()) ||
                riderAliasMap.get(String(p.riderName || '').trim().toLowerCase());
              if (resolvedRider) riderKey = resolvedRider;
            }

            const riderEntry = billingMap.get(riderKey);
            if (riderEntry) {
              riderEntry.totalOrders += 1;
              const riderPayout = Number(p.riderPayoutAmount || 0);
              riderEntry.totalPayable += riderPayout;

              if (p.riderPayoutStatus === 'approved_paid') {
                riderEntry.totalPaid += riderPayout;
              } else {
                riderEntry.totalPending += riderPayout;
                riderEntry.unsettledPaymentIds.push(String(p._id));
              }
            }
          }
        });

        // Calculate summary KPI counters
        let totalPlatformPayable = 0;
        let totalPlatformPaid = 0;
        let totalPlatformPending = 0;
        let pendingRestaurantsCount = 0;
        let pendingShopsCount = 0;
        let pendingRidersCount = 0;

        const partnerBillingList = Array.from(billingMap.values()).map((item) => {
          item.totalPayable = Math.round(item.totalPayable * 100) / 100;
          item.totalPaid = Math.round(item.totalPaid * 100) / 100;
          item.totalPending = Math.round(item.totalPending * 100) / 100;

          if (item.totalOrders === 0) {
            item.payoutStatus = 'no_orders';
          } else if (item.totalPending > 0) {
            item.payoutStatus = 'pending';
            if (item.partnerType === 'restaurant') pendingRestaurantsCount++;
            else if (item.partnerType === 'shop') pendingShopsCount++;
            else if (item.partnerType === 'deliveryPartner') pendingRidersCount++;
          } else {
            item.payoutStatus = 'settled';
          }

          totalPlatformPayable += item.totalPayable;
          totalPlatformPaid += item.totalPaid;
          totalPlatformPending += item.totalPending;

          return item;
        });

        // Filter list
        let filtered = partnerBillingList;
        if (filterRole && filterRole !== 'all') {
          filtered = filtered.filter((i) => i.partnerType === filterRole);
        }
        if (filterStatus && filterStatus !== 'all') {
          filtered = filtered.filter((i) => i.payoutStatus === filterStatus);
        }
        if (q) {
          filtered = filtered.filter((i) => {
            const hay = `${i.name} ${i.partnerCode} ${i.phone} ${i.email}`.toLowerCase();
            return hay.includes(q);
          });
        }

        // Sort: Partners with pending amounts first, then highest volume
        filtered.sort((a, b) => {
          if (b.totalPending !== a.totalPending) return b.totalPending - a.totalPending;
          return b.totalPayable - a.totalPayable;
        });

        return res.json({
          weekStart: weekStart ? weekStart.toISOString().split('T')[0] : 'All Time',
          weekEnd: weekEnd ? weekEnd.toISOString().split('T')[0] : 'All Time',
          summary: {
            totalPlatformPayable: Math.round(totalPlatformPayable * 100) / 100,
            totalPlatformPaid: Math.round(totalPlatformPaid * 100) / 100,
            totalPlatformPending: Math.round(totalPlatformPending * 100) / 100,
            pendingRestaurantsCount,
            pendingShopsCount,
            pendingRidersCount,
            totalPartnersWithPending: pendingRestaurantsCount + pendingShopsCount + pendingRidersCount,
            trackedPartnersCount: partnerBillingList.length,
          },
          billingList: filtered,
        });
      } catch (error) {
        console.error('Fetch partner billing failed:', error);
        return res.status(500).json({ message: 'Unable to calculate partner billing' });
      }
    });

    // 7. Settle Partner Weekly Pending Balance in Batch
    router.post('/billing/partners/:partnerType/:partnerId/settle', async (req: Request, res: Response) => {
      try {
        const { partnerType, partnerId } = req.params;
        const adminUser = (req as AuthenticatedRequest).user;
        const adminIdentifier = adminUser?.name || adminUser?.email || 'Admin';

        const pType = String(partnerType || '');
        if (!['restaurant', 'shop', 'deliveryPartner'].includes(pType)) {
          return res.status(400).json({ message: 'Invalid partner type.' });
        }

        let partnerDoc: any = null;
        if (pType === 'restaurant') partnerDoc = await Restaurant.findById(partnerId);
        else if (pType === 'shop') partnerDoc = await Shop.findById(partnerId);
        else if (pType === 'deliveryPartner') partnerDoc = await Rider.findById(partnerId);

        if (!partnerDoc) {
          return res.status(404).json({ message: 'Partner record not found.' });
        }

        const bankCheck = checkPartnerCanBeApproved(partnerDoc.bankDetails);
        if (!partnerDoc.isApproved || !bankCheck.canApprove) {
          return res.status(400).json({
            message: `Cannot disburse payout: Partner "${partnerDoc.name}" bank/PAN details are not approved. Please verify in Bank panel first.`,
          });
        }

        // Find all pending payments for this partner
        let query: any = {};
        if (pType === 'deliveryPartner') {
          query = { riderId: partnerId, riderPayoutStatus: 'pending_approval' };
        } else {
          query = {
            partnerId,
            partnerPayoutStatus: 'pending_approval',
          };
        }

        const pendingPayments = await Payment.find(query);
        if (!pendingPayments.length) {
          return res.status(400).json({ message: 'No pending orders to disburse for this partner.' });
        }

        let totalDisbursed = 0;
        const utrCode = `UTR-WKL-${Date.now().toString().slice(-6)}`;

        for (const payment of pendingPayments) {
          if (payment.tomatoAccountStatus !== 'received') {
            payment.tomatoAccountStatus = 'received';
            payment.tomatoReceivedAt = new Date();
            await adjustTomatoCentralBankBalance(Number(payment.totalAmount || 0));
          }

          if (pType === 'deliveryPartner') {
            const riderAmt = Number(payment.riderPayoutAmount || 0);
            totalDisbursed += riderAmt;
            payment.riderPayoutStatus = 'approved_paid';
            payment.riderPaidAt = new Date();
            payment.riderPayoutRef = utrCode;
            payment.approvedByAdmin = adminIdentifier;
          } else {
            const partnerAmt = Number(payment.partnerPayoutAmount || 0);
            totalDisbursed += partnerAmt;
            payment.partnerPayoutStatus = 'approved_paid';
            payment.partnerPaidAt = new Date();
            payment.partnerPayoutRef = utrCode;
            payment.approvedByAdmin = adminIdentifier;
          }
          await payment.save();
        }

        partnerDoc.walletBalance = Number(((partnerDoc.walletBalance || 0) + totalDisbursed).toFixed(2));
        await partnerDoc.save();
        await adjustTomatoCentralBankBalance(-totalDisbursed);

        // Record wallet ledger transaction
        await WalletCreditTrack.create({
          recordType: 'transfer',
          senderUserId: adminUser?.userId || 'TOMATO-CENTRAL-BANK',
          senderEmail: adminUser?.email || 'treasury@tomato.com',
          receiverUserId: String(partnerDoc._id),
          receiverEmail: partnerDoc.email || '',
          receiverMobile: partnerDoc.phone || '',
          receiverCurrentWalletBalance: partnerDoc.walletBalance,
          creditTransferred: totalDisbursed,
          purpose: `Tomato Weekly Batch Payout to ${partnerDoc.name} (${pendingPayments.length} orders settled, UTR: ${utrCode})`,
        });

        // Send push notification to partner
        await Notification.create({
          userId: String(partnerDoc._id),
          role: partnerType === 'deliveryPartner' ? 'deliveryPartner' : partnerType === 'shop' ? 'shop' : 'restaurant',
          title: `Weekly Payout Settled: ₹${totalDisbursed.toFixed(2)}`,
          message: `Tomato has disbursed your weekly payout of ₹${totalDisbursed.toFixed(2)} (${pendingPayments.length} orders) to your bank account with UTR ${utrCode}.`,
          type: 'service',
        });

        return res.json({
          message: `Successfully disbursed ₹${totalDisbursed.toFixed(2)} across ${pendingPayments.length} orders to ${partnerDoc.name} (UTR: ${utrCode})`,
          totalDisbursed,
          ordersSettled: pendingPayments.length,
          utrCode,
        });
      } catch (error) {
        console.error('Batch payout failed:', error);
        return res.status(500).json({ message: 'Unable to process batch weekly payout.' });
      }
    });

    return router;
  };

export const adminRoutes = createAdminRouter();
export default adminRoutes;

import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import Address from '../../model/Address.js';
import FoodItem from '../../model/FoodItem.js';
import Notification from '../../model/Notification.js';
import Order, { IOrder, OrderStatus } from '../../model/Order.js';
import Employee, { IEmployee, USER_ROLES, UserRole } from '../../model/Employee.js';
import Restaurant, { IRestaurant } from '../../model/Restaurant.js';
import Customer, { ICustomer } from '../../model/Customer.js';
import Rider, { IRider } from '../../model/Rider.js';
import WalletCreditTrack from '../../model/WalletCreditTrack.js';
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
  generateRiderId,
  generateCustomerId,
  generateSubAdminId,
  generateAdminId,
} from '../auth/authController.js';
import notificationService from '../notification/notificationService.js';
import {
  transferCreditPoints,
  WalletServiceError,
} from '../wallet/walletService.js';
import {
  formatBill,
  buildOrderLiveTrackingData,
  createNotificationForRole,
} from '../../utils/orderHelpers.js';

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
        const restaurants = await Restaurant.find(restFilter).sort({ createdAt: -1 });
        return res.json(paginateList(restaurants.map((r) => userResponse(r as any))));
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

        const [employees, restaurants, riders, customers] = await Promise.all([
          Employee.find(filter).sort({ createdAt: -1 }),
          Restaurant.find(restFilter).sort({ createdAt: -1 }),
          Rider.find(riderFilter).sort({ createdAt: -1 }),
          Customer.find(custFilter).sort({ createdAt: -1 }),
        ]);

        const combined = [
          ...employees.map((u) => userResponse(u as any)),
          ...restaurants.map((r) => userResponse(r as any)),
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
        existingRider,
        existingCustomer,
      ] = await Promise.all([
        Employee.findOne(duplicateQuery),
        Restaurant.findOne(duplicateQuery),
        Rider.findOne(duplicateQuery),
        Customer.findOne(duplicateQuery),
      ]);

      if (
        existingEmployee ||
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
        user = await Employee.findByIdAndUpdate(
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
        user = await Employee.findByIdAndUpdate(
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
        user = await Employee.findByIdAndUpdate(
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
        user = await Employee.findByIdAndUpdate(
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
        user = await Employee.findByIdAndUpdate(
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

  // 4. Analytics with Date Range Period Filter (Default: Today)
  router.get(
    '/analytics',
    requirePermission('dashboard_view'),
    async (req: Request, res: Response) => {
      try {
        const { startDate, endDate, allTime } = req.query;

        const allOrders = await Order.find().lean();
        const employees = await Employee.find().lean();
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

export const adminRoutes = createAdminRouter();
export default adminRoutes;

import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import Notification from '../../../model/Notification.js';
import Order from '../../../model/Order.js';
import ShopOrder from '../../../model/ShopOrder.js';
import Customer from '../../../model/Customer.js';
import Restaurant from '../../../model/Restaurant.js';
import Shop from '../../../model/Shop.js';
import Rider from '../../../model/Rider.js';
import Employee from '../../../model/Employee.js';
import Payment from '../../../model/Payment.js';
import WalletCreditTrack from '../../../model/WalletCreditTrack.js';
import { AuthenticatedRequest, requireRole, requirePermission } from '../../../middleware/authenticate.js';

const router = Router();


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


export default router;

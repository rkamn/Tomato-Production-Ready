import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import Order from '../../../model/Order.js';
import ShopOrder from '../../../model/ShopOrder.js';
import Customer from '../../../model/Customer.js';
import Restaurant from '../../../model/Restaurant.js';
import Shop from '../../../model/Shop.js';
import { AuthenticatedRequest, requirePermission } from '../../../middleware/authenticate.js';
import {
  formatBill,
  resolveAdminGsnNumber,
  buildOrderLiveTrackingData,
} from '../../../utils/orderHelpers.js';

const router = Router();

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
            { paymentTransactionId: { $regex: escaped, $options: 'i' } },
            { utrNumber: { $regex: escaped, $options: 'i' } },
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


export default router;

import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import WalletCreditTrack, {
  IWalletCreditTrack,
  TransferType,
} from '../../../model/WalletCreditTrack.js';
import Wallet from '../../../model/Wallet.js';
import {
  AuthenticatedRequest,
  requireRole,
} from '../../../middleware/authenticate.js';
import {
  transferCreditPoints,
  transferWalletBalance,
  WalletServiceError,
} from '../../wallet/walletService.js';

const router = Router();

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// GET /finance/transfers - Paginated, filtered audit log of all transfers
router.get(
  '/finance/transfers',
  async (req: Request, res: Response) => {
    try {
      const page = Math.max(
        1,
        parseInt(String(req.query.page || '1'), 10) || 1,
      );
      const limit = Math.min(
        100,
        Math.max(1, parseInt(String(req.query.limit || '25'), 10) || 25),
      );
      const skip = (page - 1) * limit;

      const transferTypeFilter = String(req.query.transferType || 'all').trim();
      const roleFilter = String(req.query.role || 'all').trim();
      const search = String(req.query.search || '').trim();
      const startDate = String(req.query.startDate || '').trim();
      const endDate = String(req.query.endDate || '').trim();

      const query: any = { recordType: 'transfer' };

      // Filter by transferType
      if (transferTypeFilter === 'credit_point') {
        query.$or = [
          { transferType: 'credit_point' },
          {
            transferType: { $exists: false },
            walletBalanceTransferred: { $exists: false },
          },
        ];
      } else if (transferTypeFilter === 'wallet_balance') {
        query.$or = [
          { transferType: 'wallet_balance' },
          { walletBalanceTransferred: { $gt: 0 } },
          { purpose: { $regex: /payout|settlement|disbursed|fee/i } },
        ];
      }

      // Timezone-aware date boundary parser
      const tzOffset = Number(req.query.timezoneOffset); // in minutes, e.g. -330 for IST (UTC+5:30)
      const hasOffset = !isNaN(tzOffset);

      const parseBoundaryDate = (dateStr: string, isEnd: boolean): Date => {
        const rawParts = String(dateStr).split('-');
        if (rawParts.length === 3) {
          const year = parseInt(rawParts[0] ?? '', 10);
          const month = parseInt(rawParts[1] ?? '', 10);
          const day = parseInt(rawParts[2] ?? '', 10);
          if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
            const monthIndex = month - 1;
            if (hasOffset) {
              const localMs = isEnd
                ? Date.UTC(year, monthIndex, day, 23, 59, 59, 999)
                : Date.UTC(year, monthIndex, day, 0, 0, 0, 0);
              return new Date(localMs + tzOffset * 60 * 1000);
            } else {
              return isEnd
                ? new Date(year, monthIndex, day, 23, 59, 59, 999)
                : new Date(year, monthIndex, day, 0, 0, 0, 0);
            }
          }
        }
        const d = new Date(dateStr);
        if (isEnd) d.setHours(23, 59, 59, 999);
        else d.setHours(0, 0, 0, 0);
        return d;
      };

      // Filter by date range
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) {
          query.createdAt.$gte = parseBoundaryDate(startDate, false);
        }
        if (endDate) {
          query.createdAt.$lte = parseBoundaryDate(endDate, true);
        }
      }

      // Filter by role
      if (roleFilter && roleFilter !== 'all') {
        const escapedRole = escapeRegex(roleFilter);
        const roleCondition = [
          { senderRole: { $regex: `^${escapedRole}$`, $options: 'i' } },
          { receiverRole: { $regex: `^${escapedRole}$`, $options: 'i' } },
        ];
        if (query.$and) {
          query.$and.push({ $or: roleCondition });
        } else {
          query.$and = [{ $or: roleCondition }];
        }
      }

      // Search keyword
      if (search) {
        const escapedSearch = escapeRegex(search);
        const searchRegex = { $regex: escapedSearch, $options: 'i' };
        const searchConditions = [
          { senderUserId: searchRegex },
          { receiverUserId: searchRegex },
          { senderName: searchRegex },
          { receiverName: searchRegex },
          { senderEmail: searchRegex },
          { receiverEmail: searchRegex },
          { senderMobile: searchRegex },
          { receiverMobile: searchRegex },
          { purpose: searchRegex },
          { orderNumber: searchRegex },
        ];

        if (query.$and) {
          query.$and.push({ $or: searchConditions });
        } else {
          query.$and = [{ $or: searchConditions }];
        }
      }

      const [records, total, allTransferDocs] = await Promise.all([
        WalletCreditTrack.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        WalletCreditTrack.countDocuments(query),
        WalletCreditTrack.find({ recordType: 'transfer' })
          .select(
            'transferType creditTransferred walletBalanceTransferred amount purpose createdAt',
          )
          .lean(),
      ]);

      // Calculate KPI summary stats from all transfer records
      let todayStart: Date;
      const clientToday = req.query.today;
      if (
        clientToday &&
        typeof clientToday === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(clientToday)
      ) {
        todayStart = parseBoundaryDate(clientToday, false);
      } else {
        todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
      }

      let totalCreditPointsTransferred = 0;
      let totalWalletBalanceTransferred = 0;
      let todayTransfersCount = 0;
      let todayWalletTransferred = 0;
      let todayCreditsTransferred = 0;

      for (const doc of allTransferDocs) {
        const isWallet =
          doc.transferType === 'wallet_balance' ||
          Number(doc.walletBalanceTransferred || 0) > 0 ||
          /payout|settlement|disbursed|fee/i.test(doc.purpose || '');

        const amt = isWallet
          ? Number(
              doc.walletBalanceTransferred ??
                doc.amount ??
                doc.creditTransferred ??
                0,
            )
          : Number(doc.creditTransferred ?? doc.amount ?? 0);

        if (isWallet) {
          totalWalletBalanceTransferred += amt;
        } else {
          totalCreditPointsTransferred += amt;
        }

        if (doc.createdAt && new Date(doc.createdAt) >= todayStart) {
          todayTransfersCount += 1;
          if (isWallet) {
            todayWalletTransferred += amt;
          } else {
            todayCreditsTransferred += amt;
          }
        }
      }

      // Enrich missing sender/receiver names from Wallet collection if legacy records lack them
      const missingUserIds = new Set<string>();
      for (const rec of records) {
        if (
          !rec.senderName &&
          rec.senderUserId &&
          mongoose.isValidObjectId(rec.senderUserId)
        ) {
          missingUserIds.add(rec.senderUserId);
        }
        if (
          !rec.receiverName &&
          rec.receiverUserId &&
          mongoose.isValidObjectId(rec.receiverUserId)
        ) {
          missingUserIds.add(rec.receiverUserId);
        }
      }

      const userWalletMap = new Map<string, any>();
      if (missingUserIds.size > 0) {
        const wallets = await Wallet.find({
          userId: { $in: Array.from(missingUserIds) },
        }).lean();
        for (const w of wallets) {
          userWalletMap.set(w.userId, w);
        }
      }

      const enrichedRecords = records.map((rec: any) => {
        const isWallet =
          rec.transferType === 'wallet_balance' ||
          Number(rec.walletBalanceTransferred || 0) > 0 ||
          /payout|settlement|disbursed|fee/i.test(rec.purpose || '');

        const effectiveType: TransferType = isWallet
          ? 'wallet_balance'
          : 'credit_point';
        const senderWallet = userWalletMap.get(rec.senderUserId);
        const receiverWallet = userWalletMap.get(rec.receiverUserId);

        const senderName =
          rec.senderName ||
          senderWallet?.name ||
          (rec.senderUserId === 'TOMATO-CENTRAL-BANK'
            ? 'Tomato Central Treasury'
            : rec.senderRole === 'admin'
              ? 'Platform Administrator'
              : 'Sender User');
        const senderRole =
          rec.senderRole ||
          senderWallet?.role ||
          (rec.senderUserId === 'TOMATO-CENTRAL-BANK' ? 'admin' : 'admin');

        const receiverName =
          rec.receiverName || receiverWallet?.name || 'Beneficiary User';
        const receiverRole =
          rec.receiverRole || receiverWallet?.role || 'customer';

        const amount = Number(
          rec.amount ||
            rec.walletBalanceTransferred ||
            rec.creditTransferred ||
            0,
        );

        return {
          ...rec,
          transferType: effectiveType,
          senderName,
          senderRole,
          receiverName,
          receiverRole,
          amount,
        };
      });

      const adminWalletDoc = await Wallet.findOne({ role: 'admin' }).lean();
      const adminWalletBalance = Math.max(0, Number(adminWalletDoc?.walletBalance ?? 0));
      const adminCreditPoints = Math.max(0, Number(adminWalletDoc?.creditPoint ?? 10000));

      return res.json({
        records: enrichedRecords,
        summary: {
          adminWalletBalance: Number(adminWalletBalance.toFixed(2)),
          adminCreditPoints: Math.round(adminCreditPoints),
          totalTransfers: allTransferDocs.length,
          filteredTransfers: total,
          totalCreditPointsTransferred: Math.round(
            totalCreditPointsTransferred,
          ),
          totalWalletBalanceTransferred: Number(
            totalWalletBalanceTransferred.toFixed(2),
          ),
          todayTransfersCount,
          todayWalletTransferred: Number(todayWalletTransferred.toFixed(2)),
          todayCreditsTransferred: Math.round(todayCreditsTransferred),
        },
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit) || 1,
        },
      });
    } catch (error: any) {
      console.error('Fetch finance transfers failed:', error);
      return res
        .status(500)
        .json({ message: 'Unable to fetch finance transfer records' });
    }
  },
);

// POST /finance/transfer - Admin transfers credit points or wallet balance directly
router.post(
  '/finance/transfer',
  requireRole('admin'),
  async (req: Request, res: Response) => {
    const adminId = (req as AuthenticatedRequest).user?.userId;
    if (!adminId || !mongoose.isValidObjectId(adminId)) {
      return res.status(401).json({ message: 'Valid admin ID is required' });
    }

    const { recipientId, transferType, amount, purpose, orderNumber } =
      req.body || {};
    if (
      !recipientId ||
      typeof recipientId !== 'string' ||
      !recipientId.trim()
    ) {
      return res
        .status(400)
        .json({ message: 'Recipient account ID or User ID is required' });
    }
    const numAmount = Number(amount);
    if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
      return res
        .status(400)
        .json({ message: 'A positive transfer amount is required' });
    }
    if (!purpose || typeof purpose !== 'string' || !purpose.trim()) {
      return res.status(400).json({ message: 'Transfer purpose is required' });
    }

    try {
      if (transferType === 'wallet_balance') {
        const result = await transferWalletBalance(
          adminId,
          recipientId.trim(),
          numAmount,
          purpose.trim(),
          orderNumber,
        );
        return res.json({
          message: `Transferred ₹${numAmount.toFixed(2)} wallet balance successfully`,
          transferType: 'wallet_balance',
          ...result,
        });
      } else {
        const creditPoints = Math.round(numAmount);
        const result = await transferCreditPoints(
          adminId,
          recipientId.trim(),
          creditPoints,
          purpose.trim(),
          orderNumber,
        );
        return res.json({
          message: `Transferred ${creditPoints} credit point(s) successfully`,
          transferType: 'credit_point',
          ...result,
        });
      }
    } catch (error: any) {
      if (
        error instanceof WalletServiceError ||
        error?.name === 'WalletServiceError'
      ) {
        return res
          .status(error.statusCode || 400)
          .json({ message: error.message });
      }
      console.error('Direct finance transfer failed:', error);
      return res
        .status(500)
        .json({ message: 'Transfer could not be processed' });
    }
  },
);

export default router;

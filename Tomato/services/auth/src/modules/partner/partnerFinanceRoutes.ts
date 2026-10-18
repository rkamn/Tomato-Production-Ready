import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import WalletCreditTrack, {
  IWalletCreditTrack,
  TransferType,
} from '../../model/WalletCreditTrack.js';
import Wallet from '../../model/Wallet.js';
import Restaurant from '../../model/Restaurant.js';
import Shop from '../../model/Shop.js';
import { AuthenticatedRequest } from '../../middleware/authenticate.js';
import {
  transferCreditPoints,
  transferWalletBalance,
  WalletServiceError,
} from '../wallet/walletService.js';

const router = Router();

const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Helper to resolve partner document and known identifiers
async function resolvePartnerIdentifiers(user: AuthenticatedRequest['user']) {
  if (!user?.userId) return { partnerDoc: null, identifiers: [] };

  const userId = String(user.userId);
  let partnerDoc: any = null;

  if (user.role === 'restaurant') {
    if (mongoose.isValidObjectId(userId)) {
      partnerDoc = await Restaurant.findById(userId).lean();
    }
    if (!partnerDoc && (user as any).restaurantId) {
      partnerDoc = await Restaurant.findOne({ restaurantId: (user as any).restaurantId }).lean();
    }
  } else if (user.role === 'shop') {
    if (mongoose.isValidObjectId(userId)) {
      partnerDoc = await Shop.findById(userId).lean();
    }
    if (!partnerDoc && (user as any).shopId) {
      partnerDoc = await Shop.findOne({ shopId: (user as any).shopId }).lean();
    }
  }

  const identifiers: string[] = [
    userId,
    partnerDoc?._id ? String(partnerDoc._id) : null,
    partnerDoc?.restaurantId,
    partnerDoc?.shopId,
    (user as any)?.restaurantId,
    (user as any)?.shopId,
    partnerDoc?.phone,
    user?.phone,
    partnerDoc?.email,
    user?.email,
  ].filter(Boolean) as string[];

  // Deduplicate
  const uniqueIdentifiers = Array.from(new Set(identifiers));
  return { partnerDoc, identifiers: uniqueIdentifiers };
}

// GET /transfers - Paginated, filtered audit log of partner transfers
router.get(['/transfers', '/'], async (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).user;
    if (!user?.userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const { partnerDoc, identifiers } = await resolvePartnerIdentifiers(user);
    if (!identifiers.length) {
      return res.status(404).json({ message: 'Partner account not found' });
    }

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '25'), 10) || 25));
    const skip = (page - 1) * limit;

    const transferTypeFilter = String(req.query.transferType || 'all').trim();
    const roleFilter = String(req.query.role || 'all').trim();
    const search = String(req.query.search || '').trim();
    const startDate = String(req.query.startDate || '').trim();
    const endDate = String(req.query.endDate || '').trim();

    // Partner scoping condition: record must have partner as sender OR receiver
    const partnerMatch: Record<string, any> = {
      $or: [
        { senderUserId: { $in: identifiers } },
        { receiverUserId: { $in: identifiers } },
        ...(partnerDoc?.phone ? [{ senderMobile: partnerDoc.phone }, { receiverMobile: partnerDoc.phone }] : []),
        ...(partnerDoc?.email ? [{ senderEmail: partnerDoc.email }, { receiverEmail: partnerDoc.email }] : []),
      ],
    };

    const query: any = {
      recordType: 'transfer',
      $and: [partnerMatch],
    };

    // Filter by transferType
    if (transferTypeFilter === 'credit_point') {
      query.$and.push({
        $or: [
          { transferType: 'credit_point' },
          {
            transferType: { $exists: false },
            walletBalanceTransferred: { $exists: false },
          },
        ],
      });
    } else if (transferTypeFilter === 'wallet_balance') {
      query.$and.push({
        $or: [
          { transferType: 'wallet_balance' },
          { walletBalanceTransferred: { $gt: 0 } },
          { purpose: { $regex: /payout|settlement|disbursed|fee/i } },
        ],
      });
    }

    // Timezone-aware date boundary parser
    const tzOffset = Number(req.query.timezoneOffset); // in minutes
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
      const dateCond: any = {};
      if (startDate) {
        dateCond.$gte = parseBoundaryDate(startDate, false);
      }
      if (endDate) {
        dateCond.$lte = parseBoundaryDate(endDate, true);
      }
      query.$and.push({ createdAt: dateCond });
    }

    // Filter by role
    if (roleFilter && roleFilter !== 'all') {
      const escapedRole = escapeRegex(roleFilter);
      query.$and.push({
        $or: [
          { senderRole: { $regex: `^${escapedRole}$`, $options: 'i' } },
          { receiverRole: { $regex: `^${escapedRole}$`, $options: 'i' } },
        ],
      });
    }

    // Search keyword
    if (search) {
      const escapedSearch = escapeRegex(search);
      const searchRegex = { $regex: escapedSearch, $options: 'i' };
      query.$and.push({
        $or: [
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
        ],
      });
    }

    const partnerSummaryQuery: any = {
      recordType: 'transfer',
      ...partnerMatch,
    };

    const [records, total, allPartnerTransferDocs] = await Promise.all([
      WalletCreditTrack.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      WalletCreditTrack.countDocuments(query),
      WalletCreditTrack.find(partnerSummaryQuery)
        .select('transferType creditTransferred walletBalanceTransferred amount purpose createdAt')
        .lean(),
    ]);

    // Calculate KPI summary stats from all partner transfers
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

    for (const doc of allPartnerTransferDocs) {
      const isWallet =
        doc.transferType === 'wallet_balance' ||
        Number(doc.walletBalanceTransferred || 0) > 0 ||
        /payout|settlement|disbursed|fee/i.test(doc.purpose || '');

      const amt = isWallet
        ? Number(doc.walletBalanceTransferred ?? doc.amount ?? doc.creditTransferred ?? 0)
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

    // Enrich missing sender/receiver names from central Wallet
    const missingUserIds = new Set<string>();
    for (const rec of records) {
      if (!rec.senderName && rec.senderUserId && mongoose.isValidObjectId(rec.senderUserId)) {
        missingUserIds.add(rec.senderUserId);
      }
      if (!rec.receiverName && rec.receiverUserId && mongoose.isValidObjectId(rec.receiverUserId)) {
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

      const effectiveType: TransferType = isWallet ? 'wallet_balance' : 'credit_point';
      const senderWallet = userWalletMap.get(rec.senderUserId);
      const receiverWallet = userWalletMap.get(rec.receiverUserId);

      const senderName =
        rec.senderName ||
        senderWallet?.name ||
        (rec.senderUserId === 'TOMATO-CENTRAL-BANK'
          ? 'Tomato Central Treasury'
          : rec.senderRole === 'admin'
            ? 'Platform Administrator'
            : 'Partner Store');
      const senderRole = rec.senderRole || senderWallet?.role || 'restaurant';

      const receiverName = rec.receiverName || receiverWallet?.name || 'Beneficiary User';
      const receiverRole = rec.receiverRole || receiverWallet?.role || 'customer';

      const amount = Number(
        rec.amount || rec.walletBalanceTransferred || rec.creditTransferred || 0,
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

    // Fetch live partner balance from central wallet or document
    const centralWallet = await Wallet.findOne({ userId: String(user.userId) }).lean();
    const partnerWalletBalance = Math.max(
      0,
      Number(centralWallet?.walletBalance ?? partnerDoc?.walletBalance ?? 0),
    );
    const partnerCreditPoints = Math.max(
      0,
      Number(centralWallet?.creditPoint ?? partnerDoc?.creditPoint ?? 0),
    );

    return res.json({
      records: enrichedRecords,
      summary: {
        partnerWalletBalance: Number(partnerWalletBalance.toFixed(2)),
        partnerCreditPoints: Math.round(partnerCreditPoints),
        adminWalletBalance: Number(partnerWalletBalance.toFixed(2)), // For backward/cross-compatibility
        adminCreditPoints: Math.round(partnerCreditPoints),
        totalTransfers: allPartnerTransferDocs.length,
        filteredTransfers: total,
        totalCreditPointsTransferred: Math.round(totalCreditPointsTransferred),
        totalWalletBalanceTransferred: Number(totalWalletBalanceTransferred.toFixed(2)),
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
    console.error('Fetch partner finance transfers failed:', error);
    return res.status(500).json({ message: 'Unable to fetch finance transfer records' });
  }
});

// POST /transfer - Partner transfers credit points or wallet balance directly
router.post(['/transfer', '/'], async (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).user;
  const partnerId = user?.userId;
  if (!partnerId || !mongoose.isValidObjectId(partnerId)) {
    return res.status(401).json({ message: 'Valid partner authentication required' });
  }

  const { recipientId, transferType, amount, purpose, orderNumber } = req.body || {};
  if (!recipientId || typeof recipientId !== 'string' || !recipientId.trim()) {
    return res.status(400).json({ message: 'Recipient account ID or User ID is required' });
  }
  const numAmount = Number(amount);
  if (!numAmount || isNaN(numAmount) || numAmount <= 0) {
    return res.status(400).json({ message: 'A positive transfer amount is required' });
  }
  if (!purpose || typeof purpose !== 'string' || !purpose.trim()) {
    return res.status(400).json({ message: 'Transfer purpose is required' });
  }

  try {
    if (transferType === 'wallet_balance') {
      const result = await transferWalletBalance(
        partnerId,
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
        partnerId,
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
    if (error instanceof WalletServiceError || error?.name === 'WalletServiceError') {
      return res.status(error.statusCode || 400).json({ message: error.message });
    }
    console.error('Partner finance transfer failed:', error);
    return res.status(500).json({ message: 'Transfer could not be processed' });
  }
});

export default router;

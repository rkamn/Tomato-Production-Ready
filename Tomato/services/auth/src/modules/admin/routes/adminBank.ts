import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import Restaurant from '../../../model/Restaurant.js';
import Shop from '../../../model/Shop.js';
import Rider from '../../../model/Rider.js';
import Order from '../../../model/Order.js';
import ShopOrder from '../../../model/ShopOrder.js';
import Payment from '../../../model/Payment.js';
import Notification from '../../../model/Notification.js';
import WalletCreditTrack from '../../../model/WalletCreditTrack.js';
import { AuthenticatedRequest, requireRole } from '../../../middleware/authenticate.js';
import { userResponse } from '../../auth/authController.js';
import {
  validateBankAndPanDetails,
  checkPartnerCanBeApproved,
  syncOrderToTomatoPayment,
  adjustTomatoCentralBankBalance,
  extractPincodeFromText,
  getServiceablePincodes,
  resolvePartnerPincode,
} from '../../../utils/bankHelpers.js';

const router = Router();

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


export default router;

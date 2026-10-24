import { Router, Request, Response } from 'express';
import Restaurant from '../../../model/Restaurant.js';
import Shop from '../../../model/Shop.js';
import Rider from '../../../model/Rider.js';
import Order from '../../../model/Order.js';
import ShopOrder from '../../../model/ShopOrder.js';
import Payment from '../../../model/Payment.js';
import Notification from '../../../model/Notification.js';
import WalletCreditTrack from '../../../model/WalletCreditTrack.js';
import Wallet from '../../../model/Wallet.js';
import { AuthenticatedRequest } from '../../../middleware/authenticate.js';
import {
  syncOrderToTomatoPayment,
  adjustTomatoCentralBankBalance,
  checkPartnerCanBeApproved,
} from '../../../utils/bankHelpers.js';

const router = Router();

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
            walletBalance: Math.max(0, Number(r.walletBalance || 0)),
            creditPoint: Math.max(0, Number(r.creditPoint || 0)),
            totalOrders: 0,
            grossVolume: 0,
            tomatoCommission: 0,
            gstAmount: 0,
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
            walletBalance: Math.max(0, Number(s.walletBalance || 0)),
            creditPoint: Math.max(0, Number(s.creditPoint || 0)),
            totalOrders: 0,
            grossVolume: 0,
            tomatoCommission: 0,
            gstAmount: 0,
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
            walletBalance: Math.max(0, Number(rd.walletBalance || 0)),
            creditPoint: Math.max(0, Number(rd.creditPoint || 0)),
            totalOrders: 0,
            grossVolume: 0,
            tomatoCommission: 0,
            gstAmount: 0,
            discountsFunded: 0,
            totalPayable: 0,
            totalPaid: 0,
            totalPending: 0,
            codOrdersCount: 0,
            codTotalCollected: 0,
            codCashCollected: 0,
            codUpiCollected: 0,
            unsettledPaymentIds: [] as string[],
            payoutStatus: 'settled',
          });
          riderAliasMap.set(id.toLowerCase(), rKey);
          if (rCode) riderAliasMap.set(rCode.toLowerCase(), rKey);
          if (rd.name) riderAliasMap.set(rd.name.trim().toLowerCase(), rKey);
        });

        // Track platform COD counters
        let totalPlatformCodCollected = 0;
        let totalPlatformCodCash = 0;
        let totalPlatformCodUpi = 0;
        let totalPlatformCodOrders = 0;

        // Process all payments for the period
        allPayments.forEach((p: any) => {
          const isCod = p.paymentMethod === 'cod';
          const isCodReceived = isCod && (p.tomatoAccountStatus === 'received' || Boolean(p.codCollectedAt));
          const codAmt = Number(p.totalAmount || 0);
          const codMode = p.codCollectedVia === 'upi' ? 'upi' : 'cash';

          if (isCodReceived) {
            totalPlatformCodCollected += codAmt;
            totalPlatformCodOrders += 1;
            if (codMode === 'upi') {
              totalPlatformCodUpi += codAmt;
            } else {
              totalPlatformCodCash += codAmt;
            }
          }

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

            // Platform Commission agreement
            let comm = Number(p.tomatoCommissionAmount || 0);
            if (!comm && gross > 0) {
              const agreementPct = partnerEntry.bankDetails?.agreementCommissionPercent ?? (pType === 'shop' ? 12 : 15);
              comm = Number(((gross * agreementPct) / 100).toFixed(2));
            }
            partnerEntry.tomatoCommission += comm;

            // GST value: 18% of agreement commission value
            const gst = Number((comm * 0.18).toFixed(2));
            partnerEntry.gstAmount += gst;

            const discounts = Number(p.partnerDiscountShare || 0);
            partnerEntry.discountsFunded += discounts;

            // Net payout: gross - commission - 18% GST - discounts (GST deducted from restaurant & shop)
            const partnerPayout = Math.max(0, Number((gross - comm - gst - discounts).toFixed(2)));
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
              const riderGross = Number(p.deliveryFee || p.riderPayoutAmount || 40);
              riderEntry.grossVolume += riderGross;

              // GST value: 18% of agreement value (rider delivery payout agreement)
              const riderGst = Number((riderGross * 0.18).toFixed(2));
              riderEntry.gstAmount += riderGst;

              // Net rider payout after 18% GST deduction
              const riderPayout = Math.max(0, Number((riderGross - riderGst).toFixed(2)));
              riderEntry.totalPayable += riderPayout;

              if (p.riderPayoutStatus === 'approved_paid') {
                riderEntry.totalPaid += riderPayout;
              } else {
                riderEntry.totalPending += riderPayout;
                riderEntry.unsettledPaymentIds.push(String(p._id));
              }

              if (isCodReceived) {
                riderEntry.codOrdersCount = (riderEntry.codOrdersCount || 0) + 1;
                riderEntry.codTotalCollected = (riderEntry.codTotalCollected || 0) + codAmt;
                if (codMode === 'upi') {
                  riderEntry.codUpiCollected = (riderEntry.codUpiCollected || 0) + codAmt;
                } else {
                  riderEntry.codCashCollected = (riderEntry.codCashCollected || 0) + codAmt;
                }
              }
            }
          }
        });

        // Calculate summary KPI counters
        let totalPlatformPayable = 0;
        let totalPlatformPaid = 0;
        let totalPlatformPending = 0;
        let totalPlatformGst = 0;
        let totalPlatformCommission = 0;
        let pendingRestaurantsCount = 0;
        let pendingShopsCount = 0;
        let pendingRidersCount = 0;

        const partnerBillingList = Array.from(billingMap.values()).map((item) => {
          item.grossVolume = Math.round(item.grossVolume * 100) / 100;
          item.tomatoCommission = Math.round(item.tomatoCommission * 100) / 100;
          item.gstAmount = Math.round((item.gstAmount || 0) * 100) / 100;
          item.discountsFunded = Math.round(item.discountsFunded * 100) / 100;
          item.totalPayable = Math.round(item.totalPayable * 100) / 100;
          item.totalPaid = Math.round(item.totalPaid * 100) / 100;
          item.totalPending = Math.round(item.totalPending * 100) / 100;
          item.codTotalCollected = Math.round((item.codTotalCollected || 0) * 100) / 100;
          item.codCashCollected = Math.round((item.codCashCollected || 0) * 100) / 100;
          item.codUpiCollected = Math.round((item.codUpiCollected || 0) * 100) / 100;
          item.codOrdersCount = item.codOrdersCount || 0;

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
          totalPlatformGst += item.gstAmount;
          totalPlatformCommission += item.tomatoCommission;

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
            totalPlatformGst: Math.round(totalPlatformGst * 100) / 100,
            totalPlatformCommission: Math.round(totalPlatformCommission * 100) / 100,
            totalPlatformCodCollected: Math.round(totalPlatformCodCollected * 100) / 100,
            totalPlatformCodCash: Math.round(totalPlatformCodCash * 100) / 100,
            totalPlatformCodUpi: Math.round(totalPlatformCodUpi * 100) / 100,
            totalPlatformCodOrders,
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
            const riderGross = Number(payment.deliveryFee || payment.riderPayoutAmount || 40);
            const riderGst = Number((riderGross * 0.18).toFixed(2));
            const riderAmt = Math.max(0, Number((riderGross - riderGst).toFixed(2)));
            totalDisbursed += riderAmt;
            payment.riderPayoutAmount = riderAmt;
            payment.riderPayoutStatus = 'approved_paid';
            payment.riderPaidAt = new Date();
            payment.riderPayoutRef = utrCode;
            payment.approvedByAdmin = adminIdentifier;
          } else {
            const gross = Number(payment.totalAmount || 0);
            const comm = Number(
              payment.tomatoCommissionAmount ||
              ((gross * (partnerDoc.bankDetails?.agreementCommissionPercent ?? (pType === 'shop' ? 12 : 15))) / 100).toFixed(2)
            );
            const gst = Number((comm * 0.18).toFixed(2));
            const discounts = Number((payment as any).partnerDiscountShare || payment.partnerCouponShare || 0);
            const partnerAmt = Math.max(0, Number((gross - comm - gst - discounts).toFixed(2)));
            totalDisbursed += partnerAmt;
            payment.partnerPayoutAmount = partnerAmt;
            payment.partnerPayoutStatus = 'approved_paid';
            payment.partnerPaidAt = new Date();
            payment.partnerPayoutRef = utrCode;
            payment.approvedByAdmin = adminIdentifier;
          }
          await payment.save();
        }

        partnerDoc.walletBalance = Number(((partnerDoc.walletBalance || 0) + totalDisbursed).toFixed(2));
        await partnerDoc.save();
        await Wallet.updateOne(
          { userId: String(partnerDoc._id) },
          { $set: { walletBalance: partnerDoc.walletBalance } },
          { upsert: true },
        ).catch(() => {});
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


export default router;

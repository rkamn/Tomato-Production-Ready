import Payment from '../model/Payment.js';
import Restaurant, { IBankDetails } from '../model/Restaurant.js';
import Shop from '../model/Shop.js';
import Rider from '../model/Rider.js';
import Employee from '../model/Employee.js';
import WalletCreditTrack from '../model/WalletCreditTrack.js';
import Notification from '../model/Notification.js';

export async function adjustTomatoCentralBankBalance(deltaAmount: number) {
  const numDelta = Number(Number(deltaAmount || 0).toFixed(2));
  if (!numDelta) return;
  try {
    await Employee.updateMany(
      { role: 'admin' },
      { $inc: { walletBalance: numDelta } },
    );
    await WalletCreditTrack.updateMany(
      { recordType: 'balance_snapshot' },
      { $inc: { wallet_balance: numDelta, walletBalance: numDelta } },
    );
  } catch (err) {
    console.warn('adjustTomatoCentralBankBalance warning:', err);
  }
}

export interface BankValidationResult {
  valid: boolean;
  message?: string;
  sanitized?: {
    accountHolderName: string;
    bankName: string;
    accountNumber: string;
    ifscCode: string;
    panNumber: string;
    panHolderName: string;
    upiId: string;
  };
}

export function validateBankAndPanDetails(raw: any): BankValidationResult {
  const accountHolderName = typeof raw?.accountHolderName === 'string' ? raw.accountHolderName.trim() : '';
  const bankName = typeof raw?.bankName === 'string' ? raw.bankName.trim() : '';
  const accountNumber = typeof raw?.accountNumber === 'string' ? raw.accountNumber.replace(/\s+/g, '').trim() : '';
  const ifscCode = typeof raw?.ifscCode === 'string' ? raw.ifscCode.replace(/\s+/g, '').toUpperCase().trim() : '';
  const panNumber = typeof raw?.panNumber === 'string' ? raw.panNumber.replace(/\s+/g, '').toUpperCase().trim() : '';
  const panHolderName = typeof raw?.panHolderName === 'string' ? raw.panHolderName.trim() : '';
  const upiId = typeof raw?.upiId === 'string' ? raw.upiId.trim() : '';

  if (!accountHolderName) {
    return { valid: false, message: 'Bank Account Holder Name is required.' };
  }
  if (!bankName) {
    return { valid: false, message: 'Bank Name is required.' };
  }
  if (!accountNumber || accountNumber.length < 6) {
    return { valid: false, message: 'Valid Bank Account Number is required (minimum 6 digits).' };
  }
  if (!ifscCode || !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(ifscCode)) {
    return { valid: false, message: 'Valid 11-character IFSC Code is required (e.g., SBIN0001234).' };
  }
  if (!panNumber || !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i.test(panNumber)) {
    return { valid: false, message: 'Valid 10-character PAN Card Number is required (e.g., ABCDE1234F).' };
  }
  if (!panHolderName) {
    return { valid: false, message: 'Name on PAN Card is required.' };
  }

  // Normalize whitespace & compare case-insensitively
  const normBankHolder = accountHolderName.replace(/\s+/g, ' ').toLowerCase();
  const normPanHolder = panHolderName.replace(/\s+/g, ' ').toLowerCase();

  if (normBankHolder !== normPanHolder) {
    return {
      valid: false,
      message: `Bank Account Holder Name ("${accountHolderName}") MUST match the Name on PAN Card ("${panHolderName}").`,
    };
  }

  return {
    valid: true,
    sanitized: {
      accountHolderName,
      bankName,
      accountNumber,
      ifscCode,
      panNumber,
      panHolderName,
      upiId,
    },
  };
}

export function checkPartnerCanBeApproved(bankDetails?: IBankDetails | null): {
  canApprove: boolean;
  reason?: string;
} {
  if (!bankDetails) {
    return {
      canApprove: false,
      reason: 'Bank details and PAN card have not been submitted yet.',
    };
  }
  const check = validateBankAndPanDetails(bankDetails);
  if (!check.valid) {
    return {
      canApprove: false,
      reason: check.message || 'Incomplete or invalid bank/PAN details.',
    };
  }
  return { canApprove: true };
}

/**
 * Ensures an order is recorded in Tomato's centralized `payments` collection.
 * All customer payments are received in Tomato's account first, and later settled to Shop/Restaurant and Rider.
 */
export async function syncOrderToTomatoPayment(order: any, isShopOrder = false) {
  try {
    if (!order || !order.orderNumber) return null;

    const existing = await Payment.findOne({ orderNumber: order.orderNumber });

    const totalAmount = Number(order.totalAmount || 0);
    const subtotal = Number(order.subtotal || Math.max(0, totalAmount - 40));
    const deliveryFee = Number(order.deliveryFee ?? 40);
    const tax = Number(order.tax || 0);

    const isShop =
      isShopOrder ||
      Boolean(order.shopId) ||
      String(order.orderNumber || '').startsWith('SHOP-');

    const partnerRole: 'restaurant' | 'shop' = isShop ? 'shop' : 'restaurant';
    const partnerIdStr = String(order.shopId || order.restaurantId || '');
    let partnerDoc: any = null;
    if (partnerIdStr && partnerIdStr.length === 24) {
      partnerDoc = isShop
        ? await Shop.findById(partnerIdStr).lean()
        : await Restaurant.findById(partnerIdStr).lean();
    }

    const commissionPct =
      existing?.agreementCommissionPercent ??
      partnerDoc?.bankDetails?.agreementCommissionPercent ??
      (isShop ? 12 : 15);

    const riderIdStr = order.riderId ? String(order.riderId) : '';
    let riderDoc: any = null;
    if (riderIdStr && riderIdStr.length === 24) {
      riderDoc = await Rider.findById(riderIdStr).lean();
    }

    const riderPayoutAmount =
      existing?.riderPayoutAmount ??
      riderDoc?.bankDetails?.riderPayoutPerOrder ??
      deliveryFee;

    // Tomato commission is calculated on subtotal (or total minus delivery fee)
    const baseForPartner = Math.max(0, totalAmount - riderPayoutAmount);
    const tomatoCommissionAmount = Number(((baseForPartner * commissionPct) / 100).toFixed(2));
    const partnerPayoutAmount = Number(Math.max(0, baseForPartner - tomatoCommissionAmount).toFixed(2));

    const isPaidToTomato =
      order.paymentStatus === 'paid' ||
      order.status === 'delivered' ||
      order.paymentMethod !== 'cod';

    const tomatoAccountStatus: 'received' | 'pending_cod' = isPaidToTomato
      ? 'received'
      : 'pending_cod';

    if (existing) {
      let changed = false;
      if (existing.tomatoAccountStatus !== tomatoAccountStatus && tomatoAccountStatus === 'received') {
        existing.tomatoAccountStatus = 'received';
        existing.tomatoReceivedAt = new Date();
        changed = true;
        await adjustTomatoCentralBankBalance(totalAmount);
      }
      if (riderIdStr && !existing.riderId) {
        existing.riderId = riderIdStr;
        existing.riderCode = order.riderCode || riderDoc?.riderId || '';
        existing.riderName = order.riderName || riderDoc?.name || 'Delivery Partner';
        if (existing.riderPayoutStatus === 'unassigned') {
          existing.riderPayoutStatus = 'pending_approval';
        }
        changed = true;
      }
      if (changed) await existing.save();
      return existing;
    }

    const paymentDoc = await Payment.create({
      orderId: order._id,
      orderNumber: order.orderNumber,
      billNumber: order.billNumber || `BILL-${order.orderNumber}`,
      orderType: partnerRole,
      customerId: order.customerId ? String(order.customerId) : '',
      customerName: order.customerName || 'Customer',
      customerPhone: order.customerPhone || '',
      subtotal,
      tax,
      deliveryFee,
      totalAmount,
      amount: totalAmount,
      currency: 'INR',
      paymentMethod: order.paymentMethod || 'razorpay',
      transactionId: order.paymentTransactionId || `TXN-${order.orderNumber}`,
      tomatoAccountStatus,
      tomatoReceivedAt: order.paidAt || order.createdAt || new Date(),
      partnerId: partnerIdStr,
      partnerCode: order.shopCode || order.restaurantCode || partnerDoc?.shopId || partnerDoc?.restaurantId || '',
      partnerRole,
      partnerName: order.shopName || order.restaurantName || partnerDoc?.name || 'Tomato Partner',
      agreementCommissionPercent: commissionPct,
      tomatoCommissionAmount,
      partnerPayoutAmount,
      partnerPayoutStatus: 'pending_approval',
      partnerBankSnapshot: {
        accountHolderName: partnerDoc?.bankDetails?.accountHolderName || '',
        bankName: partnerDoc?.bankDetails?.bankName || '',
        accountNumber: partnerDoc?.bankDetails?.accountNumber || '',
        ifscCode: partnerDoc?.bankDetails?.ifscCode || '',
        panNumber: partnerDoc?.bankDetails?.panNumber || '',
      },
      riderId: riderIdStr,
      riderCode: order.riderCode || riderDoc?.riderId || '',
      riderName: order.riderName || riderDoc?.name || '',
      riderPayoutAmount,
      riderPayoutStatus: riderIdStr ? 'pending_approval' : 'unassigned',
      riderBankSnapshot: {
        accountHolderName: riderDoc?.bankDetails?.accountHolderName || '',
        bankName: riderDoc?.bankDetails?.bankName || '',
        accountNumber: riderDoc?.bankDetails?.accountNumber || '',
        ifscCode: riderDoc?.bankDetails?.ifscCode || '',
        panNumber: riderDoc?.bankDetails?.panNumber || '',
      },
    });

    if (tomatoAccountStatus === 'received') {
      await adjustTomatoCentralBankBalance(totalAmount);
      try {
        await Notification.create({
          userId: 'ADMIN',
          role: 'admin',
          title: `🏦 ₹${totalAmount} Credited to Tomato Bank Account`,
          message: `Order #${order.orderNumber} payment of ₹${totalAmount} (${String(order.paymentMethod || 'ONLINE').toUpperCase()}) has been credited to Tomato's central bank account. Pending payout settlement to ${paymentDoc.partnerName} (₹${partnerPayoutAmount}) and Rider (₹${riderPayoutAmount}).`,
          type: 'order',
          entityId: String(order._id),
        });
      } catch (_) {}
    }

    return paymentDoc;
  } catch (err) {
    console.error('syncOrderToTomatoPayment error:', err);
    return null;
  }
}


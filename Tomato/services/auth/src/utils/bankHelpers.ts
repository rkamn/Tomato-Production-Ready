import Payment from '../model/Payment.js';
import Restaurant, { IBankDetails } from '../model/Restaurant.js';
import Shop from '../model/Shop.js';
import Rider from '../model/Rider.js';
import Employee from '../model/Employee.js';
import WalletCreditTrack from '../model/WalletCreditTrack.js';
import Wallet from '../model/Wallet.js';
import Notification from '../model/Notification.js';
import { Counter } from '../model/Counter.js';

export async function adjustTomatoCentralBankBalance(deltaAmount: number) {
  const numDelta = Number(Number(deltaAmount || 0).toFixed(2));
  if (!numDelta) return;
  try {
    const admins = await Employee.find({ role: 'admin' }).select('_id walletBalance');
    for (const admin of admins) {
      const current = Math.max(0, Number(admin.walletBalance || 0));
      const updated = Math.max(0, Number((current + numDelta).toFixed(2)));
      await Employee.updateOne({ _id: admin._id }, { $set: { walletBalance: updated } });
      await Wallet.updateOne({ userId: String(admin._id) }, { $set: { walletBalance: updated } });
    }
    const snapshots = await WalletCreditTrack.find({ recordType: 'balance_snapshot' });
    for (const snap of snapshots) {
      const current = Math.max(0, Number(snap.wallet_balance ?? snap.walletBalance ?? 0));
      const updated = Math.max(0, Number((current + numDelta).toFixed(2)));
      await WalletCreditTrack.updateOne(
        { _id: snap._id },
        { $set: { wallet_balance: updated, walletBalance: updated } },
      );
    }
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

export function validateBankAndPanDetails(raw: any, isAdmin: boolean = false): BankValidationResult {
  const accountHolderName = typeof raw?.accountHolderName === 'string' ? raw.accountHolderName.trim() : '';
  const bankName = typeof raw?.bankName === 'string' ? raw.bankName.trim() : '';
  const accountNumber = typeof raw?.accountNumber === 'string' ? raw.accountNumber.replace(/\s+/g, '').trim() : '';
  let ifscCode = typeof raw?.ifscCode === 'string' ? raw.ifscCode.replace(/\s+/g, '').toUpperCase().trim() : '';
  let panNumber = typeof raw?.panNumber === 'string' ? raw.panNumber.replace(/\s+/g, '').toUpperCase().trim() : '';
  let panHolderName = typeof raw?.panHolderName === 'string' ? raw.panHolderName.trim() : '';
  const upiId = typeof raw?.upiId === 'string' ? raw.upiId.trim() : '';

  if (isAdmin) {
    if (!panHolderName && accountHolderName) {
      panHolderName = accountHolderName;
    }
    if (!panNumber) {
      panNumber = 'ABCDE1234F';
    }
  }

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
  if (!isAdmin) {
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
  } else {
    if (!panHolderName) panHolderName = accountHolderName;
    if (!panNumber || !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i.test(panNumber)) {
      panNumber = 'ABCDE1234F';
    }
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

    const rawRiderPayout =
      riderDoc?.bankDetails?.riderPayoutPerOrder ??
      deliveryFee;
    const riderGst = Number((rawRiderPayout * 0.18).toFixed(2));
    const riderPayoutAmount =
      existing?.riderPayoutAmount ??
      Math.max(0, Number((rawRiderPayout - riderGst).toFixed(2)));

    // Calculate coupon discount and funding split between Tomato and Partner
    let totalCouponDiscount = Number(order.discountAmount || 0);
    let partnerDiscountShare = 0;
    let tomatoDiscountShare = 0;
    let dominantSponsorType = 'tomato';

    const appliedList = Array.isArray(order.appliedCoupons) ? order.appliedCoupons : [];
    if (appliedList.length > 0) {
      totalCouponDiscount = 0;
      for (const ac of appliedList) {
        const disc = Number(ac.discountAmount || 0);
        if (disc <= 0) continue;
        totalCouponDiscount += disc;

        const sType = ac.sponsorType || 'tomato';
        dominantSponsorType = sType;

        if (sType === 'tomato') {
          // 100% paid by Tomato
          tomatoDiscountShare += disc;
        } else if (sType === 'restaurant' || sType === 'shop') {
          // 100% paid by partner (restaurant or shop)
          partnerDiscountShare += disc;
        } else if (sType === 'common') {
          // Split based on current agreement commission %
          const tomatoPart = Number(((disc * commissionPct) / 100).toFixed(2));
          const partnerPart = Number((disc - tomatoPart).toFixed(2));
          tomatoDiscountShare += tomatoPart;
          partnerDiscountShare += partnerPart;
        }
      }
    } else if (totalCouponDiscount > 0) {
      // Default fallback if no appliedCoupons detail: paid by Tomato
      tomatoDiscountShare = totalCouponDiscount;
    }

    // Tomato standard commission is calculated on the gross subtotal
    const standardTomatoCommission = Number(((subtotal * commissionPct) / 100).toFixed(2));
    const partnerGrossEarnings = Number((subtotal - standardTomatoCommission).toFixed(2));

    // GST: 18% of agreement commission value
    const commissionGst = Number((standardTomatoCommission * 0.18).toFixed(2));

    // Partner payout: partner gets gross earnings minus partner's coupon discount share minus 18% GST
    const partnerPayoutAmount = Number(
      Math.max(0, partnerGrossEarnings - partnerDiscountShare - commissionGst).toFixed(2),
    );

    // Tomato net commission: standard commission minus Tomato's coupon discount share
    const tomatoCommissionAmount = Number(
      (standardTomatoCommission - tomatoDiscountShare).toFixed(2),
    );

    const isPaidToTomato =
      order.paymentStatus === 'paid' ||
      order.status === 'delivered' ||
      order.paymentMethod !== 'cod';

    const tomatoAccountStatus: 'received' | 'pending_cod' = isPaidToTomato
      ? 'received'
      : 'pending_cod';

    const codCollectedVia = order.codCollectedVia || (order.paymentMethod === 'cod' && (order.status === 'delivered' || order.paymentStatus === 'paid') ? 'cash' : undefined);
    const codCollectedAt = order.codCollectedAt || (order.paymentMethod === 'cod' && (order.status === 'delivered' || order.paymentStatus === 'paid') ? (order.paidAt || order.updatedAt || new Date()) : undefined);

    if (existing) {
      let changed = false;
      if (existing.tomatoAccountStatus !== tomatoAccountStatus && tomatoAccountStatus === 'received') {
        existing.tomatoAccountStatus = 'received';
        existing.tomatoReceivedAt = new Date();
        changed = true;
        await adjustTomatoCentralBankBalance(totalAmount);
      }
      if (codCollectedVia && existing.codCollectedVia !== codCollectedVia) {
        existing.codCollectedVia = codCollectedVia;
        changed = true;
      }
      if (codCollectedAt && !existing.codCollectedAt) {
        existing.codCollectedAt = codCollectedAt;
        changed = true;
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
      codCollectedVia,
      codCollectedAt,
      partnerId: partnerIdStr,
      partnerCode: order.shopCode || order.restaurantCode || partnerDoc?.shopId || partnerDoc?.restaurantId || '',
      partnerRole,
      partnerName: order.shopName || order.restaurantName || partnerDoc?.name || 'Tomato Partner',
      agreementCommissionPercent: commissionPct,
      tomatoCommissionAmount,
      partnerPayoutAmount,
      couponDiscountAmount: totalCouponDiscount,
      couponSponsorType: dominantSponsorType,
      tomatoCouponShare: Number(tomatoDiscountShare.toFixed(2)),
      partnerCouponShare: Number(partnerDiscountShare.toFixed(2)),
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

export const SERVICEABLE_PINCODES_DOC_ID = 'serviceable_pincodes';
export const DEFAULT_SERVICEABLE_PINCODES = ['560001', '560038', '560008', '560066'];

export function extractPincodeFromText(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (/^\d{5,6}$/.test(trimmed)) return trimmed;
  const match6 = trimmed.match(/\b([1-9]\d{5})\b/);
  if (match6 && match6[1]) return match6[1];
  const matchAny = trimmed.match(/\b(\d{5,6})\b/);
  return matchAny && matchAny[1] ? matchAny[1] : '';
}

export function resolvePartnerPincode(partner: any): string {
  if (!partner) return '';
  const explicit = extractPincodeFromText(partner.pincode || partner.postalCode || '');
  if (explicit) return explicit;
  const fromAddr = extractPincodeFromText(
    partner.restaurantAddress || partner.shopAddress || partner.address || '',
  );
  if (fromAddr) return fromAddr;
  const fromDigipin = extractPincodeFromText(partner.digipin || '');
  if (fromDigipin) return fromDigipin;
  return '';
}

export function resolveAddressPincode(addr: any): string {
  if (!addr) return '';
  const explicit = extractPincodeFromText(addr.postalCode || addr.pincode || '');
  if (explicit) return explicit;
  const fromLine = extractPincodeFromText(
    `${addr.line1 || ''} ${addr.line2 || ''} ${addr.locality || ''} ${addr.city || ''}`,
  );
  return fromLine;
}

export async function getServiceablePincodes(): Promise<string[]> {
  try {
    const doc = await Counter.findById(SERVICEABLE_PINCODES_DOC_ID).lean();
    if (doc && Array.isArray(doc.pincodes)) {
      return Array.from(
        new Set(doc.pincodes.map((p) => String(p || '').trim()).filter(Boolean)),
      );
    }

    const seedSet = new Set<string>(DEFAULT_SERVICEABLE_PINCODES);
    const [approvedRests, approvedShops] = await Promise.all([
      Restaurant.find({ isApproved: true }).select('pincode restaurantAddress digipin').lean(),
      Shop.find({ isApproved: true }).select('pincode shopAddress digipin').lean(),
    ]);
    for (const r of approvedRests) {
      const pin = resolvePartnerPincode(r);
      if (pin) seedSet.add(pin);
    }
    for (const s of approvedShops) {
      const pin = resolvePartnerPincode(s);
      if (pin) seedSet.add(pin);
    }

    const initialList = Array.from(seedSet);
    await Counter.findOneAndUpdate(
      { _id: SERVICEABLE_PINCODES_DOC_ID },
      {
        $set: {
          name: SERVICEABLE_PINCODES_DOC_ID,
          counterType: 'settings',
          description: 'Admin-configured serviceable delivery pincodes',
          pincodes: initialList,
        },
        $setOnInsert: { seq: 1000, lastNumber: 1000 },
      },
      { upsert: true, returnDocument: 'after' },
    );
    return initialList;
  } catch (err) {
    console.error('getServiceablePincodes error:', err);
    return [...DEFAULT_SERVICEABLE_PINCODES];
  }
}

export async function addServiceablePincodes(
  rawInput: string | string[],
): Promise<{ added: string[]; pincodes: string[] }> {
  const current = await getServiceablePincodes();
  const tokens = Array.isArray(rawInput)
    ? rawInput
    : String(rawInput || '').split(/[\s,;]+/);

  const validNew: string[] = [];
  for (const tok of tokens) {
    const clean = String(tok || '').trim();
    if (!clean) continue;
    if (!/^\d{5,6}$/.test(clean)) {
      throw new Error(`Invalid pincode "${clean}". Pincode must be a 5 or 6 digit number (e.g. 560001).`);
    }
    validNew.push(clean);
  }

  if (!validNew.length) {
    throw new Error('Please provide at least one valid 6-digit pincode.');
  }

  const updatedSet = new Set(current);
  const newlyAdded: string[] = [];
  for (const pin of validNew) {
    if (!updatedSet.has(pin)) {
      updatedSet.add(pin);
      newlyAdded.push(pin);
    }
  }

  const pincodes = Array.from(updatedSet);
  await Counter.findOneAndUpdate(
    { _id: SERVICEABLE_PINCODES_DOC_ID },
    {
      $set: {
        name: SERVICEABLE_PINCODES_DOC_ID,
        counterType: 'settings',
        description: 'Admin-configured serviceable delivery pincodes',
        pincodes,
      },
      $setOnInsert: { seq: 1000, lastNumber: 1000 },
    },
    { upsert: true, returnDocument: 'after' },
  );

  return { added: newlyAdded, pincodes };
}

export async function removeServiceablePincode(
  pincodeToRemove: string,
): Promise<{ pincodes: string[]; unapprovedPartnersCount: number }> {
  const cleanPin = String(pincodeToRemove || '').trim();
  const current = await getServiceablePincodes();
  const pincodes = current.filter((p) => p !== cleanPin);

  await Counter.findOneAndUpdate(
    { _id: SERVICEABLE_PINCODES_DOC_ID },
    {
      $set: {
        name: SERVICEABLE_PINCODES_DOC_ID,
        counterType: 'settings',
        description: 'Admin-configured serviceable delivery pincodes',
        pincodes,
      },
      $setOnInsert: { seq: 1000, lastNumber: 1000 },
    },
    { upsert: true, returnDocument: 'after' },
  );

  // Any approved restaurant or shop whose pincode matches the removed pincode is automatically unapproved so it cannot provide service
  let unapprovedPartnersCount = 0;
  const [rests, shops] = await Promise.all([
    Restaurant.find({ isApproved: true }),
    Shop.find({ isApproved: true }),
  ]);
  for (const r of rests) {
    if (resolvePartnerPincode(r) === cleanPin) {
      r.isApproved = false;
      await r.save();
      unapprovedPartnersCount++;
    }
  }
  for (const s of shops) {
    if (resolvePartnerPincode(s) === cleanPin) {
      s.isApproved = false;
      await s.save();
      unapprovedPartnersCount++;
    }
  }

  return { pincodes, unapprovedPartnersCount };
}



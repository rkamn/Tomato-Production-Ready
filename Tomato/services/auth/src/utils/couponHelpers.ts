import mongoose from 'mongoose';
import Coupon, {
  ICoupon,
  COUPON_TYPE_LABELS,
  ensureDefaultCouponsSeeded,
} from '../model/Coupon.js';
import Order from '../model/Order.js';
import Customer from '../model/Customer.js';
import { FoodItem } from '../model/MenuItem.js';

export const MAX_COUPONS_PER_ORDER = 2;

export interface CartItemInput {
  foodItemId?: string | mongoose.Types.ObjectId;
  itemId?: string;
  _id?: string;
  name: string;
  category?: string;
  quantity: number;
  price: number;
}

export interface AppliedCouponResult {
  couponId: string;
  code: string;
  title: string;
  couponType: string;
  couponTypeLabel: string;
  discountType: 'percentage' | 'flat';
  discountValue: number;
  discountAmount: number;
}

export interface CouponEvaluationSummary {
  valid: boolean;
  message?: string;
  appliedCoupons: AppliedCouponResult[];
  totalDiscount: number;
  rejectedCoupons: Array<{ code: string; reason: string }>;
}

export const doesUserMatchTargetIdentifier = (
  targetIdentifier: string | undefined,
  userContext: {
    userId: string;
    customerId?: string | undefined;
    email?: string | undefined;
    phone?: string | undefined;
    name?: string | undefined;
  },
): boolean => {
  const raw = String(targetIdentifier || '').trim();
  if (!raw) return true; // No specific restriction set

  const tokens = raw
    .split(/[,;\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (!tokens.length) return true;

  const candidates = [
    String(userContext.userId || '').toLowerCase(),
    String(userContext.customerId || '').toLowerCase(),
    String(userContext.email || '').toLowerCase(),
    String(userContext.phone || '').toLowerCase(),
    String(userContext.name || '').toLowerCase(),
  ].filter(Boolean);

  // Also check last 4 chars of userId in `cust-xxxx` format
  if (userContext.userId && userContext.userId.length >= 4) {
    candidates.push(`cust-${userContext.userId.slice(-4).toLowerCase()}`);
  }

  return tokens.some((tok) =>
    candidates.some((cand) => cand === tok || cand.includes(tok)),
  );
};

export const evaluateSingleCoupon = (
  coupon: ICoupon,
  params: {
    userId: string;
    customerId?: string | undefined;
    email?: string | undefined;
    phone?: string | undefined;
    name?: string | undefined;
    previousOrdersCount: number;
    isShopOrder: boolean;
    subtotal: number;
    enrichedItems: Array<{
      name: string;
      category: string;
      quantity: number;
      price: number;
      totalPrice: number;
    }>;
  },
): { eligible: boolean; reason?: string | undefined; discountAmount: number } => {
  const now = new Date();

  if (!coupon.isActive) {
    return {
      eligible: false,
      reason: `Coupon "${coupon.code}" is currently inactive.`,
      discountAmount: 0,
    };
  }

  if (coupon.validFrom && new Date(coupon.validFrom) > now) {
    return {
      eligible: false,
      reason: `Coupon "${coupon.code}" is not active yet.`,
      discountAmount: 0,
    };
  }

  if (coupon.validUntil && new Date(coupon.validUntil) < now) {
    return {
      eligible: false,
      reason: `Coupon "${coupon.code}" has expired.`,
      discountAmount: 0,
    };
  }

  if (coupon.totalUsageLimit > 0 && coupon.usedCount >= coupon.totalUsageLimit) {
    return {
      eligible: false,
      reason: `Coupon "${coupon.code}" has reached its maximum redemption limit.`,
      discountAmount: 0,
    };
  }

  if (coupon.usageLimitPerUser > 0) {
    const userUses = (coupon.usedBy || []).filter(
      (u) => String(u.userId) === String(params.userId),
    ).length;
    if (userUses >= coupon.usageLimitPerUser) {
      return {
        eligible: false,
        reason: `You have already used coupon "${coupon.code}" the maximum allowed times (${coupon.usageLimitPerUser}).`,
        discountAmount: 0,
      };
    }
  }

  // Store type validation
  if (coupon.applicableStoreType === 'restaurant' && params.isShopOrder) {
    return {
      eligible: false,
      reason: `Coupon "${coupon.code}" is valid only on Restaurant orders.`,
      discountAmount: 0,
    };
  }
  if (
    (coupon.applicableStoreType === 'shop' || coupon.couponType === 'shop') &&
    !params.isShopOrder
  ) {
    return {
      eligible: false,
      reason: `Coupon "${coupon.code}" is valid only on Retail Shop orders.`,
      discountAmount: 0,
    };
  }

  // Minimum order amount check
  if (coupon.minOrderAmount > 0 && params.subtotal < coupon.minOrderAmount) {
    return {
      eligible: false,
      reason: `Minimum order subtotal of ₹${coupon.minOrderAmount} is required for "${coupon.code}" (Current: ₹${params.subtotal.toFixed(2)}).`,
      discountAmount: 0,
    };
  }

  // Specific couponType validations
  if (coupon.couponType === 'new_user') {
    if (params.previousOrdersCount > 0) {
      return {
        eligible: false,
        reason: `Coupon "${coupon.code}" is valid only for New Users on their first order.`,
        discountAmount: 0,
      };
    }
  }

  if (
    coupon.couponType === 'specific_user' ||
    (coupon.couponType === 'settlement' &&
      String(coupon.targetUserIdentifier || '').trim())
  ) {
    const matched = doesUserMatchTargetIdentifier(coupon.targetUserIdentifier, {
      userId: params.userId,
      customerId: params.customerId,
      email: params.email,
      phone: params.phone,
      name: params.name,
    });
    if (!matched) {
      return {
        eligible: false,
        reason: `Coupon "${coupon.code}" is assigned to a specific user account (${coupon.targetUserIdentifier}).`,
        discountAmount: 0,
      };
    }
  }

  // Category matching for restaurant_item_category, grocery, or any coupon with targetItemCategory
  let eligibleSubtotal = params.subtotal;
  const targetCat = String(coupon.targetItemCategory || '')
    .trim()
    .toLowerCase();

  if (coupon.couponType === 'restaurant_item_category' && targetCat) {
    const matchingItems = params.enrichedItems.filter((it) => {
      const iCat = (it.category || '').toLowerCase();
      const iName = (it.name || '').toLowerCase();
      return (
        iCat.includes(targetCat) ||
        targetCat.includes(iCat) ||
        iName.includes(targetCat)
      );
    });
    if (!matchingItems.length) {
      return {
        eligible: false,
        reason: `Coupon "${coupon.code}" requires items from category "${coupon.targetItemCategory}" in your cart.`,
        discountAmount: 0,
      };
    }
    eligibleSubtotal = matchingItems.reduce((s, it) => s + it.totalPrice, 0);
  } else if (coupon.couponType === 'grocery') {
    if (!params.isShopOrder && targetCat) {
      const matchingItems = params.enrichedItems.filter((it) => {
        const iCat = (it.category || '').toLowerCase();
        return (
          iCat.includes(targetCat) ||
          iCat.includes('grocer') ||
          iCat.includes('daily') ||
          iCat.includes('produce') ||
          iCat.includes('vegetable') ||
          iCat.includes('fruit')
        );
      });
      if (!matchingItems.length) {
        return {
          eligible: false,
          reason: `Coupon "${coupon.code}" is valid on Grocery & Daily Essentials items.`,
          discountAmount: 0,
        };
      }
      eligibleSubtotal = matchingItems.reduce((s, it) => s + it.totalPrice, 0);
    } else if (targetCat && params.isShopOrder) {
      const matchingItems = params.enrichedItems.filter((it) => {
        const iCat = (it.category || '').toLowerCase();
        const iName = (it.name || '').toLowerCase();
        return (
          !iCat ||
          iCat.includes(targetCat) ||
          targetCat.includes(iCat) ||
          iCat.includes('grocer') ||
          iName.includes(targetCat)
        );
      });
      if (matchingItems.length > 0) {
        eligibleSubtotal = matchingItems.reduce((s, it) => s + it.totalPrice, 0);
      }
    }
  } else if (targetCat) {
    const matchingItems = params.enrichedItems.filter((it) => {
      const iCat = (it.category || '').toLowerCase();
      const iName = (it.name || '').toLowerCase();
      return (
        iCat.includes(targetCat) ||
        targetCat.includes(iCat) ||
        iName.includes(targetCat)
      );
    });
    if (!matchingItems.length) {
      return {
        eligible: false,
        reason: `Coupon "${coupon.code}" requires "${coupon.targetItemCategory}" items in your cart.`,
        discountAmount: 0,
      };
    }
    eligibleSubtotal = matchingItems.reduce((s, it) => s + it.totalPrice, 0);
  }

  let rawDiscount = 0;
  if (coupon.discountType === 'percentage') {
    rawDiscount = (eligibleSubtotal * Number(coupon.discountValue || 0)) / 100;
    if (coupon.maxDiscountAmount > 0) {
      rawDiscount = Math.min(rawDiscount, Number(coupon.maxDiscountAmount));
    }
  } else {
    rawDiscount = Number(coupon.discountValue || 0);
    if (coupon.maxDiscountAmount > 0) {
      rawDiscount = Math.min(rawDiscount, Number(coupon.maxDiscountAmount));
    }
  }

  const discountAmount = Math.min(
    eligibleSubtotal,
    Math.max(0, Number(rawDiscount.toFixed(2))),
  );

  return {
    eligible: discountAmount > 0,
    reason:
      discountAmount > 0
        ? undefined
        : `Coupon "${coupon.code}" yields ₹0 discount on current items.`,
    discountAmount,
  };
};

export const evaluateCouponsForCart = async (params: {
  couponCodes: string[];
  userId: string;
  isShopOrder: boolean;
  items: CartItemInput[];
}): Promise<CouponEvaluationSummary> => {
  await ensureDefaultCouponsSeeded();

  const normalizedCodes = Array.from(
    new Set(
      (params.couponCodes || [])
        .map((c) => String(c || '').trim().toUpperCase())
        .filter(Boolean),
    ),
  );

  if (normalizedCodes.length === 0) {
    return {
      valid: true,
      appliedCoupons: [],
      totalDiscount: 0,
      rejectedCoupons: [],
    };
  }

  if (normalizedCodes.length > MAX_COUPONS_PER_ORDER) {
    return {
      valid: false,
      message: `Maximum ${MAX_COUPONS_PER_ORDER} coupons can be availed at a time per order.`,
      appliedCoupons: [],
      totalDiscount: 0,
      rejectedCoupons: normalizedCodes.slice(MAX_COUPONS_PER_ORDER).map((code) => ({
        code,
        reason: `Exceeds limit of ${MAX_COUPONS_PER_ORDER} coupons per order.`,
      })),
    };
  }

  const [customer, previousOrdersCount, couponsInDb] = await Promise.all([
    mongoose.isValidObjectId(params.userId)
      ? Customer.findById(params.userId).lean()
      : null,
    mongoose.isValidObjectId(params.userId)
      ? Order.countDocuments({
          customerId: new mongoose.Types.ObjectId(params.userId),
          status: { $ne: 'cancelled' },
        })
      : 0,
    Coupon.find({ code: { $in: normalizedCodes } }),
  ]);

  // Enrich cart items with category from FoodItem if missing
  const itemIds = (params.items || [])
    .map((it) => String(it.foodItemId || it.itemId || it._id || ''))
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  const dbFoodItems = itemIds.length
    ? await FoodItem.find({ _id: { $in: itemIds } })
        .select('_id name category isShopItem')
        .lean()
    : [];
  const foodMap = new Map<string, any>();
  for (const fi of dbFoodItems) {
    foodMap.set(String(fi._id), fi);
  }

  const enrichedItems = (params.items || []).map((it) => {
    const idStr = String(it.foodItemId || it.itemId || it._id || '');
    const dbItem = foodMap.get(idStr);
    const qty = Math.max(1, Number(it.quantity ?? 1));
    const price = Math.max(0, Number(it.price ?? 0));
    return {
      name: String(it.name || dbItem?.name || '').trim(),
      category: String(it.category || dbItem?.category || 'Main Course').trim(),
      quantity: qty,
      price,
      totalPrice: Number((qty * price).toFixed(2)),
    };
  });

  const subtotal = Number(
    enrichedItems.reduce((s, it) => s + it.totalPrice, 0).toFixed(2),
  );

  const couponByCode = new Map<string, ICoupon>();
  for (const c of couponsInDb) {
    couponByCode.set(String(c.code).toUpperCase(), c);
  }

  const appliedCoupons: AppliedCouponResult[] = [];
  const rejectedCoupons: Array<{ code: string; reason: string }> = [];
  let runningDiscount = 0;

  for (const code of normalizedCodes) {
    const coupon = couponByCode.get(code);
    if (!coupon) {
      rejectedCoupons.push({
        code,
        reason: `Coupon code "${code}" does not exist.`,
      });
      continue;
    }

    const evalRes = evaluateSingleCoupon(coupon, {
      userId: params.userId,
      customerId: (customer as any)?.customerId || '',
      email: customer?.email || '',
      phone: customer?.phone || '',
      name: customer?.name || '',
      previousOrdersCount,
      isShopOrder: params.isShopOrder,
      subtotal,
      enrichedItems,
    });

    if (!evalRes.eligible) {
      rejectedCoupons.push({
        code,
        reason: evalRes.reason || `Coupon "${code}" is not eligible for this order.`,
      });
      continue;
    }

    // Cap combined discount at subtotal
    const remainingSubtotal = Math.max(0, Number((subtotal - runningDiscount).toFixed(2)));
    const finalCouponDiscount = Math.min(evalRes.discountAmount, remainingSubtotal);

    if (finalCouponDiscount <= 0) {
      rejectedCoupons.push({
        code,
        reason: `Order subtotal is already fully discounted.`,
      });
      continue;
    }

    runningDiscount = Number((runningDiscount + finalCouponDiscount).toFixed(2));
    appliedCoupons.push({
      couponId: String(coupon._id),
      code: coupon.code,
      title: coupon.title,
      couponType: coupon.couponType,
      couponTypeLabel: COUPON_TYPE_LABELS[coupon.couponType] || coupon.couponType,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      discountAmount: finalCouponDiscount,
    });
  }

  if (rejectedCoupons.length > 0) {
    return {
      valid: false,
      message: rejectedCoupons.map((r) => r.reason).join(' '),
      appliedCoupons,
      totalDiscount: runningDiscount,
      rejectedCoupons,
    };
  }

  return {
    valid: true,
    appliedCoupons,
    totalDiscount: runningDiscount,
    rejectedCoupons: [],
  };
};

export const recordCouponRedemptions = async (params: {
  appliedCoupons: AppliedCouponResult[];
  userId: string;
  customerCode?: string;
  customerName?: string;
  orderNumber: string;
}) => {
  if (!params.appliedCoupons?.length) return;
  for (const ac of params.appliedCoupons) {
    await Coupon.findOneAndUpdate(
      { code: ac.code },
      {
        $inc: { usedCount: 1 },
        $push: {
          usedBy: {
            userId: params.userId,
            customerCode: params.customerCode || '',
            customerName: params.customerName || 'Customer',
            orderNumber: params.orderNumber,
            discountAmount: ac.discountAmount,
            usedAt: new Date(),
          },
        },
      },
    );
  }
};

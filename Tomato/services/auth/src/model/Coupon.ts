import mongoose, { Document, Schema } from 'mongoose';

export const COUPON_TYPES = [
  'restaurant_item_category',
  'category_occasion',
  'new_user',
  'festival',
  'specific_user',
  'settlement',
  'special_occasion',
  'shop',
  'grocery',
  'instant',
] as const;

export type CouponType = (typeof COUPON_TYPES)[number];

export const SPONSOR_TYPES = ['tomato', 'restaurant', 'shop', 'common'] as const;
export type SponsorType = (typeof SPONSOR_TYPES)[number];

export const SPONSOR_TYPE_LABELS: Record<SponsorType, string> = {
  tomato: 'Tomato Specific (Paid by Tomato)',
  restaurant: 'Restaurant Specific (Paid by Restaurant)',
  shop: 'Shop Specific (Paid by Shop)',
  common: 'Common Coupon (Paid based on Agreement %)',
};

export const COUPON_TYPE_LABELS: Record<CouponType, string> = {
  restaurant_item_category: 'Restaurant Item Category',
  category_occasion: 'Category Occasion',
  new_user: 'New Users',
  festival: 'Festivals',
  specific_user: 'Specific User',
  settlement: 'Settlement',
  special_occasion: 'Special Occasion',
  shop: 'Shop',
  grocery: 'Grocery',
  instant: 'Instant Coupon',
};

export interface ICouponUsage {
  userId: string;
  customerCode?: string;
  customerName?: string;
  orderNumber?: string;
  discountAmount: number;
  usedAt: Date;
}

export interface ICoupon extends Document {
  code: string;
  title: string;
  description: string;
  couponType: CouponType;
  sponsorType: SponsorType;
  partnerId?: mongoose.Types.ObjectId | string | null;
  partnerName?: string;
  discountType: 'percentage' | 'flat';
  discountValue: number;
  maxDiscountAmount: number;
  minOrderAmount: number;
  targetItemCategory?: string;
  occasionName?: string;
  targetUserIdentifier?: string;
  applicableStoreType: 'all' | 'restaurant' | 'shop';
  usageLimitPerUser: number;
  totalUsageLimit: number;
  usedCount: number;
  usedBy: ICouponUsage[];
  validFrom: Date;
  validUntil?: Date | null;
  isActive: boolean;
  isInstant?: boolean;
  isDestroyed?: boolean;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const couponUsageSchema = new Schema<ICouponUsage>(
  {
    userId: { type: String, required: true },
    customerCode: { type: String, default: '' },
    customerName: { type: String, default: '' },
    orderNumber: { type: String, default: '' },
    discountAmount: { type: Number, default: 0 },
    usedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const couponSchema = new Schema<ICoupon>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    couponType: {
      type: String,
      enum: COUPON_TYPES,
      required: true,
      index: true,
    },
    sponsorType: {
      type: String,
      enum: SPONSOR_TYPES,
      default: 'tomato',
      index: true,
    },
    partnerId: {
      type: Schema.Types.Mixed,
      default: null,
      index: true,
    },
    partnerName: {
      type: String,
      default: '',
      trim: true,
    },
    discountType: {
      type: String,
      enum: ['percentage', 'flat'],
      default: 'percentage',
    },
    discountValue: {
      type: Number,
      required: true,
      min: 1,
    },
    maxDiscountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    minOrderAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    targetItemCategory: {
      type: String,
      default: '',
      trim: true,
    },
    occasionName: {
      type: String,
      default: '',
      trim: true,
    },
    targetUserIdentifier: {
      type: String,
      default: '',
      trim: true,
    },
    applicableStoreType: {
      type: String,
      enum: ['all', 'restaurant', 'shop'],
      default: 'all',
    },
    usageLimitPerUser: {
      type: Number,
      default: 1,
      min: 0,
    },
    totalUsageLimit: {
      type: Number,
      default: 0,
      min: 0,
    },
    usedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    usedBy: {
      type: [couponUsageSchema],
      default: [],
    },
    validFrom: {
      type: Date,
      default: Date.now,
    },
    validUntil: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isInstant: {
      type: Boolean,
      default: false,
      index: true,
    },
    isDestroyed: {
      type: Boolean,
      default: false,
      index: true,
    },
    createdBy: {
      type: String,
      default: 'Admin',
    },
  },
  { timestamps: true, collection: 'coupons' },
);

const Coupon = mongoose.model<ICoupon>('Coupon', couponSchema, 'coupons');

export const ensureDefaultCouponsSeeded = async () => {
  try {
    await Coupon.updateMany(
      { $or: [{ sponsorType: { $exists: false } }, { sponsorType: null }] },
      { $set: { sponsorType: 'tomato' } },
    );
    const count = await Coupon.countDocuments();
    if (count > 0) return;

    const futureDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const defaultCoupons = [
      {
        code: 'SWEETS25',
        title: '25% Off on Sweets & Desserts',
        description:
          'Get 25% discount up to ₹120 on Sweets & Desserts restaurant items.',
        couponType: 'restaurant_item_category',
        discountType: 'percentage',
        discountValue: 25,
        maxDiscountAmount: 120,
        minOrderAmount: 149,
        targetItemCategory: 'Sweets',
        applicableStoreType: 'restaurant',
        usageLimitPerUser: 3,
        totalUsageLimit: 500,
        validUntil: futureDate,
        isActive: true,
      },
      {
        code: 'MAINCOURSE20',
        title: '20% Off on Main Course Dishes',
        description:
          'Save 20% up to ₹150 on all Main Course restaurant dishes.',
        couponType: 'restaurant_item_category',
        discountType: 'percentage',
        discountValue: 20,
        maxDiscountAmount: 150,
        minOrderAmount: 199,
        targetItemCategory: 'Main Course',
        applicableStoreType: 'restaurant',
        usageLimitPerUser: 5,
        totalUsageLimit: 1000,
        validUntil: futureDate,
        isActive: true,
      },
      {
        code: 'WEEKENDFEAST',
        title: 'Weekend Feast Category Occasion',
        description: 'Flat ₹75 off on family & weekend feast dining orders.',
        couponType: 'category_occasion',
        discountType: 'flat',
        discountValue: 75,
        maxDiscountAmount: 75,
        minOrderAmount: 299,
        occasionName: 'Weekend Feast',
        targetItemCategory: '',
        applicableStoreType: 'restaurant',
        usageLimitPerUser: 3,
        totalUsageLimit: 500,
        validUntil: futureDate,
        isActive: true,
      },
      {
        code: 'WELCOME100',
        title: 'New User Welcome Offer',
        description: 'Flat ₹100 off on your very first order on Tomato!',
        couponType: 'new_user',
        discountType: 'flat',
        discountValue: 100,
        maxDiscountAmount: 100,
        minOrderAmount: 199,
        occasionName: 'First Order Welcome',
        applicableStoreType: 'all',
        usageLimitPerUser: 1,
        totalUsageLimit: 0,
        validUntil: futureDate,
        isActive: true,
      },
      {
        code: 'FESTIVAL30',
        title: 'Grand Festival Celebration 30% Off',
        description:
          'Celebrate the festive season with 30% off up to ₹200 across restaurants & shops.',
        couponType: 'festival',
        discountType: 'percentage',
        discountValue: 30,
        maxDiscountAmount: 200,
        minOrderAmount: 249,
        occasionName: 'Grand Festival Offer',
        applicableStoreType: 'all',
        usageLimitPerUser: 2,
        totalUsageLimit: 1000,
        validUntil: futureDate,
        isActive: true,
      },
      {
        code: 'VIPUSER50',
        title: 'Exclusive User Reward Coupon',
        description:
          'Special ₹50 discount curated for specific loyal customer accounts.',
        couponType: 'specific_user',
        discountType: 'flat',
        discountValue: 50,
        maxDiscountAmount: 50,
        minOrderAmount: 149,
        targetUserIdentifier: 'cust-1001',
        occasionName: 'VIP Member Reward',
        applicableStoreType: 'all',
        usageLimitPerUser: 2,
        totalUsageLimit: 50,
        validUntil: futureDate,
        isActive: true,
      },
      {
        code: 'SETTLE100',
        title: 'Order Settlement & Goodwill Credit',
        description:
          'Flat ₹100 billing settlement adjustment for previous order/service resolution.',
        couponType: 'settlement',
        discountType: 'flat',
        discountValue: 100,
        maxDiscountAmount: 100,
        minOrderAmount: 99,
        occasionName: 'Billing Settlement Credit',
        targetUserIdentifier: '',
        applicableStoreType: 'all',
        usageLimitPerUser: 1,
        totalUsageLimit: 200,
        validUntil: futureDate,
        isActive: true,
      },
      {
        code: 'SPECIALDAY15',
        title: 'Special Occasion 15% Celebration',
        description:
          '15% discount up to ₹125 for birthdays, anniversaries & special milestones.',
        couponType: 'special_occasion',
        discountType: 'percentage',
        discountValue: 15,
        maxDiscountAmount: 125,
        minOrderAmount: 199,
        occasionName: 'Birthday & Anniversary Special',
        applicableStoreType: 'all',
        usageLimitPerUser: 2,
        totalUsageLimit: 500,
        validUntil: futureDate,
        isActive: true,
      },
      {
        code: 'SHOPMART60',
        title: 'Retail Shop Partner Super Saver',
        description: 'Flat ₹60 off on retail Shop orders above ₹249.',
        couponType: 'shop',
        discountType: 'flat',
        discountValue: 60,
        maxDiscountAmount: 60,
        minOrderAmount: 249,
        occasionName: 'Shop Super Saver',
        applicableStoreType: 'shop',
        usageLimitPerUser: 3,
        totalUsageLimit: 500,
        validUntil: futureDate,
        isActive: true,
      },
      {
        code: 'GROCERY20',
        title: '20% Off on Daily Grocery & Essentials',
        description:
          'Get 20% off up to ₹120 on Fresh Grocery, Fruits, Vegetables & Daily Essentials.',
        couponType: 'grocery',
        discountType: 'percentage',
        discountValue: 20,
        maxDiscountAmount: 120,
        minOrderAmount: 199,
        targetItemCategory: 'Groceries',
        occasionName: 'Daily Grocery Basket',
        applicableStoreType: 'shop',
        usageLimitPerUser: 5,
        totalUsageLimit: 1000,
        validUntil: futureDate,
        isActive: true,
      },
    ];

    await Coupon.insertMany(defaultCoupons);
  } catch (err) {
    console.error('Error seeding default coupons:', err);
  }
};

export default Coupon;

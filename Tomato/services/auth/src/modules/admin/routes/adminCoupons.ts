import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import Coupon, {
  COUPON_TYPES,
  COUPON_TYPE_LABELS,
  CouponType,
  SPONSOR_TYPES,
  SPONSOR_TYPE_LABELS,
  SponsorType,
  ensureDefaultCouponsSeeded,
} from '../../../model/Coupon.js';
import { FoodItem } from '../../../model/MenuItem.js';
import Customer from '../../../model/Customer.js';
import Restaurant from '../../../model/Restaurant.js';
import Shop from '../../../model/Shop.js';
import { AuthenticatedRequest } from '../../../middleware/authenticate.js';

const router = Router();

  // =========================================================================
  // COUPON & DISCOUNT MANAGEMENT (ADMIN PANEL)
  // =========================================================================
  router.get('/coupons', async (_req: Request, res: Response) => {
    try {
      await ensureDefaultCouponsSeeded();
      const [coupons, rawCategories, customers] = await Promise.all([
        Coupon.find().sort({ createdAt: -1 }).lean(),
        FoodItem.distinct('category'),
        Customer.find()
          .select('_id customerId name email phone')
          .sort({ createdAt: -1 })
          .limit(120)
          .lean(),
      ]);

      const defaultCats = [
        'Main Course',
        'Sweets',
        'Starters',
        'Desserts',
        'Biryani',
        'Beverages',
        'Breads',
        'Groceries',
        'Fresh Produce',
        'Dairy & Bakery',
        'Snacks & Packaged',
      ];
      const categorySet = new Set<string>(defaultCats);
      for (const c of rawCategories) {
        if (typeof c === 'string' && c.trim()) {
          categorySet.add(c.trim());
        }
      }

      let activeCoupons = 0;
      let totalRedemptions = 0;
      let totalDiscountGiven = 0;

      for (const c of coupons) {
        if (c.isActive) activeCoupons++;
        totalRedemptions += Number(c.usedCount || 0);
        for (const u of c.usedBy || []) {
          totalDiscountGiven += Number(u.discountAmount || 0);
        }
      }

      return res.json({
        coupons: coupons.map((c) => ({
          ...c,
          id: String(c._id),
          couponTypeLabel: COUPON_TYPE_LABELS[c.couponType] || c.couponType,
          sponsorType: c.sponsorType || 'tomato',
          sponsorTypeLabel:
            SPONSOR_TYPE_LABELS[(c.sponsorType as SponsorType) || 'tomato'] ||
            'Tomato Specific (Paid by Tomato)',
        })),
        summary: {
          totalCoupons: coupons.length,
          activeCoupons,
          inactiveCoupons: coupons.length - activeCoupons,
          totalRedemptions,
          totalDiscountGiven: Number(totalDiscountGiven.toFixed(2)),
          maxCouponsPerOrder: 1,
        },
        categories: Array.from(categorySet),
        customerDirectory: customers.map((cust: any) => ({
          id: String(cust._id),
          customerId:
            cust.customerId ||
            `cust-${String(cust._id).slice(-4).toLowerCase()}`,
          name: cust.name || 'Customer',
          email: cust.email || '',
          phone: cust.phone || '',
        })),
      });
    } catch (error) {
      console.error('Admin coupons fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch coupons' });
    }
  });

  router.post('/coupons', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const body = req.body ?? {};
      const code = String(body.code || '')
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '');
      const title = String(body.title || '').trim();
      const description = String(body.description || '').trim();
      const couponType = String(body.couponType || 'restaurant_item_category') as CouponType;
      const discountType = body.discountType === 'flat' ? 'flat' : 'percentage';
      const discountValue = Number(body.discountValue ?? 0);
      const maxDiscountAmount = Math.max(0, Number(body.maxDiscountAmount ?? 0));
      const minOrderAmount = Math.max(0, Number(body.minOrderAmount ?? 0));
      const targetItemCategory = String(body.targetItemCategory || '').trim();
      const occasionName = String(body.occasionName || '').trim();
      const targetUserIdentifier = String(body.targetUserIdentifier || '').trim();
      const applicableStoreType = ['all', 'restaurant', 'shop'].includes(body.applicableStoreType)
        ? body.applicableStoreType
        : couponType === 'shop' || couponType === 'grocery'
        ? 'shop'
        : couponType === 'restaurant_item_category'
        ? 'restaurant'
        : 'all';
      const sponsorType: SponsorType = body.sponsorType === 'common' ? 'common' : 'tomato';
      const usageLimitPerUser = Math.max(0, Number(body.usageLimitPerUser ?? 1));
      const totalUsageLimit = Math.max(0, Number(body.totalUsageLimit ?? 0));
      const validFrom = body.validFrom ? new Date(body.validFrom) : new Date();
      const validUntil = body.validUntil ? new Date(body.validUntil) : null;
      const isActive = body.isActive !== undefined ? Boolean(body.isActive) : true;

      if (!code || code.length < 3) {
        return res.status(400).json({
          message: 'Coupon code must be at least 3 characters (e.g. DIWALI50, SWEETS20)',
        });
      }
      if (!title) {
        return res.status(400).json({ message: 'Coupon title is required' });
      }
      if (!COUPON_TYPES.includes(couponType)) {
        return res.status(400).json({ message: 'Invalid coupon category/type' });
      }
      if (!discountValue || discountValue <= 0) {
        return res.status(400).json({ message: 'Discount value must be greater than 0' });
      }
      if (discountType === 'percentage' && discountValue > 100) {
        return res.status(400).json({ message: 'Percentage discount cannot exceed 100%' });
      }
      if (couponType === 'specific_user' && !targetUserIdentifier) {
        return res.status(400).json({
          message: 'Please provide the Specific User ID, Email, or Mobile Number for this coupon',
        });
      }

      const existing = await Coupon.findOne({ code });
      if (existing) {
        return res.status(409).json({
          message: `A coupon with code "${code}" already exists`,
        });
      }

      const created = await Coupon.create({
        code,
        title,
        description,
        couponType,
        sponsorType,
        discountType,
        discountValue,
        maxDiscountAmount,
        minOrderAmount,
        targetItemCategory,
        occasionName,
        targetUserIdentifier,
        applicableStoreType,
        usageLimitPerUser,
        totalUsageLimit,
        validFrom,
        validUntil,
        isActive,
        createdBy: (user as any)?.name || user?.role || 'Admin',
      });

      return res.status(201).json({
        message: `Coupon "${created.code}" created successfully`,
        coupon: {
          ...created.toObject(),
          id: String(created._id),
          couponTypeLabel: COUPON_TYPE_LABELS[created.couponType] || created.couponType,
          sponsorType: created.sponsorType || 'tomato',
          sponsorTypeLabel:
            SPONSOR_TYPE_LABELS[(created.sponsorType as SponsorType) || 'tomato'] ||
            'Tomato Specific (Paid by Tomato)',
        },
      });
    } catch (error) {
      console.error('Create coupon failed:', error);
      return res.status(500).json({ message: 'Unable to create coupon' });
    }
  });

  router.put('/coupons/:couponId', async (req: Request, res: Response) => {
    try {
      const couponId = String(req.params.couponId || '');
      if (!mongoose.isValidObjectId(couponId)) {
        return res.status(400).json({ message: 'Valid coupon ID is required' });
      }

      const coupon = await Coupon.findById(couponId);
      if (!coupon) {
        return res.status(404).json({ message: 'Coupon not found' });
      }

      const body = req.body ?? {};
      if (body.code !== undefined) {
        const nextCode = String(body.code || '')
          .trim()
          .toUpperCase()
          .replace(/\s+/g, '');
        if (nextCode && nextCode !== coupon.code) {
          const dup = await Coupon.findOne({ code: nextCode, _id: { $ne: coupon._id } });
          if (dup) {
            return res.status(409).json({ message: `Coupon code "${nextCode}" already exists` });
          }
          coupon.code = nextCode;
        }
      }
      if (body.title !== undefined) coupon.title = String(body.title).trim();
      if (body.description !== undefined) coupon.description = String(body.description).trim();
      if (body.couponType !== undefined && COUPON_TYPES.includes(body.couponType)) {
        coupon.couponType = body.couponType;
      }
      if (body.discountType === 'flat' || body.discountType === 'percentage') {
        coupon.discountType = body.discountType;
      }
      if (body.discountValue !== undefined) {
        coupon.discountValue = Math.max(1, Number(body.discountValue));
      }
      if (body.maxDiscountAmount !== undefined) {
        coupon.maxDiscountAmount = Math.max(0, Number(body.maxDiscountAmount));
      }
      if (body.minOrderAmount !== undefined) {
        coupon.minOrderAmount = Math.max(0, Number(body.minOrderAmount));
      }
      if (body.targetItemCategory !== undefined) {
        coupon.targetItemCategory = String(body.targetItemCategory).trim();
      }
      if (body.occasionName !== undefined) {
        coupon.occasionName = String(body.occasionName).trim();
      }
      if (body.targetUserIdentifier !== undefined) {
        coupon.targetUserIdentifier = String(body.targetUserIdentifier).trim();
      }
      if (
        body.applicableStoreType !== undefined &&
        ['all', 'restaurant', 'shop'].includes(body.applicableStoreType)
      ) {
        coupon.applicableStoreType = body.applicableStoreType;
      }
      if (body.sponsorType !== undefined && (body.sponsorType === 'tomato' || body.sponsorType === 'common')) {
        coupon.sponsorType = body.sponsorType;
      }
      if (body.usageLimitPerUser !== undefined) {
        coupon.usageLimitPerUser = Math.max(0, Number(body.usageLimitPerUser));
      }
      if (body.totalUsageLimit !== undefined) {
        coupon.totalUsageLimit = Math.max(0, Number(body.totalUsageLimit));
      }
      if (body.validFrom !== undefined) {
        coupon.validFrom = body.validFrom ? new Date(body.validFrom) : new Date();
      }
      if (body.validUntil !== undefined) {
        coupon.validUntil = body.validUntil ? new Date(body.validUntil) : null;
      }
      if (body.isActive !== undefined) {
        coupon.isActive = Boolean(body.isActive);
      }

      await coupon.save();
      return res.json({
        message: `Coupon "${coupon.code}" updated successfully`,
        coupon: {
          ...coupon.toObject(),
          id: String(coupon._id),
          couponTypeLabel: COUPON_TYPE_LABELS[coupon.couponType] || coupon.couponType,
          sponsorType: coupon.sponsorType || 'tomato',
          sponsorTypeLabel:
            SPONSOR_TYPE_LABELS[(coupon.sponsorType as SponsorType) || 'tomato'] ||
            'Tomato Specific (Paid by Tomato)',
        },
      });
    } catch (error) {
      console.error('Update coupon failed:', error);
      return res.status(500).json({ message: 'Unable to update coupon' });
    }
  });

  router.delete('/coupons/:couponId', async (req: Request, res: Response) => {
    try {
      const couponId = String(req.params.couponId || '');
      if (!mongoose.isValidObjectId(couponId)) {
        return res.status(400).json({ message: 'Valid coupon ID is required' });
      }
      const deleted = await Coupon.findByIdAndDelete(couponId);
      if (!deleted) {
        return res.status(404).json({ message: 'Coupon not found' });
      }
      return res.json({
        message: `Coupon "${deleted.code}" deleted successfully`,
      });
    } catch (error) {
      console.error('Delete coupon failed:', error);
      return res.status(500).json({ message: 'Unable to delete coupon' });
    }
  });

export default router;

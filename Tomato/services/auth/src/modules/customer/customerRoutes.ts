import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import Address from '../../model/Address.js';
import MenuItem, { FoodItem } from '../../model/MenuItem.js';
import Notification from '../../model/Notification.js';
import Order, { IOrder } from '../../model/Order.js';
import Counter, { getNextCounterValue } from '../../model/Counter.js';
import Restaurant from '../../model/Restaurant.js';
import Shop from '../../model/Shop.js';
import ShopOrder from '../../model/ShopOrder.js';
import Customer from '../../model/Customer.js';
import Review from '../../model/Review.js';
import {
  authenticate,
  AuthenticatedRequest,
  requireRole,
} from '../../middleware/authenticate.js';
import notificationService from '../notification/notificationService.js';
import {
  formatBill,
  buildOrderLiveTrackingData,
} from '../../utils/orderHelpers.js';

const createCustomerRouter = () => {
  const router = express.Router();
  router.use(authenticate, requireRole('customer'));

  router.get('/overview', (req: Request, res: Response) => {
    const user = (req as AuthenticatedRequest).user;
    return res.json({
      role: 'customer',
      title: 'Customer',
      userId: user?.userId,
      message: 'Customer API ready',
    });
  });

  router.get('/notifications', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      await (Notification as any).cleanExpiredAndExcess(user.userId);
      const notifications = await Notification.find({
        userId: user.userId,
        role: 'customer',
      })
        .sort({ createdAt: -1 })
        .limit(15);
      return res.json({ notifications });
    } catch (error) {
      console.error('Customer notification fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch notifications' });
    }
  });

  // 1. View all restaurants
  router.get('/restaurants', async (_req: Request, res: Response) => {
    try {
      const restaurants = await Restaurant.find({
        isBlocked: { $ne: true },
      })
        .select(
          'name restaurantId digipin email phone image restaurantAddress restaurantLocation cuisine isApproved isOpen isOnline',
        )
        .lean();

      return res.json({
        restaurants: restaurants.map((r) => {
          const restId = r.restaurantId || '';
          const displayName = r.name;
          const isOpen = r.isOpen ?? r.isOnline ?? true;
          return {
            id: r._id,
            _id: r._id,
            name: r.name,
            restaurantId: restId,
            displayName,
            digipin: r.digipin || '',
            email: r.email,
            phone: r.phone,
            image: r.image,
            address: r.restaurantAddress || 'Bengaluru Food Quarter',
            location: r.restaurantLocation || { lat: 12.9716, lng: 77.5946 },
            cuisine: r.cuisine || 'North Indian, Continental, Fast Food',
            isApproved: r.isApproved ?? true,
            isOpen,
            isOnline: isOpen,
          };
        }),
      });
    } catch (error) {
      console.error('Fetch restaurants failed:', error);
      return res.status(500).json({ message: 'Unable to fetch restaurants' });
    }
  });

  // 1b. View all shops
  router.get('/shops', async (_req: Request, res: Response) => {
    try {
      const shops = await Shop.find({
        isBlocked: { $ne: true },
      })
        .select(
          'name shopId digipin email phone image shopAddress shopLocation category isApproved isOpen isOnline',
        )
        .lean();

      return res.json({
        shops: shops.map((s) => {
          const shopCode = s.shopId || '';
          const displayName = s.name;
          const isOpen = s.isOpen ?? s.isOnline ?? true;
          return {
            id: s._id,
            _id: s._id,
            name: s.name,
            shopId: shopCode,
            displayName,
            digipin: s.digipin || '',
            email: s.email,
            phone: s.phone,
            image: s.image,
            address: s.shopAddress || 'Bengaluru Retail Hub',
            location: s.shopLocation || { lat: 12.9784, lng: 77.6408 },
            category: s.category || 'Retail, Supermarket & Groceries',
            cuisine: s.category || 'Retail, Supermarket & Groceries',
            isApproved: s.isApproved ?? true,
            isOpen,
            isOnline: isOpen,
          };
        }),
      });
    } catch (error) {
      console.error('Fetch shops failed:', error);
      return res.status(500).json({ message: 'Unable to fetch shops' });
    }
  });

  // 2. View menu items (across restaurants, shops, or specific store)
  router.get('/menu', async (req: Request, res: Response) => {
    try {
      const { restaurantId, shopId, type, category, search } = req.query;
      const query: Record<string, unknown> = { isActive: true };

      if (
        typeof shopId === 'string' &&
        mongoose.isValidObjectId(shopId)
      ) {
        query.restaurantId = new mongoose.Types.ObjectId(shopId);
      } else if (
        typeof restaurantId === 'string' &&
        mongoose.isValidObjectId(restaurantId)
      ) {
        query.restaurantId = new mongoose.Types.ObjectId(restaurantId);
      } else if (type === 'shop') {
        const shops = await Shop.find({ isBlocked: { $ne: true } })
          .select('_id name')
          .lean();
        const shopIds = shops.map((s) => s._id);

        // Check if any shop items exist; if none, seed initial items for the first shop
        const existingShopItems = await FoodItem.countDocuments({
          restaurantId: { $in: shopIds },
        });
        const targetShop = shops[0];
        if (existingShopItems === 0 && targetShop) {
          const initialShopProducts = [
            {
              restaurantId: targetShop._id,
              restaurantName: targetShop.name,
              name: 'Organic Cold-Pressed Almond Milk (500ml)',
              category: 'Dairy & Plant Milks',
              description: 'Fresh unsweetened pure almond milk, zero preservatives.',
              dietary: 'vegan' as const,
              quantity: 25,
              price: 180,
              isActive: true,
            },
            {
              restaurantId: targetShop._id,
              restaurantName: targetShop.name,
              name: 'Artisan Multigrain Sourdough Loaf',
              category: 'Bakery & Fresh Breads',
              description: 'Naturally fermented 24-hour slow-baked crusty artisan bread.',
              dietary: 'veg' as const,
              quantity: 15,
              price: 150,
              isActive: true,
            },
            {
              restaurantId: targetShop._id,
              restaurantName: targetShop.name,
              name: 'Extra Virgin Greek Olive Oil (500ml)',
              category: 'Cooking & Pantry',
              description: 'First cold-pressed unfiltered Koroneiki olive oil.',
              dietary: 'veg' as const,
              quantity: 20,
              price: 420,
              isActive: true,
            },
            {
              restaurantId: targetShop._id,
              restaurantName: targetShop.name,
              name: 'Himalayan Pink Rock Salt (1kg)',
              category: 'Spices & Seasonings',
              description: '100% natural unrefined mineral-rich gourmet pink salt.',
              dietary: 'veg' as const,
              quantity: 50,
              price: 95,
              isActive: true,
            },
            {
              restaurantId: targetShop._id,
              restaurantName: targetShop.name,
              name: 'Farm-Fresh Free-Range Eggs (Pack of 12)',
              category: 'Daily Essentials',
              description: 'Antibiotic-free pasture-raised fresh grade-A brown eggs.',
              dietary: 'non-veg' as const,
              quantity: 40,
              price: 130,
              isActive: true,
            },
            {
              restaurantId: targetShop._id,
              restaurantName: targetShop.name,
              name: 'Organic Rolled Oats (1kg)',
              category: 'Breakfast Cereals',
              description: 'Whole grain gluten-free high-fiber certified organic oats.',
              dietary: 'veg' as const,
              quantity: 30,
              price: 210,
              isActive: true,
            },
          ];
          await FoodItem.insertMany(initialShopProducts);
        }

        query.restaurantId = { $in: shopIds };
      } else if (type === 'restaurant') {
        const restaurants = await Restaurant.find({ isBlocked: { $ne: true } })
          .select('_id')
          .lean();
        query.restaurantId = { $in: restaurants.map((r) => r._id) };
      }

      if (typeof category === 'string' && category.trim()) {
        query.category = new RegExp(category.trim(), 'i');
      }

      if (typeof search === 'string' && search.trim()) {
        query.$or = [
          { name: new RegExp(search.trim(), 'i') },
          { description: new RegExp(search.trim(), 'i') },
          { category: new RegExp(search.trim(), 'i') },
        ];
      }

      const menu = await FoodItem.find(query).sort({ createdAt: -1 }).lean();

      const storeIds = [
        ...new Set(menu.map((m) => String(m.restaurantId)).filter(Boolean)),
      ];

      const productIds = menu.map((m) => m._id);

      const [restaurants, shops, reviewStats] = await Promise.all([
        Restaurant.find({ _id: { $in: storeIds } })
          .select('name restaurantAddress')
          .lean(),
        Shop.find({ _id: { $in: storeIds } })
          .select('name shopAddress')
          .lean(),
        Review.aggregate([
          { $match: { productId: { $in: productIds } } },
          {
            $group: {
              _id: '$productId',
              avgRating: { $avg: '$rating' },
              totalReviews: { $sum: 1 },
            },
          },
        ]),
      ]);

      const restMap = new Map(restaurants.map((r) => [String(r._id), r]));
      const shopMap = new Map(shops.map((s) => [String(s._id), s]));
      const reviewMap = new Map(
        reviewStats.map((stat: any) => [
          String(stat._id),
          {
            rating: Math.round(stat.avgRating * 10) / 10,
            reviewCount: stat.totalReviews,
          },
        ]),
      );

      const enrichedMenu = menu.map((item) => {
        const storeIdStr = String(item.restaurantId);
        const rest = restMap.get(storeIdStr);
        const shop = shopMap.get(storeIdStr);
        const isShop = Boolean(shop);
        const rev = reviewMap.get(String(item._id));

        return {
          ...item,
          rating: rev?.rating ?? null,
          reviewCount: rev?.reviewCount ?? 0,
          restaurantName:
            item.restaurantName ||
            (isShop ? shop?.name : rest?.name) ||
            (isShop ? 'Partner Shop' : 'Partner Kitchen'),
          restaurantAddress:
            (isShop ? shop?.shopAddress : rest?.restaurantAddress) ||
            'Bengaluru Central',
          shopName: shop?.name || (isShop ? item.restaurantName : undefined),
          shopAddress: shop?.shopAddress,
          isShopItem: isShop,
          storeType: isShop ? 'shop' : 'restaurant',
        };
      });

      return res.json({ menu: enrichedMenu });
    } catch (error) {
      console.error('Customer menu fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch menu' });
    }
  });

  // 2b. Get reviews for a specific menu/product item
  router.get('/items/:itemId/reviews', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const itemId = String(req.params.itemId || '');
      const queryName = typeof req.query.name === 'string' ? req.query.name.trim() : '';

      let item: any = mongoose.isValidObjectId(itemId)
        ? await FoodItem.findById(itemId).lean()
        : null;

      if (!item && queryName) {
        item = await FoodItem.findOne({ name: new RegExp(`^${queryName}$`, 'i') }).lean();
      }

      const userObjId = new mongoose.Types.ObjectId(user.userId);

      // Check if this customer has purchased/ordered this item in past non-cancelled orders
      const orderSearchConditions: Record<string, unknown>[] = [];
      if (item) {
        orderSearchConditions.push({ 'items.foodItemId': item._id });
        orderSearchConditions.push({ 'items.name': item.name });
      } else {
        if (mongoose.isValidObjectId(itemId)) {
          orderSearchConditions.push({ 'items.foodItemId': new mongoose.Types.ObjectId(itemId) });
        }
        if (queryName) {
          orderSearchConditions.push({ 'items.name': new RegExp(`^${queryName}$`, 'i') });
        }
      }

      const pastOrder = orderSearchConditions.length
        ? await Order.findOne({
            customerId: userObjId,
            status: { $ne: 'cancelled' },
            $or: orderSearchConditions,
          })
            .sort({ createdAt: -1 })
            .lean()
        : null;

      // If item is not in active catalog but customer ordered it, use snapshot from order
      if (!item && pastOrder) {
        const orderItem = (pastOrder.items || []).find((it: any) =>
          (mongoose.isValidObjectId(itemId) && String(it.foodItemId) === itemId) ||
          (queryName && String(it.name || '').toLowerCase() === queryName.toLowerCase())
        );
        if (orderItem) {
          item = {
            _id: orderItem.foodItemId || (mongoose.isValidObjectId(itemId) ? new mongoose.Types.ObjectId(itemId) : new mongoose.Types.ObjectId()),
            name: orderItem.name,
            price: orderItem.price,
            category: 'Ordered Dish',
            restaurantId: pastOrder.restaurantId,
            restaurantName: pastOrder.restaurantName,
          };
        }
      }

      if (!item) {
        return res.status(404).json({ message: 'Product or food item not found' });
      }

      const targetProductId = item._id;
      const rawReviews = await Review.find({
        $or: [
          { productId: targetProductId },
          { productName: item.name },
        ],
      })
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean();

      // Multiple users can review the same product.
      // If the same user submitted or updated their review, keep only their latest overridden review.
      const seenCustomerIds = new Set<string>();
      const reviews: any[] = [];
      for (const r of rawReviews) {
        const custIdStr = String(r.customerId);
        if (!seenCustomerIds.has(custIdStr)) {
          seenCustomerIds.add(custIdStr);
          reviews.push(r);
        }
      }

      const totalReviews = reviews.length;
      const averageRating = totalReviews
        ? Math.round(
            (reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / totalReviews) *
              10,
          ) / 10
        : null;

      const ratingDistribution: Record<number, number> = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      for (const r of reviews) {
        const star = Math.min(5, Math.max(1, Math.round(r.rating || 0)));
        ratingDistribution[star] = (ratingDistribution[star] || 0) + 1;
      }

      const canReview = Boolean(pastOrder);
      const userReview =
        reviews.find((r) => String(r.customerId) === String(user.userId)) ||
        null;

      return res.json({
        item: {
          id: item._id,
          _id: item._id,
          name: item.name,
          category: item.category,
          price: item.price,
          image: item.image,
          restaurantName: item.restaurantName,
        },
        reviews,
        totalReviews,
        averageRating,
        ratingDistribution,
        canReview,
        cannotReviewReason: canReview
          ? null
          : 'You can only review and rate items you have ordered in the past.',
        userReview,
        verifiedOrder: pastOrder
          ? {
              orderId: pastOrder._id,
              orderNumber: pastOrder.orderNumber,
              createdAt: pastOrder.createdAt,
            }
          : null,
      });
    } catch (error) {
      console.error('Fetch item reviews failed:', error);
      return res.status(500).json({ message: 'Unable to fetch reviews' });
    }
  });

  // 2c. Submit or update review for an item (verified order required)
  router.post('/items/:itemId/reviews', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const itemId = String(req.params.itemId || '');
      const bodyName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';

      const rating = Number(req.body?.rating);
      if (isNaN(rating) || rating < 1 || rating > 5) {
        return res
          .status(400)
          .json({ message: 'Rating must be an integer between 1 and 5' });
      }

      const comment =
        typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';

      let item: any = mongoose.isValidObjectId(itemId)
        ? await FoodItem.findById(itemId).lean()
        : null;

      if (!item && bodyName) {
        item = await FoodItem.findOne({ name: new RegExp(`^${bodyName}$`, 'i') }).lean();
      }

      const userObjId = new mongoose.Types.ObjectId(user.userId);
      const orderSearchConditions: Record<string, unknown>[] = [];
      if (item) {
        orderSearchConditions.push({ 'items.foodItemId': item._id });
        orderSearchConditions.push({ 'items.name': item.name });
      } else {
        if (mongoose.isValidObjectId(itemId)) {
          orderSearchConditions.push({ 'items.foodItemId': new mongoose.Types.ObjectId(itemId) });
        }
        if (bodyName) {
          orderSearchConditions.push({ 'items.name': new RegExp(`^${bodyName}$`, 'i') });
        }
      }

      const pastOrder = orderSearchConditions.length
        ? await Order.findOne({
            customerId: userObjId,
            status: { $ne: 'cancelled' },
            $or: orderSearchConditions,
          })
            .sort({ createdAt: -1 })
            .lean()
        : null;

      if (!item && pastOrder) {
        const orderItem = (pastOrder.items || []).find((it: any) =>
          (mongoose.isValidObjectId(itemId) && String(it.foodItemId) === itemId) ||
          (bodyName && String(it.name || '').toLowerCase() === bodyName.toLowerCase())
        );
        if (orderItem) {
          item = {
            _id: orderItem.foodItemId || (mongoose.isValidObjectId(itemId) ? new mongoose.Types.ObjectId(itemId) : new mongoose.Types.ObjectId()),
            name: orderItem.name,
            price: orderItem.price,
            category: 'Ordered Dish',
            restaurantId: pastOrder.restaurantId,
            restaurantName: pastOrder.restaurantName,
          };
        }
      }

      if (!item) {
        return res.status(404).json({ message: 'Product or food item not found' });
      }

      if (!pastOrder) {
        return res.status(403).json({
          message:
            'Verified purchase required: You can only review products you have ordered in the past.',
        });
      }

      const customer = await Customer.findById(user.userId).lean();
      const customerName =
        customer?.name || (user as any).name || 'Customer';

      // Check if this customer already reviewed this product (by productId or productName)
      const existingReview = await Review.findOne({
        customerId: userObjId,
        $or: [
          { productId: item._id },
          { productName: new RegExp(`^${String(item.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        ],
      });

      let review;
      let isOverride = false;

      if (existingReview) {
        // OVERRIDE the user's previous review
        isOverride = true;
        existingReview.productId = item._id;
        existingReview.productName = item.name;
        if (item.restaurantId) existingReview.storeId = item.restaurantId;
        if (item.restaurantName) existingReview.storeName = item.restaurantName;
        existingReview.storeType = (item as any).isShopItem ? 'shop' : 'restaurant';
        existingReview.customerName = customerName;
        existingReview.rating = Math.round(rating);
        existingReview.comment = comment;
        existingReview.orderId = pastOrder._id;
        existingReview.orderNumber = pastOrder.orderNumber;
        review = await existingReview.save();
      } else {
        // Create new review for this user
        review = await Review.create({
          productId: item._id,
          productName: item.name,
          storeId: item.restaurantId,
          storeName: item.restaurantName || '',
          storeType: (item as any).isShopItem ? 'shop' : 'restaurant',
          customerId: userObjId,
          customerName,
          rating: Math.round(rating),
          comment,
          orderId: pastOrder._id,
          orderNumber: pastOrder.orderNumber,
        });
      }

      // Clean up any historical duplicate entries for this customer on this product to ensure exactly 1 review per user
      await Review.deleteMany({
        _id: { $ne: review._id },
        customerId: userObjId,
        $or: [
          { productId: item._id },
          { productName: new RegExp(`^${String(item.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        ],
      });

      return res.status(200).json({
        message: isOverride
          ? 'Your review has been updated and overridden!'
          : 'Review saved successfully!',
        review,
      });
    } catch (error) {
      console.error('Submit review failed:', error);
      return res.status(500).json({ message: 'Unable to submit review' });
    }
  });

  // 2d. Get current customer's reviews
  router.get('/reviews/my-reviews', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const reviews = await Review.find({
        customerId: new mongoose.Types.ObjectId(user.userId),
      })
        .sort({ updatedAt: -1 })
        .lean();

      return res.json({ reviews });
    } catch (error) {
      console.error('Customer my-reviews fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch your reviews' });
    }
  });

  // 3. Addresses
  router.get('/addresses', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const addresses = await Address.find({ userId: user.userId }).sort({
        isDefault: -1,
        createdAt: -1,
      });
      return res.json({ addresses });
    } catch (error) {
      console.error('Customer address fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch addresses' });
    }
  });

  router.post('/addresses', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });

      const payload = req.body ?? {};
      const label =
        typeof payload.label === 'string' ? payload.label.trim() : 'Home';
      const line1 =
        typeof payload.line1 === 'string' ? payload.line1.trim() : '';
      const city = typeof payload.city === 'string' ? payload.city.trim() : '';
      const phone =
        typeof payload.phone === 'string' ? payload.phone.trim() : '';
      const state =
        typeof payload.state === 'string' ? payload.state.trim() : '';
      const postalCode =
        typeof payload.postalCode === 'string' ? payload.postalCode.trim() : '';
      const line2 =
        typeof payload.line2 === 'string' ? payload.line2.trim() : '';
      const locality =
        typeof payload.locality === 'string' ? payload.locality.trim() : '';
      const isDefault = Boolean(payload.isDefault);
      const coordinates =
        Array.isArray(payload.coordinates) && payload.coordinates.length === 2
          ? [Number(payload.coordinates[0]), Number(payload.coordinates[1])]
          : [77.5946, 12.9716];

      if (!line1 || !city) {
        return res
          .status(400)
          .json({ message: 'Address line and city are required' });
      }

      const existingCount = await Address.countDocuments({
        userId: user.userId,
      });
      const shouldBeDefault = isDefault || existingCount === 0;

      if (shouldBeDefault) {
        await Address.updateMany(
          { userId: user.userId },
          { $set: { isDefault: false } },
        );
      }

      const address = await Address.create({
        userId: user.userId,
        label: label || 'Home',
        line1,
        line2,
        locality,
        city,
        state,
        postalCode,
        phone: phone || undefined,
        isDefault: shouldBeDefault,
        location: {
          type: 'Point',
          coordinates: coordinates as [number, number],
        },
      });

      return res.status(201).json({ message: 'Address saved', address });
    } catch (error) {
      console.error('Customer address save failed:', error);
      return res.status(500).json({ message: 'Unable to save address' });
    }
  });

  router.put('/addresses/:addressId', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const addressId = String(req.params.addressId || '');
      if (!addressId || !mongoose.isValidObjectId(addressId)) {
        return res
          .status(400)
          .json({ message: 'Valid address ID is required' });
      }

      const payload = req.body ?? {};
      const update: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(payload)) {
        if (value !== undefined && value !== null && value !== '') {
          update[key] = value;
        }
      }

      if (update.isDefault === true) {
        await Address.updateMany(
          { userId: user.userId },
          { $set: { isDefault: false } },
        );
      }

      const address = await Address.findOneAndUpdate(
        { _id: new mongoose.Types.ObjectId(addressId), userId: user.userId },
        { $set: update },
        { new: true, runValidators: true },
      );

      if (!address)
        return res.status(404).json({ message: 'Address not found' });
      return res.json({ message: 'Address updated', address });
    } catch (error) {
      console.error('Customer address update failed:', error);
      return res.status(500).json({ message: 'Unable to update address' });
    }
  });

  // Set address as default
  router.post(
    '/addresses/:addressId/default',
    async (req: Request, res: Response) => {
      try {
        const user = (req as AuthenticatedRequest).user;
        if (!user?.userId)
          return res.status(401).json({ message: 'Authentication required' });
        const addressId = String(req.params.addressId || '');
        if (!addressId || !mongoose.isValidObjectId(addressId)) {
          return res
            .status(400)
            .json({ message: 'Valid address ID is required' });
        }

        await Address.updateMany(
          { userId: user.userId },
          { $set: { isDefault: false } },
        );
        const address = await Address.findOneAndUpdate(
          { _id: new mongoose.Types.ObjectId(addressId), userId: user.userId },
          { $set: { isDefault: true } },
          { new: true },
        );

        if (!address)
          return res.status(404).json({ message: 'Address not found' });
        return res.json({
          message: 'Default delivery address updated successfully',
          address,
        });
      } catch (error) {
        console.error('Customer set default address failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to set default address' });
      }
    },
  );

  router.delete(
    '/addresses/:addressId',
    async (req: Request, res: Response) => {
      try {
        const user = (req as AuthenticatedRequest).user;
        if (!user?.userId)
          return res.status(401).json({ message: 'Authentication required' });
        const addressId = String(req.params.addressId || '');
        if (!addressId || !mongoose.isValidObjectId(addressId)) {
          return res
            .status(400)
            .json({ message: 'Valid address ID is required' });
        }

        const deleted = await Address.findOneAndDelete({
          _id: new mongoose.Types.ObjectId(addressId),
          userId: user.userId,
        });
        if (!deleted)
          return res.status(404).json({ message: 'Address not found' });

        // If deleted was default, promote another address to default
        if (deleted.isDefault) {
          const remaining = await Address.findOne({ userId: user.userId }).sort(
            { createdAt: -1 },
          );
          if (remaining) {
            remaining.isDefault = true;
            await remaining.save();
          }
        }

        return res.json({ message: 'Address removed successfully' });
      } catch (error) {
        console.error('Address delete failed:', error);
        return res.status(500).json({ message: 'Unable to delete address' });
      }
    },
  );

  // 4. Payment Gateway integration endpoint
  router.post('/payment/process', async (req: Request, res: Response) => {
    try {
      const { amount, paymentMethod, cardDetails, upiId } = req.body;
      const numAmount = Number(amount);

      if (!numAmount || numAmount <= 0) {
        return res
          .status(400)
          .json({ message: 'Valid payment amount is required' });
      }

      const method = ['card', 'upi', 'netbanking', 'cod'].includes(
        paymentMethod,
      )
        ? paymentMethod
        : 'card';

      if (method === 'card') {
        const cardNumber = String(cardDetails?.number || '').replace(
          /\s+/g,
          '',
        );
        if (cardNumber.length < 12) {
          return res.status(400).json({ message: 'Invalid card number' });
        }
      } else if (method === 'upi') {
        const upi = String(upiId || '').trim();
        if (!upi || !upi.includes('@')) {
          return res
            .status(400)
            .json({ message: 'Invalid UPI ID format (e.g. name@okhdfcbank)' });
        }
      }

      const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      return res.json({
        success: true,
        message: 'Payment verified and approved by payment gateway',
        transactionId,
        paymentMethod: method,
        amount: numAmount,
        currency: 'INR',
        paidAt: new Date(),
      });
    } catch (error) {
      console.error('Payment gateway process failed:', error);
      return res
        .status(500)
        .json({ message: 'Payment gateway transaction failed' });
    }
  });

  // 5. Place order to restaurant with payment info
  router.post('/orders', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });

      const customer = await Customer.findById(user.userId).lean();
      const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!rawItems.length)
        return res.status(400).json({ message: 'Order items are required' });

      interface SanitizedOrderItem {
        foodItemId: mongoose.Types.ObjectId;
        name: string;
        quantity: number;
        price: number;
        totalPrice: number;
      }

      const sanitizedItems: SanitizedOrderItem[] = rawItems
        .map((entry: Record<string, unknown>): SanitizedOrderItem => {
          const foodItemId = String(
            entry.foodItemId || entry.itemId || entry._id || '',
          );
          const name = typeof entry.name === 'string' ? entry.name.trim() : '';
          const quantity = Number(entry.quantity ?? 1);
          const price = Number(entry.price ?? 0);
          return {
            foodItemId: mongoose.isValidObjectId(foodItemId)
              ? new mongoose.Types.ObjectId(foodItemId)
              : new mongoose.Types.ObjectId(),
            name,
            quantity,
            price,
            totalPrice: quantity * price,
          };
        })
        .filter(
          (item: SanitizedOrderItem) =>
            Boolean(item.name) && item.quantity > 0 && item.price >= 0,
        );

      if (!sanitizedItems.length) {
        return res
          .status(400)
          .json({ message: 'Valid food items are required' });
      }

      const subtotal = sanitizedItems.reduce<number>(
        (sum: number, item: SanitizedOrderItem) => sum + item.totalPrice,
        0,
      );
      const tax = Number((subtotal * 0.05).toFixed(2));
      const deliveryFee = 40;
      const totalAmount = Number((subtotal + tax + deliveryFee).toFixed(2));

      const restaurantIdStr =
        typeof req.body?.restaurantId === 'string' ? req.body.restaurantId : '';
      const shopIdStr =
        typeof req.body?.shopId === 'string' ? req.body.shopId : '';
      const isExplicitShop = Boolean(req.body?.isShopOrder);

      let restaurantUser: any = null;
      let shopUser: any = null;
      let isShopOrder = isExplicitShop;

      // 1. Resolve explicit shopId if provided
      if (shopIdStr && mongoose.isValidObjectId(shopIdStr)) {
        shopUser = await Shop.findById(shopIdStr);
        if (shopUser) isShopOrder = true;
      }

      // 2. Resolve restaurantIdStr (which might be a restaurant or a shop)
      if (!shopUser && restaurantIdStr && mongoose.isValidObjectId(restaurantIdStr)) {
        restaurantUser = await Restaurant.findById(restaurantIdStr);
        if (!restaurantUser) {
          shopUser = await Shop.findById(restaurantIdStr);
          if (shopUser) isShopOrder = true;
        }
      }

      // 3. Fallback to first item's store if neither provided
      if (!restaurantUser && !shopUser && sanitizedItems[0]) {
        const itemDoc = await FoodItem.findById(sanitizedItems[0].foodItemId);
        if (itemDoc?.restaurantId) {
          restaurantUser = await Restaurant.findById(itemDoc.restaurantId);
          if (!restaurantUser) {
            shopUser = await Shop.findById(itemDoc.restaurantId);
            if (shopUser) isShopOrder = true;
          }
        }
      }

      if (isShopOrder) {
        if (!shopUser) {
          shopUser = await Shop.findOne({ isBlocked: { $ne: true } });
        }
        if (
          shopUser &&
          (shopUser.isOpen === false || shopUser.isOnline === false)
        ) {
          return res.status(400).json({
            message: `${shopUser.name} is currently closed and not accepting orders. Please choose another shop or try again later.`,
          });
        }
      } else {
        if (!restaurantUser) {
          restaurantUser = await Restaurant.findOne({ isBlocked: { $ne: true } });
        }
        if (
          restaurantUser &&
          (restaurantUser.isOpen === false || restaurantUser.isOnline === false)
        ) {
          return res.status(400).json({
            message: `${restaurantUser.name} is currently closed and not accepting orders. Please choose another restaurant or try again later.`,
          });
        }
      }

      const storeId = isShopOrder
        ? (shopUser?._id as mongoose.Types.ObjectId)
        : restaurantUser
        ? (restaurantUser._id as mongoose.Types.ObjectId)
        : undefined;
      const storeCode = isShopOrder
        ? (shopUser?.shopId || 'shop-1001')
        : (restaurantUser?.restaurantId || '');
      const digipin = isShopOrder
        ? (shopUser?.digipin || '')
        : (restaurantUser?.digipin || '');
      const storeName = isShopOrder
        ? (shopUser?.name || 'Tomato Partner Shop')
        : (restaurantUser ? restaurantUser.name : 'Tomato Partner Restaurant');
      const storeAddress = isShopOrder
        ? (shopUser?.shopAddress || '45 CMH Road, Indiranagar, Bengaluru, 560038')
        : (restaurantUser?.restaurantAddress || '12 Indiranagar 100ft Road, Bengaluru, 560038');
      const storeLocation = isShopOrder
        ? (shopUser?.shopLocation || { lat: 12.9784, lng: 77.6408 })
        : (restaurantUser?.restaurantLocation || { lat: 12.9716, lng: 77.5946 });

      let deliveryAddress = req.body?.deliveryAddress;
      const addressId = req.body?.addressId;

      if (!deliveryAddress || !deliveryAddress.line1) {
        const savedAddress =
          (addressId && mongoose.isValidObjectId(addressId)
            ? await Address.findOne({
                _id: new mongoose.Types.ObjectId(addressId),
                userId: user.userId,
              }).lean()
            : null) ||
          (await Address.findOne({
            userId: user.userId,
            isDefault: true,
          }).lean()) ||
          (await Address.findOne({ userId: user.userId }).lean());

        if (savedAddress) {
          deliveryAddress = {
            label: savedAddress.label || 'Home',
            phone: savedAddress.phone || customer?.phone || '',
            line1: savedAddress.line1,
            line2: savedAddress.line2 || '',
            city: savedAddress.city,
            state: savedAddress.state || '',
            postalCode: savedAddress.postalCode || '',
            coordinates: savedAddress.location?.coordinates || [
              77.5946, 12.9716,
            ],
          };
        } else {
          deliveryAddress = {
            label: 'Home',
            phone: customer?.phone || '+91 99000 00001',
            line1: 'Customer delivery address',
            city: 'Bengaluru',
            postalCode: '560001',
            coordinates: [77.5946, 12.9716],
          };
        }
      }

      const paymentMethod = ['card', 'upi', 'netbanking', 'cod'].includes(
        req.body?.paymentMethod,
      )
        ? req.body.paymentMethod
        : 'card';
      const paymentTransactionId =
        req.body?.paymentTransactionId ||
        (paymentMethod === 'cod'
          ? 'COD-PAY-ON-DELIVERY'
          : `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`);
      const paymentStatus = paymentMethod === 'cod' ? 'pending' : 'paid';

      const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const orderNumberSuffix = await getNextCounterValue(
        `orderId_${dateStr}`,
        1000,
      );
      await getNextCounterValue('orderId', 1000);
      const prefix = isShopOrder ? 'SHOP' : 'TOM';
      const orderNumber = `${prefix}-${dateStr}-${orderNumberSuffix}`;
      const billNumber = `BILL-${prefix}-${dateStr}-${orderNumberSuffix}`;

      const orderData: Record<string, unknown> = {
        orderNumber,
        billNumber,
        customerId: new mongoose.Types.ObjectId(user.userId),
        customerName: customer?.name || 'Customer',
        customerPhone: customer?.phone || '',
        restaurantCode: storeCode,
        digipin,
        restaurantName: storeName,
        restaurantAddress: storeAddress,
        restaurantLocation: storeLocation,
        items: sanitizedItems,
        subtotal,
        tax,
        deliveryFee,
        totalAmount,
        deliveryAddress,
        paymentStatus,
        paymentMethod,
        paymentTransactionId,
        status: 'placed',
        statusHistory: [
          {
            status: 'placed',
            at: new Date(),
            by: String(user.userId),
            note: `Order placed to ${isShopOrder ? 'shop' : 'restaurant'} and paid via ${paymentMethod.toUpperCase()}`,
          },
        ],
      };

      if (storeId) {
        orderData.restaurantId = storeId;
      }
      if (paymentStatus === 'paid') {
        orderData.paidAt = new Date();
      }

      const order = (await Order.create(orderData)) as unknown as IOrder;

      // If this is a shop order, also create in ShopOrder collection & notify shop
      if (isShopOrder && shopUser) {
        await ShopOrder.create({
          orderNumber,
          billNumber,
          customerId: new mongoose.Types.ObjectId(user.userId),
          customerName: customer?.name || 'Customer',
          customerPhone: customer?.phone || '',
          shopId: shopUser._id,
          shopCode: storeCode,
          digipin,
          shopName: storeName,
          shopAddress: storeAddress,
          shopLocation: storeLocation,
          items: sanitizedItems,
          subtotal,
          tax,
          deliveryFee,
          totalAmount,
          deliveryAddress,
          paymentStatus,
          paymentMethod,
          paymentTransactionId,
          status: 'placed',
          statusHistory: [
            {
              status: 'placed',
              at: new Date(),
              by: String(user.userId),
              note: `Order placed to shop and paid via ${paymentMethod.toUpperCase()}`,
            },
          ],
          ...(paymentStatus === 'paid' ? { paidAt: new Date() } : {}),
        });

        await Notification.create({
          userId: shopUser._id,
          role: 'shop',
          title: 'New Customer Order Received',
          message: `New Order #${orderNumber} received for ₹${totalAmount} from ${customer?.name || 'Customer'}.`,
          type: 'order',
          entityId: String(order._id),
        });
      } else {
        await notificationService.notifyRestaurantOnOrderPlaced(order);
      }

      return res.status(201).json({
        message: isShopOrder
          ? 'Order placed successfully and sent to shop'
          : 'Order placed successfully and sent to restaurant',
        order,
      });
    } catch (error) {
      console.error('Customer order placement failed:', error);
      return res.status(500).json({ message: 'Unable to place order' });
    }
  });

  // 6. Customer order history & live tracking
  router.get('/orders', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });

      const orders = await Order.find({
        customerId: new mongoose.Types.ObjectId(user.userId),
      }).sort({ createdAt: -1 });
      return res.json({ orders });
    } catch (error) {
      console.error('Customer orders fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch orders' });
    }
  });

  router.get('/orders/:orderId', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const orderId = String(req.params.orderId || '');
      if (!orderId || !mongoose.isValidObjectId(orderId)) {
        return res.status(400).json({ message: 'Valid order ID is required' });
      }

      const order = await Order.findOne({
        _id: new mongoose.Types.ObjectId(orderId),
        customerId: new mongoose.Types.ObjectId(user.userId),
      });
      if (!order) return res.status(404).json({ message: 'Order not found' });
      return res.json({ order });
    } catch (error) {
      console.error('Customer order detail fetch failed:', error);
      return res.status(500).json({ message: 'Unable to fetch order detail' });
    }
  });

  // 7. Customer bill view
  router.get('/orders/:orderId/bill', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });
      const orderId = String(req.params.orderId || '');
      if (!orderId || !mongoose.isValidObjectId(orderId)) {
        return res.status(400).json({ message: 'Valid order ID is required' });
      }

      const order = await Order.findOne({
        _id: new mongoose.Types.ObjectId(orderId),
        customerId: new mongoose.Types.ObjectId(user.userId),
      });
      if (!order) return res.status(404).json({ message: 'Order not found' });

      const [restaurantUser, customerUser] = await Promise.all([
        order.restaurantId
          ? await Restaurant.findById(order.restaurantId).lean()
          : null,
        order.customerId
          ? await Customer.findById(order.customerId).lean()
          : null,
      ]);

      const bill = formatBill(
        order,
        restaurantUser as any,
        customerUser as any,
      );
      return res.json({ bill });
    } catch (error) {
      console.error('Customer bill fetch failed:', error);
      return res.status(500).json({ message: 'Unable to generate bill' });
    }
  });

  // 8. Customer live tracking of assigned rider and order
  router.get(
    '/orders/:orderId/live-tracking',
    async (req: Request, res: Response) => {
      try {
        const user = (req as AuthenticatedRequest).user;
        if (!user?.userId)
          return res.status(401).json({ message: 'Authentication required' });
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
        console.error('Customer live tracking fetch failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to fetch live tracking' });
      }
    },
  );

  return router;
};

export const customerRoutes = createCustomerRouter();
export default customerRoutes;

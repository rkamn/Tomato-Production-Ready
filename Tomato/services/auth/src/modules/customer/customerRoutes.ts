import express, { Request, Response } from 'express';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import axios from 'axios';
import Address from '../../model/Address.js';
import MenuItem, { FoodItem } from '../../model/MenuItem.js';
import Notification from '../../model/Notification.js';
import Order, { IOrder } from '../../model/Order.js';
import { getNextCounterValue } from '../../model/Counter.js';
import Restaurant from '../../model/Restaurant.js';
import Shop from '../../model/Shop.js';
import ShopOrder from '../../model/ShopOrder.js';
import Customer from '../../model/Customer.js';
import Employee from '../../model/Employee.js';
import Rider from '../../model/Rider.js';
import Review from '../../model/Review.js';
import Coupon, {
  COUPON_TYPE_LABELS,
  SponsorType,
  SPONSOR_TYPE_LABELS,
  ensureDefaultCouponsSeeded,
} from '../../model/Coupon.js';
import {
  authenticate,
  AuthenticatedRequest,
  requireRole,
} from '../../middleware/authenticate.js';
import { getTomatoOfficialBankDetails } from '../../config/bankConfig.js';
import {
  validateLuhnChecksum,
  identifyCardBrand,
  validateCardExpiration,
} from '../../services/paymentService.js';
import { mailService } from '../../services/mailService.js';
import { notificationService } from '../notification/index.js';
import { calculateDistanceKm } from '../notification/notificationService.js';
import {
  formatBill,
  resolveAdminGsnNumber,
  buildOrderLiveTrackingData,
  getIndianStandardDateString,
} from '../../utils/orderHelpers.js';
import {
  syncOrderToTomatoPayment,
  resolvePartnerPincode,
  resolveAddressPincode,
  resolveRiderPincode,
  getServiceablePincodes,
  getAdminPincodeMap,
  matchAdminForPincodes,
  resolveCoordinatesFromDigipin,
  resolveCoordinatesFromPincode,
} from '../../utils/bankHelpers.js';
import {
  MAX_COUPONS_PER_ORDER,
  doesUserMatchTargetIdentifier,
  evaluateCouponsForCart,
  recordCouponRedemptions,
} from '../../utils/couponHelpers.js';

const createCustomerRouter = () => {
  const router = express.Router();
  router.use(authenticate, requireRole('customer'));

  router.get('/serviceable-pincodes', async (_req: Request, res: Response) => {
    try {
      const [pincodes, adminZones] = await Promise.all([
        getServiceablePincodes(),
        getAdminPincodeMap(),
      ]);
      return res.json({ pincodes, adminZones });
    } catch (error) {
      console.error('Customer serviceable pincodes fetch failed:', error);
      return res
        .status(500)
        .json({ message: 'Unable to fetch serviceable pincodes' });
    }
  });

  // Get available coupons for customer billing (maximum 1 coupon can be availed per order)
  router.get('/coupons', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      await ensureDefaultCouponsSeeded();
      const now = new Date();
      const storeId = String(
        req.query.storeId || req.query.restaurantId || req.query.shopId || '',
      ).trim();

      const [customer, previousOrdersCount, activeCoupons] = await Promise.all([
        Customer.findById(user.userId).lean(),
        Order.countDocuments({
          customerId: new mongoose.Types.ObjectId(user.userId),
          status: { $ne: 'cancelled' },
        }),
        Coupon.find({ isActive: true }).sort({ createdAt: -1 }).lean(),
      ]);

      const userContext = {
        userId: String(user.userId),
        customerId:
          (customer as any)?.customerId ||
          `cust-${String(user.userId).slice(-4).toLowerCase()}`,
        email: customer?.email || '',
        phone: customer?.phone || '',
        name: customer?.name || '',
      };

      // Filter out coupons targeted exclusively to another specific user or another store
      const visibleCoupons = activeCoupons
        .filter((c) => {
          if (c.validUntil && new Date(c.validUntil) < now) return false;
          if (c.totalUsageLimit > 0 && c.usedCount >= c.totalUsageLimit)
            return false;
          if (
            c.couponType === 'specific_user' ||
            c.couponType === 'instant' ||
            (c.couponType === 'settlement' &&
              String(c.targetUserIdentifier || '').trim())
          ) {
            return doesUserMatchTargetIdentifier(
              c.targetUserIdentifier,
              userContext,
            );
          }

          // Restaurant/Shop specific coupon filtering: only show if for this specific store
          if (c.sponsorType === 'restaurant') {
            if (storeId && c.partnerId && String(c.partnerId) !== storeId)
              return false;
          }
          if (c.sponsorType === 'shop') {
            if (storeId && c.partnerId && String(c.partnerId) !== storeId)
              return false;
          }
          return true;
        })
        .map((c) => {
          const userUses = (c.usedBy || []).filter(
            (u) => String(u.userId) === String(user.userId),
          ).length;
          const remainingForUser =
            c.usageLimitPerUser > 0
              ? Math.max(0, c.usageLimitPerUser - userUses)
              : 999;
          const isNewUserEligible =
            c.couponType !== 'new_user' || previousOrdersCount === 0;
          const sType = (c.sponsorType as SponsorType) || 'tomato';
          return {
            id: String(c._id),
            code: c.code,
            title: c.title,
            description: c.description,
            couponType: c.couponType,
            couponTypeLabel: COUPON_TYPE_LABELS[c.couponType] || c.couponType,
            sponsorType: sType,
            sponsorTypeLabel: SPONSOR_TYPE_LABELS[sType] || sType,
            partnerId: c.partnerId ? String(c.partnerId) : '',
            partnerName: c.partnerName || '',
            discountType: c.discountType,
            discountValue: c.discountValue,
            maxDiscountAmount: c.maxDiscountAmount,
            minOrderAmount: c.minOrderAmount,
            targetItemCategory: c.targetItemCategory || '',
            occasionName: c.occasionName || '',
            targetUserIdentifier: c.targetUserIdentifier || '',
            applicableStoreType: c.applicableStoreType || 'all',
            usageLimitPerUser: c.usageLimitPerUser,
            userUses,
            remainingForUser,
            isEligibleForUser: remainingForUser > 0 && isNewUserEligible,
            ineligibleReason: !isNewUserEligible
              ? 'Valid only for new users on their 1st order'
              : remainingForUser <= 0
                ? 'Already redeemed maximum allowed times'
                : '',
            validUntil: c.validUntil,
          };
        });

      return res.json({
        coupons: visibleCoupons,
        maxCouponsAllowed: MAX_COUPONS_PER_ORDER,
        isNewUser: previousOrdersCount === 0,
      });
    } catch (error) {
      console.error('Customer coupons fetch failed:', error);
      return res
        .status(500)
        .json({ message: 'Unable to fetch available coupons' });
    }
  });

  // Validate up to 1 coupon against customer's current cart items during billing
  router.post('/coupons/validate', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      const rawCodes = Array.isArray(req.body?.couponCodes)
        ? req.body.couponCodes
        : req.body?.couponCode
          ? [req.body.couponCode]
          : [];
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const isShopOrder = Boolean(req.body?.isShopOrder);
      const storeId = String(
        req.body?.storeId || req.body?.restaurantId || req.body?.shopId || '',
      ).trim();

      if (rawCodes.length > MAX_COUPONS_PER_ORDER) {
        return res.status(400).json({
          valid: false,
          message: `Only ${MAX_COUPONS_PER_ORDER} coupon code can be used per order.`,
          maxCouponsAllowed: MAX_COUPONS_PER_ORDER,
        });
      }

      const result = await evaluateCouponsForCart({
        couponCodes: rawCodes,
        userId: String(user.userId),
        isShopOrder,
        storeId,
        items,
      });

      if (!result.valid) {
        return res.status(400).json({
          ...result,
          maxCouponsAllowed: MAX_COUPONS_PER_ORDER,
        });
      }

      return res.json({
        ...result,
        maxCouponsAllowed: MAX_COUPONS_PER_ORDER,
      });
    } catch (error) {
      console.error('Customer coupon validation failed:', error);
      return res.status(500).json({ message: 'Unable to validate coupon' });
    }
  });

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


  // Helper: Extract coordinates from store document
  function getStoreCoordinates(
    store: any,
  ): { lat: number; lng: number } | null {
    if (!store) return null;
    const pin = resolvePartnerPincode(store);
    const pinCoords = resolveCoordinatesFromPincode(pin);

    const loc =
      store.restaurantLocation || store.shopLocation || store.location;
    if (
      loc &&
      typeof loc.lat === 'number' &&
      typeof loc.lng === 'number' &&
      (loc.lat !== 0 || loc.lng !== 0)
    ) {
      // If store is mapped to a known non-Bengaluru pincode (e.g. Pune 411057 or Motihari 845401)
      // but loc coordinates were defaulted to Bengaluru (12.9716, 77.5946), resolve to pincode coordinates
      if (
        pinCoords &&
        pin !== '560001' &&
        Math.abs(loc.lat - 12.9716) < 0.001 &&
        Math.abs(loc.lng - 77.5946) < 0.001
      ) {
        return pinCoords;
      }
      return { lat: loc.lat, lng: loc.lng };
    }
    if (loc && Array.isArray(loc.coordinates) && loc.coordinates.length >= 2) {
      const cLng = Number(loc.coordinates[0]);
      const cLat = Number(loc.coordinates[1]);
      if (!isNaN(cLat) && !isNaN(cLng) && (cLat !== 0 || cLng !== 0)) {
        if (
          pinCoords &&
          pin !== '560001' &&
          Math.abs(cLat - 12.9716) < 0.001 &&
          Math.abs(cLng - 77.5946) < 0.001
        ) {
          return pinCoords;
        }
        return { lat: cLat, lng: cLng };
      }
    }
    if (store.digipin) {
      const dgpCoords = resolveCoordinatesFromDigipin(store.digipin);
      if (dgpCoords) return dgpCoords;
    }
    return pinCoords;
  }

  interface CustomerLocationContext {
    customerPincode: string;
    customerDigipin: string;
    lat: number | null;
    lng: number | null;
  }

  // Helper: Resolve customer's operating pincode, digipin, and coordinates
  async function resolveCustomerLocationContext(
    userId?: string,
    explicitPincode?: string,
    explicitLat?: any,
    explicitLng?: any,
    explicitDigipin?: string,
  ): Promise<CustomerLocationContext> {
    let customerPincode = String(explicitPincode || '').trim();
    let customerDigipin = String(explicitDigipin || '')
      .trim()
      .toUpperCase();
    let lat: number | null = null;
    let lng: number | null = null;

    if (
      explicitLat !== undefined &&
      explicitLng !== undefined &&
      explicitLat !== '' &&
      explicitLng !== '' &&
      !isNaN(Number(explicitLat)) &&
      !isNaN(Number(explicitLng))
    ) {
      const parsedLat = Number(explicitLat);
      const parsedLng = Number(explicitLng);
      if (parsedLat !== 0 || parsedLng !== 0) {
        lat = parsedLat;
        lng = parsedLng;
      }
    }

    if (customerDigipin && (lat === null || lng === null)) {
      const dgpCoords = resolveCoordinatesFromDigipin(customerDigipin);
      if (dgpCoords) {
        lat = dgpCoords.lat;
        lng = dgpCoords.lng;
      }
    }

    let defaultAddr: any = null;
    if (userId && mongoose.isValidObjectId(userId)) {
      defaultAddr =
        (await Address.findOne({ userId, isDefault: true }).lean()) ||
        (await Address.findOne({ userId }).lean());

      if (defaultAddr) {
        if (!customerPincode) {
          customerPincode = resolveAddressPincode(defaultAddr);
        }
        if (!customerDigipin && defaultAddr.digipin) {
          customerDigipin = String(defaultAddr.digipin).trim().toUpperCase();
        }
        if ((lat === null || lng === null) && customerDigipin) {
          const dgpCoords = resolveCoordinatesFromDigipin(customerDigipin);
          if (dgpCoords) {
            lat = dgpCoords.lat;
            lng = dgpCoords.lng;
          }
        }
        if ((lat === null || lng === null) && customerPincode) {
          const pinCoords = resolveCoordinatesFromPincode(customerPincode);
          if (pinCoords) {
            lat = pinCoords.lat;
            lng = pinCoords.lng;
          }
        }
        if (
          (lat === null || lng === null) &&
          defaultAddr?.location?.coordinates
        ) {
          const coords = defaultAddr.location.coordinates;
          if (Array.isArray(coords) && coords.length >= 2) {
            const cLng = Number(coords[0]);
            const cLat = Number(coords[1]);
            if (!isNaN(cLat) && !isNaN(cLng) && (cLat !== 0 || cLng !== 0)) {
              lat = cLat;
              lng = cLng;
            }
          }
        }
      }

      if (!customerPincode) {
        const custDoc = await Customer.findById(userId).lean();
        customerPincode =
          (custDoc as any)?.pincode || (custDoc as any)?.postalCode || '';
        if (!customerDigipin && (custDoc as any)?.digipin) {
          customerDigipin = String((custDoc as any).digipin)
            .trim()
            .toUpperCase();
        }
        if ((lat === null || lng === null) && (custDoc as any)?.digipin) {
          const dgpCoords = resolveCoordinatesFromDigipin(
            (custDoc as any).digipin,
          );
          if (dgpCoords) {
            lat = dgpCoords.lat;
            lng = dgpCoords.lng;
          }
        }
      }
    }

    // Fallback lat/lng from customer pincode
    if (lat === null || lng === null) {
      if (customerPincode) {
        const pinCoords = resolveCoordinatesFromPincode(customerPincode);
        if (pinCoords) {
          lat = pinCoords.lat;
          lng = pinCoords.lng;
        }
      }
    }

    // If customer has a known non-Bengaluru pincode (e.g. Pune 411057 or Motihari 845401)
    // but lat/lng were defaulted or legacy Bengaluru, override with the pincode coordinates
    if (customerPincode && customerPincode !== '560001') {
      const pinCoords = resolveCoordinatesFromPincode(customerPincode);
      if (
        pinCoords &&
        (lat === null ||
          lng === null ||
          (Math.abs(lat - 12.9716) < 0.001 && Math.abs(lng - 77.5946) < 0.001))
      ) {
        lat = pinCoords.lat;
        lng = pinCoords.lng;
      }
    }

    // Default coordinate fallback
    if (lat === null || lng === null) {
      lat = 12.9716;
      lng = 77.5946;
    }

    return { customerPincode, customerDigipin, lat, lng };
  }

  // 1. View all restaurants (filtered to <= 15 km of customer's location/digipin, sorted nearest first)
  router.get('/restaurants', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const {
        customerPincode,
        customerDigipin,
        lat: custLat,
        lng: custLng,
      } = await resolveCustomerLocationContext(
        user?.userId,
        (req.query.pincode as string) || (req.query.postalCode as string),
        req.query.lat ?? req.query.latitude,
        req.query.lng ?? req.query.longitude,
        req.query.digipin as string,
      );

      const [restaurants, platformGsnNumber] = await Promise.all([
        Restaurant.find({
          isBlocked: { $ne: true },
        })
          .select(
            'name restaurantId digipin pincode gsnNumber email phone image restaurantAddress restaurantLocation cuisine isApproved isOpen isOnline bankDetails',
          )
          .lean(),
        resolveAdminGsnNumber(),
      ]);

      // Calculate distance for all restaurants; filter by max 15.0 km
      const restaurantsWithDistance = restaurants.map((r) => {
        const storeCoords = getStoreCoordinates(r);
        let distanceKm = 9999;
        if (custLat !== null && custLng !== null && storeCoords) {
          distanceKm = Number(
            calculateDistanceKm(
              custLat,
              custLng,
              storeCoords.lat,
              storeCoords.lng,
            ).toFixed(2),
          );
        }
        return {
          ...r,
          distanceKm,
          distanceText:
            distanceKm < 999 ? `${distanceKm.toFixed(1)} km` : 'N/A',
        };
      });

      const [adminList, serviceablePincodes] = await Promise.all([
        getAdminPincodeMap(),
        getServiceablePincodes(),
      ]);
      const isCustomerServiceable = Boolean(
        customerPincode && serviceablePincodes.includes(customerPincode),
      );

      // Filter by max 15km distance AND matching same admin as customer's pincode
      const matchingRestaurants = restaurantsWithDistance
        .filter((r) => {
          if (r.distanceKm > 15.0) return false;
          if (customerPincode) {
            const storePin = resolvePartnerPincode(r);
            if (storePin) {
              const match = matchAdminForPincodes(
                customerPincode,
                storePin,
                adminList,
              );
              return match.matched;
            }
          }
          return true;
        })
        .sort((a, b) => a.distanceKm - b.distanceKm);

      const restObjIds = matchingRestaurants.map((r) => r._id);
      const restItems = restObjIds.length
        ? await FoodItem.find({
            restaurantId: { $in: restObjIds },
            isActive: true,
          })
            .select('_id restaurantId')
            .lean()
        : [];

      const itemObjIds = restItems.map((i) => i._id);
      const allTargetIds = [...restObjIds, ...itemObjIds];

      const reviewStats = allTargetIds.length
        ? await Review.aggregate([
            { $match: { productId: { $in: allTargetIds } } },
            {
              $group: {
                _id: '$productId',
                avgRating: { $avg: '$rating' },
                totalReviews: { $sum: 1 },
              },
            },
          ])
        : [];

      const statByProductId = new Map<
        string,
        { avgRating: number; totalReviews: number }
      >(
        reviewStats.map((s: any) => [
          String(s._id),
          {
            avgRating: Number(s.avgRating || 0),
            totalReviews: Number(s.totalReviews || 0),
          },
        ]),
      );

      const itemsByRestId = new Map<string, string[]>();
      for (const itm of restItems) {
        const rKey = String(itm.restaurantId);
        if (!itemsByRestId.has(rKey)) itemsByRestId.set(rKey, []);
        itemsByRestId.get(rKey)!.push(String(itm._id));
      }

      return res.json({
        platformGsnNumber,
        customerPincode: customerPincode || '',
        customerDigipin: customerDigipin || '',
        serviceablePincodes,
        isServiceable: isCustomerServiceable && matchingRestaurants.length > 0,
        customerLocation:
          custLat !== null && custLng !== null
            ? { lat: custLat, lng: custLng }
            : null,
        message: !isCustomerServiceable
          ? 'your area is not in servicable range for now, update your address and pincode for orders.'
          : matchingRestaurants.length
            ? `Showing ${matchingRestaurants.length} restaurants within 15 km of your location`
            : 'No restaurants found within 15 km of your location',
        restaurants: matchingRestaurants.map((r) => {
          const restKey = String(r._id);
          const restId = r.restaurantId || '';
          const displayName = r.name;
          const partnerPin = resolvePartnerPincode(r);
          const isApproved = Boolean(
            r.isApproved || ((r as any).bankDetails?.isApproved ?? true),
          );
          const isServiceable = Boolean(isApproved && r.distanceKm <= 15.0);
          const isOpen = Boolean(r.isOpen ?? r.isOnline ?? true);

          const itemIdsForRest = itemsByRestId.get(restKey) || [];
          const itemAverages: number[] = [];
          let itemReviewsSum = 0;

          for (const iId of itemIdsForRest) {
            const st = statByProductId.get(iId);
            if (st && st.totalReviews > 0 && st.avgRating > 0) {
              itemAverages.push(Math.round(st.avgRating * 10) / 10);
              itemReviewsSum += st.totalReviews;
            }
          }

          const directRestStat = statByProductId.get(restKey);
          const directReviewsCount = directRestStat?.totalReviews || 0;

          let rating: number | null = null;
          if (itemAverages.length > 0) {
            const sumOfItemAvgs = itemAverages.reduce((acc, v) => acc + v, 0);
            rating =
              Math.round((sumOfItemAvgs / itemAverages.length) * 10) / 10;
          } else if (
            directRestStat &&
            directRestStat.totalReviews > 0 &&
            directRestStat.avgRating > 0
          ) {
            rating = Math.round(directRestStat.avgRating * 10) / 10;
          }

          const reviewCount = directReviewsCount + itemReviewsSum;

          return {
            id: r._id,
            _id: r._id,
            name: r.name,
            restaurantId: restId,
            displayName,
            digipin: r.digipin || '',
            pincode: partnerPin,
            distanceKm: r.distanceKm,
            distanceText: r.distanceText,
            gsnNumber:
              r.gsnNumber && r.gsnNumber.trim() ? r.gsnNumber.trim() : 'NA',
            isServiceable,
            email: r.email,
            phone: r.phone,
            image: r.image,
            address: r.restaurantAddress || 'Bengaluru Food Quarter',
            location: r.restaurantLocation || { lat: 12.9716, lng: 77.5946 },
            cuisine: r.cuisine || 'North Indian, Continental, Fast Food',
            isApproved,
            isOpen,
            isOnline: isOpen,
            rating,
            reviewCount,
            directReviewCount: directReviewsCount,
          };
        }),
      });
    } catch (error) {
      console.error('Fetch restaurants failed:', error);
      return res.status(500).json({ message: 'Unable to fetch restaurants' });
    }
  });

  // 1b. View all shops (filtered to <= 15 km of customer's location/digipin, sorted nearest first)
  router.get('/shops', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const {
        customerPincode,
        customerDigipin,
        lat: custLat,
        lng: custLng,
      } = await resolveCustomerLocationContext(
        user?.userId,
        (req.query.pincode as string) || (req.query.postalCode as string),
        req.query.lat ?? req.query.latitude,
        req.query.lng ?? req.query.longitude,
        req.query.digipin as string,
      );

      const [shops, platformGsnNumber] = await Promise.all([
        Shop.find({
          isBlocked: { $ne: true },
        })
          .select(
            'name shopId digipin pincode gsnNumber email phone image shopAddress shopLocation category isApproved isOpen isOnline bankDetails',
          )
          .lean(),
        resolveAdminGsnNumber(),
      ]);

      // Calculate distance for all shops; filter by max 15.0 km
      const shopsWithDistance = shops.map((s) => {
        const storeCoords = getStoreCoordinates(s);
        let distanceKm = 9999;
        if (custLat !== null && custLng !== null && storeCoords) {
          distanceKm = Number(
            calculateDistanceKm(
              custLat,
              custLng,
              storeCoords.lat,
              storeCoords.lng,
            ).toFixed(2),
          );
        }
        return {
          ...s,
          distanceKm,
          distanceText:
            distanceKm < 999 ? `${distanceKm.toFixed(1)} km` : 'N/A',
        };
      });

      const [adminList, serviceablePincodes] = await Promise.all([
        getAdminPincodeMap(),
        getServiceablePincodes(),
      ]);
      const isCustomerServiceable = Boolean(
        customerPincode && serviceablePincodes.includes(customerPincode),
      );

      // Filter by max 15km distance AND matching same admin as customer's pincode
      const matchingShops = shopsWithDistance
        .filter((s) => {
          if (s.distanceKm > 15.0) return false;
          if (customerPincode) {
            const storePin = resolvePartnerPincode(s);
            if (storePin) {
              const match = matchAdminForPincodes(
                customerPincode,
                storePin,
                adminList,
              );
              return match.matched;
            }
          }
          return true;
        })
        .sort((a, b) => a.distanceKm - b.distanceKm);

      const [reviewStats, shopItems] = await Promise.all([
        Review.aggregate([
          {
            $match: {
              targetType: { $in: ['restaurant', 'shop', 'dish', 'item'] },
            },
          },
          {
            $group: {
              _id: '$targetId',
              avgRating: { $avg: '$rating' },
              totalReviews: { $sum: 1 },
            },
          },
        ]),
        MenuItem.find({
          restaurantId: { $in: matchingShops.map((s) => s._id) },
        })
          .select('_id restaurantId')
          .lean(),
      ]);

      const statByProductId = new Map<
        string,
        { avgRating: number; totalReviews: number }
      >();
      for (const stat of reviewStats) {
        statByProductId.set(String(stat._id), {
          avgRating: stat.avgRating || 0,
          totalReviews: stat.totalReviews || 0,
        });
      }

      const itemsByShopId = new Map<string, string[]>();
      for (const itm of shopItems) {
        const sKey = String(itm.restaurantId);
        if (!itemsByShopId.has(sKey)) itemsByShopId.set(sKey, []);
        itemsByShopId.get(sKey)!.push(String(itm._id));
      }

      return res.json({
        platformGsnNumber,
        customerPincode: customerPincode || '',
        customerDigipin: customerDigipin || '',
        serviceablePincodes,
        isServiceable: isCustomerServiceable && matchingShops.length > 0,
        customerLocation:
          custLat !== null && custLng !== null
            ? { lat: custLat, lng: custLng }
            : null,
        message: !isCustomerServiceable
          ? 'your area is not in servicable range for now, update your address and pincode for orders.'
          : matchingShops.length
            ? `Showing ${matchingShops.length} shops within 15 km of your location`
            : 'No shops found within 15 km of your location',
        shops: matchingShops.map((s) => {
          const shopKey = String(s._id);
          const shopCode = s.shopId || '';
          const displayName = s.name;
          const partnerPin = resolvePartnerPincode(s);
          const isApproved = Boolean(
            s.isApproved || ((s as any).bankDetails?.isApproved ?? true),
          );
          const isServiceable = Boolean(isApproved && s.distanceKm <= 15.0);
          const isOpen = Boolean(s.isOpen ?? s.isOnline ?? true);

          const itemIdsForShop = itemsByShopId.get(shopKey) || [];
          const itemAverages: number[] = [];
          let itemReviewsSum = 0;

          for (const iId of itemIdsForShop) {
            const st = statByProductId.get(iId);
            if (st && st.totalReviews > 0 && st.avgRating > 0) {
              itemAverages.push(Math.round(st.avgRating * 10) / 10);
              itemReviewsSum += st.totalReviews;
            }
          }

          const directShopStat = statByProductId.get(shopKey);
          const directReviewsCount = directShopStat?.totalReviews || 0;

          let rating: number | null = null;
          if (itemAverages.length > 0) {
            const sumOfItemAvgs = itemAverages.reduce((acc, v) => acc + v, 0);
            rating =
              Math.round((sumOfItemAvgs / itemAverages.length) * 10) / 10;
          } else if (
            directShopStat &&
            directShopStat.totalReviews > 0 &&
            directShopStat.avgRating > 0
          ) {
            rating = Math.round(directShopStat.avgRating * 10) / 10;
          }

          const reviewCount = directReviewsCount + itemReviewsSum;

          return {
            id: s._id,
            _id: s._id,
            name: s.name,
            shopId: shopCode,
            displayName,
            digipin: s.digipin || '',
            pincode: partnerPin,
            distanceKm: s.distanceKm,
            distanceText: s.distanceText,
            gsnNumber:
              s.gsnNumber && s.gsnNumber.trim() ? s.gsnNumber.trim() : 'NA',
            isServiceable,
            email: s.email,
            phone: s.phone,
            image: s.image,
            address: s.shopAddress || 'Bengaluru Retail Hub',
            location: s.shopLocation || { lat: 12.9784, lng: 77.6408 },
            category: s.category || 'Retail, Supermarket & Groceries',
            cuisine: s.category || 'Retail, Supermarket & Groceries',
            isApproved,
            isOpen,
            isOnline: isOpen,
            rating,
            reviewCount,
            directReviewCount: directReviewsCount,
          };
        }),
      });
    } catch (error) {
      console.error('Fetch shops failed:', error);
      return res.status(500).json({ message: 'Unable to fetch shops' });
    }
  });

  // 2. View menu items (filtered by distance <= 15 km)
  router.get('/menu', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { restaurantId, shopId, type, category, search } = req.query;
      const query: Record<string, unknown> = { isActive: true };

      const {
        customerPincode,
        lat: custLat,
        lng: custLng,
      } = await resolveCustomerLocationContext(
        user?.userId,
        (req.query.pincode as string) || (req.query.postalCode as string),
        req.query.lat ?? req.query.latitude,
        req.query.lng ?? req.query.longitude,
        req.query.digipin as string,
      );

      const adminList = await getAdminPincodeMap();

      if (typeof shopId === 'string' && mongoose.isValidObjectId(shopId)) {
        const targetShop = await Shop.findById(shopId)
          .select('name pincode shopAddress digipin shopLocation')
          .lean();
        if (targetShop && custLat !== null && custLng !== null) {
          const coords = getStoreCoordinates(targetShop);
          if (coords) {
            const dist = calculateDistanceKm(
              custLat,
              custLng,
              coords.lat,
              coords.lng,
            );
            if (dist > 15.0) {
              return res.status(400).json({
                message: 'Shop is too far from you',
                code: 'STORE_TOO_FAR',
                distanceKm: Number(dist.toFixed(2)),
                storeName: targetShop.name || 'Shop',
                menu: [],
              });
            }
          }
        }
        if (targetShop && customerPincode) {
          const storePin = resolvePartnerPincode(targetShop);
          if (storePin) {
            const match = matchAdminForPincodes(
              customerPincode,
              storePin,
              adminList,
            );
            if (!match.matched) {
              return res.status(400).json({
                message:
                  'your area is not in servicable range for now, update your address and pincode for orders.',
                code: 'ADMIN_ZONE_MISMATCH',
                menu: [],
              });
            }
          }
        }
        query.restaurantId = new mongoose.Types.ObjectId(shopId);
      } else if (
        typeof restaurantId === 'string' &&
        mongoose.isValidObjectId(restaurantId)
      ) {
        const targetRest = await Restaurant.findById(restaurantId)
          .select('name pincode restaurantAddress digipin restaurantLocation')
          .lean();
        if (targetRest && custLat !== null && custLng !== null) {
          const coords = getStoreCoordinates(targetRest);
          if (coords) {
            const dist = calculateDistanceKm(
              custLat,
              custLng,
              coords.lat,
              coords.lng,
            );
            if (dist > 15.0) {
              return res.status(400).json({
                message: 'Restaurant is too far from you',
                code: 'STORE_TOO_FAR',
                distanceKm: Number(dist.toFixed(2)),
                storeName: targetRest.name || 'Restaurant',
                menu: [],
              });
            }
          }
        }
        if (targetRest && customerPincode) {
          const storePin = resolvePartnerPincode(targetRest);
          if (storePin) {
            const match = matchAdminForPincodes(
              customerPincode,
              storePin,
              adminList,
            );
            if (!match.matched) {
              return res.status(400).json({
                message:
                  'your area is not in servicable range for now, update your address and pincode for orders.',
                code: 'ADMIN_ZONE_MISMATCH',
                menu: [],
              });
            }
          }
        }
        query.restaurantId = new mongoose.Types.ObjectId(restaurantId);
      } else if (type === 'shop') {
        const shops = await Shop.find({ isBlocked: { $ne: true } })
          .select('_id name pincode shopAddress digipin shopLocation')
          .lean();
        const allowedShops = shops.filter((s) => {
          const storePin = resolvePartnerPincode(s);
          if (custLat !== null && custLng !== null) {
            const coords = getStoreCoordinates(s);
            if (!coords) return false;
            if (
              calculateDistanceKm(custLat, custLng, coords.lat, coords.lng) >
              15.0
            )
              return false;
          }
          if (customerPincode && storePin) {
            const match = matchAdminForPincodes(
              customerPincode,
              storePin,
              adminList,
            );
            return match.matched;
          }
          return true;
        });
        query.restaurantId = { $in: allowedShops.map((s) => s._id) };
      } else if (type === 'restaurant') {
        const restaurants = await Restaurant.find({ isBlocked: { $ne: true } })
          .select(
            '_id name pincode restaurantAddress digipin restaurantLocation',
          )
          .lean();
        const allowedRests = restaurants.filter((r) => {
          const storePin = resolvePartnerPincode(r);
          if (custLat !== null && custLng !== null) {
            const coords = getStoreCoordinates(r);
            if (!coords) return false;
            if (
              calculateDistanceKm(custLat, custLng, coords.lat, coords.lng) >
              15.0
            )
              return false;
          }
          if (customerPincode && storePin) {
            const match = matchAdminForPincodes(
              customerPincode,
              storePin,
              adminList,
            );
            return match.matched;
          }
          return true;
        });
        query.restaurantId = { $in: allowedRests.map((r) => r._id) };
      } else {
        const [restaurants, shops] = await Promise.all([
          Restaurant.find({ isBlocked: { $ne: true } })
            .select('_id pincode restaurantAddress digipin restaurantLocation')
            .lean(),
          Shop.find({ isBlocked: { $ne: true } })
            .select('_id pincode shopAddress digipin shopLocation')
            .lean(),
        ]);
        const allowedRests = restaurants.filter((r) => {
          if (custLat !== null && custLng !== null) {
            const coords = getStoreCoordinates(r);
            if (!coords) return false;
            if (
              calculateDistanceKm(custLat, custLng, coords.lat, coords.lng) >
              15.0
            )
              return false;
          }
          if (customerPincode) {
            const storePin = resolvePartnerPincode(r);
            if (storePin) {
              const match = matchAdminForPincodes(
                customerPincode,
                storePin,
                adminList,
              );
              return match.matched;
            }
          }
          return true;
        });
        const allowedShops = shops.filter((s) => {
          if (custLat !== null && custLng !== null) {
            const coords = getStoreCoordinates(s);
            if (!coords) return false;
            if (
              calculateDistanceKm(custLat, custLng, coords.lat, coords.lng) >
              15.0
            )
              return false;
          }
          if (customerPincode) {
            const storePin = resolvePartnerPincode(s);
            if (storePin) {
              const match = matchAdminForPincodes(
                customerPincode,
                storePin,
                adminList,
              );
              return match.matched;
            }
          }
          return true;
        });
        const allowedStoreIds = [
          ...allowedRests.map((r) => r._id),
          ...allowedShops.map((s) => s._id),
        ];
        query.restaurantId = { $in: allowedStoreIds };
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
      const queryName =
        typeof req.query.name === 'string' ? req.query.name.trim() : '';

      let item: any = mongoose.isValidObjectId(itemId)
        ? await FoodItem.findById(itemId).lean()
        : null;

      if (!item && queryName) {
        item = await FoodItem.findOne({
          name: new RegExp(`^${queryName}$`, 'i'),
        }).lean();
      }

      const userObjId = new mongoose.Types.ObjectId(user.userId);

      // Check if this customer has purchased/ordered this item in past non-cancelled orders
      const orderSearchConditions: Record<string, unknown>[] = [];
      if (item) {
        orderSearchConditions.push({ 'items.foodItemId': item._id });
        orderSearchConditions.push({ 'items.name': item.name });
      } else {
        if (mongoose.isValidObjectId(itemId)) {
          orderSearchConditions.push({
            'items.foodItemId': new mongoose.Types.ObjectId(itemId),
          });
        }
        if (queryName) {
          orderSearchConditions.push({
            'items.name': new RegExp(`^${queryName}$`, 'i'),
          });
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
        const orderItem = (pastOrder.items || []).find(
          (it: any) =>
            (mongoose.isValidObjectId(itemId) &&
              String(it.foodItemId) === itemId) ||
            (queryName &&
              String(it.name || '').toLowerCase() === queryName.toLowerCase()),
        );
        if (orderItem) {
          item = {
            _id:
              orderItem.foodItemId ||
              (mongoose.isValidObjectId(itemId)
                ? new mongoose.Types.ObjectId(itemId)
                : new mongoose.Types.ObjectId()),
            name: orderItem.name,
            price: orderItem.price,
            category: 'Ordered Dish',
            restaurantId: pastOrder.restaurantId,
            restaurantName: pastOrder.restaurantName,
          };
        }
      }

      if (!item) {
        return res
          .status(404)
          .json({ message: 'Product or food item not found' });
      }

      const targetProductId = item._id;
      const rawReviews = await Review.find({
        $or: [{ productId: targetProductId }, { productName: item.name }],
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
            (reviews.reduce((sum, r) => sum + (r.rating || 0), 0) /
              totalReviews) *
              10,
          ) / 10
        : null;

      const ratingDistribution: Record<number, number> = {
        5: 0,
        4: 0,
        3: 0,
        2: 0,
        1: 0,
      };
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
      const bodyName =
        typeof req.body?.name === 'string' ? req.body.name.trim() : '';

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
        item = await FoodItem.findOne({
          name: new RegExp(`^${bodyName}$`, 'i'),
        }).lean();
      }

      const userObjId = new mongoose.Types.ObjectId(user.userId);
      const orderSearchConditions: Record<string, unknown>[] = [];
      if (item) {
        orderSearchConditions.push({ 'items.foodItemId': item._id });
        orderSearchConditions.push({ 'items.name': item.name });
      } else {
        if (mongoose.isValidObjectId(itemId)) {
          orderSearchConditions.push({
            'items.foodItemId': new mongoose.Types.ObjectId(itemId),
          });
        }
        if (bodyName) {
          orderSearchConditions.push({
            'items.name': new RegExp(`^${bodyName}$`, 'i'),
          });
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
        const orderItem = (pastOrder.items || []).find(
          (it: any) =>
            (mongoose.isValidObjectId(itemId) &&
              String(it.foodItemId) === itemId) ||
            (bodyName &&
              String(it.name || '').toLowerCase() === bodyName.toLowerCase()),
        );
        if (orderItem) {
          item = {
            _id:
              orderItem.foodItemId ||
              (mongoose.isValidObjectId(itemId)
                ? new mongoose.Types.ObjectId(itemId)
                : new mongoose.Types.ObjectId()),
            name: orderItem.name,
            price: orderItem.price,
            category: 'Ordered Dish',
            restaurantId: pastOrder.restaurantId,
            restaurantName: pastOrder.restaurantName,
          };
        }
      }

      if (!item) {
        return res
          .status(404)
          .json({ message: 'Product or food item not found' });
      }

      if (!pastOrder) {
        return res.status(403).json({
          message:
            'Verified purchase required: You can only review products you have ordered in the past.',
        });
      }

      const customer =
        (await Customer.findById(user.userId).lean()) ||
        (await Employee.findById(user.userId).lean());
      const customerName = customer?.name || (user as any).name || 'Customer';

      // Check if this customer already reviewed this product (by productId or productName)
      const existingReview = await Review.findOne({
        customerId: userObjId,
        $or: [
          { productId: item._id },
          {
            productName: new RegExp(
              `^${String(item.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
              'i',
            ),
          },
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
        existingReview.storeType = (item as any).isShopItem
          ? 'shop'
          : 'restaurant';
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
          {
            productName: new RegExp(
              `^${String(item.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,
              'i',
            ),
          },
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

  // 2e. Get reviews & rating for a specific restaurant
  router.get(
    '/restaurants/:restaurantId/reviews',
    async (req: Request, res: Response) => {
      try {
        const user = (req as AuthenticatedRequest).user;
        if (!user?.userId) {
          return res.status(401).json({ message: 'Authentication required' });
        }

        const restaurantIdParam = String(req.params.restaurantId || '');
        const queryName =
          typeof req.query.name === 'string' ? req.query.name.trim() : '';

        let restaurant: any = mongoose.isValidObjectId(restaurantIdParam)
          ? await Restaurant.findById(restaurantIdParam).lean()
          : null;

        if (!restaurant && queryName) {
          const escapedName = queryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          restaurant = await Restaurant.findOne({
            name: new RegExp(`^${escapedName}`, 'i'),
          }).lean();
        }

        if (!restaurant) {
          return res.status(404).json({ message: 'Restaurant not found' });
        }

        const restObjId = restaurant._id;
        const userObjId = new mongoose.Types.ObjectId(user.userId);

        // Find all items belonging to this restaurant
        const restItems = await FoodItem.find({
          restaurantId: restObjId,
        }).lean();
        const itemIds = restItems.map((i) => i._id);
        const itemNames = restItems.map((i) => i.name).filter(Boolean);

        // Check if customer has purchased from this specific restaurant
        const escapedRestName = (
          String(restaurant.name || '').split('/')[0] || ''
        )
          .trim()
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const orderOrConditions: Record<string, unknown>[] = [
          { restaurantId: restObjId },
        ];
        if (escapedRestName) {
          orderOrConditions.push({
            restaurantName: new RegExp(escapedRestName, 'i'),
          });
        }
        if (itemIds.length > 0) {
          orderOrConditions.push({ 'items.foodItemId': { $in: itemIds } });
        }
        if (itemNames.length > 0) {
          orderOrConditions.push({ 'items.name': { $in: itemNames } });
        }

        const pastOrder = await Order.findOne({
          customerId: userObjId,
          status: { $ne: 'cancelled' },
          $or: orderOrConditions,
        })
          .sort({ createdAt: -1 })
          .lean();

        // Compute average of each item's average rating
        const itemReviewStats = itemIds.length
          ? await Review.aggregate([
              { $match: { productId: { $in: itemIds } } },
              {
                $group: {
                  _id: '$productId',
                  avgRating: { $avg: '$rating' },
                  totalReviews: { $sum: 1 },
                },
              },
            ])
          : [];

        const itemAverages: number[] = [];
        for (const st of itemReviewStats) {
          if (st.totalReviews > 0 && st.avgRating > 0) {
            itemAverages.push(Math.round(Number(st.avgRating) * 10) / 10);
          }
        }

        // Fetch all reviews for this restaurant (direct restaurant reviews + item reviews for this restaurant)
        const reviewOrConditions: Record<string, unknown>[] = [
          { productId: restObjId },
          { storeId: restObjId },
        ];
        if (itemIds.length > 0) {
          reviewOrConditions.push({ productId: { $in: itemIds } });
        }

        const rawReviews = await Review.find({ $or: reviewOrConditions })
          .sort({ updatedAt: -1, createdAt: -1 })
          .lean();

        // Deduplicate per (productId, customerId)
        const seenKeys = new Set<string>();
        const reviews: any[] = [];
        const directRestReviews: any[] = [];

        for (const r of rawReviews) {
          const key = `${String(r.productId)}_${String(r.customerId)}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            const isDirectRestaurantReview =
              String(r.productId) === String(restObjId);
            const enriched = {
              ...r,
              isRestaurantReview: isDirectRestaurantReview,
              reviewedTargetName: isDirectRestaurantReview
                ? restaurant.name
                : r.productName,
            };
            reviews.push(enriched);
            if (isDirectRestaurantReview) {
              directRestReviews.push(enriched);
            }
          }
        }

        let averageRating: number | null = null;
        if (itemAverages.length > 0) {
          const sumOfItemAvgs = itemAverages.reduce((acc, v) => acc + v, 0);
          averageRating =
            Math.round((sumOfItemAvgs / itemAverages.length) * 10) / 10;
        } else if (directRestReviews.length > 0) {
          const sumDirect = directRestReviews.reduce(
            (acc, r) => acc + Number(r.rating || 0),
            0,
          );
          averageRating =
            Math.round((sumDirect / directRestReviews.length) * 10) / 10;
        }

        const totalReviews = reviews.length;
        const canReview = Boolean(pastOrder);
        const userReview =
          directRestReviews.find(
            (r) => String(r.customerId) === String(user.userId),
          ) || null;

        return res.json({
          restaurant: {
            id: restaurant._id,
            _id: restaurant._id,
            name: restaurant.name,
            cuisine: restaurant.cuisine || 'Multi-Cuisine Restaurant',
            address: restaurant.restaurantAddress || 'Bengaluru Food Quarter',
            totalMenuItems: restItems.length,
            ratedItemsCount: itemAverages.length,
          },
          reviews,
          totalReviews,
          averageRating,
          ratedItemsCount: itemAverages.length,
          canReview,
          cannotReviewReason: canReview
            ? null
            : 'Only customers who have purchased from this restaurant can submit a review.',
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
        console.error('Fetch restaurant reviews failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to fetch restaurant reviews' });
      }
    },
  );

  // 2f. Submit or update review for a specific restaurant (verified purchase from that restaurant required)
  router.post(
    '/restaurants/:restaurantId/reviews',
    async (req: Request, res: Response) => {
      try {
        const user = (req as AuthenticatedRequest).user;
        if (!user?.userId) {
          return res.status(401).json({ message: 'Authentication required' });
        }

        const restaurantIdParam = String(req.params.restaurantId || '');
        const bodyName =
          typeof req.body?.name === 'string' ? req.body.name.trim() : '';

        const rating = Number(req.body?.rating);
        if (isNaN(rating) || rating < 1 || rating > 5) {
          return res
            .status(400)
            .json({ message: 'Rating must be an integer between 1 and 5' });
        }

        const comment =
          typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';

        let restaurant: any = mongoose.isValidObjectId(restaurantIdParam)
          ? await Restaurant.findById(restaurantIdParam).lean()
          : null;

        if (!restaurant && bodyName) {
          const escapedName = bodyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          restaurant = await Restaurant.findOne({
            name: new RegExp(`^${escapedName}`, 'i'),
          }).lean();
        }

        if (!restaurant) {
          return res.status(404).json({ message: 'Restaurant not found' });
        }

        const restObjId = restaurant._id;
        const userObjId = new mongoose.Types.ObjectId(user.userId);

        const restItems = await FoodItem.find({ restaurantId: restObjId })
          .select('_id name')
          .lean();
        const itemIds = restItems.map((i) => i._id);
        const itemNames = restItems.map((i) => i.name).filter(Boolean);

        const escapedRestName = (
          String(restaurant.name || '').split('/')[0] || ''
        )
          .trim()
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const orderOrConditions: Record<string, unknown>[] = [
          { restaurantId: restObjId },
        ];
        if (escapedRestName) {
          orderOrConditions.push({
            restaurantName: new RegExp(escapedRestName, 'i'),
          });
        }
        if (itemIds.length > 0) {
          orderOrConditions.push({ 'items.foodItemId': { $in: itemIds } });
        }
        if (itemNames.length > 0) {
          orderOrConditions.push({ 'items.name': { $in: itemNames } });
        }

        const pastOrder = await Order.findOne({
          customerId: userObjId,
          status: { $ne: 'cancelled' },
          $or: orderOrConditions,
        })
          .sort({ createdAt: -1 })
          .lean();

        if (!pastOrder) {
          return res.status(403).json({
            message:
              'Verified purchase required: Only customers who have purchased from this restaurant can submit a review.',
          });
        }

        const customer =
        (await Customer.findById(user.userId).lean()) ||
        (await Employee.findById(user.userId).lean());
        const customerName = customer?.name || (user as any).name || 'Customer';

        const existingReview = await Review.findOne({
          customerId: userObjId,
          productId: restObjId,
        });

        let review;
        let isOverride = false;

        if (existingReview) {
          isOverride = true;
          existingReview.productName = restaurant.name;
          existingReview.storeId = restObjId;
          existingReview.storeName = restaurant.name;
          existingReview.storeType = 'restaurant';
          existingReview.customerName = customerName;
          existingReview.rating = Math.round(rating);
          existingReview.comment = comment;
          existingReview.orderId = pastOrder._id;
          existingReview.orderNumber = pastOrder.orderNumber;
          review = await existingReview.save();
        } else {
          review = await Review.create({
            productId: restObjId,
            productName: restaurant.name,
            storeId: restObjId,
            storeName: restaurant.name,
            storeType: 'restaurant',
            customerId: userObjId,
            customerName,
            rating: Math.round(rating),
            comment,
            orderId: pastOrder._id,
            orderNumber: pastOrder.orderNumber,
          });
        }

        return res.status(200).json({
          message: isOverride
            ? 'Your restaurant review has been updated!'
            : 'Restaurant review saved successfully!',
          review,
        });
      } catch (error) {
        console.error('Submit restaurant review failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to submit restaurant review' });
      }
    },
  );

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
      const digipin =
        typeof payload.digipin === 'string'
          ? payload.digipin.trim().toUpperCase()
          : '';
      const line2 =
        typeof payload.line2 === 'string' ? payload.line2.trim() : '';
      const locality =
        typeof payload.locality === 'string' ? payload.locality.trim() : '';
      const isDefault = Boolean(payload.isDefault);
      let coordinates: [number, number] = [77.5946, 12.9716];
      let hasExplicitCoords = false;
      if (
        Array.isArray(payload.coordinates) &&
        payload.coordinates.length === 2
      ) {
        const c0 = Number(payload.coordinates[0]);
        const c1 = Number(payload.coordinates[1]);
        if (
          !isNaN(c0) &&
          !isNaN(c1) &&
          (c0 !== 0 || c1 !== 0) &&
          (c0 !== 77.5946 || c1 !== 12.9716)
        ) {
          coordinates = [c0, c1];
          hasExplicitCoords = true;
        }
      }
      if (!hasExplicitCoords) {
        if (digipin) {
          const dgp = resolveCoordinatesFromDigipin(digipin);
          if (dgp) coordinates = [dgp.lng, dgp.lat];
        }
        if (
          coordinates[0] === 77.5946 &&
          coordinates[1] === 12.9716 &&
          postalCode
        ) {
          const pinC = resolveCoordinatesFromPincode(postalCode);
          if (pinC) coordinates = [pinC.lng, pinC.lat];
        }
      }

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
        digipin,
        phone: phone || undefined,
        isDefault: shouldBeDefault,
        location: {
          type: 'Point',
          coordinates,
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
        if (value !== undefined && value !== null) {
          update[key] =
            typeof value === 'string' && key === 'digipin'
              ? value.trim().toUpperCase()
              : value;
        }
      }

      if (!update.location && (update.digipin || update.postalCode)) {
        let coords: { lat: number; lng: number } | null = null;
        if (typeof update.digipin === 'string') {
          coords = resolveCoordinatesFromDigipin(update.digipin);
        }
        if (!coords && typeof update.postalCode === 'string') {
          coords = resolveCoordinatesFromPincode(update.postalCode);
        }
        if (coords) {
          update.location = {
            type: 'Point',
            coordinates: [coords.lng, coords.lat],
          };
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
        { returnDocument: 'after', runValidators: true },
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
          { returnDocument: 'after' },
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

  // 4a. Official Tomato Central Bank & Gateway Configuration
  router.get('/payment/config', (_req: Request, res: Response) => {
    const keyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_TjUFioCQLtVxJn';
    const isLive = keyId.startsWith('rzp_live');
    return res.json({
      keyId,
      isLive,
      currency: 'INR',
      tomatoOfficialBank: getTomatoOfficialBankDetails(),
    });
  });

  // 4b. Razorpay - Get Public Key ID
  router.get('/payment/razorpay/key', (_req: Request, res: Response) => {
    const keyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_TjUFioCQLtVxJn';
    return res.json({ keyId });
  });

  // 4b. Razorpay - Create Order on Razorpay Gateway
  router.post(
    '/payment/razorpay/order',
    async (req: Request, res: Response) => {
      try {
        const { amount, receipt } = req.body;
        const numAmount = Number(amount);
        if (!numAmount || numAmount <= 0) {
          return res
            .status(400)
            .json({ message: 'Valid payment amount is required' });
        }

        const keyId = process.env.RAZORPAY_KEY_ID || 'rzp_test_TjUFioCQLtVxJn';
        const keySecret =
          process.env.RAZORPAY_KEY_SECRET || '1zFOIza2vJGCB6g2PeqFs12t';
        const authHeader =
          'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');

        // Amount in paise (1 INR = 100 paise)
        const amountPaise = Math.round(numAmount * 100);

        const rzpRes = await axios.post(
          'https://api.razorpay.com/v1/orders',
          {
            amount: amountPaise,
            currency: 'INR',
            receipt: receipt || `rcpt_${Date.now()}`,
            notes: {
              preferred_currency: 'INR',
              currency: 'INR',
            },
          },
          {
            headers: {
              Authorization: authHeader,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          },
        );

        return res.json({
          success: true,
          orderId: rzpRes.data.id,
          amount: rzpRes.data.amount,
          currency: rzpRes.data.currency,
          keyId,
        });
      } catch (err: any) {
        console.error(
          'Razorpay order creation failed:',
          err.response?.data || err.message,
        );
        return res.status(500).json({
          message: 'Unable to initiate Razorpay order',
          error: err.response?.data?.error?.description || err.message,
        });
      }
    },
  );

  // 4c. Razorpay - Verify Payment Signature
  router.post(
    '/payment/razorpay/verify',
    async (req: Request, res: Response) => {
      try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
          req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
          return res
            .status(400)
            .json({ message: 'Missing Razorpay verification parameters' });
        }

        const keySecret =
          process.env.RAZORPAY_KEY_SECRET || '1zFOIza2vJGCB6g2PeqFs12t';

        const generatedSignature = crypto
          .createHmac('sha256', keySecret)
          .update(`${razorpay_order_id}|${razorpay_payment_id}`)
          .digest('hex');

        if (generatedSignature !== razorpay_signature) {
          return res.status(400).json({
            success: false,
            verified: false,
            message: 'Razorpay payment signature verification failed',
          });
        }

        return res.json({
          success: true,
          verified: true,
          message:
            'Payment verified successfully via Razorpay and credited to Tomato Treasury',
          transactionId: razorpay_payment_id,
          orderId: razorpay_order_id,
          paymentMethod: 'razorpay',
          settlementAccount: getTomatoOfficialBankDetails(),
        });
      } catch (err: any) {
        console.error('Razorpay verification error:', err);
        return res
          .status(500)
          .json({ message: 'Payment verification failed', error: err.message });
      }
    },
  );

  // 4d. Payment Gateway integration endpoint (Validated Direct & Gateway Settlement)
  router.post('/payment/process', async (req: Request, res: Response) => {
    try {
      const {
        amount,
        paymentMethod,
        cardDetails,
        upiId,
        bankCode,
        utrReference,
      } = req.body;
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

      let detectedBrand = 'Generic';

      if (method === 'card') {
        const rawCard = String(cardDetails?.number || '').replace(
          /[\s-]+/g,
          '',
        );
        if (!/^\d{13,19}$/.test(rawCard)) {
          return res.status(400).json({
            message: 'Card number must be between 13 and 19 numeric digits',
          });
        }
        if (!validateLuhnChecksum(rawCard)) {
          return res.status(400).json({
            message:
              'Invalid card number (failed Luhn Mod-10 checksum validation)',
          });
        }
        detectedBrand = identifyCardBrand(rawCard);

        const expCheck = validateCardExpiration(cardDetails?.exp);
        if (!expCheck.valid) {
          return res.status(400).json({ message: expCheck.message });
        }

        const cvv = String(cardDetails?.cvv || '').trim();
        const expectedCvvLen = detectedBrand === 'American Express' ? 4 : 3;
        if (!new RegExp(`^\\d{${expectedCvvLen},4}$`).test(cvv)) {
          return res.status(400).json({
            message: `Invalid CVV security code (must be ${expectedCvvLen} digits for ${detectedBrand})`,
          });
        }

        const cardHolder = String(cardDetails?.name || '').trim();
        if (cardHolder.length < 2) {
          return res
            .status(400)
            .json({ message: 'Valid cardholder name is required' });
        }
      } else if (method === 'upi') {
        const upi = String(upiId || '').trim();
        const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
        if (!upiRegex.test(upi)) {
          return res.status(400).json({
            message:
              'Invalid UPI ID format. Expected format: username@bank (e.g. user@okhdfcbank, tomato@paytm)',
          });
        }
        if (utrReference) {
          const cleanUtr = String(utrReference).trim();
          if (cleanUtr.length > 0 && !/^[a-zA-Z0-9]{6,22}$/.test(cleanUtr)) {
            return res.status(400).json({
              message: 'Invalid Bank UTR / Reference number format',
            });
          }
        }
      } else if (method === 'netbanking') {
        const selectedBank = String(
          bankCode || req.body?.bankName || '',
        ).trim();
        if (!selectedBank) {
          return res.status(400).json({
            message: 'Please select a valid bank for NetBanking authorization',
          });
        }
      }

      const transactionId = `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

      const settlementAccount = getTomatoOfficialBankDetails();

      return res.json({
        success: true,
        message:
          'Payment verified and authorized for direct settlement to Tomato Official Bank Account',
        transactionId,
        paymentMethod: method,
        amount: numAmount,
        currency: 'INR',
        cardBrand: method === 'card' ? detectedBrand : undefined,
        settlementAccount,
        paidAt: new Date(),
      });
    } catch (error: any) {
      console.error('Payment gateway process failed:', error);
      return res.status(500).json({
        message: 'Payment gateway transaction failed',
        error: error?.message,
      });
    }
  });

  // 5. Place order to restaurant with payment info
  router.post('/orders', async (req: Request, res: Response) => {
    try {
      const user = (req as AuthenticatedRequest).user;
      if (!user?.userId)
        return res.status(401).json({ message: 'Authentication required' });

      const customer =
        (await Customer.findById(user.userId).lean()) ||
        (await Employee.findById(user.userId).lean());
      const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!rawItems.length)
        return res.status(400).json({ message: 'Order items are required' });

      interface SanitizedOrderItem {
        foodItemId: mongoose.Types.ObjectId;
        name: string;
        quantity: number;
        price: number;
        totalPrice: number;
        variant?: string;
      }

      const sanitizedItems: SanitizedOrderItem[] = rawItems
        .map((entry: Record<string, unknown>): SanitizedOrderItem => {
          const foodItemId = String(
            entry.foodItemId || entry.itemId || entry._id || '',
          );
          const name = typeof entry.name === 'string' ? entry.name.trim() : '';
          const quantity = Number(entry.quantity ?? 1);
          const price = Number(entry.price ?? 0);
          const variant = typeof entry.variant === 'string' ? entry.variant.trim() : '';
          return {
            foodItemId: mongoose.isValidObjectId(foodItemId)
              ? new mongoose.Types.ObjectId(foodItemId)
              : new mongoose.Types.ObjectId(),
            name,
            quantity,
            price,
            totalPrice: quantity * price,
            variant,
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

      // Check for finished / out-of-stock items and variants
      const foodItemIds = sanitizedItems
        .map((it) => it.foodItemId)
        .filter((id) => mongoose.isValidObjectId(id));
      if (foodItemIds.length > 0) {
        const foundFoodItems = await FoodItem.find({ _id: { $in: foodItemIds } }).lean();
        const foodItemMap = new Map(foundFoodItems.map((f) => [String(f._id), f]));

        for (const orderItem of sanitizedItems) {
          const dbItem = foodItemMap.get(String(orderItem.foodItemId));
          if (dbItem) {
            if (dbItem.isActive === false) {
              return res.status(400).json({
                message: `"${orderItem.name}" is currently unavailable.`,
                code: 'ITEM_UNAVAILABLE',
              });
            }
            if (orderItem.variant && Array.isArray(dbItem.variants) && dbItem.variants.length > 0) {
              const matchedVar = dbItem.variants.find(
                (v) => String(v.name).trim().toLowerCase() === String(orderItem.variant).trim().toLowerCase(),
              );
              if (matchedVar) {
                if (matchedVar.isAvailable === false || Number(matchedVar.quantity || 0) <= 0) {
                  return res.status(400).json({
                    message: `Selected variant "${orderItem.variant}" for "${orderItem.name}" is finished / out of stock.`,
                    code: 'VARIANT_OUT_OF_STOCK',
                  });
                }
              }
            }
          }
        }
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
      if (
        !shopUser &&
        restaurantIdStr &&
        mongoose.isValidObjectId(restaurantIdStr)
      ) {
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

      const defaultAddrDoc =
        (await Address.findOne({
          userId: user.userId,
          isDefault: true,
        }).lean()) || (await Address.findOne({ userId: user.userId }).lean());

      const customerDefaultPincode = defaultAddrDoc
        ? resolveAddressPincode(defaultAddrDoc)
        : (customer as any)?.pincode || (customer as any)?.postalCode || '';

      let deliveryAddress = req.body?.deliveryAddress;
      const addressId = req.body?.addressId;

      if (!deliveryAddress || !deliveryAddress.line1) {
        const savedAddress =
          (addressId && mongoose.isValidObjectId(addressId)
            ? await Address.findOne({
                _id: new mongoose.Types.ObjectId(addressId),
                userId: user.userId,
              }).lean()
            : null) || defaultAddrDoc;

        if (savedAddress) {
          deliveryAddress = {
            label: savedAddress.label || 'Home',
            phone: savedAddress.phone || customer?.phone || '',
            line1: savedAddress.line1,
            line2: savedAddress.line2 || '',
            city: savedAddress.city,
            state: savedAddress.state || '',
            postalCode: savedAddress.postalCode || '',
            digipin: savedAddress.digipin || '',
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
            postalCode: customerDefaultPincode || '',
            digipin: '',
            coordinates: [77.5946, 12.9716],
          };
        }
      }

      // Resolve delivery coordinates
      let delivLat: number | null = null;
      let delivLng: number | null = null;
      if (deliveryAddress.digipin) {
        const dgpCoords = resolveCoordinatesFromDigipin(
          deliveryAddress.digipin,
        );
        if (dgpCoords) {
          delivLat = dgpCoords.lat;
          delivLng = dgpCoords.lng;
        }
      }
      if (delivLat === null || delivLng === null) {
        const rawPin =
          resolveAddressPincode(deliveryAddress) || customerDefaultPincode;
        if (rawPin) {
          const pinCoords = resolveCoordinatesFromPincode(rawPin);
          if (pinCoords) {
            delivLat = pinCoords.lat;
            delivLng = pinCoords.lng;
          }
        }
      }
      if (delivLat === null || delivLng === null) {
        if (
          Array.isArray(deliveryAddress.coordinates) &&
          deliveryAddress.coordinates.length >= 2
        ) {
          const cLng = Number(deliveryAddress.coordinates[0]);
          const cLat = Number(deliveryAddress.coordinates[1]);
          if (!isNaN(cLat) && !isNaN(cLng) && (cLat !== 0 || cLng !== 0)) {
            delivLat = cLat;
            delivLng = cLng;
          }
        }
      }
      if (delivLat === null || delivLng === null) {
        delivLat = 12.9716;
        delivLng = 77.5946;
      }

      // 1. Resolve delivery location pincode from deliveryAddress.postalCode, digipin, coordinates, or customer default address
      let deliveryPincode = resolveAddressPincode(deliveryAddress);
      if (!deliveryPincode && deliveryAddress?.digipin) {
        const pinMatch = String(deliveryAddress.digipin).match(/\b\d{6}\b/);
        if (pinMatch) {
          deliveryPincode = pinMatch[0];
        } else {
          const dgpCoords = resolveCoordinatesFromDigipin(
            deliveryAddress.digipin,
          );
          if (dgpCoords) {
            if (
              calculateDistanceKm(
                dgpCoords.lat,
                dgpCoords.lng,
                18.5707,
                73.6908,
              ) <= 25
            )
              deliveryPincode = '411057';
            else if (
              calculateDistanceKm(
                dgpCoords.lat,
                dgpCoords.lng,
                26.6471,
                84.9085,
              ) <= 25
            )
              deliveryPincode = '845401';
            else if (
              calculateDistanceKm(
                dgpCoords.lat,
                dgpCoords.lng,
                12.9716,
                77.5946,
              ) <= 25
            )
              deliveryPincode = '560001';
          }
        }
      }
      if (!deliveryPincode && delivLat !== null && delivLng !== null) {
        if (calculateDistanceKm(delivLat, delivLng, 18.5707, 73.6908) <= 25)
          deliveryPincode = '411057';
        else if (
          calculateDistanceKm(delivLat, delivLng, 26.6471, 84.9085) <= 25
        )
          deliveryPincode = '845401';
        else if (
          calculateDistanceKm(delivLat, delivLng, 12.9716, 77.5946) <= 25
        )
          deliveryPincode = '560001';
      }
      if (!deliveryPincode) {
        deliveryPincode = customerDefaultPincode;
      }

      // Requirement: Customer delivery location, current location or digipin must be in serviceable location before placing order
      const serviceablePincodes = await getServiceablePincodes();
      if (!deliveryPincode || !serviceablePincodes.includes(deliveryPincode)) {
        return res.status(400).json({
          message:
            'your area is not in servicable range for now, update your address and pincode for orders.',
          code: 'AREA_OUT_OF_SERVICEABLE_RANGE',
          customerPincode: deliveryPincode || '',
          deliveryPincode: deliveryPincode || '',
          serviceablePincodes,
        });
      }

      if (isShopOrder) {
        if (!shopUser) {
          shopUser = await Shop.findOne({ isBlocked: { $ne: true } });
        }
        if (shopUser) {
          if (shopUser.isApproved === false) {
            return res.status(400).json({
              message: `Shop "${shopUser.name}" is not approved to provide service.`,
              code: 'STORE_NOT_APPROVED',
            });
          }
          // Enforce 15km distance check
          const storeCoords = getStoreCoordinates(shopUser);
          if (storeCoords && delivLat !== null && delivLng !== null) {
            const distanceKm = Number(
              calculateDistanceKm(
                delivLat,
                delivLng,
                storeCoords.lat,
                storeCoords.lng,
              ).toFixed(2),
            );
            if (distanceKm > 15.0) {
              return res.status(400).json({
                message: 'Shop is too far from you',
                code: 'STORE_TOO_FAR',
                distanceKm,
                storeName: shopUser.name || 'Shop',
              });
            }
          }
          if (shopUser.isOpen === false || shopUser.isOnline === false) {
            return res.status(400).json({
              message: `${shopUser.name} is currently closed and not accepting orders. Please choose another shop or try again later.`,
            });
          }
        }
      } else {
        if (!restaurantUser) {
          restaurantUser = await Restaurant.findOne({
            isBlocked: { $ne: true },
          });
        }
        if (restaurantUser) {
          if (restaurantUser.isApproved === false) {
            return res.status(400).json({
              message: `Restaurant "${restaurantUser.name}" is not approved to provide service.`,
              code: 'STORE_NOT_APPROVED',
            });
          }
          // Enforce 15km distance check
          const storeCoords = getStoreCoordinates(restaurantUser);
          if (storeCoords && delivLat !== null && delivLng !== null) {
            const distanceKm = Number(
              calculateDistanceKm(
                delivLat,
                delivLng,
                storeCoords.lat,
                storeCoords.lng,
              ).toFixed(2),
            );
            if (distanceKm > 15.0) {
              return res.status(400).json({
                message: 'Restaurant is too far from you',
                code: 'STORE_TOO_FAR',
                distanceKm,
                storeName: restaurantUser.name || 'Restaurant',
              });
            }
          }
          if (
            restaurantUser.isOpen === false ||
            restaurantUser.isOnline === false
          ) {
            return res.status(400).json({
              message: `${restaurantUser.name} is currently closed and not accepting orders. Please choose another restaurant or try again later.`,
            });
          }
        }
      }

      // Requirement: current selected pincode must be matching with the admin from which restaurant's pincode is matching
      const targetPartner = isShopOrder ? shopUser : restaurantUser;
      const storePin = targetPartner
        ? resolvePartnerPincode(targetPartner)
        : '';
      if (!storePin || !serviceablePincodes.includes(storePin)) {
        return res.status(400).json({
          message:
            'your area is not in servicable range for now, update your address and pincode for orders.',
          code: 'STORE_OUT_OF_SERVICEABLE_RANGE',
          storePincode: storePin || '',
          serviceablePincodes,
        });
      }

      const adminList = await getAdminPincodeMap();
      const adminMatch = matchAdminForPincodes(
        deliveryPincode,
        storePin,
        adminList,
      );
      if (!adminMatch.matched) {
        return res.status(400).json({
          message:
            'your area is not in servicable range for now, update your address and pincode for orders.',
          code: 'ADMIN_ZONE_MISMATCH',
          deliveryPincode,
          storePincode: storePin,
          serviceablePincodes,
        });
      }

      const storeId = isShopOrder
        ? (shopUser?._id as mongoose.Types.ObjectId)
        : restaurantUser
          ? (restaurantUser._id as mongoose.Types.ObjectId)
          : undefined;
      const storeCode = isShopOrder
        ? shopUser?.shopId || 'shop-1001'
        : restaurantUser?.restaurantId || '';
      const digipin = isShopOrder
        ? shopUser?.digipin || ''
        : restaurantUser?.digipin || '';
      const storeName = isShopOrder
        ? shopUser?.name || 'Tomato Partner Shop'
        : restaurantUser
          ? restaurantUser.name
          : 'Tomato Partner Restaurant';
      let defaultStoreAddr = '12 Indiranagar 100ft Road, Bengaluru, 560038';
      let defaultStoreLoc = { lat: 12.9716, lng: 77.5946 };
      if (deliveryPincode === '411057') {
        defaultStoreAddr = 'Hinjewadi Phase 3, Pune, 411057';
        defaultStoreLoc = { lat: 18.5707, lng: 73.6908 };
      } else if (deliveryPincode === '845401') {
        defaultStoreAddr = 'Main Road, Balua Chowk, Motihari, 845401';
        defaultStoreLoc = { lat: 26.6471, lng: 84.9085 };
      }

      const storeAddress = isShopOrder
        ? shopUser?.shopAddress || defaultStoreAddr
        : restaurantUser?.restaurantAddress || defaultStoreAddr;
      const storeLocation = isShopOrder
        ? shopUser?.shopLocation || defaultStoreLoc
        : restaurantUser?.restaurantLocation || defaultStoreLoc;

      // Find eligible riders
      const allRiders = await Rider.find({
        isBlocked: { $ne: true },
        isApproved: { $ne: false },
      }).lean();

      // Evaluate 1 coupon during billing
      const rawCouponCodes: string[] = Array.isArray(req.body?.couponCodes)
        ? req.body.couponCodes
        : req.body?.couponCode
          ? [String(req.body.couponCode)]
          : [];

      if (rawCouponCodes.length > MAX_COUPONS_PER_ORDER) {
        return res.status(400).json({
          message: `Only ${MAX_COUPONS_PER_ORDER} coupon code can be used per order.`,
          code: 'MAX_COUPONS_EXCEEDED',
        });
      }

      const couponEval = await evaluateCouponsForCart({
        couponCodes: rawCouponCodes,
        userId: String(user.userId),
        isShopOrder,
        storeId: storeId ? String(storeId) : undefined,
        items: sanitizedItems,
      });

      if (rawCouponCodes.length > 0 && !couponEval.valid) {
        return res.status(400).json({
          message:
            couponEval.message ||
            'One or more selected coupons are invalid for this order.',
          code: 'INVALID_COUPON',
          rejectedCoupons: couponEval.rejectedCoupons,
        });
      }

      const discountAmount = Number(couponEval.totalDiscount || 0);
      const appliedCoupons = couponEval.appliedCoupons.map((ac) => ({
        code: ac.code,
        title: ac.title,
        couponType: ac.couponType,
        sponsorType: ac.sponsorType,
        discountAmount: ac.discountAmount,
      }));
      const couponCodes = appliedCoupons.map((ac) => ac.code);
      const finalTotalAmount = Math.max(
        1,
        Number((subtotal + tax + deliveryFee - discountAmount).toFixed(2)),
      );

      const paymentMethod = [
        'card',
        'upi',
        'netbanking',
        'cod',
        'razorpay',
      ].includes(req.body?.paymentMethod)
        ? req.body.paymentMethod
        : 'card';
      const paymentTransactionId =
        req.body?.paymentTransactionId ||
        req.body?.utrNumber ||
        req.body?.utrReference ||
        (paymentMethod === 'cod'
          ? 'COD-PAY-ON-DELIVERY'
          : `TXN_${Date.now()}_${Math.random().toString(36).substring(2, 7).toUpperCase()}`);
      const utrNumber =
        req.body?.utrNumber ||
        req.body?.utrReference ||
        (paymentMethod === 'razorpay' ? paymentTransactionId : '');
      const utrReference = req.body?.utrReference || req.body?.utrNumber || '';
      const paymentStatus = paymentMethod === 'cod' ? 'pending' : 'paid';

      const dateStr = getIndianStandardDateString();
      const prefix = isShopOrder ? 'SHOP' : 'TOM';
      let orderNumberSuffix = await getNextCounterValue(
        `orderId_${dateStr}`,
        1000,
      );
      await getNextCounterValue('orderId', 1000);
      let orderNumber = `${prefix}-${dateStr}-${orderNumberSuffix}`;
      let billNumber = `BILL-${prefix}-${dateStr}-${orderNumberSuffix}`;

      // Ensure candidate order number is strictly unique in both Order and ShopOrder collections
      let collisionChecks = 0;
      while (collisionChecks < 50) {
        const [existingInOrders, existingInShopOrders] = await Promise.all([
          Order.exists({ orderNumber }),
          ShopOrder.exists({ orderNumber }),
        ]);
        if (!existingInOrders && !existingInShopOrders) {
          break;
        }
        orderNumberSuffix = await getNextCounterValue(
          `orderId_${dateStr}`,
          1000,
        );
        await getNextCounterValue('orderId', 1000);
        orderNumber = `${prefix}-${dateStr}-${orderNumberSuffix}`;
        billNumber = `BILL-${prefix}-${dateStr}-${orderNumberSuffix}`;
        collisionChecks++;
      }

      const orderData: Record<string, unknown> = {
        orderNumber,
        billNumber,
        customerId: new mongoose.Types.ObjectId(user.userId),
        customerName: customer?.name || 'Customer',
        customerPhone: customer?.phone || '',
        customerEmail:
          (typeof req.body?.email === 'string' && req.body.email.trim()) ||
          customer?.email ||
          user.email ||
          '',
        restaurantCode: storeCode,
        digipin,
        restaurantName: storeName,
        restaurantAddress: storeAddress,
        restaurantLocation: storeLocation,
        items: sanitizedItems,
        subtotal,
        tax,
        deliveryFee,
        discountAmount,
        couponCodes,
        appliedCoupons,
        totalAmount: finalTotalAmount,
        deliveryAddress,
        serviceablePincode: deliveryPincode,
        riderId: null,
        riderCode: '',
        riderName: '',
        riderPhone: '',
        paymentStatus,
        paymentMethod,
        paymentTransactionId,
        utrNumber,
        utrReference,
        status: 'placed',
        statusHistory: [
          {
            status: 'placed',
            at: new Date(),
            by: String(user.userId),
            note: `Order placed to ${isShopOrder ? 'shop' : 'restaurant'} and paid via ${paymentMethod.toUpperCase()}${couponCodes.length ? ` (Coupons: ${couponCodes.join(', ')}, Saved ₹${discountAmount})` : ''}`,
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

      // Notify online riders about the new placed pickup
      const onlineLocationRiders = allRiders.filter(
        (r) => r.isOnline !== false,
      );
      const targetRidersToNotify =
        onlineLocationRiders.length > 0 ? onlineLocationRiders : allRiders;

      for (const r of targetRidersToNotify) {
        await notificationService.createNotification({
          userId: String(r._id),
          role: 'deliveryPartner',
          title: `🚴 New Delivery Order Placed (#${orderNumber})!`,
          message: `Order #${orderNumber} from ${storeName} for ₹${finalTotalAmount} is available for pickup in your area (${deliveryPincode}).`,
          type: 'order',
          entityId: String(order._id),
          metadata: {
            orderId: String(order._id),
            orderNumber,
            totalAmount: finalTotalAmount,
            pincode: deliveryPincode,
          },
        });
      }

      // Record coupon usage if any coupons were applied
      if (couponEval.appliedCoupons.length > 0) {
        await recordCouponRedemptions({
          appliedCoupons: couponEval.appliedCoupons,
          userId: String(user.userId),
          customerCode: (customer as any)?.customerId || '',
          customerName: customer?.name || 'Customer',
          orderNumber,
        });
      }

      // Record order payment into Tomato's centralized payments ledger
      await syncOrderToTomatoPayment(order, isShopOrder);

      // If this is a shop order, also create in ShopOrder collection & notify shop
      if (isShopOrder && shopUser) {
        try {
          await ShopOrder.findOneAndUpdate(
            { orderNumber },
            {
              $set: {
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
                discountAmount,
                couponCodes,
                appliedCoupons,
                totalAmount: finalTotalAmount,
                deliveryAddress,
                serviceablePincode: deliveryPincode,
                paymentStatus,
                paymentMethod,
                paymentTransactionId,
                status: 'placed',
                statusHistory: [
                  {
                    status: 'placed',
                    at: new Date(),
                    by: String(user.userId),
                    note: `Order placed to shop and paid via ${paymentMethod.toUpperCase()}${couponCodes.length ? ` (Coupons: ${couponCodes.join(', ')}, Saved ₹${discountAmount})` : ''}`,
                  },
                ],
                ...(paymentStatus === 'paid' ? { paidAt: new Date() } : {}),
              },
            },
            { upsert: true, returnDocument: 'after' },
          );
        } catch (shopOrderErr) {
          console.error('[ShopOrder Sync Error]:', shopOrderErr);
        }

        try {
          await Notification.create({
            userId: shopUser._id,
            role: 'shop',
            title: 'New Customer Order Received',
            message: `New Order #${orderNumber} received for ₹${totalAmount} from ${customer?.name || 'Customer'}.`,
            type: 'order',
            entityId: String(order._id),
          });
        } catch (notifErr) {
          console.warn('[Shop Notification Error]:', notifErr);
        }
      } else {
        await notificationService.notifyRestaurantOnOrderPlaced(order);
      }

      // Dispatch order confirmation email dynamically to the customer mail ID
      const customerEmail =
        (typeof req.body?.email === 'string' && req.body.email.trim()) ||
        (typeof req.body?.deliveryAddress?.email === 'string' && req.body.deliveryAddress.email.trim()) ||
        customer?.email ||
        user.email;

      if (customerEmail) {
        mailService
          .sendOrderPlacedMail({
            customerEmail,
            customerName: customer?.name || user.name || 'Valued Customer',
            orderNumber,
            billNumber,
            storeName,
            storeAddress,
            isShopOrder,
            items: sanitizedItems.map((it: SanitizedOrderItem) => ({
              name: it.name,
              quantity: it.quantity,
              price: it.price,
              totalPrice: it.totalPrice,
            })),
            subtotal,
            tax,
            deliveryFee,
            discountAmount,
            couponCodes,
            totalAmount: finalTotalAmount,
            paymentMethod,
            paymentStatus,
            deliveryAddress,
            orderDate: new Date(),
          })
          .catch((mailErr) =>
            console.error('[Mail Service] Order confirmation email error:', mailErr),
          );
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
      }).sort({ createdAt: -1 }).lean();

      const augmentedOrders = orders.map((o: any) => {
        const storeLoc = o.restaurantLocation || { lat: 12.9716, lng: 77.5946 };
        const custCoords =
          o.deliveryAddress?.coordinates &&
          Array.isArray(o.deliveryAddress.coordinates) &&
          o.deliveryAddress.coordinates.length >= 2
            ? {
                lng: Number(o.deliveryAddress.coordinates[0]),
                lat: Number(o.deliveryAddress.coordinates[1]),
              }
            : { lat: 12.9716, lng: 77.5946 };

        let distanceKm = 0;
        if (storeLoc && custCoords) {
          distanceKm = Number(
            calculateDistanceKm(
              storeLoc.lat,
              storeLoc.lng,
              custCoords.lat,
              custCoords.lng,
            ).toFixed(1),
          );
        }

        const expectedDeliveryTimingMinutes = Math.max(1, Math.round(5 + 2 * distanceKm));
        const isPickedUp = Boolean(o.isPickedUp);
        const pickupStatus =
          o.pickupStatus || (isPickedUp ? 'picked_up' : (o.riderId ? 'way_to_pickup' : ''));

        return {
          ...o,
          distanceToStoreKm: distanceKm,
          expectedDeliveryTimingMinutes,
          isPickedUp,
          pickupStatus,
        };
      });

      return res.json({ orders: augmentedOrders });
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

      const [restaurantUser, shopUser, customerUser, adminGsn] =
        await Promise.all([
          order.restaurantId
            ? await Restaurant.findById(order.restaurantId).lean()
            : null,
          order.restaurantId
            ? await Shop.findById(order.restaurantId).lean()
            : null,
          order.customerId
            ? await Customer.findById(order.customerId).lean()
            : null,
          resolveAdminGsnNumber(),
        ]);

      const bill = formatBill(
        order,
        (restaurantUser || shopUser) as any,
        customerUser as any,
        adminGsn,
      );
      return res.json({ bill });
    } catch (error) {
      console.error('Customer bill fetch failed:', error);
      return res.status(500).json({ message: 'Unable to generate bill' });
    }
  });

  // 7b. Apply or update coupon code(s) on an order bill to reduce the bill amount
  router.post(
    '/orders/:orderId/apply-coupon',
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

        const order = await Order.findOne({
          _id: new mongoose.Types.ObjectId(orderId),
          customerId: new mongoose.Types.ObjectId(user.userId),
        });
        if (!order) return res.status(404).json({ message: 'Order not found' });

        const rawCodes: string[] = Array.isArray(req.body?.couponCodes)
          ? req.body.couponCodes
          : req.body?.couponCode
            ? [String(req.body.couponCode)]
            : [];

        const cleanCodes = Array.from(
          new Set(
            rawCodes
              .map((c) =>
                String(c || '')
                  .trim()
                  .toUpperCase(),
              )
              .filter(Boolean),
          ),
        );

        if (cleanCodes.length > MAX_COUPONS_PER_ORDER) {
          return res.status(400).json({
            message: `Only ${MAX_COUPONS_PER_ORDER} coupon code can be used on a bill.`,
          });
        }

        const [restaurantUser, shopUser, customerUser, adminGsn] =
          await Promise.all([
            order.restaurantId
              ? await Restaurant.findById(order.restaurantId).lean()
              : null,
            order.restaurantId
              ? await Shop.findById(order.restaurantId).lean()
              : null,
            order.customerId
              ? await Customer.findById(order.customerId).lean()
              : null,
            resolveAdminGsnNumber(),
          ]);

        const isShopOrder =
          Boolean(shopUser) ||
          String(order.orderNumber || '').startsWith('SHOP-');

        if (cleanCodes.length === 0) {
          order.discountAmount = 0;
          order.couponCodes = [];
          order.appliedCoupons = [];
          order.totalAmount = Number(
            (
              Number(order.subtotal || 0) +
              Number(order.tax || 0) +
              Number(order.deliveryFee ?? 40)
            ).toFixed(2),
          );
          await order.save();
          if (isShopOrder) {
            await ShopOrder.updateOne(
              { orderNumber: order.orderNumber },
              {
                $set: {
                  discountAmount: 0,
                  couponCodes: [],
                  appliedCoupons: [],
                  totalAmount: order.totalAmount,
                },
              },
            );
          }
          await syncOrderToTomatoPayment(order, isShopOrder);
          const bill = formatBill(
            order,
            (restaurantUser || shopUser) as any,
            customerUser as any,
            adminGsn,
          );
          return res.json({
            message: 'Coupons cleared from bill.',
            bill,
            order,
          });
        }

        const evalResult = await evaluateCouponsForCart({
          couponCodes: cleanCodes,
          userId: String(user.userId),
          isShopOrder,
          storeId: String((order as any).shopId || order.restaurantId || ''),
          items: order.items || [],
          ignoreOrderCountForNewUser: true,
        });

        if (!evalResult.valid) {
          return res.status(400).json({
            message:
              evalResult.message || 'Coupon code is not valid for this bill.',
            rejectedCoupons: evalResult.rejectedCoupons,
          });
        }

        const discountAmount = Number(evalResult.totalDiscount || 0);
        const appliedCoupons = evalResult.appliedCoupons.map((ac) => ({
          code: ac.code,
          title: ac.title,
          couponType: ac.couponType,
          sponsorType: ac.sponsorType,
          discountAmount: ac.discountAmount,
        }));
        const couponCodes = appliedCoupons.map((ac) => ac.code);
        const gross =
          Number(order.subtotal || 0) +
          Number(order.tax || 0) +
          Number(order.deliveryFee ?? 40);
        const newTotal = Math.max(
          1,
          Number((gross - discountAmount).toFixed(2)),
        );

        order.discountAmount = discountAmount;
        order.couponCodes = couponCodes;
        order.appliedCoupons = appliedCoupons;
        order.totalAmount = newTotal;
        await order.save();

        if (isShopOrder) {
          await ShopOrder.updateOne(
            { orderNumber: order.orderNumber },
            {
              $set: {
                discountAmount,
                couponCodes,
                appliedCoupons,
                totalAmount: newTotal,
              },
            },
          );
        }
        await syncOrderToTomatoPayment(order, isShopOrder);

        const bill = formatBill(
          order,
          (restaurantUser || shopUser) as any,
          customerUser as any,
          adminGsn,
        );
        return res.json({
          message: `Coupon (${couponCodes.join(' + ')}) applied! Bill reduced by ₹${discountAmount.toFixed(2)}.`,
          bill,
          order,
        });
      } catch (error) {
        console.error('Apply coupon to bill failed:', error);
        return res
          .status(500)
          .json({ message: 'Unable to apply coupon to bill' });
      }
    },
  );

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

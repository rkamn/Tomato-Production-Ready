import Order, { IOrder } from '../model/Order.js';
import Restaurant from '../model/Restaurant.js';
import Rider from '../model/Rider.js';
import Employee from '../model/Employee.js';
import notificationService from '../modules/notification/notificationService.js';
import {
  resolveLocationFromDigipinOrPincode,
  resolveCoordinatesFromDigipin,
  resolveCoordinatesFromPincode,
} from './bankHelpers.js';

/**
 * Formats a date into YYYYMMDD string according to Indian Standard Time (IST / Asia/Kolkata).
 * Ensures order numbers generated after midnight IST align with the local Indian calendar day.
 */
export const getIndianStandardDateString = (date: Date = new Date()): string => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(date)
    .replace(/-/g, '');
};

export const resolveAdminGsnNumber = async (): Promise<string> => {
  try {
    const adminDoc = await Employee.findOne({
      role: 'admin',
      gsnNumber: { $exists: true, $ne: '' },
    })
      .select('gsnNumber')
      .lean();
    return adminDoc?.gsnNumber ? String(adminDoc.gsnNumber).trim() : '';
  } catch {
    return '';
  }
};

export const createNotificationForRole = async (args: {
  userId: string;
  role: 'customer' | 'restaurant' | 'deliveryPartner' | 'admin' | 'subadmin';
  title: string;
  message: string;
  type?: 'order' | 'menu' | 'service' | 'system';
  entityId?: string;
  metadata?: Record<string, unknown>;
}) => {
  return await notificationService.createNotification(args);
};

export const formatBill = (
  order: IOrder,
  restaurantUser?: any | null,
  customerUser?: any | null,
  adminGsnNumber?: string,
) => {
  const subtotal = order.subtotal || 0;
  const cgst = Number((subtotal * 0.025).toFixed(2));
  const sgst = Number((subtotal * 0.025).toFixed(2));
  const tax = Number((cgst + sgst).toFixed(2));
  const deliveryFee = order.deliveryFee ?? 40;
  const discountAmount = Number(order.discountAmount || 0);
  const couponCodes = Array.isArray(order.couponCodes) ? order.couponCodes : [];
  const appliedCoupons = Array.isArray(order.appliedCoupons)
    ? order.appliedCoupons
    : [];
  const grossAmount = Number((subtotal + tax + deliveryFee).toFixed(2));
  const computedNetAmount = Math.max(
    0,
    Number((grossAmount - discountAmount).toFixed(2)),
  );
  const totalAmount =
    discountAmount > 0
      ? computedNetAmount
      : order.totalAmount !== undefined
      ? order.totalAmount
      : computedNetAmount;

  const rawPartnerGsn = String(
    restaurantUser?.gsnNumber || (order as any)?.gsnNumber || '',
  ).trim();
  const partnerGsn = rawPartnerGsn && rawPartnerGsn !== '' ? rawPartnerGsn : 'NA';
  const platformGsn = String(adminGsnNumber || '').trim();
  const effectiveGsn = partnerGsn;

  const partnerInfo = {
    name: order.restaurantName || restaurantUser?.name || 'Tomato Restaurant',
    address:
      order.restaurantAddress ||
      restaurantUser?.restaurantAddress ||
      restaurantUser?.shopAddress ||
      '12 MG Road, Bengaluru, Karnataka 560001',
    phone: restaurantUser?.phone || '+91 98765 43210',
    gstin: effectiveGsn,
    gsnNumber: effectiveGsn,
    partnerGsnNumber: partnerGsn,
    platformGsnNumber: platformGsn,
  };

  return {
    orderId: String((order as any)._id || ''),
    invoiceNumber: order.billNumber || `BILL-${order.orderNumber}`,
    orderNumber: order.orderNumber,
    date: order.createdAt || new Date(),
    restaurant: partnerInfo,
    shop: partnerInfo,
    gsnNumber: effectiveGsn,
    platformGsnNumber: platformGsn,
    customer: {
      name: order.customerName || customerUser?.name || 'Customer',
      phone: order.customerPhone || customerUser?.phone || '',
      address: order.deliveryAddress || {
        line1: 'Delivery address',
        city: 'Bengaluru',
      },
    },
    items: (order.items || []).map((item) => ({
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      totalPrice: item.totalPrice || item.price * item.quantity,
    })),
    subtotal,
    cgst,
    sgst,
    tax,
    deliveryFee,
    grossAmount,
    discountAmount,
    couponCodes,
    appliedCoupons,
    totalAmount,
    paymentMethod: order.paymentMethod || 'cod',
    paymentStatus: order.paymentStatus || 'pending',
    paymentTransactionId: order.paymentTransactionId || 'N/A',
    orderStatus: order.status,
    rider: order.riderName
      ? { name: order.riderName, phone: order.riderPhone }
      : null,
  };
};

export const buildOrderLiveTrackingData = async (orderId: string) => {
  let order: any = await Order.findById(orderId).lean();
  let isShopOrder = false;
  if (!order) {
    const ShopOrderModel = (await import('../model/ShopOrder.js')).default;
    order = await ShopOrderModel.findById(orderId).lean();
    if (order) isShopOrder = true;
  }
  if (!order) return null;

  const statusLower = String(order.status || '').toLowerCase();
  const isTrackingClosed = statusLower === 'delivered' || statusLower === 'cancelled';

  let riderData: {
    id: string;
    riderId: string;
    name: string;
    displayName: string;
    phone: string;
    currentLocation: { lat: number; lng: number };
    location: { lat: number; lng: number };
    lastLocationUpdated: Date;
    isOnline: boolean;
  } | null = null;

  if ((order.riderId || order.riderPhone) && !isTrackingClosed) {
    let rider: any = null;
    // Live location of the rider is tracked based on his phone number or mobile number
    const riderPhone = order.riderPhone || (order as any).riderMobile || '';
    if (riderPhone) {
      const searchPhone = String(riderPhone).trim();
      const cleanPhone = searchPhone.replace(/[^\d+]/g, '');
      const last10 = cleanPhone.replace(/[^\d]/g, '').slice(-10);
      rider = await Rider.findOne({
        $or: [
          { phone: searchPhone },
          { phone: cleanPhone },
          ...(last10 ? [{ phone: new RegExp(last10 + '$') }] : []),
        ],
      }).lean();
    }
    if (!rider && order.riderId) {
      rider = await Rider.findById(order.riderId).lean();
    }
    if (rider) {
      const riderIdStr = rider.riderId || '';
      const loc = rider.currentLocation || { lat: 12.9716, lng: 77.5946 };
      riderData = {
        id: String(rider._id),
        riderId: riderIdStr,
        name: rider.name,
        displayName: rider.name,
        phone: rider.phone || riderPhone || '',
        currentLocation: loc,
        location: loc,
        lastLocationUpdated: rider.lastLocationUpdated || new Date(),
        isOnline: rider.isOnline ?? true,
      };
    }
  }

  let restaurantData: {
    restaurantId: string;
    name: string;
    displayName: string;
    address: string;
    location: { lat: number; lng: number };
    digipin: string;
    phone: string;
  } | null = null;

  if (isShopOrder && order.shopId) {
    const ShopModel = (await import('../model/Shop.js')).default;
    const shop = await ShopModel.findById(order.shopId).lean();
    if (shop) {
      const storeDigipin = shop.digipin || order.digipin || '';
      const storePincode = (shop as any).pincode || (shop as any).postalCode || order.serviceablePincode || '';
      const storeLoc = resolveLocationFromDigipinOrPincode(
        storeDigipin,
        storePincode,
        shop.shopLocation || order.shopLocation,
      );
      restaurantData = {
        restaurantId: shop.shopId || '',
        name: shop.name,
        displayName: shop.name,
        address: shop.shopAddress || order.shopAddress || '',
        location: storeLoc,
        digipin: storeDigipin,
        phone: shop.phone || '',
      };
    }
  } else if (order.restaurantId) {
    const rest = await Restaurant.findById(order.restaurantId).lean();
    if (rest) {
      const restIdStr = rest.restaurantId || '';
      const storeDigipin = rest.digipin || order.digipin || '';
      const storePincode = (rest as any).pincode || (rest as any).postalCode || order.serviceablePincode || '';
      const storeLoc = resolveLocationFromDigipinOrPincode(
        storeDigipin,
        storePincode,
        rest.restaurantLocation || order.restaurantLocation,
      );
      restaurantData = {
        restaurantId: restIdStr,
        name: rest.name,
        displayName: rest.name,
        address: rest.restaurantAddress || order.restaurantAddress || '',
        location: storeLoc,
        digipin: storeDigipin,
        phone: rest.phone || '',
      };
    }
  }

  if (!restaurantData) {
    const fallbackName = order.restaurantName || order.shopName || 'Restaurant';
    const storeDigipin = order.digipin || '';
    const storePincode = order.serviceablePincode || '';
    const storeLoc = resolveLocationFromDigipinOrPincode(
      storeDigipin,
      storePincode,
      order.restaurantLocation || order.shopLocation,
    );
    restaurantData = {
      restaurantId: order.restaurantCode || order.shopCode || '',
      name: fallbackName,
      displayName: fallbackName,
      address: order.restaurantAddress || order.shopAddress || 'Bengaluru',
      location: storeLoc,
      digipin: storeDigipin,
      phone: '',
    };
  }

  let distanceToPickupKm: number | null = null;
  let distanceToDeliveryKm: number | null = null;

  if (riderData && restaurantData) {
    const dLat =
      (restaurantData.location.lat - riderData.currentLocation.lat) *
      (Math.PI / 180);
    const dLng =
      (restaurantData.location.lng - riderData.currentLocation.lng) *
      (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(riderData.currentLocation.lat * (Math.PI / 180)) *
        Math.cos(restaurantData.location.lat * (Math.PI / 180)) *
        Math.sin(dLng / 2) ** 2;
    distanceToPickupKm = Number(
      (6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2),
    );
  }

  const custDigipin = order.deliveryAddress?.digipin || (order as any).digipin || '';
  const custPincode = order.deliveryAddress?.postalCode || order.serviceablePincode || '';
  const hasCustomerSharedLiveGps = Boolean(
    order.customerLocationMode === 'customer_live_gps_shared' ||
    (order as any).customerSharedLocation?.lat !== undefined ||
    (order.deliveryAddress as any)?.isCurrentDeliveryLocation
  );
  const fallbackCustCoords =
    (order as any).customerSharedLocation?.lat !== undefined
      ? {
          lat: Number((order as any).customerSharedLocation.lat),
          lng: Number((order as any).customerSharedLocation.lng),
        }
      : order.deliveryAddress?.coordinates &&
        Array.isArray(order.deliveryAddress.coordinates) &&
        order.deliveryAddress.coordinates.length >= 2
        ? {
            lng: Number(order.deliveryAddress.coordinates[0]),
            lat: Number(order.deliveryAddress.coordinates[1]),
          }
        : undefined;

  let custCoords: { lat: number; lng: number };
  let custLocSource: 'digipin' | 'gps' = 'gps';

  // If customer explicitly shared current delivery GPS location, prioritize live GPS!
  if (hasCustomerSharedLiveGps && fallbackCustCoords && (fallbackCustCoords.lat !== 0 || fallbackCustCoords.lng !== 0)) {
    custCoords = fallbackCustCoords;
    custLocSource = 'gps';
  } else if (custDigipin) {
    // Primary: customer delivery address location derived strictly from DigiPin
    const dgp = resolveCoordinatesFromDigipin(custDigipin);
    if (dgp) {
      custCoords = dgp;
      custLocSource = 'digipin';
    } else {
      custCoords = resolveLocationFromDigipinOrPincode(
        custDigipin,
        custPincode,
        fallbackCustCoords,
      );
      custLocSource = 'digipin';
    }
  } else {
    // Requirement: If digipin is NOT set, ONLY then search for GPS location for customer by rider
    if (fallbackCustCoords && (fallbackCustCoords.lat !== 0 || fallbackCustCoords.lng !== 0)) {
      custCoords = fallbackCustCoords;
      custLocSource = 'gps';
    } else if (custPincode) {
      const pinC = resolveCoordinatesFromPincode(custPincode);
      custCoords = pinC || { lat: 12.9716, lng: 77.5946 };
      custLocSource = 'gps';
    } else {
      custCoords = { lat: 12.9716, lng: 77.5946 };
      custLocSource = 'gps';
    }
  }

  if (riderData) {
    const dLat = (custCoords.lat - riderData.currentLocation.lat) * (Math.PI / 180);
    const dLng = (custCoords.lng - riderData.currentLocation.lng) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(riderData.currentLocation.lat * (Math.PI / 180)) *
        Math.cos(custCoords.lat * (Math.PI / 180)) *
        Math.sin(dLng / 2) ** 2;
    distanceToDeliveryKm = Number(
      (6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2),
    );
  }

  let restaurantToCustomerDistanceKm: number = 0;
  if (restaurantData && custCoords) {
    const dLat = (custCoords.lat - restaurantData.location.lat) * (Math.PI / 180);
    const dLng = (custCoords.lng - restaurantData.location.lng) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(restaurantData.location.lat * (Math.PI / 180)) *
        Math.cos(custCoords.lat * (Math.PI / 180)) *
        Math.sin(dLng / 2) ** 2;
    restaurantToCustomerDistanceKm = Number(
      (6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2),
    );
  }

  const expectedDeliveryTimingMinutes = Math.max(1, Math.round(5 + 2 * restaurantToCustomerDistanceKm));
  const isPickedUp = Boolean(order.isPickedUp);
  const pickupStatus = order.pickupStatus || (isPickedUp ? 'picked_up' : (order.riderId ? 'way_to_pickup' : ''));

  const etaMinutes = isTrackingClosed
    ? 0
    : expectedDeliveryTimingMinutes;
  const lastPingSecondsAgo = riderData?.lastLocationUpdated
    ? Math.max(0, Math.round((Date.now() - new Date(riderData.lastLocationUpdated).getTime()) / 1000))
    : null;

  return {
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    status: order.status,
    trackingClosed: isTrackingClosed,
    customerId: String(order.customerId || ''),
    restaurantOwnerId: String(order.restaurantId || order.shopId || ''),
    riderUserId: order.riderId ? String(order.riderId) : '',
    restaurant: restaurantData,
    rider: riderData,
    customer: {
      name: order.customerName || 'Customer',
      phone: order.customerPhone || '',
      address: order.deliveryAddress || { line1: 'Delivery Address', city: 'Bengaluru' },
      location: custCoords,
      locationSource: custLocSource,
      digipin: custDigipin,
      pincode: custPincode,
      isLiveGpsShared: hasCustomerSharedLiveGps,
    },
    telemetry: {
      trackingMode: 'websocket_live_gps',
      riderTrackingMode: 'phone_mobile_number',
      riderPhone: riderData?.phone || order.riderPhone || '',
      customerLocationMode: hasCustomerSharedLiveGps
        ? 'customer_live_gps_shared'
        : (custLocSource === 'digipin' ? 'digipin_verified' : 'gps_search_fallback'),
      customerLocationSource: custLocSource,
      isLiveOnline: riderData ? riderData.isOnline : false,
      riderToRestaurantDistanceKm: isTrackingClosed ? 0 : (distanceToPickupKm ?? 0.85),
      riderToCustomerDistanceKm: isTrackingClosed ? 0 : (distanceToDeliveryKm ?? 1.45),
      etaMinutes,
      lastPingSecondsAgo,
    },
    deliveryAddress: order.deliveryAddress,
    distanceToPickupKm: isTrackingClosed ? 0 : distanceToPickupKm,
    distanceToDeliveryKm: isTrackingClosed ? 0 : distanceToDeliveryKm,
    restaurantToCustomerDistanceKm,
    expectedDeliveryTimingMinutes,
    isPickedUp,
    pickupStatus,
    pickedUpAt: order.pickedUpAt || null,
    estimatedMinutes: etaMinutes,
  };
};

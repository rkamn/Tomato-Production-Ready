import Order, { IOrder } from '../model/Order.js';
import Restaurant from '../model/Restaurant.js';
import Customer from '../model/Customer.js';
import Rider from '../model/Rider.js';
import notificationService from '../modules/notification/notificationService.js';

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
) => {
  const subtotal = order.subtotal || 0;
  const cgst = Number((subtotal * 0.025).toFixed(2));
  const sgst = Number((subtotal * 0.025).toFixed(2));
  const tax = Number((cgst + sgst).toFixed(2));
  const deliveryFee = order.deliveryFee ?? 40;
  const totalAmount = order.totalAmount || subtotal + tax + deliveryFee;

  return {
    invoiceNumber: order.billNumber || `BILL-${order.orderNumber}`,
    orderNumber: order.orderNumber,
    date: order.createdAt || new Date(),
    restaurant: {
      name: order.restaurantName || restaurantUser?.name || 'Tomato Restaurant',
      address:
        order.restaurantAddress ||
        restaurantUser?.restaurantAddress ||
        '12 MG Road, Bengaluru, Karnataka 560001',
      phone: restaurantUser?.phone || '+91 98765 43210',
      gstin: '29AABCT1337M1Z4',
    },
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
  const order = await Order.findById(orderId).lean();
  if (!order) return null;

  let riderData: {
    riderId: string;
    displayName: string;
    phone: string;
    currentLocation: { lat: number; lng: number };
    lastLocationUpdated: Date;
    isOnline: boolean;
  } | null = null;

  if (order.riderId) {
    const rider = await Rider.findById(order.riderId).lean();
    if (rider) {
      const riderIdStr = rider.riderId || '';
      riderData = {
        riderId: riderIdStr,
        displayName: rider.name,
        phone: rider.phone || '',
        currentLocation: rider.currentLocation || {
          lat: 12.9716,
          lng: 77.5946,
        },
        lastLocationUpdated: rider.lastLocationUpdated || new Date(),
        isOnline: rider.isOnline ?? true,
      };
    }
  }

  let restaurantData: {
    restaurantId: string;
    displayName: string;
    address: string;
    location: { lat: number; lng: number };
    digipin: string;
    phone: string;
  } | null = null;

  if (order.restaurantId) {
    const rest = await Restaurant.findById(order.restaurantId).lean();
    if (rest) {
      const restIdStr = rest.restaurantId || '';
      restaurantData = {
        restaurantId: restIdStr,
        displayName: rest.name,
        address: rest.restaurantAddress || order.restaurantAddress || '',
        location: rest.restaurantLocation ||
          order.restaurantLocation || { lat: 12.9716, lng: 77.5946 },
        digipin: rest.digipin || order.digipin || '',
        phone: rest.phone || '',
      };
    }
  }

  if (!restaurantData) {
    restaurantData = {
      restaurantId: order.restaurantCode || '',
      displayName: order.restaurantName || 'Restaurant',
      address: order.restaurantAddress || 'Bengaluru',
      location: order.restaurantLocation || { lat: 12.9716, lng: 77.5946 },
      digipin: order.digipin || '',
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

  if (
    riderData &&
    order.deliveryAddress?.coordinates &&
    Array.isArray(order.deliveryAddress.coordinates)
  ) {
    const custLng = order.deliveryAddress.coordinates[0];
    const custLat = order.deliveryAddress.coordinates[1];
    const dLat = (custLat - riderData.currentLocation.lat) * (Math.PI / 180);
    const dLng = (custLng - riderData.currentLocation.lng) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(riderData.currentLocation.lat * (Math.PI / 180)) *
        Math.cos(custLat * (Math.PI / 180)) *
        Math.sin(dLng / 2) ** 2;
    distanceToDeliveryKm = Number(
      (6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2),
    );
  }

  return {
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    status: order.status,
    restaurant: restaurantData,
    rider: riderData,
    deliveryAddress: order.deliveryAddress,
    distanceToPickupKm,
    distanceToDeliveryKm,
    estimatedMinutes: distanceToDeliveryKm
      ? Math.max(5, Math.round(distanceToDeliveryKm * 3.5))
      : 15,
  };
};

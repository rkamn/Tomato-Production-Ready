import { Response } from 'express';
import mongoose from 'mongoose';
import Notification, { INotification } from '../../model/Notification.js';
import Rider from '../../model/Rider.js';
import { IOrder } from '../../model/Order.js';

export interface NearbyRiderCandidate {
  riderId: string;
  name: string;
  phone: string;
  distanceKm: number;
}

/**
 * Calculates straight-line distance in kilometers between two GPS coordinates using the Haversine formula
 */
export function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's mean radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

interface SSEClient {
  userId: string;
  role: string;
  res: Response;
}

class NotificationService {
  private clients: SSEClient[] = [];

  constructor() {
    // Periodic global cleanup every hour to automatically delete notifications older than 7 days
    setInterval(async () => {
      try {
        await (Notification as any).cleanExpiredAndExcess();
      } catch (err) {
        console.error('Periodic notification purge error:', err);
      }
    }, 60 * 60 * 1000);
  }

  /**
   * Register a new client for Server-Sent Events (SSE)
   */
  public addSSEClient(userId: string, role: string, res: Response): void {
    const client: SSEClient = { userId, role, res };
    this.clients.push(client);

    // Send initial handshake event
    res.write(`event: connected\ndata: ${JSON.stringify({ message: 'Notification stream connected', userId, role })}\n\n`);

    // Keep-alive ping every 25 seconds
    const intervalId = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(intervalId);
      }
    }, 25000);

    res.on('close', () => {
      clearInterval(intervalId);
      this.removeSSEClient(client);
    });
  }

  private removeSSEClient(clientToRemove: SSEClient): void {
    this.clients = this.clients.filter((c) => c !== clientToRemove);
  }

  /**
   * Send live SSE event to all connected sessions of a specific user
   */
  private dispatchSSE(userId: string, eventName: string, payload: unknown): void {
    const matchingClients = this.clients.filter((c) => c.userId === String(userId));
    for (const client of matchingClients) {
      try {
        client.res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch (err) {
        console.error('Failed to write SSE to client:', err);
      }
    }
  }

  /**
   * Broadcast an event to all connected clients of a given role
   */
  private broadcastToRole(role: string, eventName: string, payload: unknown): void {
    const matchingClients = this.clients.filter((c) => c.role === role);
    for (const client of matchingClients) {
      try {
        client.res.write(`event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch (err) {
        console.error('Failed to broadcast SSE to role:', err);
      }
    }
  }

  /**
   * Save notification to MongoDB and dispatch live real-time event
   */
  public async createNotification(args: {
    userId: string;
    role: 'customer' | 'restaurant' | 'deliveryPartner' | 'admin' | 'subadmin';
    title: string;
    message: string;
    type?: 'order' | 'menu' | 'service' | 'system';
    entityId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<INotification | null> {
    try {
      const doc = await Notification.create({
        userId: String(args.userId),
        role: args.role,
        title: args.title,
        message: args.message,
        type: args.type || 'order',
        entityId: args.entityId || '',
        metadata: args.metadata || {},
      });

      // Dispatch live real-time event to the specific user's open browser tabs
      this.dispatchSSE(args.userId, 'notification', {
        id: doc._id,
        userId: doc.userId,
        role: doc.role,
        title: doc.title,
        message: doc.message,
        type: doc.type,
        entityId: doc.entityId,
        metadata: doc.metadata,
        createdAt: doc.createdAt,
      });

      return doc;
    } catch (error) {
      console.error('Notification creation failed:', error);
      return null;
    }
  }

  /**
   * Workflow 1: Customer places order -> Restaurant and Admin get notified
   */
  public async notifyRestaurantOnOrderPlaced(order: IOrder): Promise<void> {
    const itemsCount = (order.items || []).reduce((sum, i) => sum + (i.quantity || 1), 0);
    const orderId = String(order._id);

    // Notify Restaurant
    if (order.restaurantId) {
      await this.createNotification({
        userId: String(order.restaurantId),
        role: 'restaurant',
        title: `🚨 New Order #${order.orderNumber} Received!`,
        message: `${order.customerName || 'A customer'} placed an order with ${itemsCount} items (₹${order.totalAmount}). Please accept and start preparing.`,
        type: 'order',
        entityId: orderId,
        metadata: {
          orderId,
          orderNumber: order.orderNumber,
          totalAmount: order.totalAmount,
          customerName: order.customerName,
          itemsCount,
          action: 'view_order',
        },
      });
    }

    // Notify Customer
    if (order.customerId) {
      await this.createNotification({
        userId: String(order.customerId),
        role: 'customer',
        title: `Order #${order.orderNumber} Placed Successfully`,
        message: `Your food order of ₹${order.totalAmount} has been sent to ${order.restaurantName || 'the restaurant'}.`,
        type: 'order',
        entityId: orderId,
        metadata: {
          orderId,
          orderNumber: order.orderNumber,
          totalAmount: order.totalAmount,
        },
      });
    }

    // Also broadcast order alert to admins
    this.broadcastToRole('admin', 'order_placed', {
      orderId,
      orderNumber: order.orderNumber,
      totalAmount: order.totalAmount,
      restaurantName: order.restaurantName,
    });
  }

  /**
   * Find eligible delivery riders within a specified radius (default 2km) from restaurant.
   * Excludes any riders who have already rejected this order.
   */
  public async findNearestRidersForOrder(
    order: IOrder,
    radiusKm: number = 2.0
  ): Promise<NearbyRiderCandidate[]> {
    const restaurantLat = order.restaurantLocation?.lat ?? 12.9716;
    const restaurantLng = order.restaurantLocation?.lng ?? 77.5946;

    const rejectedIds = (order.rejectedByRiders || []).map((id) => String(id));

    // Query active and approved riders who have not rejected this order
    const activeRiders = await Rider.find({
      isBlocked: { $ne: true },
      isApproved: { $ne: false },
      _id: { $nin: rejectedIds },
    })
      .select('_id name phone currentLocation isOnline')
      .lean();

    const candidates: NearbyRiderCandidate[] = [];

    for (const rider of activeRiders) {
      const riderLat = rider.currentLocation?.lat ?? restaurantLat;
      const riderLng = rider.currentLocation?.lng ?? restaurantLng;

      const dist = calculateDistanceKm(restaurantLat, restaurantLng, riderLat, riderLng);
      candidates.push({
        riderId: String(rider._id),
        name: rider.name,
        phone: rider.phone || '',
        distanceKm: dist,
      });
    }

    // Sort by distance (nearest first)
    candidates.sort((a, b) => a.distanceKm - b.distanceKm);

    // Filter riders strictly within radiusKm (2km circle)
    const withinRadius = candidates.filter((c) => c.distanceKm <= radiusKm);

    if (withinRadius.length > 0) {
      return withinRadius;
    }

    // Fallback: If no rider is currently within 2km, take closest available riders so order isn't stranded
    return candidates.slice(0, 3);
  }

  /**
   * Workflow 2: Restaurant accepts order -> Customer gets notified,
   * AND Phone rings for all nearest riders within 2km circle from restaurant!
   */
  public async notifyRidersAndCustomerOnOrderAccepted(order: IOrder): Promise<void> {
    const orderId = String(order._id);

    // 1. Notify Customer that restaurant accepted & started cooking
    if (order.customerId) {
      await this.createNotification({
        userId: String(order.customerId),
        role: 'customer',
        title: `Kitchen Accepted Order #${order.orderNumber}!`,
        message: `Great news! ${order.restaurantName || 'The restaurant'} has accepted your order and started cooking freshly.`,
        type: 'order',
        entityId: orderId,
        metadata: {
          orderId,
          orderNumber: order.orderNumber,
          status: 'accepted',
        },
      });
    }

    // 2. Find all nearest riders within 2km circle from restaurant
    try {
      const targetRiders = await this.findNearestRidersForOrder(order, 2.0);

      for (const rider of targetRiders) {
        // High-priority Ringing Event dispatched directly to the rider's phone/browser
        const ringPayload = {
          orderId,
          orderNumber: order.orderNumber,
          restaurantName: order.restaurantName,
          restaurantAddress: order.restaurantAddress,
          restaurantLocation: order.restaurantLocation,
          deliveryAddress: order.deliveryAddress,
          totalAmount: order.totalAmount,
          distanceKm: rider.distanceKm,
          earningFee: 40,
          itemsCount: (order.items || []).reduce((sum, i) => sum + (i.quantity || 1), 0),
          ring: true,
          ringDurationSeconds: 45,
          canAccept: true,
          canReject: true,
        };

        // Dispatches real-time event to ring rider's phone and display Accept/Reject sheet
        this.dispatchSSE(rider.riderId, 'incoming_delivery_ring', ringPayload);

        await this.createNotification({
          userId: rider.riderId,
          role: 'deliveryPartner',
          title: `🚨 INCOMING PICKUP ALERT (#${order.orderNumber})!`,
          message: `Phone Ringing! ${order.restaurantName || 'Restaurant'} is ${rider.distanceKm} km away. Tap to Accept or Reject delivery.`,
          type: 'order',
          entityId: orderId,
          metadata: ringPayload,
        });
      }

      // Also broadcast live SSE event to all connected riders so their Available Pickups view auto-refreshes
      this.broadcastToRole('deliveryPartner', 'new_pickup_available', {
        orderId,
        orderNumber: order.orderNumber,
        restaurantName: order.restaurantName,
        totalAmount: order.totalAmount,
        radiusKm: 2.0,
      });
    } catch (err) {
      console.error('Failed to notify nearest riders on order acceptance:', err);
    }
  }

  /**
   * Rider rejects delivery order:
   * "if he will reject then it will go to all other riders present in 2km circle location from the restaturent"
   */
  public async handleRiderRejectOrder(
    order: IOrder,
    rejectingRiderId: string
  ): Promise<{ reassignedCount: number; message: string }> {
    const orderId = String(order._id);

    // Stop phone ringing on the rejecting rider's device immediately
    this.dispatchSSE(rejectingRiderId, 'dismiss_delivery_ring', {
      orderId,
      reason: 'rejected',
      message: 'Delivery offer declined',
    });

    // Add rider to order's rejected list
    if (!order.rejectedByRiders) {
      order.rejectedByRiders = [];
    }
    const alreadyRejected = order.rejectedByRiders.some((id) => String(id) === String(rejectingRiderId));
    if (!alreadyRejected) {
      order.rejectedByRiders.push(new mongoose.Types.ObjectId(rejectingRiderId));
      await order.save();
    }

    // Find ALL OTHER riders present in 2km circle location from the restaurant who haven't rejected
    const remainingRiders = await this.findNearestRidersForOrder(order, 2.0);

    for (const rider of remainingRiders) {
      const ringPayload = {
        orderId,
        orderNumber: order.orderNumber,
        restaurantName: order.restaurantName,
        restaurantAddress: order.restaurantAddress,
        restaurantLocation: order.restaurantLocation,
        deliveryAddress: order.deliveryAddress,
        totalAmount: order.totalAmount,
        distanceKm: rider.distanceKm,
        earningFee: 40,
        itemsCount: (order.items || []).reduce((sum, i) => sum + (i.quantity || 1), 0),
        ring: true,
        ringDurationSeconds: 45,
        canAccept: true,
        canReject: true,
        reassigned: true,
      };

      this.dispatchSSE(rider.riderId, 'incoming_delivery_ring', ringPayload);

      await this.createNotification({
        userId: rider.riderId,
        role: 'deliveryPartner',
        title: `🚨 INCOMING PICKUP ALERT (#${order.orderNumber})!`,
        message: `Phone Ringing! ${order.restaurantName || 'Restaurant'} is ${rider.distanceKm} km away. Tap to Accept or Reject delivery.`,
        type: 'order',
        entityId: orderId,
        metadata: ringPayload,
      });
    }

    return {
      reassignedCount: remainingRiders.length,
      message: `Delivery rejected. Re-routed to ${remainingRiders.length} other rider(s) within 2km of restaurant.`,
    };
  }

  /**
   * Workflow 3: Rider accepts delivery -> Customer and Restaurant get notified,
   * AND all other riders' ringing stops and dismisses the popup!
   */
  public async notifyOnRiderAccepted(order: IOrder, riderName: string, riderPhone?: string): Promise<void> {
    const orderId = String(order._id);

    // Stop phone ringing on ALL riders' devices since order has been claimed!
    this.broadcastToRole('deliveryPartner', 'delivery_claimed', {
      orderId,
      orderNumber: order.orderNumber,
      riderName,
      message: `Order #${order.orderNumber} has been accepted by ${riderName}.`,
    });

    // Notify Customer
    if (order.customerId) {
      await this.createNotification({
        userId: String(order.customerId),
        role: 'customer',
        title: `Rider Assigned (#${order.orderNumber})`,
        message: `Delivery partner ${riderName} has accepted your order and is on the way with your food.`,
        type: 'order',
        entityId: orderId,
        metadata: {
          orderId,
          orderNumber: order.orderNumber,
          riderName,
          riderPhone: riderPhone || '',
          status: 'out_for_delivery',
        },
      });
    }

    // Notify Restaurant
    if (order.restaurantId) {
      await this.createNotification({
        userId: String(order.restaurantId),
        role: 'restaurant',
        title: `Order Picked Up (#${order.orderNumber})`,
        message: `Delivery partner ${riderName} has claimed and picked up order #${order.orderNumber}.`,
        type: 'order',
        entityId: orderId,
        metadata: {
          orderId,
          orderNumber: order.orderNumber,
          riderName,
          status: 'out_for_delivery',
        },
      });
    }
  }

  /**
   * Workflow 4: Rider marks order as delivered -> Customer and Restaurant get notified
   */
  public async notifyOnDelivered(order: IOrder): Promise<void> {
    const orderId = String(order._id);

    // Notify Customer
    if (order.customerId) {
      await this.createNotification({
        userId: String(order.customerId),
        role: 'customer',
        title: `Delivered! Enjoy your meal (#${order.orderNumber})`,
        message: `Your food has been delivered to your doorstep. Bon appétit!`,
        type: 'order',
        entityId: orderId,
        metadata: {
          orderId,
          orderNumber: order.orderNumber,
          status: 'delivered',
        },
      });
    }

    // Notify Restaurant
    if (order.restaurantId) {
      await this.createNotification({
        userId: String(order.restaurantId),
        role: 'restaurant',
        title: `Order Delivered Successfully (#${order.orderNumber})`,
        message: `Order #${order.orderNumber} has been safely delivered to the customer.`,
        type: 'order',
        entityId: orderId,
        metadata: {
          orderId,
          orderNumber: order.orderNumber,
          status: 'delivered',
        },
      });
    }
  }
}

export const notificationService = new NotificationService();
export default notificationService;

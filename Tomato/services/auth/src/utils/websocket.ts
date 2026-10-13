import crypto from 'crypto';
import http from 'http';
import { Duplex } from 'stream';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Order from '../model/Order.js';
import ShopOrder from '../model/ShopOrder.js';
import Rider from '../model/Rider.js';
import { buildOrderLiveTrackingData } from './orderHelpers.js';

const WS_MAGIC_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export interface WsClientConnection {
  id: string;
  socket: Duplex;
  userId?: string;
  role?: string;
  subscribedOrderIds: Set<string>;
  subscribedFleet: boolean;
  isAlive: boolean;
}

const clients = new Set<WsClientConnection>();

/**
 * Encodes a UTF-8 string payload into an RFC 6455 WebSocket text frame (server -> client, unmasked).
 */
function encodeWsTextFrame(payload: string): Buffer {
  const data = Buffer.from(payload, 'utf8');
  const len = data.length;

  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81; // FIN + text frame (opcode 0x1)
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, data]);
}

function encodeWsControlFrame(opcode: number, payload: Buffer = Buffer.alloc(0)): Buffer {
  const len = Math.min(payload.length, 125);
  const header = Buffer.from([0x80 | (opcode & 0x0f), len]);
  return Buffer.concat([header, payload.subarray(0, len)]);
}

/**
 * Decodes one or more RFC 6455 frames from an incoming client buffer.
 */
function decodeWsFrames(buffer: Buffer): {
  messages: Array<{ opcode: number; payload: Buffer }>;
  remaining: Buffer;
} {
  const messages: Array<{ opcode: number; payload: Buffer }> = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const byte1 = buffer[offset]!;
    const byte2 = buffer[offset + 1]!;
    const opcode = byte1 & 0x0f;
    const isMasked = (byte2 & 0x80) !== 0;
    let payloadLen = byte2 & 0x7f;
    let headerLen = 2;

    if (payloadLen === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > buffer.length) break;
      payloadLen = Number(buffer.readBigUInt64BE(offset + 2));
      headerLen = 10;
    }

    const maskLen = isMasked ? 4 : 0;
    const totalFrameLen = headerLen + maskLen + payloadLen;
    if (offset + totalFrameLen > buffer.length) break;

    const maskStart = offset + headerLen;
    const payloadStart = maskStart + maskLen;
    const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + payloadLen));

    if (isMasked) {
      const mask = buffer.subarray(maskStart, maskStart + 4);
      for (let i = 0; i < payload.length; i++) {
        payload[i] = payload[i]! ^ mask[i % 4]!;
      }
    }

    messages.push({ opcode, payload });
    offset += totalFrameLen;
  }

  return {
    messages,
    remaining: buffer.subarray(offset),
  };
}

function sendJson(client: WsClientConnection, data: Record<string, unknown>) {
  if (client.socket.destroyed || !client.socket.writable) return;
  try {
    const frame = encodeWsTextFrame(JSON.stringify(data));
    client.socket.write(frame);
  } catch (err) {
    console.warn('[WebSocket send error]:', err);
  }
}

/**
 * Broadcasts live tracking telemetry for a specific order to all subscribed or involved clients
 * (Customer, Restaurant/Shop, Rider, and Admin/Sub-Admin).
 */
export async function broadcastOrderLiveTrackingUpdate(orderId: string) {
  if (!orderId || !mongoose.isValidObjectId(orderId)) return null;
  try {
    const tracking = await buildOrderLiveTrackingData(orderId);
    if (!tracking) return null;

    const payload = {
      type: 'order_live_tracking',
      orderId: String(tracking.orderId),
      tracking,
      timestamp: new Date().toISOString(),
    };

    for (const client of clients) {
      const isSubscribed = client.subscribedOrderIds.has(String(orderId));
      const isParticipant =
        Boolean(client.userId) &&
        (client.userId === tracking.customerId ||
          client.userId === tracking.restaurantOwnerId ||
          client.userId === tracking.riderUserId ||
          client.role === 'admin' ||
          client.role === 'subadmin');

      if (isSubscribed || isParticipant) {
        sendJson(client, payload);
      }
      if (tracking.trackingClosed && isSubscribed) {
        client.subscribedOrderIds.delete(String(orderId));
      }
    }
    return tracking;
  } catch (err) {
    console.error('[WebSocket broadcastOrderLiveTrackingUpdate error]:', err);
    return null;
  }
}

/**
 * Persists a Rider's live GPS coordinates and broadcasts real-time updates to:
 * 1. All active orders (Restaurant & Shop orders) currently assigned to this rider (picking up from restaurant/shop & delivering to customer address)
 * 2. Admin / Sub-Admin live fleet radar subscribers
 */
export async function handleRiderLocationRealtimeUpdate(args: {
  riderUserId: string;
  lat: number;
  lng: number;
  isOnline?: boolean;
}) {
  const { riderUserId, lat, lng, isOnline } = args;
  if (!riderUserId || !mongoose.isValidObjectId(riderUserId)) return null;

  const numLat = Number(lat);
  const numLng = Number(lng);
  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) return null;

  const updatedRider: any = await Rider.findByIdAndUpdate(
    riderUserId,
    {
      $set: {
        currentLocation: { lat: numLat, lng: numLng },
        isOnline: isOnline !== undefined ? Boolean(isOnline) : true,
        lastLocationUpdated: new Date(),
      },
    },
    { returnDocument: 'after' },
  ).lean();

  if (!updatedRider) return null;

  // Find all active orders assigned to this rider (picking up from restaurant/shop or out_for_delivery to customer)
  const riderObjId = new mongoose.Types.ObjectId(riderUserId);
  const [activeRestOrders, activeShopOrders] = await Promise.all([
    Order.find({
      riderId: riderObjId,
      status: { $in: ['accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery'] },
    })
      .select('_id')
      .lean(),
    ShopOrder.find({
      riderId: riderObjId,
      status: { $in: ['accepted', 'preparing', 'ready_for_pickup', 'out_for_delivery'] },
    })
      .select('_id')
      .lean(),
  ]);

  const activeOrderIds = [
    ...activeRestOrders.map((o) => String(o._id)),
    ...activeShopOrders.map((o) => String(o._id)),
  ];

  // Broadcast updated tracking telemetry for each active order assigned to this rider
  await Promise.all(activeOrderIds.map((oid) => broadcastOrderLiveTrackingUpdate(oid)));

  // Broadcast rider position to Admin Fleet Radar subscribers and the rider's own active sockets
  const riderBroadcastPayload = {
    type: 'rider_location_update',
    rider: {
      id: String(updatedRider._id),
      riderId: updatedRider.riderId || '',
      name: updatedRider.name,
      displayName: updatedRider.name,
      phone: updatedRider.phone || '',
      deliveryVehicle: updatedRider.deliveryVehicle || 'motorcycle',
      currentLocation: { lat: numLat, lng: numLng },
      isOnline: updatedRider.isOnline ?? true,
      lastLocationUpdated: updatedRider.lastLocationUpdated || new Date(),
      activeDeliveriesCount: activeOrderIds.length,
    },
    activeOrderIds,
    timestamp: new Date().toISOString(),
  };

  for (const client of clients) {
    if (
      client.subscribedFleet ||
      client.role === 'admin' ||
      client.role === 'subadmin' ||
      client.userId === String(updatedRider._id)
    ) {
      sendJson(client, riderBroadcastPayload);
    }
  }

  return updatedRider;
}

async function handleIncomingWsMessage(client: WsClientConnection, rawText: string) {
  let msg: any;
  try {
    msg = JSON.parse(rawText);
  } catch {
    return;
  }

  if (!msg || typeof msg.type !== 'string') return;

  switch (msg.type) {
    case 'auth': {
      const token = String(msg.token || '').trim();
      if (token) {
        try {
          const secret = process.env.JWT_SECRET || 'tomato-local-development-secret';
          const decoded = jwt.verify(token, secret) as any;
          client.userId = String(decoded.userId || decoded.id || decoded._id || '');
          client.role = String(decoded.role || '');
          sendJson(client, {
            type: 'auth_ok',
            userId: client.userId,
            role: client.role,
          });
        } catch {
          sendJson(client, { type: 'auth_error', message: 'Invalid token' });
        }
      }
      break;
    }

    case 'subscribe_order': {
      const orderId = String(msg.orderId || '').trim();
      if (orderId && mongoose.isValidObjectId(orderId)) {
        client.subscribedOrderIds.add(orderId);
        const tracking = await buildOrderLiveTrackingData(orderId);
        if (tracking) {
          sendJson(client, {
            type: 'order_live_tracking',
            orderId,
            tracking,
            timestamp: new Date().toISOString(),
          });
        }
      }
      break;
    }

    case 'unsubscribe_order': {
      const orderId = String(msg.orderId || '').trim();
      if (orderId) {
        client.subscribedOrderIds.delete(orderId);
      }
      break;
    }

    case 'subscribe_fleet': {
      client.subscribedFleet = true;
      sendJson(client, { type: 'fleet_subscribed', timestamp: new Date().toISOString() });
      break;
    }

    case 'unsubscribe_fleet': {
      client.subscribedFleet = false;
      break;
    }

    case 'rider_location_ping': {
      const riderUserId = client.userId || String(msg.riderUserId || '');
      if (riderUserId && msg.lat !== undefined && msg.lng !== undefined) {
        await handleRiderLocationRealtimeUpdate({
          riderUserId,
          lat: Number(msg.lat),
          lng: Number(msg.lng),
          isOnline: msg.isOnline !== undefined ? Boolean(msg.isOnline) : true,
        });
      }
      break;
    }

    case 'ping': {
      sendJson(client, { type: 'pong', timestamp: new Date().toISOString() });
      break;
    }
  }
}

/**
 * Attaches the RFC 6455 WebSocket upgrade handler (`/ws`) to an HTTP server instance.
 */
export function attachWebSocketServer(server: http.Server) {
  server.on('upgrade', (req: http.IncomingMessage, socket: Duplex, _head: Buffer) => {
    try {
      const reqUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (!reqUrl.pathname.startsWith('/ws')) {
        socket.destroy();
        return;
      }

      const key = req.headers['sec-websocket-key'];
      if (!key || typeof key !== 'string') {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      const acceptKey = crypto
        .createHash('sha1')
        .update(key + WS_MAGIC_GUID)
        .digest('base64');

      const responseHeaders = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        '\r\n',
      ];
      socket.write(responseHeaders.join('\r\n'));

      const client: WsClientConnection = {
        id: crypto.randomUUID(),
        socket,
        subscribedOrderIds: new Set<string>(),
        subscribedFleet: false,
        isAlive: true,
      };

      // Authenticate from query token if provided (?token=...)
      const queryToken = reqUrl.searchParams.get('token');
      if (queryToken) {
        try {
          const secret = process.env.JWT_SECRET || 'tomato-local-development-secret';
          const decoded = jwt.verify(queryToken, secret) as any;
          client.userId = String(decoded.userId || decoded.id || decoded._id || '');
          client.role = String(decoded.role || '');
        } catch {
          // Optional token on connect; client can also authenticate via 'auth' message
        }
      }

      clients.add(client);

      sendJson(client, {
        type: 'connected',
        clientId: client.id,
        userId: client.userId || null,
        role: client.role || null,
        message: 'Tomato Live Rider GPS WebSocket connected',
        timestamp: new Date().toISOString(),
      });

      let recvBuffer: Buffer = Buffer.alloc(0);

      socket.on('data', (chunk: Buffer) => {
        client.isAlive = true;
        recvBuffer = Buffer.concat([recvBuffer, chunk]);
        const { messages, remaining } = decodeWsFrames(recvBuffer);
        recvBuffer = remaining;

        for (const frame of messages) {
          if (frame.opcode === 0x8) {
            // Close frame
            socket.end(encodeWsControlFrame(0x8));
            clients.delete(client);
            return;
          } else if (frame.opcode === 0x9) {
            // Ping -> Pong
            socket.write(encodeWsControlFrame(0xa, frame.payload));
          } else if (frame.opcode === 0x1) {
            // Text frame
            const text = frame.payload.toString('utf8');
            handleIncomingWsMessage(client, text).catch((err) =>
              console.warn('[WebSocket message handler error]:', err),
            );
          }
        }
      });

      socket.on('close', () => {
        clients.delete(client);
      });

      socket.on('error', () => {
        clients.delete(client);
      });
    } catch (err) {
      console.error('[WebSocket upgrade error]:', err);
      socket.destroy();
    }
  });
}

// Keep-alive ping interval across all connected sockets
setInterval(() => {
  for (const client of clients) {
    if (client.socket.destroyed || !client.socket.writable) {
      clients.delete(client);
      continue;
    }
    try {
      client.socket.write(encodeWsControlFrame(0x9));
    } catch {
      clients.delete(client);
    }
  }
}, 25000);


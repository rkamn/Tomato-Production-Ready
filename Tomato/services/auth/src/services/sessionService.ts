import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import Session, { ISession } from '../model/Session.js';

export interface ClientMetadata {
  ipAddress: string;
  userAgent: string;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown';
  browser: string;
  os: string;
}

export interface CachedSession {
  sessionId: string;
  userId: string;
  role: string;
  email?: string | undefined;
  phone?: string | undefined;
  name?: string | undefined;
  isValid: boolean;
  expiresAt: number;
  cachedAt: number;
  permissions?: string[] | undefined;
  adminRoleTitle?: string | undefined;
  baseRole?: string | undefined;
  restaurantId?: string | undefined;
  shopId?: string | undefined;
  riderId?: string | undefined;
  customerId?: string | undefined;
  subadminId?: string | undefined;
  adminId?: string | undefined;
  employeeId?: string | undefined;
}

// In-Memory Session Cache: High performance authorization with zero-delay invalidation
const sessionCache = new Map<string, CachedSession>();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds cached validation
const SESSION_EXPIRATION_HOURS = 12;

// Clean up stale in-memory cache entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of sessionCache.entries()) {
    if (now > value.expiresAt || now - value.cachedAt > CACHE_TTL_MS * 5) {
      sessionCache.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

/**
 * Extract IP address, device type, browser, and OS from the HTTP Request
 */
export const parseClientMetadata = (req?: Request): ClientMetadata => {
  if (!req) {
    return {
      ipAddress: '127.0.0.1',
      userAgent: 'Internal System',
      deviceType: 'desktop',
      browser: 'System',
      os: 'Server',
    };
  }

  // Resolve Real Client IP
  const forwarded = req.headers['x-forwarded-for'];
  let ipAddress = '';
  if (typeof forwarded === 'string') {
    ipAddress = forwarded.split(',')[0]?.trim() || '';
  } else if (Array.isArray(forwarded) && forwarded.length > 0) {
    ipAddress = forwarded[0]?.trim() || '';
  }
  if (!ipAddress) {
    ipAddress = req.ip || req.socket?.remoteAddress || '127.0.0.1';
  }
  if (ipAddress.startsWith('::ffff:')) {
    ipAddress = ipAddress.slice(7);
  }

  const userAgent = String(req.headers['user-agent'] || 'Unknown Agent').trim();
  const uaLower = userAgent.toLowerCase();

  // Device classification
  let deviceType: ClientMetadata['deviceType'] = 'desktop';
  if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(uaLower)) {
    deviceType = 'tablet';
  } else if (
    /mobile|iphone|ipod|blackberry|opera mini|iemobile|wpdesktop/i.test(uaLower)
  ) {
    deviceType = 'mobile';
  } else if (/bot|crawler|spider|crawling/i.test(uaLower)) {
    deviceType = 'bot';
  }

  // Browser detection
  let browser = 'Browser';
  if (uaLower.includes('edg/')) browser = 'Microsoft Edge';
  else if (uaLower.includes('chrome/') && !uaLower.includes('chromium/'))
    browser = 'Google Chrome';
  else if (uaLower.includes('safari/') && !uaLower.includes('chrome/'))
    browser = 'Apple Safari';
  else if (uaLower.includes('firefox/')) browser = 'Mozilla Firefox';
  else if (uaLower.includes('opr/') || uaLower.includes('opera/'))
    browser = 'Opera';

  // OS detection
  let os = 'OS';
  if (uaLower.includes('win')) os = 'Windows';
  else if (uaLower.includes('macintosh') || uaLower.includes('mac os x'))
    os = 'macOS';
  else if (uaLower.includes('android')) os = 'Android';
  else if (uaLower.includes('iphone') || uaLower.includes('ipad')) os = 'iOS';
  else if (uaLower.includes('linux')) os = 'Linux';

  return { ipAddress, userAgent, deviceType, browser, os };
};

/**
 * Generate a cryptographically random, unique session identifier
 */
export const generateSessionId = (): string => {
  return `sess_${Date.now().toString(36)}_${randomBytes(20).toString('hex')}`;
};

/**
 * Create a new database-backed session and issue a JWT signed with sessionId
 */
export const createSession = async (
  user: {
    _id: { toString: () => string };
    email?: string;
    phone?: string;
    name?: string;
    role: string;
    permissions?: string[];
    adminRoleTitle?: string;
    baseRole?: string;
    restaurantId?: string;
    shopId?: string;
    riderId?: string;
    customerId?: string;
    subadminId?: string;
    adminId?: string;
    employeeId?: string;
  },
  req?: Request,
): Promise<{ token: string; session: ISession; sessionId: string }> => {
  const sessionId = generateSessionId();
  const meta = parseClientMetadata(req);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + SESSION_EXPIRATION_HOURS * 60 * 60 * 1000,
  );

  const session = await Session.create({
    sessionId,
    userId: user._id.toString(),
    role: user.role,
    email: user.email || '',
    phone: user.phone || '',
    name: user.name || '',
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    deviceType: meta.deviceType,
    browser: meta.browser,
    os: meta.os,
    isValid: true,
    lastActiveAt: now,
    expiresAt,
  });

  // Warm the memory cache immediately for zero-latency subsequent calls
  sessionCache.set(sessionId, {
    sessionId,
    userId: user._id.toString(),
    role: user.role,
    email: user.email,
    phone: user.phone,
    name: user.name,
    isValid: true,
    expiresAt: expiresAt.getTime(),
    cachedAt: Date.now(),
    permissions: user.permissions || [],
    adminRoleTitle: user.adminRoleTitle || '',
    baseRole: user.baseRole || '',
    restaurantId: user.restaurantId || '',
    shopId: user.shopId || '',
    riderId: user.riderId || '',
    customerId: user.customerId || '',
    subadminId: user.subadminId || '',
    adminId: user.adminId || '',
    employeeId: user.employeeId || '',
  });

  const jwtSecret =
    process.env.JWT_SECRET || 'tomato-local-development-secret';
  const token = jwt.sign(
    {
      sessionId,
      userId: user._id.toString(),
      id: user._id.toString(),
      _id: user._id.toString(),
      email: user.email,
      phone: user.phone,
      name: user.name,
      role: user.role,
      permissions: user.permissions || [],
      adminRoleTitle: user.adminRoleTitle || '',
      baseRole: user.baseRole || '',
      restaurantId: user.restaurantId || '',
      shopId: user.shopId || '',
      riderId: user.riderId || '',
      customerId: user.customerId || '',
      subadminId: user.subadminId || '',
      adminId: user.adminId || '',
      employeeId: user.employeeId || '',
    },
    jwtSecret,
    { expiresIn: `${SESSION_EXPIRATION_HOURS}h` },
  );

  return { token, session, sessionId };
};

/**
 * Validate an active session using fast in-memory cache with fallback to MongoDB
 */
export const validateSession = async (
  sessionId: string,
  userId: string,
): Promise<CachedSession | null> => {
  const now = Date.now();

  // 1. Check in-memory fast cache
  const cached = sessionCache.get(sessionId);
  if (cached) {
    if (!cached.isValid || now > cached.expiresAt) {
      sessionCache.delete(sessionId);
      return null;
    }
    if (String(cached.userId) !== String(userId)) {
      sessionCache.delete(sessionId);
      return null;
    }
    return cached;
  }

  // 2. Cache miss: Check MongoDB
  try {
    const session = await Session.findOne({
      sessionId,
      userId,
      isValid: true,
      expiresAt: { $gt: new Date() },
    }).lean();

    if (!session) {
      return null;
    }

    const cachedEntry: CachedSession = {
      sessionId: session.sessionId,
      userId: String(session.userId),
      role: session.role,
      email: session.email,
      phone: session.phone,
      name: session.name,
      isValid: session.isValid,
      expiresAt: new Date(session.expiresAt).getTime(),
      cachedAt: now,
    };

    sessionCache.set(sessionId, cachedEntry);

    // Throttled async update of lastActiveAt in background (max once per 5m)
    if (
      !session.lastActiveAt ||
      now - new Date(session.lastActiveAt).getTime() > 5 * 60 * 1000
    ) {
      Session.updateOne(
        { sessionId },
        { $set: { lastActiveAt: new Date() } },
      ).catch(() => {});
    }

    return cachedEntry;
  } catch (err) {
    console.error('[SessionService] Validation DB error:', err);
    return null;
  }
};

/**
 * Revoke a specific session (e.g. on user sign-out)
 */
export const revokeSession = async (
  sessionId: string,
  reason = 'user_logout',
): Promise<boolean> => {
  if (!sessionId) return false;
  sessionCache.delete(sessionId);

  try {
    const res = await Session.updateOne(
      { sessionId },
      {
        $set: {
          isValid: false,
          revokedAt: new Date(),
          revokedReason: reason,
        },
      },
    );
    return res.modifiedCount > 0;
  } catch (err) {
    console.error('[SessionService] Revocation error:', err);
    return false;
  }
};

/**
 * Revoke all active sessions for a user (e.g. password change, security reset)
 */
export const revokeAllUserSessions = async (
  userId: string,
  reason = 'logout_all_devices',
): Promise<number> => {
  if (!userId) return 0;

  // Clear all in-memory entries for this user
  for (const [key, val] of sessionCache.entries()) {
    if (String(val.userId) === String(userId)) {
      sessionCache.delete(key);
    }
  }

  try {
    const res = await Session.updateMany(
      { userId, isValid: true },
      {
        $set: {
          isValid: false,
          revokedAt: new Date(),
          revokedReason: reason,
        },
      },
    );
    return res.modifiedCount;
  } catch (err) {
    console.error('[SessionService] Revoke all error:', err);
    return 0;
  }
};

/**
 * Get all active sessions for a user
 */
export const getUserActiveSessions = async (
  userId: string,
  currentSessionId?: string,
) => {
  if (!userId) return [];

  const sessions = await Session.find({
    userId,
    isValid: true,
    expiresAt: { $gt: new Date() },
  })
    .sort({ lastActiveAt: -1 })
    .lean();

  return sessions.map((s) => ({
    sessionId: s.sessionId,
    deviceType: s.deviceType || 'desktop',
    browser: s.browser || 'Browser',
    os: s.os || 'OS',
    ipAddress: s.ipAddress || '127.0.0.1',
    lastActiveAt: s.lastActiveAt,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    isCurrent: s.sessionId === currentSessionId,
  }));
};

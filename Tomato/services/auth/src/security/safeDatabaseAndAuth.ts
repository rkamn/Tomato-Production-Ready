import type { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { AuthenticatedRequest } from '../middleware/authenticate.js';

/* =========================================================================
 * 1. SAFE DATABASE QUERIES
 * ========================================================================= */

/**
 * Escapes characters with special meaning in Regular Expressions to prevent ReDoS & regex injection
 */
export function escapeRegex(text: string): string {
  if (typeof text !== 'string') return '';
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validates and safely converts an ID into a MongoDB ObjectId, or returns null if invalid
 */
export function toSafeObjectId(id: unknown): mongoose.Types.ObjectId | null {
  if (!id || typeof id !== 'string') {
    if (id instanceof mongoose.Types.ObjectId) return id;
    return null;
  }
  const cleanId = id.trim();
  if (cleanId.length === 24 && mongoose.isValidObjectId(cleanId)) {
    try {
      return new mongoose.Types.ObjectId(cleanId);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Clamps pagination parameters to safe boundaries to prevent Denial-of-Service and memory exhaustion
 */
export function clampPagination(query: {
  page?: unknown;
  limit?: unknown;
  maxLimit?: number;
}): { page: number; limit: number; skip: number } {
  const maxLimit = query.maxLimit && query.maxLimit > 0 ? query.maxLimit : 100;
  const rawPage = parseInt(String(query.page || '1'), 10);
  const rawLimit = parseInt(String(query.limit || '10'), 10);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : 10;
  const skip = (page - 1) * limit;

  return { page, limit, skip };
}

/**
 * Safely constructs a sort query object only permitting whitelisted fields
 */
export function safeSort(
  sortParam: unknown,
  allowedFields: string[],
  defaultField = 'createdAt',
  defaultOrder: 1 | -1 = -1,
): Record<string, 1 | -1> {
  const result: Record<string, 1 | -1> = {};
  if (typeof sortParam === 'string' && sortParam.trim()) {
    const isDesc = sortParam.startsWith('-');
    const field = isDesc ? sortParam.slice(1) : sortParam;
    if (allowedFields.includes(field)) {
      result[field] = isDesc ? -1 : 1;
      return result;
    }
  }
  result[defaultField] = defaultOrder;
  return result;
}

/**
 * Sanitizes MongoDB query filters to prevent top-level or nested operator injection
 */
export function sanitizeMongoFilter<T extends Record<string, unknown>>(filter: T): T {
  if (!filter || typeof filter !== 'object') {
    return filter;
  }

  const cleanFilter: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    // Drop dangerous operators unless carefully constructed
    if (key === '$where' || key === '$function' || key === '$accumulator') {
      continue;
    }

    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof RegExp) && !(value instanceof mongoose.Types.ObjectId)) {
      cleanFilter[key] = sanitizeMongoFilter(value as Record<string, unknown>);
    } else {
      cleanFilter[key] = value;
    }
  }

  return cleanFilter as T;
}

/* =========================================================================
 * 2. SAFE OUTPUT HANDLING & SENSITIVE DATA SCRUBBING
 * ========================================================================= */

const SENSITIVE_FIELDS = new Set([
  'password',
  'passwordhash',
  'salt',
  'resettoken',
  'verificationcode',
  '__v',
  'secret',
  'sessiontoken',
]);

/**
 * Recursively scrubs sensitive credentials, tokens, and internal database keys before sending responses
 */
export function scrubSensitiveFields<T>(data: T, customFields: string[] = []): T {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data !== 'object') {
    return data;
  }

  if (data instanceof Date || data instanceof mongoose.Types.ObjectId) {
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => scrubSensitiveFields(item, customFields)) as unknown as T;
  }

  // Handle Mongoose documents
  const plainObj = typeof (data as any)?.toObject === 'function' ? (data as any).toObject() : { ...(data as Record<string, unknown>) };
  const cleaned: Record<string, unknown> = {};
  const extraFieldsSet = new Set(customFields.map((f) => f.toLowerCase()));

  for (const [key, value] of Object.entries(plainObj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_FIELDS.has(lowerKey) || extraFieldsSet.has(lowerKey)) {
      continue;
    }

    // Mask bank account numbers if present
    if (lowerKey === 'accountnumber' && typeof value === 'string' && value.length > 4) {
      cleaned[key] = `••••••••${value.slice(-4)}`;
      continue;
    }

    // Mask PAN numbers if present (e.g. ABCDE1234F -> AB•••••34F)
    if (lowerKey === 'pannumber' && typeof value === 'string' && value.length === 10) {
      cleaned[key] = `${value.slice(0, 2)}•••••${value.slice(-3)}`;
      continue;
    }

    if (typeof value === 'object' && value !== null) {
      cleaned[key] = scrubSensitiveFields(value, customFields);
    } else {
      cleaned[key] = value;
    }
  }

  return cleaned as T;
}

/**
 * Express middleware: Intercepts res.json to automatically scrub sensitive data from all responses
 */
export function safeOutputInterceptorMiddleware(_req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);

  res.json = function (body: any): Response {
    if (body && typeof body === 'object') {
      const sanitizedBody = scrubSensitiveFields(body);
      return originalJson(sanitizedBody);
    }
    return originalJson(body);
  };

  next();
}

/**
 * Sends a safe, sanitized error response that prevents leaking database stacks or internals
 */
export function safeErrorResponse(res: Response, error: unknown, defaultMessage = 'An unexpected error occurred'): Response {
  const isDev = process.env.NODE_ENV === 'development';
  const errMessage = error instanceof Error ? error.message : String(error);

  console.error('[Security SafeError]:', errMessage);

  return res.status(500).json({
    success: false,
    message: isDev ? errMessage : defaultMessage,
    ...(isDev && error instanceof Error && error.stack ? { debug: error.stack } : {}),
  });
}

/* =========================================================================
 * 3. AUTHENTICATION & AUTHORIZATION GUARDS
 * ========================================================================= */

/**
 * Verifies JWT signature and expiry safely
 */
export function verifyJwtToken<T = Record<string, unknown>>(token: string, secret?: string): { valid: boolean; payload?: T; error?: string } {
  try {
    const jwtSecret = secret || process.env.JWT_SECRET || 'tomato-local-development-secret';
    const payload = jwt.verify(token, jwtSecret) as T;
    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}

/**
 * Role-Based Access Control Guard:
 * Allows specified roles. Superadmin automatically satisfies any admin check.
 */
export function authorizeRoles(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest).user;
    if (!user || !user.role) {
      res.status(401).json({
        success: false,
        message: 'Authentication required. No active credentials found.',
        code: 'AUTH_REQUIRED',
      });
      return;
    }

    // Superadmin has universal administrative authority
    if (user.role === 'superadmin' || user.baseRole === 'superadmin') {
      next();
      return;
    }

    const matchesRole = allowedRoles.includes(user.role) || (user.baseRole && allowedRoles.includes(user.baseRole));
    if (!matchesRole) {
      res.status(403).json({
        success: false,
        message: `Access denied. Requires one of the following roles: [${allowedRoles.join(', ')}]. Current role: ${user.role}.`,
        code: 'FORBIDDEN_ROLE',
      });
      return;
    }

    next();
  };
}

/**
 * Fine-Grained Permission Guard:
 * Checks whether user has required permission or universal wildcard '*'
 */
export function authorizePermissions(...requiredPermissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required.',
        code: 'AUTH_REQUIRED',
      });
      return;
    }

    if (user.role === 'superadmin' || user.baseRole === 'superadmin') {
      next();
      return;
    }

    const userPerms = Array.isArray(user.permissions) ? user.permissions : [];
    if (userPerms.includes('*')) {
      next();
      return;
    }

    const hasAll = requiredPermissions.every((perm) => userPerms.includes(perm));
    if (!hasAll) {
      res.status(403).json({
        success: false,
        message: `Access denied. Missing required permission(s): [${requiredPermissions.join(', ')}].`,
        code: 'FORBIDDEN_PERMISSION',
      });
      return;
    }

    next();
  };
}

/**
 * Ownership Guard:
 * Ensures the authenticated user only accesses/modifies their own resource,
 * unless they are an admin or superadmin.
 */
export function authorizeSelfOrAdmin(targetIdGetter: (req: Request) => string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest).user;
    if (!user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    if (user.role === 'superadmin' || user.role === 'admin' || user.baseRole === 'admin') {
      next();
      return;
    }

    const targetId = targetIdGetter(req);
    const isSelf = targetId && (targetId === user.userId || targetId === user.customerId || targetId === user.restaurantId || targetId === user.shopId || targetId === user.riderId);

    if (!isSelf) {
      res.status(403).json({
        success: false,
        message: 'Access denied. You can only view or manage your own account.',
        code: 'FORBIDDEN_RESOURCE',
      });
      return;
    }

    next();
  };
}

export default {
  escapeRegex,
  toSafeObjectId,
  clampPagination,
  safeSort,
  sanitizeMongoFilter,
  scrubSensitiveFields,
  safeOutputInterceptorMiddleware,
  safeErrorResponse,
  verifyJwtToken,
  authorizeRoles,
  authorizePermissions,
  authorizeSelfOrAdmin,
};


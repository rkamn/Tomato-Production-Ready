import type { Request, Response, NextFunction } from 'express';
import { getClientIp } from './rateLimiter.js';

export type SecurityEventType =
  | 'AUTH_LOGIN_SUCCESS'
  | 'AUTH_LOGIN_FAILURE'
  | 'AUTH_REGISTER_SUCCESS'
  | 'AUTH_LOGOUT'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_SUCCESS'
  | 'PASSWORD_RESET_FAILED'
  | 'PASSWORD_CHANGED'
  | 'ACCESS_DENIED_UNAUTHORIZED'
  | 'ACCESS_DENIED_FORBIDDEN'
  | 'INJECTION_ATTEMPT_DETECTED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'SUSPICIOUS_PATH_TRAVERSAL'
  | 'PAYMENT_SECURITY_VIOLATION'
  | 'SUSPICIOUS_ACTIVITY';

export type SecuritySeverity = 'INFO' | 'WARN' | 'HIGH' | 'CRITICAL';

export interface SecurityEvent {
  eventType: SecurityEventType;
  severity: SecuritySeverity;
  identifier?: string | undefined;
  userId?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  method?: string | undefined;
  path?: string | undefined;
  message: string;
  details?: Record<string, unknown> | undefined;
  timestamp?: string | undefined;
}

/**
 * Sensitive field patterns that must NEVER be written to logs.
 */
const SENSITIVE_KEY_REGEX =
  /^(password|currentpassword|newpassword|oldpassword|confirmpassword|token|resettoken|refreshtoken|accesstoken|authorization|otp|code|verificationcode|secret|secretkey|clientsecret|apikey|cvv|creditcard|bankaccountnumber|cardnumber|salt|hash)$/i;

/**
 * Recursively redacts sensitive keys from log objects.
 */
export function sanitizeLogData(data: unknown): unknown {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    // If string resembles a JWT (header.payload.signature), redact it
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(data)) {
      return '[REDACTED_JWT_TOKEN]';
    }
    // If string looks like a Bearer token
    if (/^Bearer\s+.+$/i.test(data)) {
      return 'Bearer [REDACTED_TOKEN]';
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map(sanitizeLogData);
  }

  if (typeof data === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_KEY_REGEX.test(k)) {
        if (/password/i.test(k)) {
          clean[k] = '[REDACTED_PASSWORD]';
        } else if (/token|auth/i.test(k)) {
          clean[k] = '[REDACTED_TOKEN]';
        } else if (/otp|code/i.test(k)) {
          clean[k] = '[REDACTED_OTP_CODE]';
        } else if (/secret|key/i.test(k)) {
          clean[k] = '[REDACTED_SECRET]';
        } else {
          clean[k] = '[REDACTED_SENSITIVE]';
        }
      } else if (typeof v === 'object' && v !== null) {
        clean[k] = sanitizeLogData(v);
      } else if (typeof v === 'string') {
        clean[k] = sanitizeLogData(v);
      } else {
        clean[k] = v;
      }
    }
    return clean;
  }

  return data;
}

/**
 * Strip sensitive credentials (JWT tokens, passwords, secrets, verification codes)
 * from logged URLs or query parameters to prevent leaking credentials in log monitors.
 */
export function sanitizePath(rawPath?: string): string | undefined {
  if (!rawPath || typeof rawPath !== 'string') return rawPath;
  return rawPath.replace(/([?&](?:token|auth|password|secret|key|code|otp)=)[^&]*/gi, '$1[REDACTED]');
}

interface UnauthTracker {
  lastLogged: number;
  suppressedCount: number;
}

const unauthDebounceMap = new Map<string, UnauthTracker>();
const UNAUTH_DEBOUNCE_WINDOW_MS = 5000;
const MAX_DEBOUNCE_ENTRIES = 2000;

/**
 * Throttle repetitive 401 UNAUTHORIZED warnings from the same client IP
 * to prevent burst log floods when an expired tab triggers multiple concurrent requests or SSE reconnects.
 */
export function shouldThrottleUnauthLog(ip: string, method?: string, rawPath?: string): boolean {
  const now = Date.now();

  if (unauthDebounceMap.size > MAX_DEBOUNCE_ENTRIES) {
    for (const [k, v] of unauthDebounceMap.entries()) {
      if (now - v.lastLogged > UNAUTH_DEBOUNCE_WINDOW_MS * 2) {
        unauthDebounceMap.delete(k);
      }
    }
  }

  const cleanPath = (rawPath || '').split('?')[0];
  const routeKey = `${ip}:${method || 'GET'}:${cleanPath}`;
  const ipBurstKey = `${ip}:BURST_BURST`;

  // Check identical endpoint debounce (e.g. SSE stream reconnects every 3s)
  const routeTracker = unauthDebounceMap.get(routeKey);
  if (routeTracker && now - routeTracker.lastLogged < UNAUTH_DEBOUNCE_WINDOW_MS) {
    routeTracker.suppressedCount++;
    return true;
  }

  // Check overall burst per IP (e.g. dashboard loading 7 requests at the same millisecond)
  const ipTracker = unauthDebounceMap.get(ipBurstKey);
  if (ipTracker && now - ipTracker.lastLogged < 2000) {
    if (ipTracker.suppressedCount >= 2) {
      ipTracker.suppressedCount++;
      return true; // Limit to 2 logs within 2 seconds per IP
    }
    ipTracker.suppressedCount++;
  } else {
    unauthDebounceMap.set(ipBurstKey, { lastLogged: now, suppressedCount: 1 });
  }

  unauthDebounceMap.set(routeKey, { lastLogged: now, suppressedCount: 0 });
  return false;
}

/**
 * Primary logger function for all security-relevant occurrences.
 * Outputs safe, sanitized, structured log records without leaking credentials.
 */
export function logSecurityEvent(event: SecurityEvent): void {
  const record: SecurityEvent = {
    eventType: event.eventType,
    severity: event.severity,
    identifier: event.identifier ? String(event.identifier).trim() : undefined,
    userId: event.userId ? String(event.userId) : undefined,
    ip: event.ip || 'internal',
    userAgent: event.userAgent ? String(event.userAgent).slice(0, 200) : undefined,
    method: event.method,
    path: sanitizePath(event.path),
    message: event.message,
    details: event.details ? (sanitizeLogData(event.details) as Record<string, unknown>) : undefined,
    timestamp: event.timestamp || new Date().toISOString(),
  };

  const jsonStr = JSON.stringify(record);

  switch (event.severity) {
    case 'CRITICAL':
    case 'HIGH':
      console.error(`🚨 [SECURITY_${event.severity}] ${event.eventType}: ${event.message}`, jsonStr);
      break;
    case 'WARN':
      console.warn(`⚠️ [SECURITY_WARN] ${event.eventType}: ${event.message}`, jsonStr);
      break;
    default:
      console.info(`🛡️ [SECURITY_INFO] ${event.eventType}: ${event.message}`, jsonStr);
      break;
  }
}

/**
 * Helper to log authentication attempts
 */
export function logAuthEvent(
  success: boolean,
  identifier: string,
  req: Request,
  message: string,
  extra?: Record<string, unknown> | undefined,
): void {
  const userAgentHeader = req.headers['user-agent'];
  logSecurityEvent({
    eventType: success ? 'AUTH_LOGIN_SUCCESS' : 'AUTH_LOGIN_FAILURE',
    severity: success ? 'INFO' : 'WARN',
    identifier,
    ip: getClientIp(req),
    userAgent: typeof userAgentHeader === 'string' ? userAgentHeader : undefined,
    method: req.method,
    path: req.originalUrl || req.path,
    message,
    details: extra,
  });
}

/**
 * Helper to log access control rejections (401 / 403)
 */
export function logAccessViolation(
  type: 'UNAUTHORIZED' | 'FORBIDDEN',
  req: Request,
  reason: string,
  extra?: Record<string, unknown> | undefined,
): void {
  const userAgentHeader = req.headers['user-agent'];
  const userObj = (req as any).user;
  const userId = userObj ? String(userObj.id || userObj._id || '') : undefined;

  logSecurityEvent({
    eventType: type === 'UNAUTHORIZED' ? 'ACCESS_DENIED_UNAUTHORIZED' : 'ACCESS_DENIED_FORBIDDEN',
    severity: type === 'FORBIDDEN' ? 'HIGH' : 'WARN',
    userId: userId || undefined,
    ip: getClientIp(req),
    userAgent: typeof userAgentHeader === 'string' ? userAgentHeader : undefined,
    method: req.method,
    path: req.originalUrl || req.path,
    message: reason,
    details: extra,
  });
}

/**
 * Helper to log blocked query/payload injections
 */
export function logInjectionEvent(
  injectionType: string,
  req: Request,
  field: string,
  pattern: string,
): void {
  const userAgentHeader = req.headers['user-agent'];
  logSecurityEvent({
    eventType: 'INJECTION_ATTEMPT_DETECTED',
    severity: 'CRITICAL',
    ip: getClientIp(req),
    userAgent: typeof userAgentHeader === 'string' ? userAgentHeader : undefined,
    method: req.method,
    path: req.originalUrl || req.path,
    message: `Blocked ${injectionType} injection pattern in ${field}`,
    details: {
      field,
      matchedPattern: pattern,
    },
  });
}

/**
 * Helper to log payment / financial security events
 */
export function logPaymentSecurityEvent(
  success: boolean,
  req: Request,
  action: string,
  details: Record<string, unknown>,
): void {
  const userAgentHeader = req.headers['user-agent'];
  const userObj = (req as any).user;
  const userId = userObj ? String(userObj.id || userObj._id || '') : undefined;

  logSecurityEvent({
    eventType: 'PAYMENT_SECURITY_VIOLATION',
    severity: success ? 'INFO' : 'CRITICAL',
    userId: userId || undefined,
    ip: getClientIp(req),
    userAgent: typeof userAgentHeader === 'string' ? userAgentHeader : undefined,
    method: req.method,
    path: req.originalUrl || req.path,
    message: `${action}: ${success ? 'Approved' : 'Blocked suspicious payment operation'}`,
    details,
  });
}

/**
 * Express Middleware to track 401, 403, and 429 responses automatically
 */
export function securityEventAuditorMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const originalEnd = res.end;

  (res as any).end = function (chunk: any, encoding: any, cb: any) {
    const userAgentHeader = req.headers['user-agent'];
    const userAgentStr = typeof userAgentHeader === 'string' ? userAgentHeader : undefined;

    if (res.statusCode === 401) {
      const clientIp = getClientIp(req);
      const rawPath = req.originalUrl || req.path;
      if (!shouldThrottleUnauthLog(clientIp, req.method, rawPath)) {
        logAccessViolation('UNAUTHORIZED', req, 'Endpoint access denied: Invalid or missing authentication');
      }
    } else if (res.statusCode === 403) {
      logAccessViolation('FORBIDDEN', req, 'Endpoint access forbidden: Insufficient privileges or CSRF rejection');
    } else if (res.statusCode === 429) {
      logSecurityEvent({
        eventType: 'RATE_LIMIT_EXCEEDED',
        severity: 'WARN',
        ip: getClientIp(req),
        userAgent: userAgentStr,
        method: req.method,
        path: req.originalUrl || req.path,
        message: 'Rate limit quota exceeded on sensitive route',
      });
    }

    return originalEnd.call(this, chunk, encoding, cb);
  };

  next();
}

export default {
  logSecurityEvent,
  logAuthEvent,
  logAccessViolation,
  logInjectionEvent,
  logPaymentSecurityEvent,
  securityEventAuditorMiddleware,
  sanitizeLogData,
  sanitizePath,
  shouldThrottleUnauthLog,
};


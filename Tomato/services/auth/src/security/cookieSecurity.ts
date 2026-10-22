import type { Request, Response, NextFunction } from 'express';
import { logSecurityEvent } from './securityLogger.js';

// Extend Express Request interface to include validated cookies dictionary
declare global {
  namespace Express {
    interface Request {
      cookies?: Record<string, string>;
    }
  }
}

/**
 * Cookie Security & Efficiency Options
 */
export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  path?: string;
  maxAge?: number; // In milliseconds
  domain?: string;
}

/**
 * Default secure cookie configuration
 * - httpOnly: prevents client-side script access (immunizes against XSS token theft)
 * - secure: enforced in production or when ENFORCE_HTTPS is active
 * - sameSite: 'lax' defends against CSRF while enabling standard navigation
 * - path: '/' guarantees universal availability across all API endpoints
 * - maxAge: 12 hours (aligned with active JWT session lifespan)
 */
export function getDefaultCookieOptions(override: Partial<CookieOptions> = {}): CookieOptions {
  const isProduction = process.env.NODE_ENV === 'production';
  const isHttpsEnforced = process.env.ENFORCE_HTTPS === 'true';

  return {
    httpOnly: true,
    secure: isProduction || isHttpsEnforced,
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 60 * 60 * 1000, // 12 hours
    ...override,
  };
}

/**
 * Safe, zero-dependency RFC 6265 Cookie Parser
 * Parses Cookie header string into a sanitized dictionary
 * Enforces maximum size limits to mitigate Cookie Bomb / HTTP 431 DoS
 */
export function parseAndValidateCookies(cookieHeader?: string): {
  cookies: Record<string, string>;
  isValid: boolean;
  warning?: string;
} {
  const cookies: Record<string, string> = Object.create(null);

  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return { cookies, isValid: true };
  }

  // 1. Enforce max Cookie header size limit (8192 bytes)
  if (cookieHeader.length > 8192) {
    return {
      cookies,
      isValid: false,
      warning: 'Cookie header exceeds maximum permissible size limit (8KB). Dropping to prevent header flood.',
    };
  }

  // 2. Split into individual name=value pairs
  const pairs = cookieHeader.split(';');

  for (let i = 0; i < pairs.length; i++) {
    const rawPair = pairs[i];
    if (!rawPair) continue;
    const pair = rawPair.trim();
    if (!pair) continue;

    // Reject individual oversized cookies (> 4096 bytes)
    if (pair.length > 4096) {
      continue;
    }

    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) {
      continue;
    }

    const rawName = pair.slice(0, eqIdx).trim();
    const rawVal = pair.slice(eqIdx + 1).trim();

    // RFC 6265 name syntax validation: only valid token characters allowed
    if (!/^[a-zA-Z0-9!#$%&'*+\-.^_`|~]+$/.test(rawName)) {
      continue;
    }

    // Prevent Prototype Pollution
    if (rawName === '__proto__' || rawName === 'constructor' || rawName === 'prototype') {
      continue;
    }

    // Sanitize value: strip control characters, carriage returns, newlines, and null bytes
    let cleanVal = rawVal;
    if (cleanVal.startsWith('"') && cleanVal.endsWith('"')) {
      cleanVal = cleanVal.slice(1, -1);
    }

    // Reject control characters that could trigger HTTP Response Splitting
    if (/[\r\n\0]/.test(cleanVal)) {
      continue;
    }

    try {
      cookies[rawName] = decodeURIComponent(cleanVal);
    } catch {
      // Decode fallback for raw strings
      cookies[rawName] = cleanVal;
    }
  }

  return { cookies, isValid: true };
}

/**
 * Validates authentication token structure inside cookies
 */
export function isValidAuthTokenFormat(token?: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const trimmed = token.trim();
  // Standard compact JWT format: header.payload.signature
  const jwtRegex = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
  return jwtRegex.test(trimmed);
}

/**
 * Validates session ID structure inside cookies
 */
export function isValidSessionIdFormat(sessionId?: string): boolean {
  if (!sessionId || typeof sessionId !== 'string') return false;
  const trimmed = sessionId.trim();
  // UUID or hex/base64url session identifiers (16 to 64 alphanumeric chars)
  const sessionRegex = /^[a-zA-Z0-9_-]{16,64}$/;
  return sessionRegex.test(trimmed);
}

/**
 * Sets secure, validated authentication and session cookies on outgoing response
 * Improves application efficiency by enabling automatic browser credential attachment
 */
export function setAuthCookies(
  res: Response,
  payload: {
    token: string;
    sessionId?: string;
    maxAge?: number;
  },
): void {
  const options = getDefaultCookieOptions(payload.maxAge ? { maxAge: payload.maxAge } : {});

  // 1. Primary auth_token cookie
  if (payload.token && isValidAuthTokenFormat(payload.token)) {
    res.cookie('auth_token', payload.token, options);
    res.cookie('token', payload.token, options); // Interoperability alias
  }

  // 2. Active session ID cookie
  if (payload.sessionId && isValidSessionIdFormat(payload.sessionId)) {
    res.cookie('sessionId', payload.sessionId, options);
  }
}

/**
 * Clears authentication and session cookies on logout
 */
export function clearAuthCookies(res: Response): void {
  const clearOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || process.env.ENFORCE_HTTPS === 'true',
    sameSite: 'lax' as const,
    path: '/',
  };

  res.clearCookie('auth_token', clearOptions);
  res.clearCookie('token', clearOptions);
  res.clearCookie('sessionId', clearOptions);
}

/**
 * Express Middleware:
 * Parses, validates, and sanitizes incoming cookies on every request.
 * Discards malformed or oversized cookies to protect the application.
 */
export function cookieValidationMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const cookieHeader = req.headers.cookie;

  const { cookies, isValid, warning } = parseAndValidateCookies(cookieHeader);

  if (!isValid && warning) {
    logSecurityEvent({
      eventType: 'ACCESS_DENIED_FORBIDDEN',
      severity: 'WARN',
      ip: req.ip || req.socket.remoteAddress,
      path: req.originalUrl || req.path,
      method: req.method,
      message: `Cookie security warning: ${warning}`,
    });
  }

  req.cookies = cookies;
  next();
}

export default {
  getDefaultCookieOptions,
  parseAndValidateCookies,
  isValidAuthTokenFormat,
  isValidSessionIdFormat,
  setAuthCookies,
  clearAuthCookies,
  cookieValidationMiddleware,
};

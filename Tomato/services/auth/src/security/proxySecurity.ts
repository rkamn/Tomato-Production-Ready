import type { Request, Response, NextFunction } from 'express';
import { isIP } from 'node:net';
import { logSecurityEvent } from './securityLogger.js';

/**
 * Built-in trusted proxy subnets and loopback addresses
 */
export const DEFAULT_TRUSTED_PROXIES = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
  'localhost',
]);

/**
 * Checks if a given IP address belongs to standard private/internal subnets (RFC 1918 / Docker)
 */
export function isPrivateSubnet(ip: string): boolean {
  const cleanIp = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

  // IPv4 Private Address Ranges (RFC 1918)
  // 10.0.0.0 - 10.255.255.255
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleanIp)) return true;
  // 172.16.0.0 - 172.31.255.255 (Docker standard bridges)
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(cleanIp)) return true;
  // 192.168.0.0 - 192.168.255.255
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(cleanIp)) return true;

  // IPv6 Unique Local Address (fc00::/7) or Loopback
  if (/^f[cd][0-9a-f]{2}:/i.test(cleanIp) || cleanIp === '::1') return true;

  return false;
}

/**
 * Determines whether the immediate peer/socket connection originates from a trusted reverse proxy
 */
export function isTrustedProxy(remoteAddress?: string): boolean {
  if (!remoteAddress) return false;
  const ip = remoteAddress.trim();

  if (DEFAULT_TRUSTED_PROXIES.has(ip)) return true;
  if (isPrivateSubnet(ip)) return true;

  // Check custom TRUSTED_PROXIES from environment
  const customTrusted = (process.env.TRUSTED_PROXIES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return customTrusted.includes(ip);
}

export const REVERSE_PROXY_CONFIG_DOC_ID = 'reverse_proxy_config';

export interface ReverseProxyState {
  enabled: boolean;
  gatewayPort: number;
  backendPort: number;
  updatedBy?: string;
  updatedAt?: Date;
}

export const DEFAULT_BACKEND_PORT = Number(process.env.PORT || 5050);
export const DEFAULT_GATEWAY_PORT = Number(process.env.PROXY_PORT || process.env.GATEWAY_PORT || (DEFAULT_BACKEND_PORT === 8080 ? 8000 : 8080));

// In-memory runtime state for fast synchronous checking in middleware
let cachedReverseProxyState: ReverseProxyState = {
  enabled: true,
  gatewayPort: DEFAULT_GATEWAY_PORT,
  backendPort: DEFAULT_BACKEND_PORT,
  updatedBy: 'System Init',
  updatedAt: new Date(),
};

/**
 * Returns whether reverse proxy enforcement is currently enabled
 */
export function isReverseProxyEnabled(): boolean {
  return cachedReverseProxyState.enabled;
}

/**
 * Synchronous getter for in-memory cached reverse proxy state
 */
export function getCachedReverseProxyConfig(): ReverseProxyState {
  return { ...cachedReverseProxyState };
}

/**
 * Loads reverse proxy settings from persistent database or returns cached state
 */
export async function fetchReverseProxyConfig(): Promise<ReverseProxyState> {
  try {
    const mongoose = (await import('mongoose')).default;
    if (mongoose.connection.readyState !== 1) {
      return { ...cachedReverseProxyState };
    }
    const Counter = (await import('../model/Counter.js')).default;
    const doc = await Counter.findById(REVERSE_PROXY_CONFIG_DOC_ID).lean();
    if (doc?.metadata && typeof doc.metadata.enabled === 'boolean') {
      cachedReverseProxyState = {
        enabled: Boolean(doc.metadata.enabled),
        gatewayPort: Number(process.env.PROXY_PORT || doc.metadata.gatewayPort || DEFAULT_GATEWAY_PORT),
        backendPort: Number(process.env.PORT || doc.metadata.backendPort || DEFAULT_BACKEND_PORT),
        updatedBy: doc.description || 'Super Admin',
        updatedAt: (doc as any).updatedAt || new Date(),
      };
    }
  } catch {
    // Return cached state if database is loading or unavailable
  }
  return { ...cachedReverseProxyState };
}

/**
 * Dynamically updates the reverse proxy toggle state both in memory and persistently in the database
 */
export async function updateReverseProxyConfig(
  enabled: boolean,
  updatedBy = 'Super Admin',
  gatewayPort?: number,
  backendPort?: number,
): Promise<ReverseProxyState> {
  const validGatewayPort = gatewayPort && Number.isInteger(gatewayPort) && gatewayPort > 0 && gatewayPort <= 65535
    ? gatewayPort
    : cachedReverseProxyState.gatewayPort;
  const validBackendPort = backendPort && Number.isInteger(backendPort) && backendPort > 0 && backendPort <= 65535
    ? backendPort
    : cachedReverseProxyState.backendPort;

  cachedReverseProxyState = {
    ...cachedReverseProxyState,
    enabled,
    gatewayPort: validGatewayPort,
    backendPort: validBackendPort,
    updatedBy,
    updatedAt: new Date(),
  };

  try {
    const mongoose = (await import('mongoose')).default;
    if (mongoose.connection.readyState === 1) {
      const Counter = (await import('../model/Counter.js')).default;
      await Counter.findOneAndUpdate(
        { _id: REVERSE_PROXY_CONFIG_DOC_ID },
        {
          $set: {
            name: REVERSE_PROXY_CONFIG_DOC_ID,
            counterType: 'settings',
            description: updatedBy,
            metadata: {
              enabled,
              gatewayPort: cachedReverseProxyState.gatewayPort,
              backendPort: cachedReverseProxyState.backendPort,
            },
          },
        },
        { upsert: true, returnDocument: 'after' }
      );
    }
  } catch (err) {
    console.error('[Reverse Proxy] Failed to persist toggle state to database:', err);
  }

  logSecurityEvent({
    eventType: 'AUTH_LOGIN_SUCCESS',
    severity: 'INFO',
    message: `Reverse Proxy dynamically ${enabled ? 'ENABLED' : 'DISABLED'} by ${updatedBy}`,
  });

  return { ...cachedReverseProxyState };
}

/**
 * Secure Client IP Resolver:
 * Protects against X-Forwarded-For header spoofing attacks.
 * 
 * - If reverse proxy is toggled OFF, resolves IP directly without proxy enforcement.
 * - If connection is directly from an untrusted client while proxy is ON, X-Forwarded-For is ignored.
 * - If connection IS from a trusted proxy, verified client IP is extracted from proxy chain.
 */
export function getSecureClientIp(req: Request): string {
  // If reverse proxy toggle is OFF, allow direct IP resolution without proxy restrictions
  if (!isReverseProxyEnabled()) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
      const firstIp = forwarded.split(',')[0]?.trim();
      if (firstIp && isIP(firstIp)) return firstIp;
    }
    const realIp = req.headers['x-real-ip'];
    if (typeof realIp === 'string' && realIp.trim() && isIP(realIp.trim())) {
      return realIp.trim();
    }
    const directIp = req.ip || req.socket?.remoteAddress || '127.0.0.1';
    return directIp.startsWith('::ffff:') ? directIp.slice(7) : directIp;
  }

  const socketIp = req.socket?.remoteAddress || req.ip || '127.0.0.1';
  const cleanSocketIp = socketIp.startsWith('::ffff:') ? socketIp.slice(7) : socketIp;

  // If connection is directly from an untrusted client, do NOT trust forwarded headers
  if (!isTrustedProxy(cleanSocketIp)) {
    return cleanSocketIp;
  }

  // Trusted proxy connection: inspect proxy-supplied headers
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    const candidate = realIp.trim();
    if (isIP(candidate)) {
      return candidate;
    }
  }

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const ips = forwarded.split(',').map((p) => p.trim()).filter(Boolean);
    for (const candidate of ips) {
      if (isIP(candidate)) {
        return candidate;
      }
    }
  } else if (Array.isArray(forwarded)) {
    for (const raw of forwarded) {
      const candidate = raw.trim();
      if (isIP(candidate)) {
        return candidate;
      }
    }
  }

  return cleanSocketIp;
}

/**
 * Reverse Proxy Protocol & Header Hardening Middleware
 * - If reverse proxy is toggled OFF, bypasses proxy checks and proceeds directly
 * - Enforces HTTPS awareness when behind SSL-terminating reverse proxies
 * - Defends against Host Header Poisoning & HTTP Desync
 * - Logs any proxy header anomalies
 */
export function reverseProxySecurityMiddleware(req: Request, res: Response, next: NextFunction): void {
  // If reverse proxy toggle is OFF, bypass proxy security enforcement
  if (!isReverseProxyEnabled()) {
    return next();
  }

  const socketIp = req.socket?.remoteAddress || '';
  const isFromProxy = isTrustedProxy(socketIp);

  // 1. Host Header Validation
  const host = req.headers.host || '';
  if (host && /[\r\n\0]/.test(host)) {
    logSecurityEvent({
      eventType: 'ACCESS_DENIED_FORBIDDEN',
      severity: 'HIGH',
      ip: getSecureClientIp(req),
      path: req.originalUrl || req.path,
      method: req.method,
      message: `Blocked Host Header Poisoning attempt: ${host.slice(0, 50)}`,
    });
    res.status(400).json({ error: 'Bad Request', message: 'Malformed Host header' });
    return;
  }

  // 2. SSL/TLS Termination Detection from Trusted Proxy
  const forwardedProto = req.headers['x-forwarded-proto'];
  if (isFromProxy && forwardedProto) {
    const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
    if (proto && proto.toLowerCase().trim() === 'https') {
      // Mark Express request as secure so HTTPS cookies & HSTS rules apply
      (req as any).isHttpsFromProxy = true;
    }
  }

  // 3. Spoofing Detection: untrusted client sent X-Forwarded-For directly
  if (!isFromProxy && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) {
    // Drop untrusted proxy headers to prevent spoofing down the pipeline
    delete req.headers['x-forwarded-for'];
    delete req.headers['x-real-ip'];
  }

  next();
}

export default {
  DEFAULT_TRUSTED_PROXIES,
  isPrivateSubnet,
  isTrustedProxy,
  getSecureClientIp,
  reverseProxySecurityMiddleware,
  isReverseProxyEnabled,
  getCachedReverseProxyConfig,
  fetchReverseProxyConfig,
  updateReverseProxyConfig,
};


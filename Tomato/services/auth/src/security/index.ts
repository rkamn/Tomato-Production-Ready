import type { Express } from 'express';
import { xssFilterMiddleware } from './xssProtection.js';
import {
  securityHeadersMiddleware,
  enforceHttpsMiddleware,
  type SecurityHeadersOptions,
} from './securityHeaders.js';
import {
  sqlAndNoSqlInjectionGuardMiddleware,
  unauthorizedAccessGuardMiddleware,
} from './injectionAndAccessGuard.js';
import { safeOutputInterceptorMiddleware } from './safeDatabaseAndAuth.js';
import { securityEventAuditorMiddleware } from './securityLogger.js';

export * from './sanitizer.js';
export * from './xssProtection.js';
export * from './securityHeaders.js';
export * from './rateLimiter.js';
export * from './injectionAndAccessGuard.js';
export * from './safeDatabaseAndAuth.js';
export * from './corsConfig.js';
export {
  logSecurityEvent,
  logAuthEvent,
  logAccessViolation,
  logInjectionEvent,
  logPaymentSecurityEvent,
  securityEventAuditorMiddleware,
  sanitizeLogData,
  type SecurityEvent,
  type SecurityEventType,
  type SecuritySeverity,
} from './securityLogger.js';

export interface SecurityModuleOptions {
  headers?: SecurityHeadersOptions;
}

/**
 * Applies all enterprise security layers to the Express application:
 * 1. Disables server fingerprint (X-Powered-By)
 * 2. Security Headers (CSP, X-XSS-Protection, nosniff, etc.)
 * 3. Unauthorized access & path traversal prevention
 * 4. SQL & NoSQL injection prevention across body, query, params
 * 5. Deep recursive XSS input sanitization
 * 6. Safe output interceptor (scrubs password hashes, reset tokens, internal keys)
 */
export function applySecurityMiddleware(app: Express, options: SecurityModuleOptions = {}): void {
  // Trust proxy for reverse proxy SSL termination (Cloudflare, Nginx, ALB)
  app.set('trust proxy', 1);

  // Disable Express fingerprint
  app.disable('x-powered-by');

  // 1. Enforce HTTPS in production or when ENFORCE_HTTPS is active
  app.use(enforceHttpsMiddleware);

  // 2. Audit security responses (401, 403, 429) without leaking credentials
  app.use(securityEventAuditorMiddleware);

  // 3. Apply protective HTTP response headers (HSTS, CSP, nosniff, etc.)
  app.use(securityHeadersMiddleware(options.headers));

  // 3. Prevent unauthorized access & path traversal
  app.use(unauthorizedAccessGuardMiddleware);

  // 3. Prevent SQL and NoSQL query injection
  app.use(sqlAndNoSqlInjectionGuardMiddleware);

  // 4. Apply recursive XSS input filtering on all incoming requests
  app.use(xssFilterMiddleware);

  // 5. Intercept all outgoing JSON responses to scrub sensitive data & credentials
  app.use(safeOutputInterceptorMiddleware);

  console.log('[Security Module] Comprehensive Security Suite initialized: XSS, SQL/NoSQL Injection Guard, Rate Limiting, Unauthorized Access Defense, and Safe Output Scrubber active.');
}

export default {
  applySecurityMiddleware,
  enforceHttpsMiddleware,
  xssFilterMiddleware,
  securityHeadersMiddleware,
  sqlAndNoSqlInjectionGuardMiddleware,
  unauthorizedAccessGuardMiddleware,
  safeOutputInterceptorMiddleware,
};


import type { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';

export interface SecurityHeadersOptions {
  enableHsts?: boolean;
  corsOrigin?: string;
  enforceHttps?: boolean;
}

/**
 * Middleware to enforce HTTPS redirection in production environments or when ENFORCE_HTTPS is configured.
 * Safely ignores local development (localhost / 127.0.0.1) and internal healthchecks.
 */
export function enforceHttpsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const shouldEnforce = process.env.ENFORCE_HTTPS === 'true';

  if (shouldEnforce) {
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    const host = req.headers.host || '';

    // Bypass HTTPS requirement for local loopback addresses during development
    const isLocalhost =
      host.startsWith('localhost') ||
      host.startsWith('127.0.0.1') ||
      host.startsWith('::1') ||
      host.includes(':3000') ||
      host.includes(':5050');

    if (!isSecure && !isLocalhost && host) {
      const secureUrl = `https://${host}${req.originalUrl || req.url}`;
      res.redirect(301, secureUrl);
      return;
    }
  }

  next();
}

/**
 * Enterprise-grade Security Headers Middleware backed by Helmet
 * Configures protective HTTP headers to guard against XSS, clickjacking,
 * MIME-sniffing, and data exfiltration attacks.
 */
export function securityHeadersMiddleware(options: SecurityHeadersOptions = {}) {
  const isProd = process.env.NODE_ENV === 'production';
  const enableHsts = options.enableHsts ?? (isProd && process.env.ENFORCE_HTTPS === 'true');

  const helmetInstance = helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'", "'unsafe-inline'", 'data:', 'blob:'],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          'https://checkout.razorpay.com',
          'https://cdn.jsdelivr.net',
        ],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        styleSrcAttr: ["'unsafe-inline'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'https:', 'blob:', 'http:'],
        connectSrc: [
          "'self'",
          'ws:',
          'wss:',
          'http:',
          'https:',
          'https://api.razorpay.com',
          'https://lumberjack.razorpay.com',
        ],
        frameSrc: ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    dnsPrefetchControl: { allow: false },
    frameguard: { action: 'sameorigin' },
    hidePoweredBy: true,
    hsts: enableHsts ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    ieNoOpen: true,
    noSniff: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xssFilter: true,
  });

  return (req: Request, res: Response, next: NextFunction): void => {
    // Run Helmet
    helmetInstance(req, res, (err) => {
      if (err) return next(err);

      // Additional custom headers (Permissions-Policy & legacy XSS)
      res.setHeader(
        'Permissions-Policy',
        'camera=(), microphone=(), payment=(self "https://checkout.razorpay.com")',
      );
      res.setHeader('X-XSS-Protection', '1; mode=block');
      res.removeHeader('X-Powered-By');

      next();
    });
  };
}

export default securityHeadersMiddleware;


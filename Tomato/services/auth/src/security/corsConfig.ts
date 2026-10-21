import type { CorsOptions } from 'cors';

/**
 * Explicit default trusted web origins for Tomato frontend & administrative apps
 */
export const TRUSTED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5050',
  'http://127.0.0.1:5050',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

/**
 * Returns merged set of trusted origins from environment variables and built-in defaults
 */
export function getTrustedOrigins(): string[] {
  const envOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  return Array.from(new Set([...TRUSTED_ORIGINS, ...envOrigins]));
}

/**
 * Explicit CORS Security Configuration
 * Blocks unauthorized third-party cross-origin requests while permitting authorized frontends
 */
export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser agents (server-to-server, curl, mobile native clients, postman)
    if (!origin) {
      return callback(null, true);
    }

    const trusted = getTrustedOrigins();
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const isAllowed = isLocal || trusted.includes(origin) || trusted.includes('*');

    if (isAllowed) {
      return callback(null, true);
    }

    console.warn(`[Security - CORS Blocked] Unauthorized origin attempted connection: ${origin}`);
    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Cache-Control',
  ],
  exposedHeaders: [
    'RateLimit-Limit',
    'RateLimit-Remaining',
    'RateLimit-Reset',
    'Retry-After',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
  ],
  maxAge: 86400, // 24 hours preflight cache
};

export default corsOptions;


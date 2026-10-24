import type { Request, Response, NextFunction } from 'express';
import { z, ZodSchema, ZodError } from 'zod';
import { getSecureClientIp } from './proxySecurity.js';

export { z, ZodSchema, ZodError };

/**
 * Zod Schema for Rate Limiter Configuration.
 * Default: 3 attempts per 10 minutes (600,000 ms).
 */
export const RateLimitConfigSchema = z.object({
  windowMs: z
    .number()
    .int()
    .positive()
    .default(10 * 60 * 1000), // 10 minutes window
  maxAttempts: z
    .number()
    .int()
    .positive()
    .default(3), // 3 attempts allowed
  message: z
    .string()
    .default('Too many attempts. You are only allowed 3 attempts per 10 minutes. Please try again later.'),
  statusCode: z
    .number()
    .int()
    .default(429),
  standardHeaders: z
    .boolean()
    .default(true), // Return standard RateLimit-* headers
  legacyHeaders: z
    .boolean()
    .default(true), // Return X-RateLimit-* headers
  skipSuccessfulRequests: z
    .boolean()
    .default(false),
  keyGenerator: z
    .function()
    .optional(),
  skip: z
    .custom<(req: Request) => boolean>()
    .optional(),
});

export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;
export type RateLimitInputOptions = Partial<z.input<typeof RateLimitConfigSchema>> & {
  keyGenerator?: (req: Request) => string;
  skip?: (req: Request) => boolean;
};

interface RateLimitRecord {
  count: number;
  resetTime: number;
  firstHitTime: number;
}

/**
 * In-memory thread-safe rate limiter store with automatic garbage collection
 */
class MemoryRateLimitStore {
  private store = new Map<string, RateLimitRecord>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    // Periodically prune expired entries every 3 minutes
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, 3 * 60 * 1000);

    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  public increment(key: string, windowMs: number): { count: number; resetTime: number } {
    const now = Date.now();
    const existing = this.store.get(key);

    if (!existing || now >= existing.resetTime) {
      const record: RateLimitRecord = {
        count: 1,
        firstHitTime: now,
        resetTime: now + windowMs,
      };
      this.store.set(key, record);
      return { count: 1, resetTime: record.resetTime };
    }

    existing.count += 1;
    return { count: existing.count, resetTime: existing.resetTime };
  }

  public decrement(key: string): void {
    const record = this.store.get(key);
    if (record && record.count > 0) {
      record.count -= 1;
    }
  }

  public get(key: string): RateLimitRecord | undefined {
    return this.store.get(key);
  }

  public resetKey(key: string): void {
    this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.store.entries()) {
      if (now >= record.resetTime) {
        this.store.delete(key);
      }
    }
  }

  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.store.clear();
  }
}

export const rateLimitStore = new MemoryRateLimitStore();

/**
 * Extracts a robust client IP address from the Express request
 */
export function getClientIp(req: Request): string {
  return getSecureClientIp(req);
}

/**
 * Creates an Express rate limiting middleware with Zod validated options.
 * Defaults strictly to 3 attempts in 10 minutes.
 */
export function createRateLimiter(options: RateLimitInputOptions = {}) {
  // Validate and parse options using Zod schema
  const parsedOptions = RateLimitConfigSchema.parse(options);
  const keyGen = options.keyGenerator || ((req: Request) => `${getClientIp(req)}:${req.baseUrl || ''}${req.path || ''}`);
  const skipFn = options.skip;

  return (req: Request, res: Response, next: NextFunction) => {
    if (skipFn && skipFn(req)) {
      return next();
    }
    const key = keyGen(req);
    const { count, resetTime } = rateLimitStore.increment(key, parsedOptions.windowMs);
    const now = Date.now();
    const remainingMs = Math.max(0, resetTime - now);
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const remainingAttempts = Math.max(0, parsedOptions.maxAttempts - count);

    // Set standard and legacy rate limiting headers
    if (parsedOptions.standardHeaders) {
      res.setHeader('RateLimit-Limit', parsedOptions.maxAttempts);
      res.setHeader('RateLimit-Remaining', remainingAttempts);
      res.setHeader('RateLimit-Reset', remainingSeconds);
    }

    if (parsedOptions.legacyHeaders) {
      res.setHeader('X-RateLimit-Limit', parsedOptions.maxAttempts);
      res.setHeader('X-RateLimit-Remaining', remainingAttempts);
      res.setHeader('X-RateLimit-Reset', Math.ceil(resetTime / 1000));
    }

    if (parsedOptions.skipSuccessfulRequests) {
      res.on('finish', () => {
        if (res.statusCode < 400) {
          rateLimitStore.decrement(key);
        }
      });
    }

    // Check if limit exceeded (more than 3 attempts in 10 minutes)
    if (count > parsedOptions.maxAttempts) {
      res.setHeader('Retry-After', remainingSeconds);
      return res.status(parsedOptions.statusCode).json({
        success: false,
        error: 'Too Many Requests',
        message: parsedOptions.message,
        retryAfterSeconds: remainingSeconds,
        retryAfterMinutes: Math.ceil(remainingSeconds / 60),
        allowedAttempts: parsedOptions.maxAttempts,
        windowMinutes: Math.round(parsedOptions.windowMs / 60000),
      });
    }

    next();
  };
}

/**
 * Preconfigured strict rate limiter: 3 attempts per 10 minutes
 */
export const strictRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  maxAttempts: 3,           // 3 attempts
  message: 'Too many attempts. You are only allowed 3 attempts in 10 minutes. Please try again later.',
});

/**
 * Preconfigured auth rate limiter: 3 attempts per 10 minutes for login & register
 */
export const authRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxAttempts: 3,
  message: 'Too many login attempts. You are allowed 3 attempts in 10 minutes. Please try again later.',
  keyGenerator: (req: Request) => {
    const ip = getClientIp(req);
    const identifier = (req.body?.email || req.body?.phone || req.body?.username || req.body?.identifier || '').toString().toLowerCase().trim();
    return identifier ? `auth:${ip}:${identifier}` : `auth:${ip}`;
  },
});

/**
 * Preconfigured password reset rate limiter: 3 attempts per 10 minutes
 */
export const passwordResetRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxAttempts: 3,
  message: 'Too many password reset attempts. You are allowed 3 attempts in 10 minutes. Please try again later.',
  keyGenerator: (req: Request) => {
    const ip = getClientIp(req);
    const identifier = (req.body?.email || req.body?.phone || req.body?.identifier || '').toString().toLowerCase().trim();
    return identifier ? `pw-reset:${ip}:${identifier}` : `pw-reset:${ip}`;
  },
});

/**
 * Preconfigured OTP & verification code rate limiter: 3 attempts per 10 minutes
 */
export const otpRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  maxAttempts: 3,
  message: 'Too many OTP verification attempts. You are allowed 3 attempts in 10 minutes. Please try again later.',
  keyGenerator: (req: Request) => {
    const ip = getClientIp(req);
    const code = (req.body?.code || req.body?.resetToken || '').toString().trim();
    return `otp:${ip}:${code}`;
  },
});

/**
 * Preconfigured general API rate limiter: 3000 requests per 15 minutes per IP
 * Allows seamless real-time operation of dashboards (orders, updates, SSE, telemetry)
 * while still defending against abusive automated DDoS floods.
 */
export const apiRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxAttempts: Number(process.env.API_RATE_LIMIT_MAX || 3000),
  message: 'API rate limit exceeded. Please throttle your requests.',
  skipSuccessfulRequests: true,
  keyGenerator: (req: Request) => `api:${getClientIp(req)}`,
  skip: (req: Request) => {
    const p = (req.originalUrl || req.baseUrl || req.path || '').toLowerCase();
    return (
      p.includes('/rider/location') ||
      p.includes('/notifications/stream') ||
      p.includes('/health')
    );
  },
});

/* =========================================================================
 * ZOD VALIDATION MIDDLEWARE & SCHEMAS
 * ========================================================================= */

/**
 * Express middleware that validates req.body against any Zod schema
 */
export function validateBody<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errorIssues = (result as { error: ZodError }).error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errorIssues,
      });
    }
    req.body = result.data;
    next();
  };
}

/**
 * Express middleware that validates req.query against any Zod schema
 */
export function validateQuery<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const errorIssues = (result as { error: ZodError }).error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      return res.status(400).json({
        success: false,
        message: 'Query validation failed',
        errors: errorIssues,
      });
    }
    if (result.data && typeof result.data === 'object' && req.query) {
      for (const key of Object.keys(req.query)) {
        delete (req.query as any)[key];
      }
      Object.assign(req.query, result.data);
    }
    next();
  };
}

/**
 * Express middleware that validates req.params against any Zod schema
 */
export function validateParams<T extends ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      const errorIssues = (result as { error: ZodError }).error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      return res.status(400).json({
        success: false,
        message: 'Parameters validation failed',
        errors: errorIssues,
      });
    }
    if (result.data && typeof result.data === 'object' && req.params) {
      for (const key of Object.keys(req.params)) {
        delete (req.params as any)[key];
      }
      Object.assign(req.params, result.data);
    }
    next();
  };
}

/* =========================================================================
 * CORE REUSABLE ZOD SCHEMAS FOR SECURITY & AUTH
 * ========================================================================= */

/**
 * Login validation schema
 */
export const LoginSchema = z
  .object({
    identifier: z.string().trim().optional(),
    email: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    username: z.string().trim().optional(),
    password: z.string().min(1, 'Password is required'),
    role: z.string().trim().optional(),
  })
  .passthrough()
  .refine(
    (data) => Boolean(data.identifier || data.email || data.phone || data.username),
    {
      message: 'Email, mobile number, username, or account ID is required',
      path: ['identifier'],
    },
  );

/**
 * Password reset request schema
 */
export const PasswordResetRequestSchema = z
  .object({
    identifier: z.string().trim().optional(),
    email: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    customerId: z.string().trim().optional(),
    username: z.string().trim().optional(),
  })
  .refine(
    (data) => Boolean(data.identifier || data.email || data.phone || data.customerId || data.username),
    {
      message: 'Account identifier (email, phone, username, or account ID) is required',
      path: ['identifier'],
    },
  );

/**
 * 6-digit verification code schema
 * Accepts code, resetToken, or token (with optional identifier/email)
 */
export const PasswordResetVerifySchema = z
  .object({
    identifier: z.string().trim().optional(),
    email: z.string().trim().optional(),
    code: z.string().trim().optional(),
    token: z.string().trim().optional(),
    resetToken: z.string().trim().optional(),
  })
  .refine(
    (data) => {
      const codeVal = data.resetToken || data.token || data.code;
      return typeof codeVal === 'string' && /^\d{6}$/.test(codeVal.trim());
    },
    {
      message: 'Verification code must be exactly 6 digits',
      path: ['resetToken'],
    },
  );

/**
 * Password reset confirm schema
 * Accepts resetToken/token/code and password/newPassword
 */
export const PasswordResetConfirmSchema = z
  .object({
    token: z.string().trim().optional(),
    resetToken: z.string().trim().optional(),
    code: z.string().trim().optional(),
    newPassword: z.string().min(8, 'New password must be at least 8 characters long').optional(),
    password: z.string().min(8, 'New password must be at least 8 characters long').optional(),
    confirmPassword: z.string().trim().optional(),
  })
  .refine(
    (data) => Boolean((data.resetToken && data.resetToken.trim().length >= 6) || (data.token && data.token.trim().length >= 6) || (data.code && data.code.trim().length >= 6)),
    {
      message: 'Verification token or code is required',
      path: ['resetToken'],
    },
  )
  .refine(
    (data) => Boolean((data.newPassword && data.newPassword.length >= 8) || (data.password && data.password.length >= 8)),
    {
      message: 'New password must be at least 8 characters long',
      path: ['password'],
    },
  )
  .refine(
    (data) => {
      const pwd = data.newPassword || data.password;
      return !data.confirmPassword || pwd === data.confirmPassword;
    },
    {
      message: 'Passwords do not match',
      path: ['confirmPassword'],
    },
  );

/**
 * In-app change password schema
 */
export const ChangePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8, 'New password must be at least 8 characters long'),
    confirmPassword: z.string().trim().optional(),
  })
  .refine(
    (data) => !data.confirmPassword || data.newPassword === data.confirmPassword,
    {
      message: 'Passwords do not match',
      path: ['confirmPassword'],
    },
  );

/**
 * Registration schema
 */
export const RegisterSchema = z
  .object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters'),
    email: z.string().trim().email('Invalid email address').optional(),
    phone: z.string().trim().min(10, 'Mobile number must be at least 10 digits').optional(),
    password: z.string().min(8, 'Password must be at least 8 characters long'),
    role: z.string().trim().min(1, 'Role is required'),
  })
  .passthrough()
  .refine((data) => Boolean(data.email || data.phone), {
    message: 'Either email or mobile number is required',
    path: ['email'],
  });

export default {
  z,
  createRateLimiter,
  strictRateLimiter,
  authRateLimiter,
  otpRateLimiter,
  passwordResetRateLimiter,
  apiRateLimiter,
  rateLimitStore,
  validateBody,
  validateQuery,
  validateParams,
  RateLimitConfigSchema,
  LoginSchema,
  PasswordResetRequestSchema,
  PasswordResetVerifySchema,
  PasswordResetConfirmSchema,
  ChangePasswordSchema,
  RegisterSchema,
};

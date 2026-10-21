import type { Request, Response, NextFunction } from 'express';
import { sanitizeData } from './sanitizer.js';

// Suspicious patterns to flag in security logs
const XSS_DETECTION_PATTERN = /<\s*script|javascript\s*:|on[a-z]+\s*=|data\s*:\s*text\/html|<\s*iframe/i;

/**
 * Express middleware that recursively sanitizes req.body, req.query, and req.params
 * in-place to prevent Stored and Reflected Cross-Site Scripting (XSS) attacks.
 * Fully compatible with Express 5 getters.
 */
export function xssFilterMiddleware(req: Request, _res: Response, next: NextFunction): void {
  try {
    // 1. Sanitize Body
    if (req.body && typeof req.body === 'object') {
      const rawBodyStr = JSON.stringify(req.body);
      if (XSS_DETECTION_PATTERN.test(rawBodyStr)) {
        console.warn(`[Security Alert: XSS Filter] Neutralized suspicious XSS payload in request body on ${req.method} ${req.originalUrl} from IP: ${req.ip || 'unknown'}`);
      }
      const cleanBody = sanitizeData(req.body);
      try {
        req.body = cleanBody;
      } catch {
        for (const key of Object.keys(req.body)) {
          delete (req.body as any)[key];
        }
        Object.assign(req.body, cleanBody);
      }
    }

    // 2. Sanitize Query Parameters in-place (Express 5 req.query is a getter)
    if (req.query && typeof req.query === 'object') {
      const rawQueryStr = JSON.stringify(req.query);
      if (XSS_DETECTION_PATTERN.test(rawQueryStr)) {
        console.warn(`[Security Alert: XSS Filter] Neutralized suspicious XSS payload in query params on ${req.method} ${req.originalUrl} from IP: ${req.ip || 'unknown'}`);
      }
      for (const key of Object.keys(req.query)) {
        (req.query as any)[key] = sanitizeData((req.query as any)[key]);
      }
    }

    // 3. Sanitize URL Route Parameters in-place
    if (req.params && typeof req.params === 'object') {
      for (const key of Object.keys(req.params)) {
        (req.params as any)[key] = sanitizeData((req.params as any)[key]);
      }
    }
  } catch (err: any) {
    console.error('[XSS Filter Error]:', err?.message || err);
  }

  next();
}

export default xssFilterMiddleware;


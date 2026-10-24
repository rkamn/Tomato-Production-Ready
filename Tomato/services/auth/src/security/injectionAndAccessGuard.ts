import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual, scryptSync } from 'node:crypto';
import { logInjectionEvent, logAccessViolation } from './securityLogger.js';

/* =========================================================================
 * 1. SQL & NOSQL INJECTION PREVENTION
 * ========================================================================= */

// High-confidence SQL injection signatures
const SQL_INJECTION_PATTERNS = [
  /(\b(UNION(\s+ALL)?)\s+SELECT\b)/i,
  /(\bSELECT\b[\s\S]+\bFROM\b[\s\S]+\bWHERE\b)/i,
  /(\bINSERT\s+INTO\b[\s\S]+\bVALUES\b)/i,
  /(\bUPDATE\b[\s\S]+\bSET\b[\s\S]+\bWHERE\b)/i,
  /(\bDELETE\s+FROM\b[\s\S]+\bWHERE\b)/i,
  /(\bDROP\s+(TABLE|DATABASE|VIEW|PROCEDURE)\b)/i,
  /(\bALTER\s+TABLE\b)/i,
  /(\bEXEC(\s+XP_\w+)?\b)/i,
  /(\bWAITFOR\s+DELAY\b)/i,
  /('|\b)(OR|AND)\s+('?\w+'?|\d+)\s*=\s*('?\w+'?|\d+)/i, // e.g. ' OR 1=1 --
  /('|\b)(OR|AND)\s+TRUE\b/i,
  /(\bHAVING\s+\d+=\d+)/i,
  /(--\s*$|;--|\/\*[\s\S]*?\*\/)/, // SQL comments
];

// Dangerous NoSQL / MongoDB operator injections and JavaScript expressions
const NOSQL_INJECTION_KEYS = [
  '$where',
  '$expr',
  '$regex',
  '$ne',
  '$nin',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$function',
  '$accumulator',
  '__proto__',
  'constructor',
  'prototype',
];

/**
 * Checks if a string contains known SQL injection patterns
 */
export function containsSqlInjection(value: string): boolean {
  if (typeof value !== 'string' || value.length < 4) {
    return false;
  }
  return SQL_INJECTION_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Recursively scans an object for dangerous NoSQL operators ($keys) or SQL injection payloads
 */
export function detectInjection(target: unknown): { hasInjection: boolean; reason?: string; field?: string } {
  if (target === null || target === undefined) {
    return { hasInjection: false };
  }

  if (typeof target === 'string') {
    if (containsSqlInjection(target)) {
      return { hasInjection: true, reason: 'SQL Injection signature detected', field: target.slice(0, 50) };
    }
    return { hasInjection: false };
  }

  if (Array.isArray(target)) {
    for (const item of target) {
      const res = detectInjection(item);
      if (res.hasInjection) return res;
    }
    return { hasInjection: false };
  }

  if (typeof target === 'object') {
    for (const [key, val] of Object.entries(target as Record<string, unknown>)) {
      // Check for forbidden NoSQL injection keys or prototype pollution
      if (key.startsWith('$') || NOSQL_INJECTION_KEYS.includes(key.toLowerCase())) {
        return { hasInjection: true, reason: `Forbidden NoSQL operator or prototype key "${key}"`, field: key };
      }

      // Check key name for SQL injection
      if (containsSqlInjection(key)) {
        return { hasInjection: true, reason: 'SQL Injection detected in key name', field: key };
      }

      const res = detectInjection(val);
      if (res.hasInjection) return res;
    }
  }

  return { hasInjection: false };
}

/**
 * Recursively sanitizes any object by stripping keys starting with '$' or containing '.'
 */
export function sanitizeNoSqlPayload<T>(input: T): T {
  if (input === null || typeof input !== 'object') {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeNoSqlPayload(item)) as unknown as T;
  }

  const cleanObj: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    // Strip dangerous NoSQL operators and prototype pollution keys
    if (key.startsWith('$') || key.includes('.') || key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    cleanObj[key] = sanitizeNoSqlPayload(value);
  }

  return cleanObj as T;
}

/**
 * Express Middleware: Defends against SQL & NoSQL injection across body, query, and params
 */
export function sqlAndNoSqlInjectionGuardMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 1. Check URL parameters
  const paramsCheck = detectInjection(req.params);
  if (paramsCheck.hasInjection) {
    logInjectionEvent('URL_PARAMS', req, paramsCheck.field || 'params', paramsCheck.reason || 'Signature match');
    res.status(400).json({
      success: false,
      error: 'Bad Request',
      message: 'Malicious query or injection payload detected in URL parameters',
      code: 'INJECTION_DETECTED',
    });
    return;
  }

  // 2. Check and sanitize Query string
  const queryCheck = detectInjection(req.query);
  if (queryCheck.hasInjection) {
    logInjectionEvent('QUERY_STRING', req, queryCheck.field || 'query', queryCheck.reason || 'Signature match');
    res.status(400).json({
      success: false,
      error: 'Bad Request',
      message: 'Malicious query or injection payload detected in query string',
      code: 'INJECTION_DETECTED',
    });
    return;
  }
  if (req.query && typeof req.query === 'object') {
    for (const key of Object.keys(req.query)) {
      if (key.startsWith('$') || key.includes('.') || key === '__proto__' || key === 'constructor' || key === 'prototype') {
        delete (req.query as any)[key];
      }
    }
  }

  // 3. Check and sanitize Body (for mutating requests)
  if (req.body && typeof req.body === 'object') {
    const bodyCheck = detectInjection(req.body);
    if (bodyCheck.hasInjection) {
      logInjectionEvent('REQUEST_BODY', req, bodyCheck.field || 'body', bodyCheck.reason || 'Signature match');
      res.status(400).json({
        success: false,
        error: 'Bad Request',
        message: `Malicious query or injection payload detected in request body: ${bodyCheck.reason}`,
        code: 'INJECTION_DETECTED',
      });
      return;
    }
    req.body = sanitizeNoSqlPayload(req.body);
  }

  next();
}

/* =========================================================================
 * 2. PASSWORD GUESSING & BRUTE-FORCE DEFENSE
 * ========================================================================= */

interface FailedAttemptTracker {
  attempts: number;
  lockUntil: number;
  lastAttemptTime: number;
}

/**
 * In-memory failed credential attempt tracker with progressive lockouts
 */
class CredentialAttemptTracker {
  private tracker = new Map<string, FailedAttemptTracker>();

  /**
   * Check if a credential identifier (e.g. email or username) is currently locked out
   */
  public isLockedOut(identifier: string): { locked: boolean; remainingSeconds: number } {
    const key = identifier.toLowerCase().trim();
    const record = this.tracker.get(key);
    if (!record) {
      return { locked: false, remainingSeconds: 0 };
    }

    const now = Date.now();
    if (now < record.lockUntil) {
      const remainingSeconds = Math.ceil((record.lockUntil - now) / 1000);
      return { locked: true, remainingSeconds };
    }

    // Lock has expired; if last attempt was more than 30 minutes ago, reset completely
    if (now - record.lastAttemptTime > 30 * 60 * 1000) {
      this.tracker.delete(key);
    }

    return { locked: false, remainingSeconds: 0 };
  }

  /**
   * Register a failed authentication attempt with progressive lockouts:
   * - 3 failures: 2 minutes lockout
   * - 5 failures: 10 minutes lockout
   * - 8+ failures: 30 minutes lockout
   */
  public recordFailure(identifier: string): { attempts: number; isLocked: boolean; lockMinutes: number } {
    const key = identifier.toLowerCase().trim();
    const now = Date.now();
    const record = this.tracker.get(key) || { attempts: 0, lockUntil: 0, lastAttemptTime: now };

    record.attempts += 1;
    record.lastAttemptTime = now;

    let lockMinutes = 0;
    if (record.attempts >= 8) {
      lockMinutes = 30; // 30 minutes for aggressive guessing
      record.lockUntil = now + 30 * 60 * 1000;
    } else if (record.attempts >= 5) {
      lockMinutes = 10; // 10 minutes
      record.lockUntil = now + 10 * 60 * 1000;
    } else if (record.attempts >= 3) {
      lockMinutes = 2; // 2 minutes
      record.lockUntil = now + 2 * 60 * 1000;
    }

    this.tracker.set(key, record);
    return {
      attempts: record.attempts,
      isLocked: lockMinutes > 0,
      lockMinutes,
    };
  }

  /**
   * Reset failed attempt counter upon successful login
   */
  public recordSuccess(identifier: string): void {
    const key = identifier.toLowerCase().trim();
    this.tracker.delete(key);
  }

  public clear(): void {
    this.tracker.clear();
  }
}

export const credentialAttemptTracker = new CredentialAttemptTracker();

/**
 * Constant-time string/hash comparison to prevent timing-based side-channel password guessing
 */
export function secureTimingEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  // Hash both inputs with scrypt or sha256 to ensure equal length buffers before comparing
  const bufA = scryptSync(a, 'salt', 32);
  const bufB = scryptSync(b, 'salt', 32);
  return timingSafeEqual(bufA, bufB);
}

/**
 * Evaluates password strength to eliminate weak or easily guessable passwords
 */
export function evaluatePasswordStrength(password: string): { valid: boolean; score: number; issues: string[] } {
  const issues: string[] = [];
  if (!password || typeof password !== 'string') {
    return { valid: false, score: 0, issues: ['Password must be a non-empty string'] };
  }

  if (password.length < 8) {
    issues.push('Password must be at least 8 characters long');
  }
  if (!/[A-Z]/.test(password)) {
    issues.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    issues.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    issues.push('Password must contain at least one number');
  }

  // Check against common easily guessable passwords
  const commonPasswords = ['password', '12345678', 'admin123', 'tomato123', 'qwerty1234', 'welcome123'];
  if (commonPasswords.includes(password.toLowerCase())) {
    issues.push('Password is too common or easily guessable');
  }

  const score = Math.max(0, 4 - issues.length);
  return {
    valid: issues.length === 0,
    score,
    issues,
  };
}

/* =========================================================================
 * 3. UNAUTHORIZED ACCESS PREVENTION
 * ========================================================================= */

/**
 * Middleware preventing unauthorized direct access by validating request origin & integrity
 */
export function unauthorizedAccessGuardMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Block requests that attempt host header poisoning
  const host = req.headers['host'];
  if (host && (host.includes('\r') || host.includes('\n') || host.includes('@'))) {
    res.status(400).json({
      success: false,
      error: 'Bad Request',
      message: 'Invalid Host header detected',
    });
    return;
  }

  // Prevent path traversal attempts in URL (e.g. /../../etc/passwd)
  const decodedPath = decodeURI(req.path || '');
  if (decodedPath.includes('..') || decodedPath.includes('\\')) {
    logAccessViolation('FORBIDDEN', req, `Path traversal attempt blocked: ${decodedPath}`);
    res.status(403).json({
      success: false,
      error: 'Forbidden',
      message: 'Path traversal attempt blocked',
    });
    return;
  }

  next();
}

export default {
  containsSqlInjection,
  detectInjection,
  sanitizeNoSqlPayload,
  sqlAndNoSqlInjectionGuardMiddleware,
  credentialAttemptTracker,
  secureTimingEqual,
  evaluatePasswordStrength,
  unauthorizedAccessGuardMiddleware,
};

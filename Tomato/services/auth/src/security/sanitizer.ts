/**
 * Comprehensive Sanitization Utilities for XSS Prevention
 */

// Regex to remove script and style tags along with their inner content
const SCRIPT_TAG_CONTENT_REGEX = /<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi;
const STYLE_TAG_CONTENT_REGEX = /<\s*style\b[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi;

// Regex to identify remaining dangerous HTML tags
const DANGEROUS_TAGS_REGEX = /<\s*\/?\s*(script|iframe|embed|object|applet|meta|link|style|form|frame|frameset|base)[^>]*>/gi;

// Regex to identify inline event handlers (e.g. onload, onerror, onclick, onmouseover)
const EVENT_HANDLER_REGEX = /\s*on[a-z]+\s*=\s*(['"][^'"]*['"]|[^\s>]+)/gi;

// Regex to identify javascript/vbscript/data URI schemes
const DANGEROUS_PROTOCOL_REGEX = /(?:javascript|vbscript|data\s*:\s*text\s*\/\s*html)\s*:[^\s]*/gi;

/**
 * Escapes characters with special meaning in HTML to prevent HTML injection attacks
 */
export function escapeHtml(str: string): string {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Strips all HTML tags from a string
 */
export function stripHtml(str: string): string {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim();
}

/**
 * Validates whether a URL is safe to use in href or src attributes.
 * Disallows javascript:, vbscript:, data:text/html, etc.
 */
export function isSafeUrl(url: string): boolean {
  if (typeof url !== 'string' || !url.trim()) return false;
  const trimmed = url.trim().toLowerCase();
  
  // Allow relative URLs starting with / or ./ or #
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('#')) {
    return true;
  }
  
  // Disallow javascript:, vbscript:, and data:text/html
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('vbscript:') || trimmed.startsWith('data:text/html')) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol);
  } catch {
    // Relative URL without protocol
    return !trimmed.includes(':');
  }
}

/**
 * Neutralizes dangerous URI schemes from a URL string
 */
export function sanitizeUrl(url: string, fallback: string = ''): string {
  if (!url || typeof url !== 'string') return fallback;
  return isSafeUrl(url) ? url.trim() : fallback;
}

/**
 * Cleans a string by removing script tags, event handlers, and dangerous protocol links
 */
export function cleanXssString(str: string): string {
  if (typeof str !== 'string') return str;
  if (!str) return '';

  let cleaned = str;

  // 1. Strip script and style tags along with their inner code/content
  cleaned = cleaned.replace(SCRIPT_TAG_CONTENT_REGEX, '');
  cleaned = cleaned.replace(STYLE_TAG_CONTENT_REGEX, '');

  // 2. Strip dangerous tags
  cleaned = cleaned.replace(DANGEROUS_TAGS_REGEX, '');

  // 2. Remove inline event handlers (e.g. onerror="alert(1)", onload=...)
  cleaned = cleaned.replace(EVENT_HANDLER_REGEX, '');

  // 3. Remove javascript/vbscript/data pseudo-protocols
  cleaned = cleaned.replace(DANGEROUS_PROTOCOL_REGEX, '');

  return cleaned;
}

/**
 * Recursively sanitizes any data structure (string, array, object) against XSS payloads
 */
export function sanitizeData<T>(input: T): T {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    return cleanXssString(input) as unknown as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeData(item)) as unknown as T;
  }

  if (typeof input === 'object') {
    // Check if it is a Date, Buffer, ObjectId, etc.
    if (input instanceof Date || (input as any)._bsontype || (input as any) instanceof RegExp) {
      return input;
    }

    const sanitizedObj: Record<string, any> = {};
    for (const [key, value] of Object.entries(input)) {
      // Clean keys as well to prevent prototype pollution or injection via key names
      const cleanKey = cleanXssString(key);
      if (cleanKey === '__proto__' || cleanKey === 'constructor' || cleanKey === 'prototype') {
        continue;
      }
      sanitizedObj[cleanKey] = sanitizeData(value);
    }
    return sanitizedObj as T;
  }

  return input;
}

export default {
  escapeHtml,
  stripHtml,
  isSafeUrl,
  sanitizeUrl,
  cleanXssString,
  sanitizeData,
};


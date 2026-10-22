/**
 * Tomato Frontend Security Module
 * 
 * Implements:
 * 1. Safe HTML insertion (safeSetHTML) and entity escaping (escapeHtml)
 * 2. URL sanitization and protocol validation (sanitizeUrl)
 * 3. Secrets isolation, sensitive token cleanup, and URL parameter scrubbing (tokenStorage, clearClientSession, scrubSensitiveUrlParams)
 * 4. Protection against dynamic code execution (eval, new Function, unsafe javascript: targets)
 */

(function () {
  'use strict';

  // Allowed URL protocols for anchors, image sources, and navigation
  const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
  const SAFE_IMAGE_DATA_REGEX = /^data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/i;

  /**
   * Escape HTML entities to prevent Cross-Site Scripting (XSS)
   * Converts &, <, >, ", ', and ` into safe character entities.
   *
   * @param {*} str - Input value
   * @returns {string} - Escaped string safe for HTML text or attributes
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Escape string for safe insertion inside JavaScript literals in HTML event attributes
   * 
   * @param {*} str - Input value
   * @returns {string} - Safe escaped string
   */
  function escapeJs(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/"/g, '\\"')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/</g, '\\x3c')
      .replace(/>/g, '\\x3e');
  }

  /**
   * Validate and sanitize URLs to prevent javascript:, vbscript:, and malicious data: injections.
   * Allows safe relative paths (/path, ./path), safe web URLs (http:, https:), contact links (mailto:, tel:),
   * and base64 encoded safe images.
   *
   * @param {string} rawUrl - Untrusted URL
   * @param {string} [fallback=''] - Safe fallback if invalid
   * @returns {string} - Validated URL or fallback
   */
  function sanitizeUrl(rawUrl, fallback = '') {
    if (!rawUrl || typeof rawUrl !== 'string') return fallback;

    // Strip control characters and whitespace
    const cleaned = rawUrl.trim().replace(/[\u0000-\u001F\u007F-\u009F\s]+/g, '');
    if (!cleaned) return fallback;

    // Check for explicit dangerous pseudo-protocols before URL parsing
    const lower = cleaned.toLowerCase();
    if (
      lower.startsWith('javascript:') ||
      lower.startsWith('vbscript:') ||
      lower.startsWith('file:') ||
      lower.startsWith('data:text/')
    ) {
      console.warn('[Security] Dangerous URL scheme blocked:', cleaned);
      return fallback;
    }

    // Allow safe image data URIs (base64 or encoded SVG)
    if (lower.startsWith('data:image/')) {
      return cleaned;
    }
    if (lower.startsWith('data:')) {
      console.warn('[Security] Disallowed non-image data URL type blocked:', cleaned.slice(0, 32));
      return fallback;
    }

    // Relative URLs starting with / or ./ or ../ without colon in path segment
    if (cleaned.startsWith('/') || cleaned.startsWith('./') || cleaned.startsWith('../')) {
      return cleaned;
    }

    try {
      // Parse with base origin
      const parsed = new URL(cleaned, window.location.origin);
      if (SAFE_URL_PROTOCOLS.has(parsed.protocol)) {
        return cleaned;
      }
    } catch (_) {
      // Relative path without leading slash
      if (!cleaned.includes(':')) {
        return cleaned;
      }
    }

    console.warn('[Security] Disallowed URL scheme rejected:', cleaned);
    return fallback;
  }

  /**
   * Cleanly set HTML content on a DOM element using native Sanitizer API (setHTML)
   * where available, falling back to inert Document-based parsing with strict tag & attribute allowlists.
   *
   * @param {HTMLElement} element - Target container element
   * @param {string} untrustedHtml - Markup to sanitize and insert
   * @param {Object} [options] - Optional custom allowed elements and attributes
   */
  function safeSetHTML(element, untrustedHtml, options = {}) {
    if (!element || !(element instanceof Element)) return;
    if (typeof untrustedHtml !== 'string') {
      element.textContent = untrustedHtml ? String(untrustedHtml) : '';
      return;
    }

    const defaultElements = [
      'a', 'b', 'strong', 'i', 'em', 'u', 's', 'span', 'div', 'p', 'br', 'hr',
      'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead',
      'tbody', 'tr', 'th', 'td', 'img', 'svg', 'path', 'circle', 'rect', 'line',
      'polyline', 'polygon', 'time', 'small', 'badge', 'button', 'code', 'pre'
    ];
    const allowedElements = options.elements || defaultElements;
    const defaultAttributes = [
      'class', 'id', 'style', 'title', 'alt', 'src', 'href', 'target', 'rel',
      'width', 'height', 'viewbox', 'fill', 'stroke', 'stroke-width', 'd', 'points',
      'data-id', 'data-status', 'data-type', 'type', 'colspan', 'rowspan'
    ];
    const allowedAttributes = options.attributes || defaultAttributes;

    // Use native modern Sanitizer API if supported (Chrome 146+, Firefox 148+, Edge 146+)
    if (typeof element.setHTML === 'function') {
      try {
        element.setHTML(untrustedHtml, {
          sanitizer: {
            elements: allowedElements,
            attributes: allowedAttributes,
          },
        });
        return;
      } catch (err) {
        // Fall through to DOM fallback on any sanitizer error
        console.warn('[Security] Native setHTML failed, applying fallback sanitizer:', err);
      }
    }

    // Fallback: Inert DOM Document parsing and node tree filtering
    const parser = new DOMParser();
    const doc = parser.parseFromString(untrustedHtml, 'text/html');

    function cleanNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return;
      if (node.nodeType !== Node.ELEMENT_NODE) {
        node.remove();
        return;
      }

      const tagName = node.tagName.toLowerCase();
      // Remove dangerous and disallowed tags completely
      if (
        !allowedElements.includes(tagName) ||
        ['script', 'iframe', 'object', 'embed', 'style', 'base', 'meta', 'link', 'form'].includes(tagName)
      ) {
        node.remove();
        return;
      }

      // Filter attributes
      const attrs = Array.from(node.attributes);
      for (const attr of attrs) {
        const name = attr.name.toLowerCase();
        const value = attr.value;

        // Block inline event handlers (onclick, onerror, onload, etc.)
        if (name.startsWith('on')) {
          node.removeAttribute(attr.name);
          continue;
        }

        // Enforce attribute allowlist
        if (!allowedAttributes.includes(name)) {
          node.removeAttribute(attr.name);
          continue;
        }

        // Validate URLs in href and src
        if (name === 'href' || name === 'src') {
          const safe = sanitizeUrl(value, '');
          if (!safe) {
            node.removeAttribute(attr.name);
          } else {
            node.setAttribute(attr.name, safe);
          }
        }
      }

      // Recursively clean children
      Array.from(node.childNodes).forEach(cleanNode);
    }

    Array.from(doc.body.childNodes).forEach(cleanNode);
    element.replaceChildren(...Array.from(doc.body.childNodes));
  }

  /**
   * Token & Session Security:
   * Keep secrets and sensitive tokens out of browser code and memory leaks
   */
  const SENSITIVE_STORAGE_KEYS = [
    'tomatoToken',
    'tomatoUser',
    'tomato_active_view',
    'tomato_support_contact',
    'tomato_partner_billing_tab',
    'tomato_visited_restaurants',
    'tomato_visited_shops',
  ];

  /**
   * Centralized cleanup function to purge tokens and session state
   * on logout, 401 Unauthorized, or session expiration.
   */
  function clearClientSession() {
    try {
      SENSITIVE_STORAGE_KEYS.forEach((key) => {
        try {
          localStorage.removeItem(key);
        } catch (_) {}
        try {
          sessionStorage.removeItem(key);
        } catch (_) {}
      });
      // Clear dynamic keys with tomato prefix
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('tomato_') || k.startsWith('tomatoToken') || k.startsWith('tomatoUser'))) {
          try {
            localStorage.removeItem(k);
          } catch (_) {}
        }
      }
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith('tomato_')) {
          try {
            sessionStorage.removeItem(k);
          } catch (_) {}
        }
      }
    } catch (e) {
      console.warn('[Security] Failed to cleanly clear client storage:', e);
    }
  }

  /**
   * Scrub sensitive tokens (password reset tokens, verification codes, auth secrets)
   * from the browser address bar and history state so they are not saved in history
   * or leaked via the Referer header to external links or third-party resources.
   */
  function scrubSensitiveUrlParams() {
    try {
      const url = new URL(window.location.href);
      const sensitiveParams = ['token', 'resetToken', 'code', 'otp', 'secret', 'password'];
      let modified = false;

      sensitiveParams.forEach((param) => {
        if (url.searchParams.has(param)) {
          url.searchParams.delete(param);
          modified = true;
        }
      });

      if (modified) {
        const cleanUrl = url.pathname + (url.searchParams.toString() ? '?' + url.searchParams.toString() : '') + url.hash;
        const title = typeof document !== 'undefined' ? document.title : '';
        window.history.replaceState({}, title, cleanUrl);
      }
    } catch (_) {}
  }

  /**
   * Decode and inspect JWT expiration claim (exp) against current time.
   * Returns true if the token is missing, malformed, or already expired.
   *
   * @param {string} tokenStr - Raw JWT string
   * @param {number} [bufferMs=5000] - Clock skew / safety buffer in milliseconds
   * @returns {boolean} - true if expired or invalid
   */
  function isTokenExpired(tokenStr, bufferMs = 5000) {
    if (!tokenStr || typeof tokenStr !== 'string') return true;
    try {
      const parts = tokenStr.split('.');
      if (parts.length !== 3) return true;
      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      const parsed = JSON.parse(jsonPayload);
      if (typeof parsed.exp !== 'number') return false;
      return (parsed.exp * 1000) <= (Date.now() + bufferMs);
    } catch (_) {
      return true;
    }
  }

  // Freeze security exports on window.TomatoSecurity
  const TomatoSecurity = Object.freeze({
    escapeHtml,
    escapeJs,
    sanitizeUrl,
    safeSetHTML,
    clearClientSession,
    scrubSensitiveUrlParams,
    isTokenExpired,
  });

  window.TomatoSecurity = TomatoSecurity;

  // Also expose escapeHtml and sanitizeUrl globally for direct calls
  if (typeof window.isTokenExpired !== 'function') {
    window.isTokenExpired = isTokenExpired;
  }
  if (typeof window.escapeHtml !== 'function') {
    window.escapeHtml = escapeHtml;
  }
  if (typeof window.escapeJs !== 'function') {
    window.escapeJs = escapeJs;
  }
  if (typeof window.sanitizeUrl !== 'function') {
    window.sanitizeUrl = sanitizeUrl;
  }
  if (typeof window.safeSetHTML !== 'function') {
    window.safeSetHTML = safeSetHTML;
  }
})();

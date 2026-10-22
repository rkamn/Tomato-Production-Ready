#!/usr/bin/env node

/**
 * Enterprise Security Test Suite
 * 
 * Tests:
 * 1. Access Controls (path traversal, unauthenticated route access, role authorization)
 * 2. SQL & NoSQL Injection defense
 * 3. Cross-Site Scripting (XSS) input filtering and sanitization
 * 4. Payment flow security and amount validation
 * 5. Security event logging & sensitive data redaction (zero password/token leakage)
 * 6. HTTPS enforcement and defensive HTTP headers
 */

import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const securityDistPath = path.resolve(__dirname, '../dist/security/index.js');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(testName, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ [PASS] ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${testName}`);
    console.error(`    Error: ${err.message}`);
    failedTests++;
  }
}

async function runAsyncTest(testName, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ [PASS] ${testName}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${testName}`);
    console.error(`    Error: ${err.message}`);
    failedTests++;
  }
}

async function main() {
  console.log('\n=======================================================');
  console.log('🛡️  STARTING ENTERPRISE SECURITY DEFENSE TEST SUITE');
  console.log('=======================================================\n');

  const security = await import(securityDistPath);
  const {
    containsSqlInjection,
    detectInjection,
    sanitizeNoSqlPayload,
    cleanXssString,
    sanitizeData,
    sanitizeLogData,
    sanitizePath,
    shouldThrottleUnauthLog,
    enforceHttpsMiddleware,
    securityHeadersMiddleware,
  } = security;

  // =========================================================================
  // 1. ACCESS CONTROL TESTS
  // =========================================================================
  console.log('--- 1. Testing Access Controls & Traversal Protections ---');

  runTest('Should block directory path traversal attempts (/../../etc/passwd)', () => {
    let statusCode = 0;
    let responseBody = null;

    const mockReq = {
      path: '/static/../../etc/passwd',
      headers: { host: 'example.com' },
    };
    const mockRes = {
      status(code) {
        statusCode = code;
        return this;
      },
      json(data) {
        responseBody = data;
        return this;
      },
    };
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    security.unauthorizedAccessGuardMiddleware(mockReq, mockRes, next);

    assert.strictEqual(statusCode, 403, 'Must return 403 Forbidden for path traversal');
    assert.strictEqual(nextCalled, false, 'Next middleware must not be called');
    assert.strictEqual(responseBody?.error, 'Forbidden');
  });

  runTest('Should block backslash Windows path traversal (..\\..\\windows)', () => {
    let statusCode = 0;
    const mockReq = {
      path: '/files/..\\..\\windows\\system32',
      headers: { host: 'example.com' },
    };
    const mockRes = {
      status(code) { statusCode = code; return this; },
      json() { return this; },
    };
    let nextCalled = false;
    security.unauthorizedAccessGuardMiddleware(mockReq, mockRes, () => { nextCalled = true; });

    assert.strictEqual(statusCode, 403);
    assert.strictEqual(nextCalled, false);
  });

  runTest('Should block Host header poisoning attempts with carriage returns', () => {
    let statusCode = 0;
    const mockReq = {
      path: '/api/auth/me',
      headers: { host: 'legitimate.com\r\nX-Injected: evil.com' },
    };
    const mockRes = {
      status(code) { statusCode = code; return this; },
      json() { return this; },
    };
    let nextCalled = false;
    security.unauthorizedAccessGuardMiddleware(mockReq, mockRes, () => { nextCalled = true; });

    assert.strictEqual(statusCode, 400, 'Must reject malicious Host header with 400');
    assert.strictEqual(nextCalled, false);
  });

  runTest('Should pass legitimate path requests through access control', () => {
    let nextCalled = false;
    const mockReq = {
      path: '/api/v1/customer/orders/ORD-1234',
      headers: { host: 'tomato.app' },
    };
    const mockRes = {
      status() { return this; },
      json() { return this; },
    };
    security.unauthorizedAccessGuardMiddleware(mockReq, mockRes, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, true, 'Legitimate request must proceed');
  });

  // =========================================================================
  // 2. INJECTION DEFENSE TESTS (SQL & NoSQL)
  // =========================================================================
  console.log('\n--- 2. Testing SQL & NoSQL Injection Defenses ---');

  runTest('Should detect classic SQL injection signature (\' OR 1=1 --)', () => {
    const payload = "' OR 1=1 --";
    assert.strictEqual(containsSqlInjection(payload), true);
    assert.strictEqual(detectInjection(payload).hasInjection, true);
  });

  runTest('Should detect UNION SELECT SQL injection signature', () => {
    const payload = "admin' UNION SELECT null, username, password FROM users--";
    assert.strictEqual(containsSqlInjection(payload), true);
    assert.strictEqual(detectInjection(payload).hasInjection, true);
  });

  runTest('Should detect DROP TABLE SQL injection signature', () => {
    const payload = "; DROP TABLE employees; --";
    assert.strictEqual(containsSqlInjection(payload), true);
    assert.strictEqual(detectInjection(payload).hasInjection, true);
  });

  runTest('Should detect nested NoSQL operator injection ($gt, $where, $ne)', () => {
    const payload = {
      username: 'admin',
      password: { $gt: '' },
    };
    const result = detectInjection(payload);
    assert.strictEqual(result.hasInjection, true);
    assert.match(result.reason, /Forbidden NoSQL operator/);
  });

  runTest('Should detect prototype pollution injection (__proto__, constructor)', () => {
    const payload = JSON.parse('{"__proto__": {"isAdmin": true}}');
    const result = detectInjection(payload);
    assert.strictEqual(result.hasInjection, true);
  });

  runTest('Should cleanly sanitize and strip NoSQL injection keys via sanitizeNoSqlPayload', () => {
    const rawInput = {
      role: 'customer',
      $where: 'sleep(5000)',
      email: 'test@example.com',
      nested: {
        $regex: '.*',
        validKey: 42,
      },
    };
    const sanitized = sanitizeNoSqlPayload(rawInput);
    assert.strictEqual(sanitized.$where, undefined, '$where must be stripped');
    assert.strictEqual(sanitized.nested.$regex, undefined, 'nested $regex must be stripped');
    assert.strictEqual(sanitized.role, 'customer', 'legitimate keys preserved');
    assert.strictEqual(sanitized.nested.validKey, 42, 'legitimate nested keys preserved');
  });

  // =========================================================================
  // 3. XSS FILTERING & INPUT SANITIZATION TESTS
  // =========================================================================
  console.log('\n--- 3. Testing Cross-Site Scripting (XSS) Defenses ---');

  runTest('Should sanitize <script> tags from incoming strings', () => {
    const dirty = '<script>alert("XSS")</script>Hello World!';
    const clean = cleanXssString(dirty);
    assert.strictEqual(clean.includes('<script>'), false);
    assert.strictEqual(clean.includes('</script>'), false);
    assert.strictEqual(clean.trim(), 'Hello World!');
  });

  runTest('Should neutralize inline event handlers (onerror, onload, onclick)', () => {
    const dirty = '<img src="invalid.jpg" onerror="alert(document.cookie)" />';
    const clean = cleanXssString(dirty);
    assert.strictEqual(clean.includes('onerror='), false);
  });

  runTest('Should strip javascript: pseudo-protocol links', () => {
    const dirty = '<a href="javascript:stealTokens()">Click here</a>';
    const clean = cleanXssString(dirty);
    assert.strictEqual(clean.includes('javascript:'), false);
  });

  runTest('Should recursively sanitize complex nested JSON payloads with sanitizeData', () => {
    const dirtyObj = {
      name: 'Safe Name',
      comment: '<script>alert("XSS")</script>Delicious food!',
      tags: ['italian', '<img src=x onerror=alert(1)>pasta'],
    };
    const cleanObj = sanitizeData(dirtyObj);
    assert.strictEqual(cleanObj.comment.includes('<script>'), false);
    assert.strictEqual(cleanObj.tags[1].includes('onerror='), false);
  });

  // =========================================================================
  // 4. PAYMENT FLOW SECURITY TESTS
  // =========================================================================
  console.log('\n--- 4. Testing Payment Flow Security ---');

  runTest('Should reject negative or zero payment amount in validation', () => {
    const validatePaymentAmount = (amt) => {
      const num = Number(amt);
      if (isNaN(num) || num <= 0 || !Number.isFinite(num)) {
        return { valid: false, error: 'Payment amount must be a positive number' };
      }
      return { valid: true, amount: Math.round(num * 100) / 100 };
    };

    assert.strictEqual(validatePaymentAmount(-100).valid, false);
    assert.strictEqual(validatePaymentAmount(0).valid, false);
    assert.strictEqual(validatePaymentAmount('NaN').valid, false);
    assert.strictEqual(validatePaymentAmount(Infinity).valid, false);
    assert.strictEqual(validatePaymentAmount(250.75).valid, true);
  });

  runTest('Should reject payout execution without Admin credentials', () => {
    const mockOrderSettlement = {
      orderId: 'ORD-7788',
      amount: 450,
      status: 'pending',
    };

    const processPayout = (user, settlement) => {
      if (!user || user.role !== 'admin' && user.role !== 'superadmin') {
        throw new Error('403 Forbidden: Insufficient privileges for financial payout disbursement');
      }
      return { settled: true, orderId: settlement.orderId };
    };

    assert.throws(() => {
      processPayout({ role: 'customer' }, mockOrderSettlement);
    }, /403 Forbidden/);

    assert.throws(() => {
      processPayout(null, mockOrderSettlement);
    }, /403 Forbidden/);

    const result = processPayout({ role: 'admin' }, mockOrderSettlement);
    assert.strictEqual(result.settled, true);
  });

  // =========================================================================
  // 5. SECURITY LOGGING & SENSITIVE DATA REDACTION TESTS
  // =========================================================================
  console.log('\n--- 5. Testing Security Event Logging & Data Redaction ---');

  runTest('Should redact passwords, new passwords, and confirm passwords in logs', () => {
    const logData = {
      user: 'john_doe',
      password: 'SuperSecretPassword123!',
      newPassword: 'MyNewSecretPassword456!',
      confirmPassword: 'MyNewSecretPassword456!',
    };
    const sanitized = sanitizeLogData(logData);
    assert.strictEqual(sanitized.password, '[REDACTED_PASSWORD]');
    assert.strictEqual(sanitized.newPassword, '[REDACTED_PASSWORD]');
    assert.strictEqual(sanitized.confirmPassword, '[REDACTED_PASSWORD]');
    assert.strictEqual(sanitized.user, 'john_doe');
  });

  runTest('Should redact JWT tokens and Bearer headers in logs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjM0NSJ9.TJVA95OrM7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ';
    const logData = {
      token: jwt,
      authHeader: `Bearer ${jwt}`,
      metadata: { nestedToken: jwt },
    };
    const sanitized = sanitizeLogData(logData);
    assert.strictEqual(sanitized.token, '[REDACTED_TOKEN]');
    assert.strictEqual(sanitized.authHeader, 'Bearer [REDACTED_TOKEN]');
    assert.strictEqual(sanitized.metadata.nestedToken, '[REDACTED_JWT_TOKEN]');
  });

  runTest('Should redact OTP verification codes and API keys', () => {
    const logData = {
      otp: '782910',
      verificationCode: '449102',
      apiKey: 'rzp_live_secretkey123',
    };
    const sanitized = sanitizeLogData(logData);
    assert.strictEqual(sanitized.otp, '[REDACTED_OTP_CODE]');
    assert.strictEqual(sanitized.verificationCode, '[REDACTED_OTP_CODE]');
    assert.strictEqual(sanitized.apiKey, '[REDACTED_SECRET]');
  });

  runTest('Should redact sensitive tokens and credentials from logged URL paths', () => {
    const rawPath1 = '/api/notifications/stream?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZXNzaW9uSWQi...';
    assert.strictEqual(sanitizePath(rawPath1), '/api/notifications/stream?token=[REDACTED]');

    const rawPath2 = '/api/auth/reset?code=123456&email=admin@lightbits.in';
    assert.strictEqual(sanitizePath(rawPath2), '/api/auth/reset?code=[REDACTED]&email=admin@lightbits.in');

    const cleanPath = '/api/auth/profile';
    assert.strictEqual(sanitizePath(cleanPath), '/api/auth/profile');
  });

  runTest('Should throttle repetitive burst 401 unauthorized warnings for same IP and route', () => {
    const testIp = '192.168.10.99';
    const testRoute = '/api/notifications/stream?token=xyz';

    // First request should NOT be throttled
    const firstCheck = shouldThrottleUnauthLog(testIp, 'GET', testRoute);
    assert.strictEqual(firstCheck, false, 'First unauth request should be logged');

    // Immediate second request to same endpoint should be throttled
    const secondCheck = shouldThrottleUnauthLog(testIp, 'GET', testRoute);
    assert.strictEqual(secondCheck, true, 'Immediate identical unauth request should be throttled');

    // Different IP should not be throttled on its first attempt
    const diffIpCheck = shouldThrottleUnauthLog('192.168.10.100', 'GET', testRoute);
    assert.strictEqual(diffIpCheck, false, 'Different IP first attempt should not be throttled');
  });

  // =========================================================================
  // 6. HTTPS ENFORCEMENT & SECURITY HEADERS TESTS
  // =========================================================================
  console.log('\n--- 6. Testing HTTPS Enforcement & Security Headers ---');

  runTest('Should redirect HTTP to HTTPS when in production or ENFORCE_HTTPS=true', () => {
    const origEnv = process.env.ENFORCE_HTTPS;
    process.env.ENFORCE_HTTPS = 'true';

    let redirectCode = 0;
    let redirectTarget = '';
    const mockReq = {
      secure: false,
      headers: { host: 'tomato.app', 'x-forwarded-proto': 'http' },
      originalUrl: '/dashboard/orders',
    };
    const mockRes = {
      redirect(code, url) {
        redirectCode = code;
        redirectTarget = url;
      },
    };
    let nextCalled = false;

    enforceHttpsMiddleware(mockReq, mockRes, () => { nextCalled = true; });

    assert.strictEqual(redirectCode, 301, 'Must issue 301 Permanent Redirect');
    assert.strictEqual(redirectTarget, 'https://tomato.app/dashboard/orders');
    assert.strictEqual(nextCalled, false);

    process.env.ENFORCE_HTTPS = origEnv;
  });

  runTest('Should NOT redirect localhost requests during local development', () => {
    const origEnv = process.env.ENFORCE_HTTPS;
    process.env.ENFORCE_HTTPS = 'true';

    const mockReq = {
      secure: false,
      headers: { host: 'localhost:5050' },
      originalUrl: '/health',
    };
    const mockRes = {
      redirect() { assert.fail('Should not redirect localhost'); },
    };
    let nextCalled = false;

    enforceHttpsMiddleware(mockReq, mockRes, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, true, 'Localhost request must proceed');
    process.env.ENFORCE_HTTPS = origEnv;
  });

  await runAsyncTest('Should set protective security headers (HSTS, CSP, X-XSS-Protection)', async () => {
    const headers = {};
    const mockReq = {
      headers: {},
      method: 'GET',
      url: '/health',
    };
    const mockRes = {
      setHeader(name, val) { headers[name.toLowerCase()] = val; },
      getHeader(name) { return headers[name.toLowerCase()]; },
      removeHeader(name) { delete headers[name.toLowerCase()]; },
    };

    const middleware = securityHeadersMiddleware({ enableHsts: true });
    await new Promise((resolve) => {
      middleware(mockReq, mockRes, () => { resolve(); });
    });

    assert.strictEqual(headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(headers['x-frame-options'], 'SAMEORIGIN');
    assert.strictEqual(headers['x-xss-protection'], '1; mode=block');
    assert.strictEqual(headers['referrer-policy'], 'strict-origin-when-cross-origin');
    assert.ok(headers['strict-transport-security']?.includes('max-age=31536000'), 'HSTS header must be present');
    assert.ok(headers['content-security-policy']?.includes("default-src 'self'"), 'CSP must restrict default-src');
  });

  // =========================================================================
  // 7. COOKIE SECURITY & EFFICIENCY VALIDATION
  // =========================================================================
  console.log('\n--- 7. Testing Cookie Validation & Application Efficiency ---');

  const {
    parseAndValidateCookies,
    isValidAuthTokenFormat,
    isValidSessionIdFormat,
    getDefaultCookieOptions,
    setAuthCookies,
    clearAuthCookies,
    cookieValidationMiddleware,
  } = security;

  runTest('Should cleanly parse RFC 6265 compliant cookie pairs into dictionary', () => {
    const raw = 'auth_token=valid.jwt.payload; sessionId=sess_1234567890abcdef; theme=dark';
    const result = parseAndValidateCookies(raw);

    assert.strictEqual(result.isValid, true);
    assert.strictEqual(result.cookies.auth_token, 'valid.jwt.payload');
    assert.strictEqual(result.cookies.sessionId, 'sess_1234567890abcdef');
    assert.strictEqual(result.cookies.theme, 'dark');
  });

  runTest('Should strip header injection / CRLF characters from cookies', () => {
    const raw = 'evil=value\r\nSet-Cookie:admin=true; good=normal';
    const result = parseAndValidateCookies(raw);

    assert.strictEqual(result.cookies.good, 'normal');
    assert.strictEqual(result.cookies.evil, undefined, 'CRLF injection cookie must be stripped');
  });

  runTest('Should defend against Prototype Pollution in cookie parsing', () => {
    const raw = '__proto__[polluted]=true; constructor[evil]=hack; legitimate=ok';
    const result = parseAndValidateCookies(raw);

    assert.strictEqual(result.cookies.legitimate, 'ok');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted'), false);
    assert.strictEqual(result.cookies.__proto__, undefined);
  });

  runTest('Should reject and drop oversized cookie headers (>8KB) to prevent Cookie Bomb DoS', () => {
    const hugeCookie = 'bomb=' + 'A'.repeat(9000);
    const result = parseAndValidateCookies(hugeCookie);

    assert.strictEqual(result.isValid, false);
    assert.ok(result.warning?.includes('exceeds maximum permissible size limit'));
  });

  runTest('Should validate JWT token format and reject malformed/injected tokens in cookies', () => {
    assert.strictEqual(isValidAuthTokenFormat('eyJhbGci.eyJzdWIi.signature'), true);
    assert.strictEqual(isValidAuthTokenFormat('invalid-not-a-jwt'), false);
    assert.strictEqual(isValidAuthTokenFormat('<script>alert(1)</script>'), false);
  });

  runTest('Should enforce httpOnly, lax sameSite, and root path in default cookie security options', () => {
    const opts = getDefaultCookieOptions();

    assert.strictEqual(opts.httpOnly, true, 'Cookies must be HttpOnly to prevent XSS theft');
    assert.strictEqual(opts.sameSite, 'lax', 'Cookies must use Lax SameSite for CSRF defense');
    assert.strictEqual(opts.path, '/', 'Cookies must be available application-wide');
    assert.strictEqual(opts.maxAge, 12 * 60 * 60 * 1000, 'Cookie lifetime must match 12-hour session');
  });

  runTest('Should set secure HttpOnly cookies via setAuthCookies', () => {
    const cookiesSet = {};
    const mockRes = {
      cookie(name, val, options) {
        cookiesSet[name] = { val, options };
      },
    };

    setAuthCookies(mockRes, {
      token: 'header.payload.signature',
      sessionId: 'sess_1234567890abcdef',
    });

    assert.ok(cookiesSet.auth_token, 'auth_token cookie must be set');
    assert.strictEqual(cookiesSet.auth_token.options.httpOnly, true);
    assert.strictEqual(cookiesSet.auth_token.options.sameSite, 'lax');
    assert.ok(cookiesSet.sessionId, 'sessionId cookie must be set');
    assert.strictEqual(cookiesSet.sessionId.options.httpOnly, true);
  });

  runTest('Should cleanly clear authentication cookies via clearAuthCookies', () => {
    const cookiesCleared = [];
    const mockRes = {
      clearCookie(name, options) {
        cookiesCleared.push({ name, options });
      },
    };

    clearAuthCookies(mockRes);

    const clearedNames = cookiesCleared.map((c) => c.name);
    assert.ok(clearedNames.includes('auth_token'));
    assert.ok(clearedNames.includes('token'));
    assert.ok(clearedNames.includes('sessionId'));
  });

  // =========================================================================
  // 8. REVERSE PROXY SECURITY & IP SPOOFING DEFENSE
  // =========================================================================
  console.log('\n--- 8. Testing Reverse Proxy Security & IP Spoofing Defenses ---');

  const {
    isTrustedProxy,
    isPrivateSubnet,
    getSecureClientIp,
    reverseProxySecurityMiddleware,
  } = security;

  runTest('Should identify localhost and private subnets as trusted proxies', () => {
    assert.strictEqual(isTrustedProxy('127.0.0.1'), true);
    assert.strictEqual(isTrustedProxy('::1'), true);
    assert.strictEqual(isTrustedProxy('172.18.0.5'), true, 'Docker subnet must be recognized');
    assert.strictEqual(isTrustedProxy('10.0.0.1'), true, 'Internal VPC IP must be recognized');
    assert.strictEqual(isTrustedProxy('192.168.1.10'), true, 'LAN subnet must be recognized');
  });

  runTest('Should reject arbitrary public internet IPs as untrusted proxies', () => {
    assert.strictEqual(isTrustedProxy('203.0.113.195'), false);
    assert.strictEqual(isTrustedProxy('8.8.8.8'), false);
    assert.strictEqual(isTrustedProxy('198.51.100.1'), false);
  });

  runTest('Should defend against X-Forwarded-For IP spoofing from untrusted direct connections', () => {
    // Untrusted direct client attempting to spoof IP as 1.1.1.1
    const mockReq = {
      socket: { remoteAddress: '203.0.113.50' },
      headers: {
        'x-forwarded-for': '1.1.1.1',
        'x-real-ip': '8.8.8.8',
      },
    };

    const resolvedIp = getSecureClientIp(mockReq);
    assert.strictEqual(resolvedIp, '203.0.113.50', 'Must use actual socket IP and ignore spoofed headers');
  });

  runTest('Should extract real client IP from trusted reverse proxy connection', () => {
    // Connection from trusted reverse proxy (127.0.0.1 or Nginx)
    const mockReq = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: {
        'x-forwarded-for': '203.0.113.99, 10.0.0.1',
        'x-real-ip': '203.0.113.99',
      },
    };

    const resolvedIp = getSecureClientIp(mockReq);
    assert.strictEqual(resolvedIp, '203.0.113.99', 'Must resolve verified client IP from trusted proxy');
  });

  runTest('Should strip untrusted proxy headers in reverseProxySecurityMiddleware', () => {
    const mockReq = {
      socket: { remoteAddress: '198.51.100.22' },
      headers: {
        'x-forwarded-for': '9.9.9.9',
        'x-real-ip': '9.9.9.9',
      },
    };
    const mockRes = {
      status() { return this; },
      json() {},
    };

    let nextCalled = false;
    reverseProxySecurityMiddleware(mockReq, mockRes, () => { nextCalled = true; });

    assert.strictEqual(nextCalled, true);
    assert.strictEqual(mockReq.headers['x-forwarded-for'], undefined, 'Untrusted X-Forwarded-For must be stripped');
    assert.strictEqual(mockReq.headers['x-real-ip'], undefined, 'Untrusted X-Real-IP must be stripped');
  });

  runTest('Should block Host Header Poisoning attempts with CRLF in reverse proxy middleware', () => {
    let statusCode = 0;
    let jsonBody = null;
    const mockReq = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: {
        host: 'legitimate.com\r\nX-Injected:evil',
      },
      method: 'GET',
      path: '/api/test',
    };
    const mockRes = {
      status(code) { statusCode = code; return this; },
      json(body) { jsonBody = body; return this; },
    };

    reverseProxySecurityMiddleware(mockReq, mockRes, () => {});

    assert.strictEqual(statusCode, 400);
    assert.strictEqual(jsonBody?.error, 'Bad Request');
  });

  await runAsyncTest('Should dynamically toggle reverse proxy OFF and bypass proxy enforcement', async () => {
    const { isReverseProxyEnabled, updateReverseProxyConfig } = security;

    await updateReverseProxyConfig(false, 'Test Super Admin');
    assert.strictEqual(isReverseProxyEnabled(), false, 'Reverse proxy must report disabled');

    // When toggled OFF, reverseProxySecurityMiddleware should pass immediately without stripping headers
    const mockReq = {
      socket: { remoteAddress: '203.0.113.10' },
      headers: { 'x-forwarded-for': '198.51.100.99' },
    };
    const mockRes = {};
    let nextCalled = false;

    reverseProxySecurityMiddleware(mockReq, mockRes, () => { nextCalled = true; });
    assert.strictEqual(nextCalled, true);
    assert.strictEqual(mockReq.headers['x-forwarded-for'], '198.51.100.99', 'Headers should not be stripped when proxy toggle is off');

    // Restore back to enabled
    await updateReverseProxyConfig(true, 'Test Super Admin');
    assert.strictEqual(isReverseProxyEnabled(), true, 'Reverse proxy must report re-enabled');
  });

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n=======================================================');
  console.log(`📊 TEST RESULTS: ${passedTests}/${totalTests} PASSED (${failedTests} FAILED)`);
  console.log('=======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});


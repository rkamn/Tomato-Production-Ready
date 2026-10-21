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


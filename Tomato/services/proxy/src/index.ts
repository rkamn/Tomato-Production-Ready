import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Target backend service (private internal network/port)
const BACKEND_HOST = process.env.BACKEND_HOST || '127.0.0.1';
const BACKEND_PORT = Number(process.env.BACKEND_PORT || process.env.PORT || 5050);

// Proxy gateway listening port (strictly isolated from internal backend port)
const PROXY_PORT = Number(process.env.PROXY_PORT || process.env.GATEWAY_PORT || (BACKEND_PORT === 8080 ? 8000 : 8080));
const FRONTEND_DIR = path.resolve(__dirname, '../../../frontend');

// MIME types dictionary for zero-dependency static file delivery
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// Dynamic Reverse Proxy Toggle State (synchronized with Control Panel)
let proxyEnabled = true;

function syncProxyStatus(): void {
  const req = http.get(
    `http://${BACKEND_HOST}:${BACKEND_PORT}/api/reverse-proxy/status`,
    { timeout: 3000 },
    (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (typeof parsed.enabled === 'boolean') {
            proxyEnabled = parsed.enabled;
          }
        } catch {}
      });
    }
  );
  req.on('error', () => {
    // Fall back to default on initial connection
  });
}

// Poll every 5 seconds to sync dynamic toggle from backend control panel
setInterval(syncProxyStatus, 5000).unref();
syncProxyStatus();

// Simple In-Memory Gateway Sliding Window Rate Limiter
interface IpRateData {
  count: number;
  resetAt: number;
}
const rateLimiterStore = new Map<string, IpRateData>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 300; // 300 requests/minute per IP

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimiterStore.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimiterStore.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  entry.count++;
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}

// Clean up stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimiterStore.entries()) {
    if (now > entry.resetAt) {
      rateLimiterStore.delete(ip);
    }
  }
}, 5 * 60 * 1000).unref();

/**
 * Enterprise Security Headers applied to every response by the reverse proxy
 */
function applyProxySecurityHeaders(res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Reverse-Proxy', 'Tomato-Secure-Gateway');
  // Strip backend fingerprinting
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
}

/**
 * Reverse Proxy Core HTTP Handler
 */
const proxyServer = http.createServer((clientReq, clientRes) => {
  const clientIp = clientReq.socket.remoteAddress || '127.0.0.1';
  const rawUrl = clientReq.url || '/';
  const [pathname] = rawUrl.split('?');

  applyProxySecurityHeaders(clientRes);

  // 1. Dynamic Reverse Proxy Toggle Check
  if (!proxyEnabled) {
    clientRes.writeHead(503, {
      'Content-Type': 'application/json',
      'X-Reverse-Proxy-Status': 'disabled',
    });
    clientRes.end(JSON.stringify({
      status: 'disabled',
      enabled: false,
      message: 'Reverse Proxy is currently toggled OFF in the Control Panel. Reverse proxy forwarding is bypassed.',
      directBackendUrl: `http://localhost:${BACKEND_PORT}`,
      directFrontendUrl: `http://localhost:${BACKEND_PORT}/`,
    }));
    return;
  }

  // 2. Gateway Rate Limiting
  if (isRateLimited(clientIp)) {
    clientRes.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': '60',
    });
    clientRes.end(JSON.stringify({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded at proxy gateway. Please slow down.',
    }));
    return;
  }

  // 2. Host Header Sanitization
  const host = clientReq.headers.host || '';
  if (/[\r\n\0]/.test(host)) {
    clientRes.writeHead(400, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify({ error: 'Bad Request', message: 'Malformed Host header' }));
    return;
  }

  // 3. Route: API endpoints, OAuth callbacks, uploads, or health checks -> Proxy to Backend
  const isBackendRoute =
    pathname.startsWith('/api/') ||
    pathname.startsWith('/oauth/') ||
    pathname.startsWith('/uploads/') ||
    pathname === '/health';

  if (isBackendRoute) {
    forwardToBackend(clientReq, clientRes);
    return;
  }

  // 4. Route: Static Frontend Delivery
  serveStaticFrontend(pathname, clientReq, clientRes);
});

/**
 * Forwards client HTTP request to internal backend service with sanitized headers
 */
function forwardToBackend(clientReq: http.IncomingMessage, clientRes: http.ServerResponse): void {
  const clientIp = clientReq.socket.remoteAddress || '127.0.0.1';
  const cleanClientIp = clientIp.startsWith('::ffff:') ? clientIp.slice(7) : clientIp;

  // Propagate secure proxy headers
  const existingForwarded = clientReq.headers['x-forwarded-for'];
  const newForwardedFor = existingForwarded
    ? `${existingForwarded}, ${cleanClientIp}`
    : cleanClientIp;

  const proxyHeaders = {
    ...clientReq.headers,
    host: `${BACKEND_HOST}:${BACKEND_PORT}`,
    'x-real-ip': cleanClientIp,
    'x-forwarded-for': newForwardedFor,
    'x-forwarded-proto': (clientReq.socket as any).encrypted ? 'https' : 'http',
    'x-forwarded-host': clientReq.headers.host || 'localhost',
    'x-forwarded-port': String(PROXY_PORT),
  };

  const proxyOptions: http.RequestOptions = {
    host: BACKEND_HOST,
    port: BACKEND_PORT,
    path: clientReq.url,
    method: clientReq.method,
    headers: proxyHeaders,
    timeout: 30000,
  };

  const proxyReq = http.request(proxyOptions, (backendRes) => {
    // Copy backend status and headers
    const resHeaders = { ...backendRes.headers };
    delete resHeaders['x-powered-by']; // Strip server engine header
    delete resHeaders['server'];

    clientRes.writeHead(backendRes.statusCode || 200, resHeaders);
    backendRes.pipe(clientRes);
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    if (!clientRes.headersSent) {
      clientRes.writeHead(504, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({
        error: 'Gateway Timeout',
        message: 'Internal backend service timed out responding to reverse proxy.',
      }));
    }
  });

  proxyReq.on('error', (err) => {
    console.error(`[Reverse Proxy Error] Proxy forwarding failed: ${err.message}`);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { 'Content-Type': 'application/json' });
      clientRes.end(JSON.stringify({
        error: 'Bad Gateway',
        message: 'Internal backend service is currently unavailable or restarting.',
      }));
    }
  });

  clientReq.pipe(proxyReq);
}

/**
 * Serves static frontend assets with caching and compression
 */
function serveStaticFrontend(pathname: string, req: http.IncomingMessage, res: http.ServerResponse): void {
  let relativePath = pathname === '/' ? '/index.html' : pathname;

  // Strip frontend prefix if present
  if (relativePath.startsWith('/frontend/')) {
    relativePath = relativePath.slice('/frontend'.length);
  }

  // Path Traversal Security Guard
  const safePath = path.normalize(path.join(FRONTEND_DIR, relativePath));
  if (!safePath.startsWith(FRONTEND_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Access Denied');
    return;
  }

  fs.stat(safePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback for SPA routing
      const fallbackIndex = path.join(FRONTEND_DIR, 'index.html');
      fs.readFile(fallbackIndex, (fbErr, fbData) => {
        if (fbErr) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fbData);
      });
      return;
    }

    const ext = path.extname(safePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Set client-side cache headers for static resources
    if (ext.match(/\.(css|js|png|jpg|jpeg|gif|ico|svg|woff2?)$/)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }

    // Support Gzip compression
    const acceptEncoding = req.headers['accept-encoding'] || '';
    if (typeof acceptEncoding === 'string' && acceptEncoding.includes('gzip')) {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Encoding': 'gzip',
      });
      const rawStream = fs.createReadStream(safePath);
      const gzipStream = zlib.createGzip({ level: 6 });
      rawStream.pipe(gzipStream).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stats.size,
      });
      fs.createReadStream(safePath).pipe(res);
    }
  });
}

/**
 * WebSocket Protocol Upgrade Proxy
 * Transparently establishes duplex socket tunnel between client and backend on /ws
 */
proxyServer.on('upgrade', (clientReq, clientSocket, clientHead) => {
  if (!proxyEnabled) {
    clientSocket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
    clientSocket.destroy();
    return;
  }

  const backendSocket = net.connect(BACKEND_PORT, BACKEND_HOST, () => {
    const socket = clientSocket as net.Socket;
    const clientIp = socket.remoteAddress || '127.0.0.1';
    const cleanClientIp = clientIp.startsWith('::ffff:') ? clientIp.slice(7) : clientIp;

    // Build raw HTTP Upgrade Request to forward to backend
    let upgradeRequest = `${clientReq.method} ${clientReq.url} HTTP/1.1\r\n`;
    for (const [key, value] of Object.entries(clientReq.headers)) {
      if (key.toLowerCase() === 'host') {
        upgradeRequest += `Host: ${BACKEND_HOST}:${BACKEND_PORT}\r\n`;
      } else {
        upgradeRequest += `${key}: ${Array.isArray(value) ? value.join(', ') : value}\r\n`;
      }
    }
    upgradeRequest += `X-Real-IP: ${cleanClientIp}\r\n`;
    upgradeRequest += `X-Forwarded-For: ${cleanClientIp}\r\n`;
    upgradeRequest += `X-Forwarded-Proto: http\r\n\r\n`;

    backendSocket.write(upgradeRequest);
    if (clientHead && clientHead.length > 0) {
      backendSocket.write(clientHead);
    }

    // Pipe bi-directionally
    backendSocket.pipe(clientSocket);
    clientSocket.pipe(backendSocket);
  });

  backendSocket.on('error', (err) => {
    console.error(`[WebSocket Reverse Proxy Error] ${err.message}`);
    clientSocket.destroy();
  });

  clientSocket.on('error', (err) => {
    backendSocket.destroy();
  });
});

proxyServer.listen(PROXY_PORT, () => {
  console.log(`\n=============================================================`);
  console.log(`🛡️  TOMATO ENTERPRISE REVERSE PROXY GATEWAY ACTIVE`);
  console.log(`=============================================================`);
  console.log(`🌐 Public Gateway:    http://localhost:${PROXY_PORT}`);
  console.log(`🔒 Target Backend:    http://${BACKEND_HOST}:${BACKEND_PORT} (Cloaked)`);
  console.log(`📁 Static Frontend:   Served from ${FRONTEND_DIR}`);
  console.log(`📡 WebSocket Tunnel:  Forwarding /ws upgrades to backend`);
  console.log(`🛡️  Security Shields: Rate Limiting, Header Sanitization, Cloaking`);
  console.log(`=============================================================\n`);
});

export default proxyServer;

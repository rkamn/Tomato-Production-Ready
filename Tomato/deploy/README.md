# Tomato Enterprise Reverse Proxy Architecture & Security Guide

## Overview

The Tomato platform uses a **Reverse Proxy Gateway Architecture** to shield the backend Node.js application from direct public exposure, eliminate CORS friction, and harden the system against DDoS, slowloris attacks, and IP header spoofing.

```
                    Internet / Public Clients
                               │
            ┌──────────────────┴──────────────────┐
            │  Port 80 (HTTP) -> 301 HTTPS Redir  │
            │  Port 443 (HTTPS) / Port 8080 (Dev) │
            └──────────────────┬──────────────────┘
                               │
                ▼ Reverse Proxy Gateway ▼
         (Nginx Production / Node.js Edge Proxy)
       ┌───────────────────────┼───────────────────────┐
       │                       │                       │
       ▼                       ▼                       ▼
Static Assets           WebSocket Tunnel          API & Auth Routes
(/, /css, /js, /img)         (/ws)             (/api/*, /oauth/*, /uploads/*)
Direct Disk Delivery    HTTP 101 Duplex        Reverse Proxy Forward
Gzip + Client Caching    Upgrade Tunnel         Header Sanitization & Cloaking
                                                       │
                                                       ▼
                                            Internal Backend Network
                                             http://127.0.0.1:5050
                                            (Express / MongoDB Atlas)
```

---

## 1. Security Enhancements Implemented

### 🛡️ Origin Cloaking & Port Isolation
- The internal Node.js backend (`5050`) binds only to `127.0.0.1` and is never exposed directly to the outside world.
- Server identity signatures (`X-Powered-By`, `Server: Express`) are stripped at the proxy edge.

### 🛡️ Unified Single-Origin Cookies
- Because both frontend (`/`) and API (`/api/*`) are served under the exact same origin through the reverse proxy, authentication cookies are treated as **true first-party cookies**.
- Eliminates third-party cookie phaseout restrictions and complex cross-origin credential issues.

### 🛡️ IP Spoofing & Header Injection Defenses
- The backend validates whether incoming requests arrive from a **trusted reverse proxy** (`isTrustedProxy`).
- Direct client attempts to inject fake `X-Forwarded-For` or `X-Real-IP` headers to bypass rate limits are automatically detected and dropped.
- Host Header Poisoning with CRLF control characters (`\r\n`) is rejected immediately with HTTP 400.

### 🛡️ Dual-Layer Rate Limiting & DDoS Shielding
- **Proxy Layer**: Sliding window rate limiter (300 requests/minute per IP) drops floods before Node.js event loops are loaded.
- **Application Layer**: Zod-validated business rate limiters (e.g., 3 login attempts per 10 minutes) protect authentication and password reset routes.

---

## 2. Running Options

### Option A: Built-in Node.js Edge Proxy (Development & Cloud PaaS)
Zero external dependencies required. Runs anywhere Node.js runs.

```bash
# Build proxy & backend
npm run build

# Start backend service (Port 5050)
npm start

# In a separate terminal or service manager, start reverse proxy (Port 8080)
npm run proxy
```

Environment variables:
- `PROXY_PORT`: Listening port (default: `8080`)
- `BACKEND_HOST`: Internal backend host (default: `127.0.0.1`)
- `BACKEND_PORT`: Internal backend port (default: `5050`)

### Option B: Production Nginx & Docker Deployment

The production configuration is ready in `Tomato/deploy/`:
- `Tomato/deploy/nginx/nginx.conf`: Hardened Nginx configuration with TLS 1.3, A+ SSL profile, buffer overflow protection, and Gzip compression.
- `Tomato/deploy/docker-compose.yml`: Multi-container architecture with an internal isolated bridge network (`tomato_internal_net`).

```bash
cd Tomato/deploy
docker-compose up -d --build
```


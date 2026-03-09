# MediLight Backend

Express API server for the MediLight Dispensing System.  
PostgreSQL via Neon · WebSocket · Swagger UI · Security-hardened (v3.1)

## Features

- **Inventory CRUD** — Products with stock tracking and LED addresses
- **Order Processing** — Atomic stock deduction + LED activation in one transaction
- **OCR Parsing** — Server-side regex prescription fallback
- **AI Parsing** — Google Gemini 2.5 Flash (text + vision) via secure proxy
- **ID Verification** — Controlled substance compliance gate
- **Audit Trail** — Every action logged with timestamps
- **WebSocket** — Real-time LED commands to ESP32 shelf devices
- **Rate Limiting** — IP-based, tiered per endpoint (express-rate-limit)
- **Input Validation** — Schema-based allowlist on all user inputs
- **Security Headers** — helmet() with CSP, HSTS, X-Frame-Options, and more

## Project Structure

```
medilight-backend/
├── server.js                 ← Entry point — helmet, CORS, global rate limiter
├── db.js                     ← Neon PostgreSQL pool + auditLog helper
├── websocket.js              ← WebSocket server + broadcast
├── swagger.js                ← OpenAPI 3.0 spec
├── schema.sql                ← DB schema + seed data
├── middleware/
│   ├── rateLimiter.js        ← 4-tier rate limiting (global/write/ai/nuke)
│   └── validate.js           ← Schema-based input validation + field stripping
└── routes/
    ├── health.js             ← GET /api/health
    ├── inventory.js          ← CRUD /api/inventory — reset/delete need X-Admin-Secret
    ├── orders.js             ← POST /api/orders/confirm, GET /api/orders
    ├── ocr.js                ← POST /api/ocr/extract
    ├── ai.js                 ← POST /api/ai/parse-text, /api/ai/parse-image
    ├── verification.js       ← POST /api/verify-id
    ├── led.js                ← POST /api/led/trigger
    ├── audit.js              ← GET /api/audit
    └── tests.js              ← GET /api/test/run-all (dev only)
```

## Setup (Local)

```bash
npm install
cp .env.example .env
# Fill in DATABASE_URL, GEMINI_API_KEY, ADMIN_SECRET in .env
npm run dev
```

Swagger UI → http://localhost:3001/api/docs

## Environment Variables

All secrets live in environment variables — never in source code.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon PostgreSQL connection string |
| `GEMINI_API_KEY` | ✅ | Google Gemini API key (free tier: 250 req/day) |
| `ADMIN_SECRET` | ✅ | Guards `/reset` and `DELETE` endpoints — generate with `openssl rand -hex 32` |
| `ALLOWED_ORIGINS` | ✅ | Comma-separated list of allowed frontend origins (e.g. your Render dashboard URL) |
| `NODE_ENV` | ✅ | Set to `production` on Render |
| `DOCS_ENABLED` | optional | Set `true` to expose Swagger UI in production (default: hidden) |
| `TEST_ROUTES_ENABLED` | optional | Set `true` to expose `/api/test/run-all` in production (default: hidden) |
| `PORT` | auto | Set automatically by Render |

## Deploy to Render

1. Connect the `medilight-backend` GitHub repo to Render
2. **Build command:** `npm install`
3. **Start command:** `node server.js`
4. Add all environment variables above in the Render dashboard (Environment tab)
5. Trigger a manual deploy

> The old `MONGO_URI` variable is no longer used — remove it from Render if it still exists.

## Rate Limits

| Tier | Endpoints | Limit |
|---|---|---|
| Global | All routes | 500 req / 15 min / IP |
| Write | Orders confirm, inventory mutations, OCR, verify-id | 50 req / 15 min / IP |
| AI | `/api/ai/*` | 20 req / 15 min / IP |
| Nuke | Inventory reset, product delete | 5 req / 15 min / IP |

All 429 responses include `Retry-After` headers.

## Using Admin-Protected Endpoints

The `/api/inventory/reset` and `DELETE /api/inventory/:id` endpoints require:

```bash
curl -X POST https://your-backend.onrender.com/api/inventory/reset \
  -H "X-Admin-Secret: your-admin-secret-here"
```

## API Reference

Full interactive docs at `/api/docs` (enabled in dev, opt-in in production via `DOCS_ENABLED=true`).

### Key Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Server + DB status |
| GET | `/api/inventory` | List all products |
| POST | `/api/inventory` | Add product |
| PUT | `/api/inventory/:id` | Update product |
| DELETE | `/api/inventory/:id` | Delete product (admin) |
| POST | `/api/inventory/reset` | Wipe + re-seed DB (admin) |
| POST | `/api/orders/confirm` | Confirm order, deduct stock, trigger LEDs |
| GET | `/api/orders` | Order history |
| POST | `/api/ocr/extract` | Parse prescription text |
| POST | `/api/ai/parse-text` | AI prescription text analysis |
| POST | `/api/ai/parse-image` | AI prescription image analysis |
| POST | `/api/verify-id` | Patient ID verification |
| POST | `/api/led/trigger` | Manual LED broadcast |
| GET | `/api/audit` | Audit log |

## Security

See [SECURITY.md](./SECURITY.md) for a full breakdown of all hardening measures, the OWASP controls applied, and the key rotation procedure.
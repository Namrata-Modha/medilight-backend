# MediLight Backend

**Express.js API server for the MediLight Smart Dispensing System.**

> REST API + WebSocket + Gemini AI proxy + PostgreSQL inventory + Swagger docs

![Node](https://img.shields.io/badge/Node.js-Express-339933?logo=node.js) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-4169E1?logo=postgresql) ![Gemini](https://img.shields.io/badge/Gemini_AI-Proxy-4285F4?logo=google) ![Render](https://img.shields.io/badge/Deployed-Render-46E3B7?logo=render)

## What This Does

This is the brain of MediLight. It sits between the pharmacist dashboard, the AI engine, the database, and the shelf hardware:

- **Proxies Gemini AI** calls (keeps API key server-side, never exposed to browser)
- **Manages inventory** in PostgreSQL with full CRUD + stock tracking
- **Processes orders** with atomic transactions (deduct stock → save order → trigger LEDs)
- **Broadcasts LED commands** to shelf devices via WebSocket
- **Verifies patient identity** for controlled substance compliance (age 18+, ID format)
- **Logs everything** to an audit trail for compliance

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server + database health check |
| GET | `/api/inventory` | List all products |
| POST | `/api/inventory` | Add new product |
| PUT | `/api/inventory/:id` | Update product fields |
| DELETE | `/api/inventory/:id` | Delete product (checks order refs) |
| POST | `/api/inventory/reset` | Reset to 12 seed products |
| POST | `/api/ai/parse-text` | Gemini AI text analysis (PHI redacted) |
| POST | `/api/ai/parse-image` | Gemini AI Vision analysis |
| POST | `/api/ocr/extract` | Server-side regex prescription parser |
| POST | `/api/orders/confirm` | Confirm order + deduct stock + trigger LEDs |
| GET | `/api/orders` | Order history with line items |
| POST | `/api/verify-id` | Patient ID verification (age 18+) |
| POST | `/api/led/trigger` | Manual LED broadcast to devices |
| GET | `/api/audit` | Compliance audit log |
| GET | `/api/test/run-all` | Run 10 automated tests |
| GET | `/api/docs` | Swagger UI (interactive API explorer) |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js + Express.js |
| Database | PostgreSQL on Neon (free forever) |
| AI Proxy | Google Gemini 2.5 Flash (250 req/day free) |
| WebSocket | ws library for ESP32 shelf devices |
| API Docs | Swagger UI (auto-generated) |
| Hosting | Render (free tier) |

## Project Structure

```
├── server.js              ← Express app + middleware + route wiring
├── db.js                  ← PostgreSQL connection pool + schema init + audit logging
├── websocket.js           ← WebSocket server for shelf LED devices
├── schema.sql             ← Database tables + 12 seed medications
├── swagger.js             ← OpenAPI 3.0 specification
├── routes/
│   ├── ai.js              ← Gemini AI proxy (text + vision + thinking model handler)
│   ├── inventory.js       ← Product CRUD + stock management + delete
│   ├── orders.js          ← Atomic order processing + LED broadcast
│   ├── ocr.js             ← Server-side regex prescription parser
│   ├── verification.js    ← Patient ID verification (age + format)
│   ├── health.js          ← Health check endpoint
│   ├── led.js             ← Manual LED trigger
│   ├── audit.js           ← Audit trail retrieval
│   └── tests.js           ← 10 automated API tests
```

## Setup

### Environment Variables

Set these in Render's Environment tab:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `postgresql://user:pass@host/db?sslmode=require` (from Neon) |
| `GEMINI_API_KEY` | `AIza...` (from [Google AI Studio](https://aistudio.google.com)) |
| `NODE_ENV` | `production` |

### Run Locally

```bash
npm install
cp .env.example .env  # fill in DATABASE_URL and GEMINI_API_KEY
npm run dev
```

### Deploy to Render

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → New Web Service → Connect repo
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. Add environment variables (see above)
6. Deploy — note your URL for the dashboard config

### Verify Deployment

- **Swagger UI**: `https://medilight-backend.onrender.com/api/docs`
- **Test Suite**: `https://medilight-backend.onrender.com/api/test/run-all` (should show 10/10 PASS)
- **Health Check**: `https://medilight-backend.onrender.com/api/health`

## Key Design Decisions

- **Gemini thinking model handling**: `extractGeminiText()` skips `thought: true` parts and finds the actual JSON response — Gemini 2.5 Flash returns multi-part responses where `parts[0]` is reasoning
- **Robust JSON parsing**: `cleanAndParseJSON()` handles trailing commas, single quotes, markdown fences, and unquoted keys that Gemini sometimes produces
- **Atomic orders**: Stock deduction + order creation wrapped in a PostgreSQL transaction with ROLLBACK on failure
- **Delete protection**: Cannot delete products referenced by existing orders

## Related Repos

- **Dashboard** → [medilight-dashboard](https://github.com/Namrata-Modha/medilight-dashboard)
- **Shelf Device** → [medilight-shelf](https://github.com/Namrata-Modha/medilight-shelf)
- **Project Guide + Test Images** → [medilight-guide](https://github.com/Namrata-Modha/medilight-guide)

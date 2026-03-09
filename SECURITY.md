# MediLight Backend — Security Hardening Guide

## What Changed and Why

### 1. Rate Limiting (`middleware/rateLimiter.js`)

**Before:** No limits — any endpoint could be hammered indefinitely.  
**After:** Four tiers using `express-rate-limit` (in-process, no Redis dependency):

| Limiter | Applies to | Limit |
|---|---|---|
| `globalLimiter` | Every route | 500 req / 15 min / IP |
| `writeLimiter` | POST/PUT on orders, inventory, OCR, verify-id | 50 req / 15 min / IP |
| `aiLimiter` | `/api/ai/*` | 20 req / 15 min / IP |
| `nukeLimiter` | reset, delete | 5 req / 15 min / IP |

All 429 responses include `Retry-After` headers and a consistent JSON body.  
Health check is excluded so uptime monitors don't consume quota.

> **Multi-instance note:** MemoryStore is per-process. If you scale to multiple Render instances, swap to `rate-limit-redis` with Upstash or similar.

---

### 2. Input Validation (`middleware/validate.js`)

**Before:** Ad-hoc `if (!field)` checks; no type enforcement; unexpected fields accepted.  
**After:** Schema-based allowlist validation applied before every route handler.

- **Allowlist approach** — any field not declared in the schema is rejected (not silently ignored)
- **Type enforcement** — strings, integers, booleans, arrays all checked
- **Length limits** — all string fields capped; arrays capped (e.g. order items max 50)
- **Pattern checks** — IDs, transaction IDs, color hex, media types validated via regex
- **Enum checks** — LED commands restricted to 4 known values
- **Stripping** — req.body is replaced with only the fields in the schema before the handler runs

Key vulnerability closed: `/api/led/trigger` previously broadcast `req.body` raw to hardware. Now only an explicit, reconstructed payload is sent.

---

### 3. Secure Secret Handling (`routes/ai.js`, `routes/inventory.js`)

**Before:** `GEMINI_API_KEY` was already in env — but no guard if it was missing.  
**After (OWASP A02):**
- `getApiKey()` logs a server-side error and returns 503 if the key is absent
- The key **never appears in any response body** — Gemini errors are sanitized
- All secrets documented in `.env.example` with rotation instructions

**New:** `ADMIN_SECRET` env var gates destructive operations (`/reset`, `DELETE`).  
Pass it as `X-Admin-Secret: <value>` header. If the env var is not set, the endpoint returns 503 (fail-safe).

---

### 4. HTTP Security Headers (`server.js` — `helmet`)

**Before:** No security headers.  
**After:** `helmet()` adds 15+ headers including:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security` (HSTS)
- `Content-Security-Policy` (allows Swagger UI CDN assets)
- `X-XSS-Protection`

---

### 5. CORS Lockdown (`server.js`)

**Before:** `Access-Control-Allow-Origin: *` — any site could call this API.  
**After:** Only origins listed in `ALLOWED_ORIGINS` env var are permitted.  
Localhost is added automatically in non-production environments.

---

### 6. Error Sanitization (all routes)

**Before:** `res.status(500).json({ error: err.message })` — leaks DB schema, query structure, and connection strings.  
**After:** Generic user-facing message; full detail only in server logs.  
In development (`NODE_ENV !== "production"`), `detail` field is included for debugging.

---

### 7. Destructive Endpoint Protection (`routes/inventory.js`)

**Before:** `POST /api/inventory/reset` wiped the database with no authentication.  
**After:**
- Requires `X-Admin-Secret` header
- Protected by `nukeLimiter` (5 req / 15 min)
- Fails safe (503) if `ADMIN_SECRET` env var is not configured

---

### 8. Test & Docs Routes Hidden in Production (`server.js`)

**Before:** `/api/test/run-all` and Swagger UI were always public.  
**After:**
- Both are hidden when `NODE_ENV=production`
- Re-enable with `TEST_ROUTES_ENABLED=true` or `DOCS_ENABLED=true` if needed

---

## Deployment Checklist

### Render Environment Variables (set in dashboard)

```
DATABASE_URL        = postgres://...neon.tech/medilight?sslmode=require
GEMINI_API_KEY      = AIza...
ADMIN_SECRET        = <openssl rand -hex 32>
ALLOWED_ORIGINS     = https://your-dashboard.onrender.com
NODE_ENV            = production
```

### Install New Dependencies

```bash
npm install
# Adds: express-rate-limit@^7, helmet@^8
```

### Using the Admin Secret

```bash
# Reset inventory (from your machine only, never automate this)
curl -X POST https://your-backend.onrender.com/api/inventory/reset \
  -H "X-Admin-Secret: your-secret-here"

# Delete a product
curl -X DELETE https://your-backend.onrender.com/api/inventory/med_001 \
  -H "X-Admin-Secret: your-secret-here"
```

---

## Key Rotation

**GEMINI_API_KEY** — rotate if ever exposed:
1. Go to https://aistudio.google.com/app/apikey
2. Revoke the old key, generate a new one
3. Update the Render environment variable
4. Trigger a redeploy

**ADMIN_SECRET** — rotate if ever exposed:
1. `openssl rand -hex 32` → new value
2. Update Render env var → redeploy
3. Update any scripts that use the old secret

---

## What This Does NOT Cover

- **Authentication / user sessions** — the dashboard has no login. If you add pharmacist auth, use JWTs or sessions with a proper secret.
- **HTTPS termination** — handled by Render automatically.
- **Database query parameterization** — already correct throughout (parameterized queries via `pg`).
- **WebSocket auth** — ESP32 devices connect without a token. Consider adding a shared secret on the `ws://` URL if the shelf network is untrusted.

// server.js — MediLight API server (security-hardened)
//
// Security changes (OWASP aligned):
//   A01 — helmet() adds 15+ protective HTTP headers
//   A02 — Secrets only via environment variables (see .env.example)
//   A05 — CORS locked to specific origins; wildcard removed
//   A06 — Rate limiting applied globally + per-endpoint tier
//   A09 — Stack traces never sent to clients in production

const express = require("express");
const http    = require("http");
const helmet  = require("helmet");
const swaggerUi = require("swagger-ui-express");

// Core modules
const { initDB }        = require("./db");
const { setupWebSocket } = require("./websocket");
const swaggerSpec       = require("./swagger");
const { globalLimiter } = require("./middleware/rateLimiter");

// Route modules
const healthRoutes       = require("./routes/health");
const inventoryRoutes    = require("./routes/inventory");
const orderRoutes        = require("./routes/orders");
const ocrRoutes          = require("./routes/ocr");
const verificationRoutes = require("./routes/verification");
const ledRoutes          = require("./routes/led");
const auditRoutes        = require("./routes/audit");
const testRoutes         = require("./routes/tests");
const aiRoutes           = require("./routes/ai");

// ─── Express App ──────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

// ─── WebSocket ────────────────────────────────────────────────
setupWebSocket(server);

// ─── Security headers (OWASP A05) ─────────────────────────────
// helmet() sets: X-Content-Type-Options, X-Frame-Options,
// Strict-Transport-Security, Content-Security-Policy, and more.
app.use(helmet({
  crossOriginResourcePolicy: { policy: "same-site" },
  // Allow Swagger UI assets to load
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
      styleSrc:   ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
      imgSrc:     ["'self'", "data:", "cdn.jsdelivr.net"],
    },
  },
}));

// ─── CORS (OWASP A05) ─────────────────────────────────────────
// Replace the wildcard "*" with an explicit allowlist.
// Add your Render/Vercel dashboard URL to ALLOWED_ORIGINS in .env.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Always allow localhost during development
if (process.env.NODE_ENV !== "production") {
  ALLOWED_ORIGINS.push("http://localhost:5173", "http://localhost:3000");
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }
  res.header("Access-Control-Allow-Headers", "Content-Type");  // No Authorization header needed (API key stays server-side)
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ─── Body parsing ──────────────────────────────────────────────
// 5 MB ceiling is intentional — allows base64 prescription images.
// Individual route schemas enforce tighter limits per field.
app.use(express.json({ limit: "5mb" }));

// ─── Global rate limiter (OWASP A06) ──────────────────────────
// 500 req / 15 min per IP — safety net before hitting any route.
app.use(globalLimiter);

// ─── Swagger UI (dev / staging only) ──────────────────────────
// In production, docs are behind DOCS_ENABLED env flag to reduce
// attack surface exposure.
if (process.env.NODE_ENV !== "production" || process.env.DOCS_ENABLED === "true") {
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: `.swagger-ui .topbar { background: #0f172a; } .swagger-ui .info .title { color: #22c55e; }`,
    customSiteTitle: "MediLight API — Swagger",
  }));
}
app.get("/", (req, res) => res.redirect("/api/docs"));

// ─── Routes ───────────────────────────────────────────────────
app.use("/api/health",    healthRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/orders",    orderRoutes);
app.use("/api/ocr",       ocrRoutes);
app.use("/api/verify-id", verificationRoutes);
app.use("/api/led",       ledRoutes);
app.use("/api/audit",     auditRoutes);
app.use("/api/ai",        aiRoutes);

// Test suite — DISABLED in production unless explicitly re-enabled.
// Never expose internal test endpoints on a live server.
if (process.env.NODE_ENV !== "production" || process.env.TEST_ROUTES_ENABLED === "true") {
  app.use("/api/test", testRoutes);
}

// ─── 404 handler ──────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// ─── Global error handler (OWASP A09) ─────────────────────────
// Never leak stack traces or raw DB error messages to the client.
// Full details go to server logs only.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error("[MediLight] Unhandled error:", err);
  res.status(500).json({
    error: "An internal server error occurred",
    // Only expose error detail in non-production environments
    ...(process.env.NODE_ENV !== "production" && { detail: err.message }),
  });
});

// ─── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`[MediLight] Server on port ${PORT}`);
    console.log(`[MediLight] NODE_ENV: ${process.env.NODE_ENV || "development"}`);
    console.log(`[MediLight] Swagger UI → http://localhost:${PORT}/api/docs`);
    console.log(`[MediLight] Allowed origins: ${ALLOWED_ORIGINS.join(", ") || "(none in production)"}`);
  });
});
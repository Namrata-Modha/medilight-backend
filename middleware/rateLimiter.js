// middleware/rateLimiter.js
// OWASP A05 — Security Misconfiguration / Unrestricted Resource Consumption
//
// Strategy:
//   • Global limiter  — broad safety net (500 req / 15 min per IP)
//   • AI limiter      — Gemini is costly; cap tightly (20 req / 15 min)
//   • Write limiter   — mutating endpoints (50 req / 15 min)
//   • Nuke limiter    — destructive ops, e.g. reset (5 req / 15 min)
//
// All limiters use in-process memory store (MemoryStore).
// For multi-instance deployments, swap to redis-rate-limit or similar.

const rateLimit = require("express-rate-limit");

// ─── Shared 429 response format ──────────────────────────────────────────────
const handler = (req, res, _next, options) => {
  res.status(429).json({
    error: "Too many requests",
    message: options.message,
    retry_after_seconds: Math.ceil(options.windowMs / 1000),
  });
};

// ─── Global limiter (applied to every route in server.js) ────────────────────
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,        // 15 minutes
  max: 500,                          // 500 requests per window per IP
  standardHeaders: true,             // Return RateLimit-* headers (RFC 6585)
  legacyHeaders: false,
  message: "Request limit reached. Please wait before retrying.",
  handler,
  // Skip health checks so uptime monitors don't eat the quota
  skip: (req) => req.path === "/api/health",
});

// ─── AI / LLM endpoints — expensive external calls ───────────────────────────
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: "AI request limit reached (20 per 15 min). Please wait.",
  handler,
});

// ─── Write / mutation endpoints ───────────────────────────────────────────────
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Write limit reached (50 per 15 min). Please wait.",
  handler,
});

// ─── Destructive / admin endpoints (reset, delete) ───────────────────────────
const nukeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Destructive operation limit reached (5 per 15 min).",
  handler,
});

module.exports = { globalLimiter, aiLimiter, writeLimiter, nukeLimiter };

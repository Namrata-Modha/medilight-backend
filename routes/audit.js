// routes/audit.js — Compliance audit trail (hardened)
//
// Security changes:
//   • Raw DB error messages not exposed to client
//   • limit query param re-validated defensively

const { Router } = require("express");
const { pool }   = require("../db");

const router = Router();

// GET /api/audit — Returns audit log entries (newest first)
router.get("/", async (req, res) => {
  const rawLimit = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100;

  try {
    const { rows } = await pool.query(
      "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1",
      [limit]
    );
    res.json({ logs: rows });
  } catch (err) {
    console.error("[audit/list] DB error:", err);
    res.status(500).json({ error: "Failed to retrieve audit log." });
  }
});

module.exports = router;
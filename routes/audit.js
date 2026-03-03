// routes/audit.js — Compliance audit trail

const { Router } = require("express");
const { pool } = require("../db");

const router = Router();

// GET /api/audit — Returns audit log entries (newest first)
router.get("/", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const { rows } = await pool.query(
      "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1",
      [limit]
    );
    res.json({ logs: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

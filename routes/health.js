// routes/health.js — Server & database health check

const { Router } = require("express");
const { pool } = require("../db");
const { deviceCount } = require("../websocket");

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT COUNT(*) as count FROM products");
    res.json({
      status: "online",
      database: "connected",
      product_count: parseInt(rows[0].count),
      connected_devices: deviceCount(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.json({
      status: "online",
      database: "error",
      error: err.message,
      connected_devices: deviceCount(),
    });
  }
});

module.exports = router;

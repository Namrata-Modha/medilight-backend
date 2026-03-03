// db.js — PostgreSQL connection pool + schema init + audit logging
// Database: Neon (free forever) → https://neon.tech

const { Pool } = require("pg");
const { readFileSync } = require("fs");
const { join } = require("path");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/**
 * Run schema.sql on startup — creates tables + seeds data if empty.
 * Safe to run multiple times (uses IF NOT EXISTS).
 */
async function initDB() {
  try {
    const schema = readFileSync(join(__dirname, "schema.sql"), "utf8");
    await pool.query(schema);
    console.log("[DB] Schema initialized (Neon PostgreSQL)");
  } catch (err) {
    console.error("[DB] Schema init error:", err.message);
  }
}

/**
 * Write to compliance audit trail.
 * @param {string} action - e.g. "ORDER_CONFIRMED", "INVENTORY_UPDATE"
 * @param {object} details - JSONB payload with context
 */
async function auditLog(action, details) {
  try {
    await pool.query(
      "INSERT INTO audit_log (action, details) VALUES ($1, $2)",
      [action, JSON.stringify(details)]
    );
  } catch (err) {
    console.error("[Audit]", err.message);
  }
}

module.exports = { pool, initDB, auditLog };

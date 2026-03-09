// routes/inventory.js — Product CRUD (hardened)
//
// Security changes:
//   • Schema validation on create (POST) and update (PUT)
//   • productId path param validated before DB query
//   • /reset requires ADMIN_SECRET header — prevents accidental / malicious wipes
//   • nukeLimiter on destructive operations (reset, delete)
//   • Raw DB error messages never returned to the client

const { Router }   = require("express");
const { readFileSync } = require("fs");
const { join }     = require("path");
const { pool, auditLog }  = require("../db");
const { deviceCount }     = require("../websocket");
const { writeLimiter, nukeLimiter } = require("../middleware/rateLimiter");
const {
  validate,
  inventoryCreateSchema,
  inventoryUpdateSchema,
} = require("../middleware/validate");

const router = Router();

// ─── Admin secret guard ────────────────────────────────────────────────────────
// Destructive ops (reset, delete) require the X-Admin-Secret header to match
// the ADMIN_SECRET environment variable. Set this in Render's environment panel.
// OWASP A01 — Broken Access Control mitigation.
function requireAdminSecret(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    // If env var is not set, block the operation entirely to fail safe
    console.error("[security] ADMIN_SECRET env var is not set — blocking destructive op");
    return res.status(503).json({ error: "Admin operations are not configured on this server" });
  }
  if (req.headers["x-admin-secret"] !== secret) {
    return res.status(403).json({ error: "Forbidden — valid X-Admin-Secret header required" });
  }
  next();
}

// ─── GET /api/inventory ───────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM products ORDER BY category, name");
    res.json({ products: rows, connected_devices: deviceCount() });
  } catch (err) {
    console.error("[inventory/list] DB error:", err);
    res.status(500).json({ error: "Failed to retrieve inventory." });
  }
});

// ─── GET /api/inventory/:productId ────────────────────────────────────────────
router.get("/:productId", async (req, res) => {
  const { productId } = req.params;
  // Validate path param to prevent injection via unusual IDs
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(productId)) {
    return res.status(400).json({ error: "Invalid product ID format" });
  }
  try {
    const { rows } = await pool.query(
      "SELECT * FROM products WHERE product_id = $1",
      [productId]
    );
    if (!rows.length) return res.status(404).json({ error: "Product not found" });
    res.json(rows[0]);
  } catch (err) {
    console.error("[inventory/get] DB error:", err);
    res.status(500).json({ error: "Failed to retrieve product." });
  }
});

// ─── PUT /api/inventory/:productId ────────────────────────────────────────────
router.put(
  "/:productId",
  writeLimiter,
  validate(inventoryUpdateSchema),
  async (req, res) => {
    const { productId } = req.params;
    if (!/^[a-zA-Z0-9_-]{1,50}$/.test(productId)) {
      return res.status(400).json({ error: "Invalid product ID format" });
    }

    const { stock_count, price, name, category, reorder_threshold } = req.body;

    // Build dynamic SET clause from allowed fields only (req.body is already stripped by validate())
    const sets = [];
    const vals = [];
    let i = 1;

    if (stock_count       !== undefined) { sets.push(`stock_count = $${i++}`);       vals.push(stock_count); }
    if (price             !== undefined) { sets.push(`price = $${i++}`);             vals.push(price); }
    if (name              !== undefined) { sets.push(`name = $${i++}`);              vals.push(name.trim()); }
    if (category          !== undefined) { sets.push(`category = $${i++}`);          vals.push(category.trim()); }
    if (reorder_threshold !== undefined) { sets.push(`reorder_threshold = $${i++}`); vals.push(reorder_threshold); }

    if (!sets.length) return res.status(400).json({ error: "No fields to update" });

    sets.push("updated_at = NOW()");
    vals.push(productId);

    try {
      const { rows } = await pool.query(
        `UPDATE products SET ${sets.join(", ")} WHERE product_id = $${i} RETURNING *`,
        vals
      );
      if (!rows.length) return res.status(404).json({ error: "Product not found" });

      await auditLog("INVENTORY_UPDATE", { product_id: productId, changes: req.body });
      res.json(rows[0]);
    } catch (err) {
      console.error("[inventory/update] DB error:", err);
      res.status(500).json({ error: "Failed to update product." });
    }
  }
);

// ─── POST /api/inventory — Add new product ────────────────────────────────────
router.post(
  "/",
  writeLimiter,
  validate(inventoryCreateSchema),
  async (req, res) => {
    const { product_id, name, price, age_restricted, stock_count, led_address, category, reorder_threshold } = req.body;
    try {
      const { rows } = await pool.query(
        `INSERT INTO products (product_id, name, price, age_restricted, stock_count, led_address, category, reorder_threshold)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          product_id,
          name.trim(),
          price,
          age_restricted || false,
          stock_count || 0,
          (led_address || "").trim(),
          (category || "").trim(),
          reorder_threshold || 20,
        ]
      );
      await auditLog("PRODUCT_ADDED", { product_id, name });
      res.status(201).json(rows[0]);
    } catch (err) {
      // Distinguish unique-constraint violations (duplicate product_id) from other errors
      if (err.code === "23505") {
        return res.status(409).json({ error: "A product with that ID already exists" });
      }
      console.error("[inventory/create] DB error:", err);
      res.status(500).json({ error: "Failed to create product." });
    }
  }
);

// ─── DELETE /api/inventory/:productId ─────────────────────────────────────────
router.delete(
  "/:productId",
  nukeLimiter,
  requireAdminSecret,
  async (req, res) => {
    const { productId } = req.params;
    if (!/^[a-zA-Z0-9_-]{1,50}$/.test(productId)) {
      return res.status(400).json({ error: "Invalid product ID format" });
    }
    try {
      const { rows: refs } = await pool.query(
        "SELECT COUNT(*) as count FROM order_items WHERE product_id = $1",
        [productId]
      );
      if (parseInt(refs[0].count) > 0) {
        return res.status(409).json({
          error: `Cannot delete — ${refs[0].count} order(s) reference this product.`,
        });
      }
      const { rows } = await pool.query(
        "DELETE FROM products WHERE product_id = $1 RETURNING *",
        [productId]
      );
      if (!rows.length) return res.status(404).json({ error: "Product not found" });

      await auditLog("PRODUCT_DELETED", { product_id: productId, name: rows[0].name });
      res.json({ status: "deleted", product: rows[0] });
    } catch (err) {
      console.error("[inventory/delete] DB error:", err);
      res.status(500).json({ error: "Failed to delete product." });
    }
  }
);

// ─── POST /api/inventory/reset ────────────────────────────────────────────────
// DANGER: Wipes and re-seeds the entire database.
// Protected by nukeLimiter + requireAdminSecret.
router.post(
  "/reset",
  nukeLimiter,
  requireAdminSecret,
  async (req, res) => {
    try {
      await pool.query("DELETE FROM order_items");
      await pool.query("DELETE FROM orders");
      await pool.query("DELETE FROM products");
      await pool.query("DELETE FROM audit_log");

      const schema = readFileSync(join(__dirname, "..", "schema.sql"), "utf8");
      await pool.query(schema);

      await auditLog("INVENTORY_RESET", { timestamp: new Date().toISOString() });
      res.json({ status: "reset_complete" });
    } catch (err) {
      console.error("[inventory/reset] DB error:", err);
      res.status(500).json({ error: "Reset failed. Database may be in a partial state." });
    }
  }
);

module.exports = router;
// routes/inventory.js — Product CRUD (list, get, create, update, delete, reset)

const { Router } = require("express");
const { readFileSync } = require("fs");
const { join } = require("path");
const { pool, auditLog } = require("../db");
const { deviceCount } = require("../websocket");

const router = Router();

// GET /api/inventory — List all products
router.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM products ORDER BY category, name"
    );
    res.json({ products: rows, connected_devices: deviceCount() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/inventory/:productId — Single product
router.get("/:productId", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM products WHERE product_id = $1",
      [req.params.productId]
    );
    if (!rows.length) return res.status(404).json({ error: "Product not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/inventory/:productId — Update fields
router.put("/:productId", async (req, res) => {
  const { stock_count, price, name, category, reorder_threshold } = req.body;
  try {
    const sets = [];
    const vals = [];
    let i = 1;

    if (stock_count !== undefined) { sets.push(`stock_count = $${i++}`); vals.push(stock_count); }
    if (price !== undefined)       { sets.push(`price = $${i++}`); vals.push(price); }
    if (name !== undefined)        { sets.push(`name = $${i++}`); vals.push(name); }
    if (category !== undefined)    { sets.push(`category = $${i++}`); vals.push(category); }
    if (reorder_threshold !== undefined) { sets.push(`reorder_threshold = $${i++}`); vals.push(reorder_threshold); }

    if (!sets.length) return res.status(400).json({ error: "No fields to update" });

    sets.push("updated_at = NOW()");
    vals.push(req.params.productId);

    const { rows } = await pool.query(
      `UPDATE products SET ${sets.join(", ")} WHERE product_id = $${i} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: "Product not found" });

    await auditLog("INVENTORY_UPDATE", {
      product_id: req.params.productId,
      changes: req.body,
    });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inventory — Add new product
router.post("/", async (req, res) => {
  const { product_id, name, price, age_restricted, stock_count, led_address, category, reorder_threshold } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO products (product_id, name, price, age_restricted, stock_count, led_address, category, reorder_threshold)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [product_id, name, price, age_restricted || false, stock_count || 0, led_address, category, reorder_threshold || 20]
    );
    await auditLog("PRODUCT_ADDED", { product_id, name });
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/inventory/:productId — Remove a product
router.delete("/:productId", async (req, res) => {
  const { productId } = req.params;
  try {
    // Check for existing order references
    const { rows: refs } = await pool.query(
      "SELECT COUNT(*) as count FROM order_items WHERE product_id = $1",
      [productId]
    );
    if (parseInt(refs[0].count) > 0) {
      return res.status(409).json({
        error: `Cannot delete — ${refs[0].count} order(s) reference this product. Remove order history first or use Reset All Data.`,
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
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inventory/reset — Reset DB to seed data
router.post("/reset", async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
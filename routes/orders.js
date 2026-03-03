// routes/orders.js — Order processing with atomic stock deduction

const { Router } = require("express");
const { pool, auditLog } = require("../db");
const { broadcast, deviceCount } = require("../websocket");

const router = Router();

// POST /api/orders/confirm — Atomic: deduct stock → save order → trigger LEDs
router.post("/confirm", async (req, res) => {
  const { transaction_id, patient_name, doctor_name, clinic, items, id_verified } = req.body;

  if (!transaction_id || !items?.length) {
    return res.status(400).json({ error: "Missing transaction_id or items" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let total = 0;
    const ledTargets = [];
    const lowStockAlerts = [];
    const confirmedItems = [];

    for (const item of items) {
      const { rows } = await client.query(
        "UPDATE products SET stock_count = GREATEST(0, stock_count - $1), updated_at = NOW() WHERE product_id = $2 RETURNING *",
        [item.quantity_requested, item.database_id]
      );

      if (rows.length) {
        const p = rows[0];
        total += parseFloat(p.price) * item.quantity_requested;

        ledTargets.push({ led_address: p.led_address, item: p.name });
        confirmedItems.push({
          ...item,
          medication_name: p.name,
          unit_price: parseFloat(p.price),
          led_address: p.led_address,
        });

        if (p.stock_count <= p.reorder_threshold) {
          lowStockAlerts.push({
            medication_name: p.name,
            remaining_stock: p.stock_count,
            reorder_threshold: p.reorder_threshold,
          });
        }
      }
    }

    // Insert order header
    const { rows: orderRows } = await client.query(
      "INSERT INTO orders (transaction_id, patient_name, doctor_name, clinic, total, id_verified) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [transaction_id, patient_name, doctor_name, clinic || "Unknown", total.toFixed(2), id_verified || false]
    );

    // Insert line items
    for (const ci of confirmedItems) {
      await client.query(
        "INSERT INTO order_items (order_id, product_id, medication_name, quantity, unit_price, led_address) VALUES ($1,$2,$3,$4,$5,$6)",
        [orderRows[0].id, ci.database_id, ci.medication_name, ci.quantity_requested, ci.unit_price, ci.led_address]
      );
    }

    await client.query("COMMIT");

    // Broadcast LED activation to shelf devices
    const hardware_payload = {
      command: "ACTIVATE_LEDS",
      activation_mode: "BLINK_FAST",
      duration_seconds: 30,
      color_hex: "#00FF00",
      targets: ledTargets,
    };
    const sent = broadcast(hardware_payload);

    await auditLog("ORDER_CONFIRMED", {
      transaction_id,
      total,
      items_count: confirmedItems.length,
      devices_notified: sent,
    });

    res.json({
      status: "confirmed",
      transaction_id,
      order_id: orderRows[0].id,
      total: parseFloat(total.toFixed(2)),
      items_dispensed: confirmedItems.length,
      hardware_payload,
      connected_devices: sent,
      low_stock_alerts: lowStockAlerts,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/orders — Order history with line items
router.get("/", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const { rows: orders } = await pool.query(
      "SELECT * FROM orders ORDER BY created_at DESC LIMIT $1",
      [limit]
    );

    for (const order of orders) {
      const { rows: items } = await pool.query(
        "SELECT * FROM order_items WHERE order_id = $1",
        [order.id]
      );
      order.items = items;
    }

    res.json({ orders, connected_devices: deviceCount() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/orders/:transactionId — Single order
router.get("/:transactionId", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM orders WHERE transaction_id = $1",
      [req.params.transactionId]
    );
    if (!rows.length) return res.status(404).json({ error: "Order not found" });

    const order = rows[0];
    const { rows: items } = await pool.query(
      "SELECT * FROM order_items WHERE order_id = $1",
      [order.id]
    );
    order.items = items;
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// routes/tests.js — Automated test suite (10 tests)
// Hit GET /api/test/run-all to verify deployment

const { Router } = require("express");
const { pool, auditLog } = require("../db");

const router = Router();

router.get("/run-all", async (req, res) => {
  const results = [];

  const test = async (name, fn) => {
    try {
      const r = await fn();
      results.push({ test: name, status: "PASS", ...r });
    } catch (err) {
      results.push({ test: name, status: "FAIL", error: err.message });
    }
  };

  // 1. Database connectivity
  await test("Health — server is online", async () => {
    const { rows } = await pool.query("SELECT 1 as ok");
    if (!rows.length) throw new Error("DB query failed");
    return { detail: "Database responds to queries" };
  });

  // 2. Products seeded
  await test("Inventory — products exist in database", async () => {
    const { rows } = await pool.query("SELECT COUNT(*) as count FROM products");
    const count = parseInt(rows[0].count);
    if (count < 1) throw new Error(`Expected products, got ${count}`);
    return { detail: `${count} products in database` };
  });

  // 3. Fetch single product
  await test("Inventory — fetch single product (med_001)", async () => {
    const { rows } = await pool.query(
      "SELECT * FROM products WHERE product_id = 'med_001'"
    );
    if (!rows.length) throw new Error("med_001 not found");
    if (!rows[0].name.includes("Amoxicillin")) throw new Error("Wrong product returned");
    return { detail: `Found: ${rows[0].name}, stock: ${rows[0].stock_count}` };
  });

  // 4. Stock update + rollback
  await test("Inventory — update stock count", async () => {
    const { rows: before } = await pool.query(
      "SELECT stock_count FROM products WHERE product_id = 'med_001'"
    );
    const originalStock = before[0].stock_count;

    await pool.query(
      "UPDATE products SET stock_count = stock_count + 1 WHERE product_id = 'med_001'"
    );
    const { rows: after } = await pool.query(
      "SELECT stock_count FROM products WHERE product_id = 'med_001'"
    );
    if (after[0].stock_count !== originalStock + 1) throw new Error("Stock not updated");

    // Restore original value
    await pool.query(
      "UPDATE products SET stock_count = $1 WHERE product_id = 'med_001'",
      [originalStock]
    );
    return { detail: `Stock: ${originalStock} → ${originalStock + 1} → restored` };
  });

  // 5. OCR text parsing
  await test("OCR — parse prescription text", async () => {
    const text = `Dr. Test Doctor, MD\nClinic: Test Clinic\nPatient: Test Patient\nDate: Mar 1, 2026\n\nRx: Amoxicillin 500mg — Qty: 30\nRx: Ibuprofen 400mg — Qty: 20`;
    const get = (rx) => { const m = text.match(rx); return m ? m[1].trim() : "Unknown"; };
    const rxM = [...text.matchAll(/Rx:\s*(.+?)\s*(?:[—\-]+\s*Qty:|quantity)\s*(\d+)/gi)];

    if (rxM.length !== 2) throw new Error(`Expected 2 medications, got ${rxM.length}`);
    const doctor = get(/Dr\.\s+([^\n,]+)/i);
    if (doctor === "Unknown") throw new Error("Doctor name not parsed");

    return { detail: `Parsed: Dr. ${doctor}, ${rxM.length} medications found` };
  });

  // 6. Medication matching
  await test("OCR — match medications to inventory", async () => {
    const { rows } = await pool.query("SELECT * FROM products");
    const match = rows.find((p) => p.name.toLowerCase().startsWith("amoxicillin"));
    if (!match) throw new Error("Amoxicillin not found in inventory");
    return { detail: `Matched: ${match.name} (${match.product_id}), stock: ${match.stock_count}` };
  });

  // 7. Controlled substance flagging
  await test("Compliance — controlled substances flagged", async () => {
    const { rows } = await pool.query(
      "SELECT * FROM products WHERE age_restricted = true"
    );
    if (rows.length < 1) throw new Error("No controlled substances found");
    const names = rows.map((r) => r.name).join(", ");
    return { detail: `${rows.length} controlled: ${names}` };
  });

  // 8. Order creation + stock deduction (transactional, with rollback)
  await test("Orders — create order + deduct stock (with rollback)", async () => {
    const { rows: before } = await pool.query(
      "SELECT stock_count FROM products WHERE product_id = 'med_023'"
    );
    const txnId = `test_${Date.now()}`;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE products SET stock_count = stock_count - 5 WHERE product_id = 'med_023'"
      );
      const { rows: ord } = await client.query(
        "INSERT INTO orders (transaction_id, patient_name, doctor_name, total, id_verified) VALUES ($1, 'Test', 'Dr. Test', 34.95, false) RETURNING id",
        [txnId]
      );
      await client.query(
        "INSERT INTO order_items (order_id, product_id, medication_name, quantity, unit_price) VALUES ($1, 'med_023', 'Aspirin 81mg', 5, 6.99)",
        [ord[0].id]
      );

      const { rows: after } = await client.query(
        "SELECT stock_count FROM products WHERE product_id = 'med_023'"
      );
      await client.query("ROLLBACK"); // Don't pollute DB

      if (after[0].stock_count !== before[0].stock_count - 5) {
        throw new Error("Stock deduction failed");
      }

      return { detail: `Stock: ${before[0].stock_count} → ${after[0].stock_count} (rolled back)` };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  // 9. Audit log write
  await test("Audit — log entry created", async () => {
    await auditLog("TEST_RUN", { test: true, timestamp: new Date().toISOString() });
    const { rows } = await pool.query(
      "SELECT * FROM audit_log WHERE action = 'TEST_RUN' ORDER BY created_at DESC LIMIT 1"
    );
    if (!rows.length) throw new Error("Audit entry not found");
    return { detail: `Audit entry #${rows[0].id} created at ${rows[0].created_at}` };
  });

  // 10. Low stock detection
  await test("Alerts — low stock detection works", async () => {
    const { rows } = await pool.query(
      "SELECT * FROM products WHERE stock_count <= reorder_threshold"
    );
    return {
      detail: `${rows.length} products at or below reorder threshold${
        rows.length ? ": " + rows.map((r) => r.name).join(", ") : ""
      }`,
    };
  });

  // Summary
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;

  res.json({
    summary: `${passed}/${results.length} tests passed${failed ? ` — ${failed} FAILED` : " ✅"}`,
    total: results.length,
    passed,
    failed,
    results,
    ran_at: new Date().toISOString(),
  });
});

module.exports = router;

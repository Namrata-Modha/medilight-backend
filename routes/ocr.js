// routes/ocr.js — Server-side regex prescription parser

const { Router } = require("express");
const { pool, auditLog } = require("../db");
const { deviceCount } = require("../websocket");

const router = Router();

// POST /api/ocr/extract — Parse raw prescription text, match to inventory
router.post("/extract", async (req, res) => {
  const { ocr_text } = req.body;
  if (!ocr_text) return res.status(400).json({ error: "Missing ocr_text" });

  // Extract structured fields via regex
  const get = (rx) => {
    const m = ocr_text.match(rx);
    return m ? m[1].trim() : "Unknown";
  };

  const prescription_data = {
    doctor_name: get(/Dr\.\s+([^\n,]+)/i),
    clinic: get(/Clinic:\s*([^\n]+)/i),
    patient_name: get(/Patient:\s*([^\n]+)/i),
    date_issued: get(/Date:\s*([^\n]+)/i),
  };

  // Extract medication lines: "Rx: Name — Qty: 30"
  const rxMatches = [
    ...ocr_text.matchAll(/Rx:\s*(.+?)\s*(?:[—\-]+\s*Qty:|quantity)\s*(\d+)/gi),
  ];

  // Match against database inventory
  const { rows: products } = await pool.query("SELECT * FROM products");

  const order_summary = rxMatches.map((m) => {
    const medName = m[1].trim();
    const qty = parseInt(m[2], 10);
    const key = medName.split(" ")[0].toLowerCase();
    const match = products.find((p) => p.name.toLowerCase().startsWith(key));

    if (!match) {
      return {
        medication_name: medName,
        quantity_requested: qty,
        matched: false,
        stock_sufficient: false,
      };
    }

    return {
      medication_name: medName,
      quantity_requested: qty,
      database_id: match.product_id,
      led_address: match.led_address,
      price: parseFloat(match.price),
      in_stock: match.stock_count,
      requires_id: match.age_restricted,
      category: match.category,
      stock_sufficient: match.stock_count >= qty,
      matched: true,
    };
  });

  await auditLog("OCR_EXTRACT", { items_found: order_summary.length });
  res.json({ prescription_data, order_summary, connected_devices: deviceCount() });
});

module.exports = router;

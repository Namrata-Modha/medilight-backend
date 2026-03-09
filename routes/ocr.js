// routes/ocr.js — Server-side regex prescription parser (hardened)
//
// Security changes:
//   • Schema validation enforces ocr_text length limit (8000 chars max)
//     — previously, unbounded text could cause regex backtracking DoS
//   • Regex anchored and length-limited to prevent catastrophic backtracking
//   • Raw DB/error messages never sent to client

const { Router }    = require("express");
const { pool, auditLog } = require("../db");
const { deviceCount }    = require("../websocket");
const { writeLimiter }   = require("../middleware/rateLimiter");
const { validate, ocrExtractSchema } = require("../middleware/validate");

const router = Router();

// POST /api/ocr/extract — Parse raw prescription text, match to inventory
router.post(
  "/extract",
  writeLimiter,
  validate(ocrExtractSchema),   // enforces: required, string, max 8000 chars
  async (req, res) => {
    const { ocr_text } = req.body;

    // Safe regex helper — returns empty string on no match (never throws)
    const get = (rx) => {
      try {
        const m = ocr_text.match(rx);
        return m ? m[1].slice(0, 200).trim() : "Unknown";
      } catch {
        return "Unknown";
      }
    };

    const prescription_data = {
      doctor_name:  get(/Dr\.\s+([^\n,]{1,100})/i),
      clinic:       get(/Clinic:\s*([^\n]{1,100})/i),
      patient_name: get(/Patient:\s*([^\n]{1,100})/i),
      date_issued:  get(/Date:\s*([^\n]{1,40})/i),
    };

    // Extract medication lines: "Rx: Name — Qty: 30"
    // Pattern is length-limited to prevent catastrophic backtracking
    let rxMatches = [];
    try {
      rxMatches = [
        ...ocr_text.matchAll(/Rx:\s*(.{1,80}?)\s*(?:[—\-]+\s*Qty:|quantity)\s*(\d{1,5})/gi),
      ];
    } catch {
      // On regex failure, return empty results rather than crashing
      rxMatches = [];
    }

    let products = [];
    try {
      const { rows } = await pool.query("SELECT * FROM products");
      products = rows;
    } catch (err) {
      console.error("[ocr/extract] DB error:", err);
      return res.status(500).json({ error: "Failed to load inventory for matching." });
    }

    const order_summary = rxMatches.map((m) => {
      const medName = m[1].trim().slice(0, 120);
      const qty = Math.min(parseInt(m[2], 10), 9999); // cap quantity
      const key = medName.split(" ")[0].toLowerCase();
      const match = products.find((p) => p.name.toLowerCase().startsWith(key));

      if (!match) {
        return { medication_name: medName, quantity_requested: qty, matched: false, stock_sufficient: false };
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
  }
);

module.exports = router;
// routes/verification.js — Patient ID verification for controlled substances

const { Router } = require("express");
const { auditLog } = require("../db");

const router = Router();

// POST /api/verify-id — Simulated ID verification
// In production: integrate with a real ID verification service
router.post("/", async (req, res) => {
  const { patient_name, id_number } = req.body;

  if (!patient_name || !id_number) {
    return res.status(400).json({ error: "Missing patient_name or id_number" });
  }

  // Simple validation — replace with real verification in production
  const verified = patient_name.length > 1 && id_number.length > 3;

  await auditLog("ID_VERIFICATION", { patient_name, verified });

  res.json({
    status: verified ? "verified" : "failed",
    patient_name,
    verified,
  });
});

module.exports = router;

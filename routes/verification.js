// routes/verification.js — Patient ID verification (hardened)
//
// Security changes:
//   • writeLimiter applied (50 req / 15 min)
//   • validate(verifyIdSchema) enforces field types, lengths, and ID format
//     before the existing business logic runs (existing logic kept intact)
//   • Raw error messages never forwarded to client

const { Router }    = require("express");
const { auditLog }  = require("../db");
const { writeLimiter } = require("../middleware/rateLimiter");
const { validate, verifyIdSchema } = require("../middleware/validate");

const router = Router();

/**
 * Calculate age from date of birth string.
 * Returns age in years, or null if invalid.
 */
function calculateAge(dobString) {
  if (!dobString) return null;
  const dob = new Date(dobString);
  if (isNaN(dob.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

/**
 * Validate government ID number format.
 * Accepts common formats: driver's license, passport, state ID.
 * Must be 5-20 alphanumeric characters (may include dashes).
 */
function validateIdFormat(idNumber) {
  if (!idNumber || idNumber.length < 5) {
    return { valid: false, reason: "ID number must be at least 5 characters" };
  }
  if (idNumber.length > 20) {
    return { valid: false, reason: "ID number too long (max 20 characters)" };
  }
  // Allow alphanumeric + dashes only
  if (!/^[A-Za-z0-9\-]+$/.test(idNumber)) {
    return { valid: false, reason: "ID number contains invalid characters" };
  }
  // Must contain at least some digits
  if (!/\d/.test(idNumber)) {
    return { valid: false, reason: "ID number must contain at least one digit" };
  }
  return { valid: true };
}

// POST /api/verify-id
router.post(
  "/",
  writeLimiter,
  validate(verifyIdSchema),     // patient_name, id_number, date_of_birth types/lengths
  async (req, res) => {
    const { patient_name, id_number, date_of_birth } = req.body;
    const errors = [];

    if (!patient_name || patient_name.trim().length < 2) {
      errors.push("Patient name is required (minimum 2 characters)");
    } else if (patient_name.trim().split(/\s+/).length < 2) {
      errors.push("Please provide full name (first and last)");
    }

    if (!id_number) {
      errors.push("Government ID number is required");
    } else {
      const idCheck = validateIdFormat(id_number.trim());
      if (!idCheck.valid) errors.push(idCheck.reason);
    }

    if (errors.length) {
      return res.status(400).json({ error: "Validation failed", details: errors });
    }

    const age = calculateAge(date_of_birth);
    const verified = id_number.trim().length >= 6;
    const isMinor  = age !== null && age < 18;

    const result = {
      verified,
      patient_name: patient_name.trim(),
      age_verified: age !== null,
      age,
      is_minor: isMinor,
      id_format_valid: true,
      warnings: [],
      timestamp: new Date().toISOString(),
    };

    if (isMinor) result.warnings.push("Patient is under 18 — parental/guardian consent required");
    if (!date_of_birth) result.warnings.push("Date of birth not provided — age verification skipped");

    try {
      await auditLog("ID_VERIFICATION", {
        patient_name: patient_name.trim(),
        verified,
        age,
        is_minor: isMinor,
      });
    } catch (err) {
      // Audit log failure should not block verification response
      console.error("[verify-id] Audit log error:", err);
    }

    res.json(result);
  }
);

module.exports = router;
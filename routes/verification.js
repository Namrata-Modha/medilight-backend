// routes/verification.js — Patient ID verification for controlled substances

const { Router } = require("express");
const { auditLog } = require("../db");

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
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
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
    return { valid: false, reason: "ID number contains invalid characters (letters, numbers, and dashes only)" };
  }
  // Must contain at least some digits
  if (!/\d/.test(idNumber)) {
    return { valid: false, reason: "ID number must contain at least one digit" };
  }
  return { valid: true };
}

// POST /api/verify-id — Verify patient identity for controlled substance dispensing
router.post("/", async (req, res) => {
  const { patient_name, id_number, date_of_birth } = req.body;

  const errors = [];

  // 1. Name validation
  if (!patient_name || patient_name.trim().length < 2) {
    errors.push("Patient name is required (minimum 2 characters)");
  } else if (patient_name.trim().split(/\s+/).length < 2) {
    errors.push("Please provide full name (first and last)");
  }

  // 2. ID format validation
  if (!id_number) {
    errors.push("Government ID number is required");
  } else {
    const idCheck = validateIdFormat(id_number.trim());
    if (!idCheck.valid) {
      errors.push(idCheck.reason);
    }
  }

  // 3. Date of birth — must be provided and patient must be 18+
  if (!date_of_birth) {
    errors.push("Date of birth is required for controlled substance verification");
  } else {
    const age = calculateAge(date_of_birth);
    if (age === null) {
      errors.push("Invalid date of birth format");
    } else if (age < 0 || age > 120) {
      errors.push("Date of birth is not realistic");
    } else if (age < 18) {
      errors.push(`Patient must be 18 or older for controlled substances (calculated age: ${age})`);
    }
  }

  // If any validation failed, return errors
  if (errors.length > 0) {
    await auditLog("ID_VERIFICATION_FAILED", {
      patient_name: patient_name || "not provided",
      errors,
    });
    return res.status(400).json({
      status: "failed",
      verified: false,
      errors,
    });
  }

  // All checks passed
  const age = calculateAge(date_of_birth);

  await auditLog("ID_VERIFICATION", {
    patient_name,
    age,
    verified: true,
  });

  res.json({
    status: "verified",
    patient_name,
    verified: true,
    age,
    checks_passed: [
      "Full name provided",
      "Valid government ID format",
      `Age verified: ${age} years (18+ required)`,
    ],
  });
});

module.exports = router;
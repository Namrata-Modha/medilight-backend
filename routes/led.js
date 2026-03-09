// routes/led.js — Manual LED trigger for ESP32 shelf devices (hardened)
//
// Security changes:
//   • Command field restricted to an explicit allowlist — previously ANY
//     arbitrary JSON was broadcast directly to hardware (critical vulnerability)
//   • LED target addresses validated for format and length
//   • writeLimiter applied — prevents LED spam / hardware DoS
//   • req.body no longer forwarded raw; a sanitized payload is constructed

const { Router }   = require("express");
const { broadcast } = require("../websocket");
const { writeLimiter }    = require("../middleware/rateLimiter");
const { validate, ledTriggerSchema } = require("../middleware/validate");

const router = Router();

// Validate individual LED target objects within the targets array
function validateTargets(targets) {
  if (!targets) return [];
  const errors = [];
  if (targets.length > 200) {
    return ['"targets" may contain at most 200 entries'];
  }
  targets.forEach((t, i) => {
    if (typeof t !== "object" || Array.isArray(t)) {
      errors.push(`targets[${i}]: must be an object`);
      return;
    }
    if (typeof t.led_address !== "string" || t.led_address.length > 80) {
      errors.push(`targets[${i}].led_address: required string (max 80 chars)`);
    }
    if (t.item !== undefined && (typeof t.item !== "string" || t.item.length > 120)) {
      errors.push(`targets[${i}].item: must be a string (max 120 chars)`);
    }
    // Reject unexpected fields on target objects
    const allowedKeys = new Set(["led_address", "item"]);
    for (const k of Object.keys(t)) {
      if (!allowedKeys.has(k)) errors.push(`targets[${i}]: unexpected field "${k}"`);
    }
  });
  return errors;
}

// POST /api/led/trigger — Broadcast validated payload to connected devices
router.post(
  "/trigger",
  writeLimiter,                 // 50 req / 15 min per IP
  validate(ledTriggerSchema),   // command allowlist + field types/lengths
  (req, res) => {
    const { command, activation_mode, duration_seconds, color_hex, targets } = req.body;

    // Validate nested targets array
    const targetErrors = validateTargets(targets);
    if (targetErrors.length) {
      return res.status(400).json({ error: "Validation failed", details: targetErrors });
    }

    // Construct a clean, explicit payload — never pass req.body directly to hardware
    const safePayload = {
      command,
      ...(activation_mode    && { activation_mode }),
      ...(duration_seconds   && { duration_seconds }),
      ...(color_hex          && { color_hex }),
      ...(targets?.length    && { targets: targets.map((t) => ({
        led_address: t.led_address,
        ...(t.item && { item: t.item }),
      })) }),
    };

    const sent = broadcast(safePayload);
    res.json({ sent_to: sent, payload: safePayload });
  }
);

module.exports = router;
// middleware/validate.js
// OWASP A03 — Injection / A04 — Insecure Design
//
// Lightweight schema-based validator. No heavy runtime dependency (Joi/Zod)
// is added intentionally — the existing package.json has no validation lib,
// and this keeps the audit surface small.
//
// Each schema is a plain object:
//   { fieldName: { type, required?, min?, max?, pattern?, enum? } }
//
// validate(schema) returns an Express middleware that:
//   1. Rejects unexpected fields (allowlist approach)
//   2. Checks required fields exist
//   3. Enforces types, lengths and patterns
//   4. Strips any field not declared in the schema (defense-in-depth)

// ─── Shared limits (used across schemas) ──────────────────────────────────────
const LIMITS = {
  NAME:       { min: 1,  max: 120 },
  TEXT_OCR:   { min: 1,  max: 8_000 },    // ~4 pages of text
  PRODUCT_ID: { min: 1,  max: 50 },
  LED_ADDR:   { min: 1,  max: 80 },
  CATEGORY:   { min: 1,  max: 60 },
  TXN_ID:     { min: 1,  max: 80 },
  ID_NUM:     { min: 5,  max: 20 },
  INVENTORY_B64: { min: 1, max: 4_000 },  // inventory name list
  IMAGE_B64:  { min: 1,  max: 5_000_000 },// ~3.75 MB raw base64
};

// ─── Core validator ───────────────────────────────────────────────────────────
function runSchema(schema, body) {
  const errors = [];

  // 1. Reject fields not in the schema (allowlist)
  const allowed = new Set(Object.keys(schema));
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      errors.push(`Unexpected field: "${key}"`);
    }
  }
  if (errors.length) return errors;

  // 2. Validate each declared field
  for (const [field, rules] of Object.entries(schema)) {
    const val = body[field];
    const missing = val === undefined || val === null || val === "";

    if (rules.required && missing) {
      errors.push(`"${field}" is required`);
      continue;
    }
    if (missing) continue; // optional + absent → skip

    // Type check
    if (rules.type === "string" && typeof val !== "string") {
      errors.push(`"${field}" must be a string`);
      continue;
    }
    if (rules.type === "number" && (typeof val !== "number" || isNaN(val))) {
      errors.push(`"${field}" must be a number`);
      continue;
    }
    if (rules.type === "integer") {
      if (!Number.isInteger(val)) {
        errors.push(`"${field}" must be an integer`);
        continue;
      }
    }
    if (rules.type === "boolean" && typeof val !== "boolean") {
      errors.push(`"${field}" must be a boolean`);
      continue;
    }
    if (rules.type === "array" && !Array.isArray(val)) {
      errors.push(`"${field}" must be an array`);
      continue;
    }

    // String length
    if (typeof val === "string") {
      if (rules.min !== undefined && val.trim().length < rules.min) {
        errors.push(`"${field}" must be at least ${rules.min} characters`);
      }
      if (rules.max !== undefined && val.length > rules.max) {
        errors.push(`"${field}" must be at most ${rules.max} characters`);
      }
    }

    // Numeric range
    if (typeof val === "number" || Number.isInteger(val)) {
      if (rules.min !== undefined && val < rules.min) {
        errors.push(`"${field}" must be ≥ ${rules.min}`);
      }
      if (rules.max !== undefined && val > rules.max) {
        errors.push(`"${field}" must be ≤ ${rules.max}`);
      }
    }

    // Array length
    if (Array.isArray(val)) {
      if (rules.min !== undefined && val.length < rules.min) {
        errors.push(`"${field}" must have at least ${rules.min} item(s)`);
      }
      if (rules.max !== undefined && val.length > rules.max) {
        errors.push(`"${field}" must have at most ${rules.max} item(s)`);
      }
    }

    // Pattern (regex)
    if (rules.pattern && typeof val === "string" && !rules.pattern.test(val)) {
      errors.push(`"${field}" has an invalid format`);
    }

    // Enum
    if (rules.enum && !rules.enum.includes(val)) {
      errors.push(`"${field}" must be one of: ${rules.enum.join(", ")}`);
    }
  }

  return errors;
}

// ─── Middleware factory ────────────────────────────────────────────────────────
function validate(schema) {
  return (req, res, next) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "Request body must be a JSON object" });
    }

    const errors = runSchema(schema, req.body);
    if (errors.length) {
      return res.status(400).json({ error: "Validation failed", details: errors });
    }

    // Strip unexpected fields from body so downstream code never sees them
    const clean = {};
    for (const key of Object.keys(schema)) {
      if (req.body[key] !== undefined) clean[key] = req.body[key];
    }
    req.body = clean;

    next();
  };
}

// ─── Order item sub-validator (used inside orders schema) ─────────────────────
function validateOrderItems(items) {
  const errors = [];
  if (!Array.isArray(items) || items.length === 0) {
    return ['"items" must be a non-empty array'];
  }
  if (items.length > 50) {
    return ['"items" may contain at most 50 entries per order'];
  }
  items.forEach((item, i) => {
    if (typeof item !== "object" || Array.isArray(item)) {
      errors.push(`items[${i}]: must be an object`);
      return;
    }
    if (!item.database_id || typeof item.database_id !== "string") {
      errors.push(`items[${i}].database_id: required string`);
    } else if (item.database_id.length > LIMITS.PRODUCT_ID.max) {
      errors.push(`items[${i}].database_id: too long (max ${LIMITS.PRODUCT_ID.max})`);
    } else if (!/^[a-zA-Z0-9_-]+$/.test(item.database_id)) {
      errors.push(`items[${i}].database_id: invalid characters`);
    }
    if (!Number.isInteger(item.quantity_requested)) {
      errors.push(`items[${i}].quantity_requested: must be an integer`);
    } else if (item.quantity_requested < 1 || item.quantity_requested > 9_999) {
      errors.push(`items[${i}].quantity_requested: must be between 1 and 9999`);
    }
    // Reject unexpected fields on each item
    const allowedItemKeys = new Set(["database_id", "quantity_requested"]);
    for (const k of Object.keys(item)) {
      if (!allowedItemKeys.has(k)) errors.push(`items[${i}]: unexpected field "${k}"`);
    }
  });
  return errors;
}

// ─── Exported schemas ──────────────────────────────────────────────────────────

// POST /api/orders/confirm
const orderConfirmSchema = {
  transaction_id: { type: "string", required: true, ...LIMITS.TXN_ID, pattern: /^[a-zA-Z0-9_-]+$/ },
  patient_name:   { type: "string", required: false, ...LIMITS.NAME },
  doctor_name:    { type: "string", required: false, ...LIMITS.NAME },
  clinic:         { type: "string", required: false, ...LIMITS.NAME },
  items:          { type: "array",  required: true,  min: 1, max: 50 },
  id_verified:    { type: "boolean", required: false },
};

// POST /api/ocr/extract
const ocrExtractSchema = {
  ocr_text: { type: "string", required: true, ...LIMITS.TEXT_OCR },
};

// POST /api/verify-id
const verifyIdSchema = {
  patient_name:  { type: "string", required: true,  ...LIMITS.NAME },
  id_number:     { type: "string", required: true,  ...LIMITS.ID_NUM, pattern: /^[A-Za-z0-9-]+$/ },
  date_of_birth: { type: "string", required: false, min: 1, max: 15 },
};

// POST /api/inventory (create product)
const inventoryCreateSchema = {
  product_id:        { type: "string",  required: true,  ...LIMITS.PRODUCT_ID, pattern: /^[a-zA-Z0-9_-]+$/ },
  name:              { type: "string",  required: true,  ...LIMITS.NAME },
  price:             { type: "number",  required: true,  min: 0,   max: 99_999 },
  stock_count:       { type: "integer", required: false, min: 0,   max: 999_999 },
  age_restricted:    { type: "boolean", required: false },
  led_address:       { type: "string",  required: false, ...LIMITS.LED_ADDR },
  category:          { type: "string",  required: false, ...LIMITS.CATEGORY },
  reorder_threshold: { type: "integer", required: false, min: 0, max: 999_999 },
};

// PUT /api/inventory/:productId (update product)
const inventoryUpdateSchema = {
  stock_count:       { type: "integer", required: false, min: 0,   max: 999_999 },
  price:             { type: "number",  required: false, min: 0,   max: 99_999 },
  name:              { type: "string",  required: false, ...LIMITS.NAME },
  category:          { type: "string",  required: false, ...LIMITS.CATEGORY },
  reorder_threshold: { type: "integer", required: false, min: 0, max: 999_999 },
};

// POST /api/led/trigger
const ledTriggerSchema = {
  command:         { type: "string", required: true,  min: 1, max: 60,
                     enum: ["ACTIVATE_LEDS", "DEACTIVATE_LEDS", "BLINK", "STATUS"] },
  activation_mode: { type: "string", required: false, max: 40 },
  duration_seconds:{ type: "integer",required: false, min: 1, max: 3_600 },
  color_hex:       { type: "string", required: false, max: 10, pattern: /^#[0-9A-Fa-f]{3,6}$/ },
  // targets array validated separately — can contain up to 200 LED addresses
  targets:         { type: "array",  required: false, min: 0, max: 200 },
};

// POST /api/ai/parse-text
const aiParseTextSchema = {
  text:      { type: "string", required: true,  ...LIMITS.TEXT_OCR },
  inventory: { type: "string", required: true,  ...LIMITS.INVENTORY_B64 },
};

// POST /api/ai/parse-image
const aiParseImageSchema = {
  image_base64: { type: "string", required: true,  ...LIMITS.IMAGE_B64 },
  media_type:   { type: "string", required: true,  max: 50,
                  enum: ["image/jpeg", "image/png", "image/webp", "image/gif"] },
  inventory:    { type: "string", required: true,  ...LIMITS.INVENTORY_B64 },
};

module.exports = {
  validate,
  validateOrderItems,
  orderConfirmSchema,
  ocrExtractSchema,
  verifyIdSchema,
  inventoryCreateSchema,
  inventoryUpdateSchema,
  ledTriggerSchema,
  aiParseTextSchema,
  aiParseImageSchema,
};

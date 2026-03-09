// routes/ai.js — AI prescription parsing via Google Gemini (security-hardened)
//
// Security changes vs original:
//   • aiLimiter (20 req / 15 min) — protects the 250 req/day free quota
//   • Schema validation: text ≤ 8000 chars, inventory ≤ 4000 chars,
//     image_base64 ≤ 5 MB, media_type restricted to known MIME types
//   • GEMINI_API_KEY checked at request time — returns 503 if missing (fail-safe)
//   • Gemini upstream errors sanitized — raw API bodies never forwarded to client
//   • Raw err.message never sent to client on catch
//
// Functionality preserved vs original:
//   • Full fuzzy-matching prompt text (Codiene→Codeine, Omprazole→Omeprazole, etc.)
//   • generationConfig (temperature: 0.1, maxOutputTokens: 1000)
//   • inlineData / mimeType (correct camelCase for Gemini REST API)
//   • extractGeminiText() — handles Gemini 2.5 Flash thinking model multi-part response
//   • cleanAndParseJSON() — all original cleanup logic preserved

const { Router }   = require("express");
const { auditLog } = require("../db");
const { aiLimiter } = require("../middleware/rateLimiter");
const {
  validate,
  aiParseTextSchema,
  aiParseImageSchema,
} = require("../middleware/validate");

const router = Router();

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL      = "gemini-2.5-flash";

// ─── API key access (OWASP A02) ───────────────────────────────────────────────
// Key is ONLY read from environment — never hard-coded.
function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("[security] GEMINI_API_KEY is not set in environment variables");
  }
  return key;
}

// ─── Gemini 2.5 Flash thinking-model response extractor ──────────────────────
// parts[0] may be { thought: true, text: "reasoning..." }
// parts[1] is the actual JSON response we want
function extractGeminiText(data) {
  const parts = data.candidates?.[0]?.content?.parts || [];

  // First: find a non-thought part containing JSON
  for (const part of parts) {
    if (!part.thought && part.text && part.text.includes("{")) {
      return part.text;
    }
  }

  // Fallback: last part's text (original behavior)
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].text) return parts[i].text;
  }

  return "";
}

// ─── Robust JSON cleanup (handles common Gemini output quirks) ────────────────
function cleanAndParseJSON(raw) {
  let text = raw || "";

  // Strip markdown code fences
  text = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  // Remove any leading text before the first {
  const firstBrace = text.indexOf("{");
  if (firstBrace > 0) text = text.slice(firstBrace);

  // Remove any trailing text after the last }
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace >= 0) text = text.slice(0, lastBrace + 1);

  // Fix trailing commas before } or ]
  text = text.replace(/,\s*([\]}])/g, "$1");

  // Replace single quotes with double quotes
  text = text.replace(/(?<=[{,[\s:])'/g, '"').replace(/'(?=[},\]:\s])/g, '"');

  // Remove control characters (preserve newlines and tabs)
  text = text.replace(/[\x00-\x1F\x7F]/g, (ch) => ch === "\n" || ch === "\t" ? ch : "");

  // Standard parse
  try {
    return JSON.parse(text);
  } catch {
    // Fallback: fix unquoted property names
    const fixed = text.replace(/(\{|,)\s*([a-zA-Z_]\w*)\s*:/g, '$1"$2":');
    return JSON.parse(fixed);
  }
}

// ─── POST /api/ai/parse-text ──────────────────────────────────────────────────
router.post(
  "/parse-text",
  aiLimiter,
  validate(aiParseTextSchema),
  async (req, res) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return res.status(503).json({ error: "AI service is not configured on this server" });
    }

    // Accept both "text" (frontend ai.js) and "redacted_text" (legacy)
    const redacted_text = req.body.text || req.body.redacted_text;
    const { inventory } = req.body;

    const prompt = `You are a pharmacy prescription parser. Extract medications from this prescription text (which may be messy OCR output with typos and misspellings). Match medications to our inventory even if names are misspelled.

OUR INVENTORY:
${inventory || "No inventory provided"}

PRESCRIPTION TEXT (PHI redacted):
"""
${redacted_text}
"""

Respond ONLY with a JSON object (no markdown, no backticks, no extra text):
{
  "items": [
    {
      "medication_name": "exact name as it appears",
      "quantity_requested": number,
      "matched_product_id": "product_id from inventory or null",
      "confidence": "high" or "medium" or "low"
    }
  ],
  "notes": "any warnings about the prescription"
}

CRITICAL MATCHING RULES:
- Match medications by active ingredient even with OCR typos (e.g. "Codiene"→Codeine, "Omprazole"→Omeprazole, "Cetrizine"→Cetirizine, "Asprin"→Aspirin)
- Use fuzzy matching: if a medication name is 1-2 characters off from an inventory item, MATCH IT and set confidence to "medium"
- Quantity formats: "Qty: 30", "#30", "qty 30", "(thirty)" all mean quantity 30
- Shorthand: "#" means quantity, "mg" may be omitted
- If quantity unclear, default to 30
- Include ALL medications found, even if not in inventory
- ALWAYS try to match to inventory — only return null for matched_product_id if truly no match exists`;

    try {
      const response = await fetch(
        `${GEMINI_API}/${MODEL}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 1000,
            },
          }),
        }
      );

      if (!response.ok) {
        // Do NOT forward Gemini's raw error body — may contain quota/key info
        console.error("[ai/parse-text] Gemini API error:", response.status);
        return res.status(502).json({ error: "AI service returned an error. Please try again." });
      }

      const data        = await response.json();
      const textContent = extractGeminiText(data);
      const parsed      = cleanAndParseJSON(textContent);

      await auditLog("AI_PARSE_TEXT", { items_found: parsed.items?.length || 0 });
      res.json(parsed);
    } catch (err) {
      console.error("[ai/parse-text] Error:", err.message);
      res.status(500).json({ error: "AI parsing failed. Please try again or use manual entry." });
    }
  }
);

// ─── POST /api/ai/parse-image ─────────────────────────────────────────────────
router.post(
  "/parse-image",
  aiLimiter,
  validate(aiParseImageSchema),
  async (req, res) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      return res.status(503).json({ error: "AI service is not configured on this server" });
    }

    const { image_base64, media_type, inventory } = req.body;

    const prompt = `You are a pharmacy prescription parser. Read this prescription image and extract ONLY medication data. DO NOT extract or return any patient names, doctor names, clinic names, addresses, dates of birth, or phone numbers — these are protected health information.

OUR INVENTORY:
${inventory || "No inventory provided"}

Respond ONLY with a JSON object (no markdown, no backticks, no extra text):
{
  "items": [
    {
      "medication_name": "medication name as written",
      "quantity_requested": number,
      "matched_product_id": "product_id from inventory or null",
      "confidence": "high" or "medium" or "low"
    }
  ],
  "notes": "any warnings (do NOT include patient or doctor names here)"
}

CRITICAL MATCHING RULES:
- ONLY extract medications — NO personal/health information
- Match by active ingredient even with handwriting variations or misspellings (e.g. "Codiene"→Codeine med_091, "Omprazole"→Omeprazole med_056, "Cetrizine"→Cetirizine med_067)
- Quantity formats: "Qty: 30", "#30", "qty 30", "(thirty)" all mean quantity 30
- Shorthand: "#" means quantity, "mg" may be omitted
- If quantity unclear, default to 30
- Include ALL medications found, even if not in inventory
- ALWAYS try to match to inventory — only return null for matched_product_id if truly no match exists`;

    try {
      const response = await fetch(
        `${GEMINI_API}/${MODEL}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    // NOTE: camelCase is required by the Gemini REST API
                    inlineData: {
                      mimeType: media_type || "image/jpeg",
                      data: image_base64,
                    },
                  },
                  { text: prompt },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 1000,
            },
          }),
        }
      );

      if (!response.ok) {
        console.error("[ai/parse-image] Gemini API error:", response.status);
        return res.status(502).json({ error: "AI Vision service returned an error. Please try again." });
      }

      const data        = await response.json();
      const textContent = extractGeminiText(data);
      const parsed      = cleanAndParseJSON(textContent);

      await auditLog("AI_PARSE_IMAGE", { items_found: parsed.items?.length || 0, media_type });
      res.json(parsed);
    } catch (err) {
      console.error("[ai/parse-image] Error:", err.message);
      res.status(500).json({ error: "AI image parsing failed. Please try again." });
    }
  }
);

module.exports = router;
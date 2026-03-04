// routes/ai.js — Free AI prescription parsing via Google Gemini
// No cost — uses Gemini 2.5 Flash free tier (250 req/day, no credit card)

const { Router } = require("express");
const { auditLog } = require("../db");

const router = Router();

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = "gemini-2.5-flash";

function getApiKey() {
  return process.env.GEMINI_API_KEY;
}

/**
 * Robustly clean and parse JSON from Gemini output.
 * Handles: markdown fences, trailing commas, single quotes,
 * unquoted keys, control characters, and partial responses.
 */
function cleanAndParseJSON(raw) {
  let text = raw || "";

  // Strip markdown code fences
  text = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  // Remove any leading text before the first { or [
  const firstBrace = text.indexOf("{");
  if (firstBrace > 0) text = text.slice(firstBrace);

  // Remove any trailing text after the last } or ]
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace >= 0) text = text.slice(0, lastBrace + 1);

  // Fix trailing commas before } or ] (most common Gemini issue)
  text = text.replace(/,\s*([\]}])/g, "$1");

  // Replace single quotes with double quotes (but not inside words like "don't")
  text = text.replace(/(?<=[{,[\s:])'/g, '"').replace(/'(?=[},\]:\s])/g, '"');

  // Remove control characters
  text = text.replace(/[\x00-\x1F\x7F]/g, (ch) => ch === "\n" || ch === "\t" ? ch : "");

  // Try standard parse first
  try {
    return JSON.parse(text);
  } catch (e) {
    // Fallback: try to fix unquoted property names
    const fixed = text.replace(/(\{|,)\s*([a-zA-Z_]\w*)\s*:/g, '$1"$2":');
    try {
      return JSON.parse(fixed);
    } catch (e2) {
      throw new Error(`JSON parse failed after cleanup: ${e.message}`);
    }
  }
}

// POST /api/ai/parse-text — Parse prescription text (PHI already redacted by frontend)
router.post("/parse-text", async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY not configured on server" });
  }

  // Accept both "text" (from frontend ai.js) and "redacted_text" (legacy)
  const redacted_text = req.body.text || req.body.redacted_text;
  const inventory = req.body.inventory;
  if (!redacted_text) {
    return res.status(400).json({ error: "Missing redacted_text" });
  }

  try {
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
      const errBody = await response.text();
      console.error("[AI] Gemini API error:", response.status, errBody);
      return res.status(502).json({ error: `Gemini API returned ${response.status}` });
    }

    const data = await response.json();
    const textContent =
      data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = cleanAndParseJSON(textContent);

    await auditLog("AI_PARSE_TEXT", { items_found: parsed.items?.length || 0 });
    res.json(parsed);
  } catch (err) {
    console.error("[AI] Parse text error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ai/parse-image — Analyze prescription image (only extracts meds, no PHI)
router.post("/parse-image", async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY not configured on server" });
  }

  const { image_base64, media_type, inventory } = req.body;
  if (!image_base64) {
    return res.status(400).json({ error: "Missing image_base64" });
  }

  try {
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
      const errBody = await response.text();
      console.error("[AI] Gemini Vision error:", response.status, errBody);
      return res.status(502).json({ error: `Gemini API returned ${response.status}` });
    }

    const data = await response.json();
    const textContent =
      data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = cleanAndParseJSON(textContent);

    await auditLog("AI_PARSE_IMAGE", { items_found: parsed.items?.length || 0 });
    res.json(parsed);
  } catch (err) {
    console.error("[AI] Parse image error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
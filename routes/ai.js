// routes/ai.js — Free AI prescription parsing via Google Gemini
// No cost — uses Gemini 2.5 Flash free tier (250 req/day, no credit card)

const { Router } = require("express");
const { auditLog } = require("../db");

const router = Router();

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL = "gemini-2.5-flash-preview-05-20";

function getApiKey() {
  return process.env.GEMINI_API_KEY;
}

// POST /api/ai/parse-text — Parse prescription text (PHI already redacted by frontend)
router.post("/parse-text", async (req, res) => {
  const apiKey = getApiKey();
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY not configured on server" });
  }

  const { redacted_text, inventory } = req.body;
  if (!redacted_text) {
    return res.status(400).json({ error: "Missing redacted_text" });
  }

  try {
    const prompt = `You are a pharmacy prescription parser. Extract medications from this prescription text (which may be messy OCR output). Match medications to our inventory. Patient details have been redacted for privacy — focus only on medications.

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

Rules:
- Match medications by active ingredient name
- If quantity unclear, default to 30
- Include ALL medications found, even if not in inventory
- confidence: "high" if clear match, "medium" if partially garbled, "low" if unsure`;

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
    const cleaned = textContent.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

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
      "medication_name": "medication name",
      "quantity_requested": number,
      "matched_product_id": "product_id from inventory or null",
      "confidence": "high" or "medium" or "low"
    }
  ],
  "notes": "any warnings (do NOT include patient or doctor names here)"
}

Rules:
- ONLY extract medications — NO personal/health information
- Match by active ingredient
- If quantity unclear, default to 30
- Include ALL medications, even if not in inventory`;

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
    const cleaned = textContent.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    await auditLog("AI_PARSE_IMAGE", { items_found: parsed.items?.length || 0 });
    res.json(parsed);
  } catch (err) {
    console.error("[AI] Parse image error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
/**
 * AI material lookup — fallback for materials NOT in the curated library.
 *
 * Calls Anthropic's Claude API with a strict JSON-only prompt asking for
 * strength / flexibility / heat/detail/outdoor ratings + customer-facing
 * material specs, tags, ideal-for / not-for bullets, and production-day
 * suggestions. Uses claude-haiku for speed and cost.
 *
 * Requires: ANTHROPIC_API_KEY env var. Falls back to a 503-style response
 * with a clear message if the key isn't configured.
 *
 * Cost: roughly $0.001–0.005 per lookup (Haiku, ~500 input + ~300 output tokens).
 */

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL   = 'claude-haiku-4-5';

const SYSTEM_PROMPT =
  'You are an additive manufacturing and 3D-printing materials expert. When given a material name, you answer ONLY ' +
  'with a single JSON object — no prose, no markdown, no code fences. The JSON must match ' +
  'the schema exactly. Base your answers on widely-known material datasheet properties.';

const SCHEMA_INSTRUCTION = `
Return a JSON object with exactly these keys:

{
  "displayName": string,            // canonical name (e.g. "PLA-CF (Carbon Fiber)")
  "category":    "FDM" | "Resin" | "SLS" | "Specialty",
  "strength":    integer 0-100,     // tensile + impact, perceptual
  "flexibility": integer 0-100,     // ability to bend without breaking
  "heat":        integer 0-100,     // continuous-use temperature resistance
  "detail":      integer 1-5,       // surface/detail suitability
  "outdoorUse":  integer 1-5,       // UV/weather/outdoor suitability
  "tags":        string[] (2-6 short filter labels),
  "best_for":    string[] (2-4 short labels),
  "specs":       [{"label": string, "value": string}] (4-8 rows),
  "shortDescription": string,        // one short customer card sentence
  "longDescription": string,         // 1-2 customer-safe technical sentences
  "learn_more":  string,             // 1-2 practical guidance sentences
  "production_days_min": integer 1-14,
  "production_days_max": integer 1-14,
  "ideal_for":   string[] (3-5 short bullet phrases),
  "not_for":     string[] (2-4 short bullet phrases),
  "confidence":  "high" | "medium" | "low",  // how well-known this material is
  "notes":       string                       // one short sentence, e.g. citing the typical use context
}

Rules:
- Treat "additive manufacturing", "AM", "3D printing", "rapid prototyping", "FFF/FDM", "SLA/DLP/MSLA",
  "SLS", "MJF", "powder bed fusion", "material extrusion", and "vat photopolymerization" as process/search
  context. Identify the underlying material family first.
- Interpret common AM naming variants and regional spellings, such as carbon fibre/fiber, glass fibre/fiber,
  PA/polyamide/nylon, PA12/nylon 12, TPU shore names, photopolymer/resin, and filament/powder/resin feedstock.
- For obscure or brand-specific names, infer from the base resin family.
- If a material truly doesn't exist or you can't confidently rate it, set "confidence":"low" but still answer.
- Bullets must be short user-facing phrases — no full sentences.
- Tags should use generic labels such as Strong, Flexible, Outdoor, Smooth finish, Engineering, Low cost when appropriate.
- Specs must describe material properties only. Do not include shipping, delivery, packaging, location, service area, or production promises.
- Numbers MUST be integers, no quotes, no units.
- Output ONLY the JSON. No leading text. No trailing text. No \`\`\` fences.
`;

/**
 * Ask Claude to rate a material. Returns the parsed JSON object on success,
 * or throws an Error with a useful message on failure.
 *
 * @param {string} name  free-form material name from the admin
 */
export async function aiLookupMaterial(name) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error('ANTHROPIC_API_KEY is not set — internet AI lookup is disabled.');
    err.code = 'NO_API_KEY';
    throw err;
  }
  if (!name || typeof name !== 'string' || !name.trim()) {
    const err = new Error('Material name is required.');
    err.code = 'BAD_INPUT';
    throw err;
  }

  const body = {
    model: MODEL,
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Material name: "${name.trim()}"\n${SCHEMA_INSTRUCTION}`,
      },
    ],
  };

  const res = await fetch(API_URL, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err  = new Error(`Anthropic API ${res.status}: ${text.slice(0, 300)}`);
    err.code = 'API_ERROR';
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const raw  = data?.content?.[0]?.text || '';
  if (!raw) {
    const err = new Error('Anthropic returned an empty response.');
    err.code = 'EMPTY';
    throw err;
  }

  // Strip code fences if Claude ever decides to use them
  const cleaned = raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    const err = new Error('Could not parse the AI response as JSON. Try a slightly different name.');
    err.code = 'BAD_JSON';
    err.raw  = raw;
    throw err;
  }

  // Validate & coerce — be defensive about bad model output
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, parseInt(v, 10) || 0));
  const cleanArr = (a, maxLen = 5) =>
    Array.isArray(a) ? a.map(s => String(s).trim()).filter(Boolean).slice(0, maxLen) : [];
  const cleanSpecs = a =>
    Array.isArray(a)
      ? a.map(row => ({
          label: String(row?.label || '').trim().slice(0, 48),
          value: String(row?.value || '').trim().slice(0, 96),
        })).filter(row => row.label && row.value).slice(0, 8)
      : [];
  const rating = v => Math.max(1, Math.min(5, parseInt(v, 10) || 3));
  const strength = clamp(parsed.strength, 0, 100);
  const flexibility = clamp(parsed.flexibility, 0, 100);
  const heat = clamp(parsed.heat, 0, 100);
  const detail = rating(parsed.detail);
  const outdoorUse = rating(parsed.outdoorUse);

  const out = {
    displayName: String(parsed.displayName || name).trim().slice(0, 80),
    category:    ['FDM','Resin','SLS','Specialty'].includes(parsed.category) ? parsed.category : 'FDM',
    strength,
    flexibility,
    heat,
    ratings: {
      strength: Math.max(1, Math.min(5, Math.round(strength / 20))),
      flexibility: Math.max(1, Math.min(5, Math.round(flexibility / 20))),
      heatResistance: Math.max(1, Math.min(5, Math.round(heat / 20))),
      detail,
      outdoorUse,
    },
    detail,
    outdoorUse,
    tags:        cleanArr(parsed.tags, 6),
    best_for:    cleanArr(parsed.best_for, 4),
    specs:       cleanSpecs(parsed.specs),
    shortDescription: String(parsed.shortDescription || '').trim().slice(0, 180),
    longDescription: String(parsed.longDescription || '').trim().slice(0, 500),
    learn_more:  String(parsed.learn_more || '').trim().slice(0, 500),
    production_days_min: clamp(parsed.production_days_min, 1, 30),
    production_days_max: clamp(parsed.production_days_max, 1, 30),
    ideal_for:   cleanArr(parsed.ideal_for, 5),
    not_for:     cleanArr(parsed.not_for,   4),
    confidence:  ['high','medium','low'].includes(parsed.confidence) ? parsed.confidence : 'medium',
    notes:       String(parsed.notes || '').trim().slice(0, 200),
    source:      'ai',
  };

  // Make sure min ≤ max
  if (out.production_days_max < out.production_days_min) {
    out.production_days_max = out.production_days_min;
  }

  return out;
}

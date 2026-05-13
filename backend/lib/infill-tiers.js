/**
 * Infill-tier configuration — used by both the admin pricing route
 * (GET/PUT) and the customer-facing pricing endpoint (GET) so the
 * customer's quote page sees exactly what the shop owner saves.
 *
 * Tier shape:
 *   {
 *     id:         string,  // stable, used as the dropdown <option value>
 *     label:      string,  // e.g. "Standard"
 *     percent:    number,  // 0–100 (informational + shown in label)
 *     multiplier: number,  // applied to base price (e.g. 1.0 = no change)
 *     is_default: boolean, // pre-selected on the quote page
 *     active:     boolean, // hidden from customers if false
 *   }
 */

export const DEFAULT_INFILL_TIERS = [
  { id: 'light',    label: 'Light',    percent: 10,  multiplier: 0.90, is_default: false, active: true },
  { id: 'standard', label: 'Standard', percent: 20,  multiplier: 1.00, is_default: true,  active: true },
  { id: 'medium',   label: 'Medium',   percent: 35,  multiplier: 1.15, is_default: false, active: true },
  { id: 'strong',   label: 'Strong',   percent: 50,  multiplier: 1.30, is_default: false, active: true },
  { id: 'heavy',    label: 'Heavy',    percent: 75,  multiplier: 1.55, is_default: false, active: true },
  { id: 'solid',    label: 'Solid',    percent: 100, multiplier: 1.80, is_default: false, active: true },
];

/**
 * Parse the raw `infill_tiers` JSON column. Returns the curated defaults
 * if the value is missing, empty, or unparseable.
 */
export function parseInfillTiers(rawJson) {
  if (!rawJson) return [...DEFAULT_INFILL_TIERS];
  let arr;
  try { arr = JSON.parse(rawJson); } catch { return [...DEFAULT_INFILL_TIERS]; }
  if (!Array.isArray(arr) || arr.length === 0) return [...DEFAULT_INFILL_TIERS];
  return arr.map(sanitiseTier).filter(Boolean);
}

/**
 * Validate / coerce an incoming tier object before saving. Bad values
 * are clamped to safe ranges rather than rejected outright.
 */
export function sanitiseTier(t, idx = 0) {
  if (!t || typeof t !== 'object') return null;
  const percent    = Math.max(0,    Math.min(100,  Number(t.percent)    || 0));
  const multiplier = Math.max(0.10, Math.min(10,   Number(t.multiplier) || 1.0));
  const label      = String(t.label || `Tier ${idx + 1}`).trim().slice(0, 40) || `Tier ${idx + 1}`;
  const idRaw      = String(t.id || label).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  const id         = idRaw || `tier-${idx + 1}`;
  return {
    id, label, percent,
    multiplier: Math.round(multiplier * 1000) / 1000,
    is_default: !!t.is_default,
    active:     t.active !== false,
  };
}

/**
 * Validate an array of tiers as a whole. Ensures exactly one is marked
 * default (defaults to the first active tier if none is). Returns the
 * sanitised array.
 */
export function sanitiseTierList(arr) {
  if (!Array.isArray(arr)) return [...DEFAULT_INFILL_TIERS];
  let cleaned = arr.map((t, i) => sanitiseTier(t, i)).filter(Boolean);
  if (cleaned.length === 0) return [...DEFAULT_INFILL_TIERS];

  // De-duplicate ids
  const seen = new Set();
  cleaned = cleaned.map((t, i) => {
    let id = t.id;
    while (seen.has(id)) id = `${t.id}-${i + 1}`;
    seen.add(id);
    return { ...t, id };
  });

  // Ensure exactly one default
  const defaults = cleaned.filter(t => t.is_default && t.active);
  if (defaults.length === 0) {
    const firstActive = cleaned.find(t => t.active);
    if (firstActive) firstActive.is_default = true;
  } else if (defaults.length > 1) {
    let kept = false;
    cleaned = cleaned.map(t => {
      if (t.is_default && !kept) { kept = true; return t; }
      return { ...t, is_default: false };
    });
  }
  return cleaned;
}

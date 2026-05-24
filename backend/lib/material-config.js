export function safeJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

export const VISIBLE_MATERIAL_CATEGORY = 'FDM';
const HIDDEN_PUBLIC_MATERIAL_LABELS = new Set(['resin', 'sls', 'specialty']);

export function isVisibleMaterialCategory(category) {
  return String(category || '').trim().toLowerCase() === VISIBLE_MATERIAL_CATEGORY.toLowerCase();
}

export function isVisiblePublicMaterialLabel(label) {
  return !HIDDEN_PUBLIC_MATERIAL_LABELS.has(String(label || '').trim().toLowerCase());
}

export function cleanTextArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(v => String(v || '').trim()).filter(Boolean);
}

export function makeId(prefix = 'item') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeColour(c, index = 0, { stableIds = false } = {}) {
  const fallbackId = stableIds ? `colour_${index}` : makeId('colour');
  if (typeof c === 'string') {
    return { id: fallbackId, name: c, hex: '#cccccc', textureUrl: null, enabled: true, sortOrder: index };
  }
  const name = String(c?.name || c?.label || c?.hex || `Colour ${index + 1}`).trim();
  return {
    id: String(c?.id || fallbackId),
    name,
    hex: String(c?.hex || '#cccccc').trim(),
    textureUrl: c?.textureUrl || c?.texture_url || c?.imageUrl || null,
    enabled: c?.enabled !== false,
    sortOrder: Number.isFinite(Number(c?.sortOrder)) ? Number(c.sortOrder) : index,
  };
}

export function normalizeFinish(f, index = 0, { stableIds = false } = {}) {
  const fallbackId = stableIds ? `finish_${index}` : makeId('finish');
  if (typeof f === 'string') {
    return {
      id: fallbackId,
      name: f,
      layerHeight: '',
      description: '',
      priceMultiplier: 1,
      previewType: index === 0 ? 'standard' : 'fine',
      previewImageUrl: null,
      enabled: true,
      default: index === 0,
      sortOrder: index,
    };
  }
  return {
    id: String(f?.id || fallbackId),
    name: String(f?.name || `Finish ${index + 1}`).trim(),
    layerHeight: String(f?.layerHeight || f?.layer_height || '').trim(),
    description: String(f?.description || '').trim(),
    priceMultiplier: Number.isFinite(Number(f?.priceMultiplier ?? f?.price_multiplier))
      ? Number(f?.priceMultiplier ?? f?.price_multiplier)
      : 1,
    previewType: String(f?.previewType || f?.preview_type || (index === 0 ? 'standard' : 'fine')),
    previewImageUrl: f?.previewImageUrl || f?.preview_image_url || null,
    enabled: f?.enabled !== false,
    default: !!f?.default,
    sortOrder: Number.isFinite(Number(f?.sortOrder)) ? Number(f.sortOrder) : index,
  };
}

export function normalizeProperties(properties = {}) {
  const p = properties && typeof properties === 'object' ? { ...properties } : {};
  const rating = v => {
    if (v == null || v === '') return 3;
    const n = Number(v);
    if (!Number.isFinite(n)) return 3;
    return Math.max(1, Math.min(5, n > 5 ? Math.round(n / 20) : Math.round(n)));
  };
  const r = p.ratings && typeof p.ratings === 'object' ? p.ratings : {};
  p.ratings = {
    strength: rating(r.strength ?? p.strength),
    flexibility: rating(r.flexibility ?? p.flexibility),
    heatResistance: rating(r.heatResistance ?? r.heat ?? p.heat),
    detail: rating(r.detail ?? p.detail),
    outdoorUse: rating(r.outdoorUse ?? p.outdoor_use),
  };
  return p;
}

export function normalizeMaterialPayload(input = {}, existing = {}) {
  const rawProperties = input.properties !== undefined
    ? input.properties
    : safeJson(existing.properties, {});
  const properties = normalizeProperties(rawProperties);
  const colours = (input.colours !== undefined ? input.colours : safeJson(existing.colours, []))
    .map((c, i) => normalizeColour(c, i))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  let finishes = (input.finishes !== undefined ? input.finishes : safeJson(existing.finishes, []))
    .map((f, i) => normalizeFinish(f, i))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (finishes.length && !finishes.some(f => f.default && f.enabled !== false)) {
    finishes = finishes.map((f, i) => ({ ...f, default: i === 0 }));
  }
  const rawSpecs = input.specs !== undefined ? input.specs : safeJson(existing.specs, []);
  return {
    properties,
    colours,
    finishes,
    tags: cleanTextArray(input.tags !== undefined ? input.tags : safeJson(existing.tags, [])),
    best_for: cleanTextArray(input.best_for !== undefined ? input.best_for : safeJson(existing.best_for, [])),
    specs: Array.isArray(rawSpecs) ? rawSpecs : [],
  };
}

export function parseMaterialRow(row, { stableIds = false, publicOnly = false } = {}) {
  if (!row) return row;
  let colours = safeJson(row.colours, []).map((c, i) => normalizeColour(c, i, { stableIds }));
  let finishes = safeJson(row.finishes, []).map((f, i) => normalizeFinish(f, i, { stableIds }));
  if (publicOnly) {
    colours = colours.filter(c => c.enabled !== false);
    finishes = finishes.filter(f => f.enabled !== false);
  }
  colours.sort((a, b) => a.sortOrder - b.sortOrder);
  finishes.sort((a, b) => a.sortOrder - b.sortOrder);
  if (finishes.length && !finishes.some(f => f.default && f.enabled !== false)) {
    finishes = finishes.map((f, i) => ({ ...f, default: i === 0 }));
  }
  const tags = cleanTextArray(safeJson(row.tags, []));
  return {
    ...row,
    active: row.active == null ? row.active : !!row.active,
    recommended: !!row.recommended,
    tags: publicOnly ? tags.filter(isVisiblePublicMaterialLabel) : tags,
    best_for: cleanTextArray(safeJson(row.best_for, [])),
    specs: safeJson(row.specs, []),
    colours,
    finishes,
    volume_tiers: safeJson(row.volume_tiers, []),
    properties: normalizeProperties(safeJson(row.properties, {})),
  };
}

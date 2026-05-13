import { Router } from 'express';
import multer from 'multer';
import { mkdirSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { db, requireShopAuth } from '../middleware/auth.js';
import { MATERIAL_LIBRARY, findMaterialMatch } from '../lib/material-library.js';
import { aiLookupMaterial } from '../lib/material-ai.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype || '')) return cb(new Error('Only image uploads are supported'));
    cb(null, true);
  },
});

function safeJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function cleanTextArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(v => String(v || '').trim()).filter(Boolean);
}

function makeId(prefix = 'item') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeColour(c, index = 0) {
  if (typeof c === 'string') {
    return { id: makeId('colour'), name: c, hex: '#cccccc', textureUrl: null, enabled: true, sortOrder: index };
  }
  const name = String(c?.name || c?.label || c?.hex || `Colour ${index + 1}`).trim();
  return {
    id: String(c?.id || makeId('colour')),
    name,
    hex: String(c?.hex || '#cccccc').trim(),
    textureUrl: c?.textureUrl || c?.texture_url || c?.imageUrl || null,
    enabled: c?.enabled !== false,
    sortOrder: Number.isFinite(Number(c?.sortOrder)) ? Number(c.sortOrder) : index,
  };
}

function normalizeFinish(f, index = 0) {
  if (typeof f === 'string') {
    return {
      id: makeId('finish'),
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
    id: String(f?.id || makeId('finish')),
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

function normalizeProperties(properties = {}) {
  const p = properties && typeof properties === 'object' ? { ...properties } : {};
  const ratingFrom100 = v => {
    if (v == null || v === '') return 3;
    const n = Number(v);
    if (!Number.isFinite(n)) return 3;
    return Math.max(1, Math.min(5, n > 5 ? Math.round(n / 20) : Math.round(n)));
  };
  const ratings = p.ratings && typeof p.ratings === 'object' ? p.ratings : {};
  p.ratings = {
    strength: ratingFrom100(ratings.strength ?? p.strength),
    flexibility: ratingFrom100(ratings.flexibility ?? p.flexibility),
    heatResistance: ratingFrom100(ratings.heatResistance ?? ratings.heat ?? p.heat),
    detail: ratingFrom100(ratings.detail ?? p.detail),
    outdoorUse: ratingFrom100(ratings.outdoorUse ?? p.outdoor_use),
  };
  return p;
}

function normalizeMaterialPayload(input = {}, existing = {}) {
  const rawProperties = input.properties !== undefined
    ? input.properties
    : safeJson(existing.properties, {});
  const properties = normalizeProperties(rawProperties);
  const colours = (input.colours !== undefined ? input.colours : safeJson(existing.colours, []))
    .map(normalizeColour)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  let finishes = (input.finishes !== undefined ? input.finishes : safeJson(existing.finishes, []))
    .map(normalizeFinish)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (finishes.length && !finishes.some(f => f.default && f.enabled !== false)) {
    finishes = finishes.map((f, i) => ({ ...f, default: i === 0 }));
  }
  return {
    properties,
    colours,
    finishes,
    tags: cleanTextArray(input.tags !== undefined ? input.tags : safeJson(existing.tags, [])),
    best_for: cleanTextArray(input.best_for !== undefined ? input.best_for : safeJson(existing.best_for, [])),
    specs: Array.isArray(input.specs !== undefined ? input.specs : safeJson(existing.specs, []))
      ? (input.specs !== undefined ? input.specs : safeJson(existing.specs, []))
      : [],
  };
}

// ── Material library (curated reference data — used by the admin
//     panel's "Suggest from library" feature) ──────────────────
router.get('/library', requireShopAuth, (req, res) => {
  res.json({ materials: MATERIAL_LIBRARY });
});

// Optional server-side suggestion lookup — handy for scripting/tests
router.get('/library/suggest', requireShopAuth, (req, res) => {
  const { name } = req.query;
  const match = findMaterialMatch(name);
  if (!match) return res.status(404).json({ error: 'No close match found', query: name });
  res.json({ match, query: name, source: 'library' });
});

// ── AI material lookup — used as a fallback when the curated
//     library has no good match. Calls Anthropic Claude.
//     Returns 503 with a clear error if ANTHROPIC_API_KEY isn't set.
router.post('/library/ai-lookup', requireShopAuth, async (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Material name is required' });
  }
  try {
    const result = await aiLookupMaterial(name);
    res.json({ match: result, query: name, source: 'ai' });
  } catch (err) {
    if (err.code === 'NO_API_KEY') {
      return res.status(503).json({
        error: 'Internet AI lookup is disabled — set ANTHROPIC_API_KEY in the server .env to enable it.',
        code: 'NO_API_KEY',
      });
    }
    if (err.code === 'BAD_INPUT') {
      return res.status(400).json({ error: err.message, code: err.code });
    }
    if (err.code === 'BAD_JSON' || err.code === 'EMPTY') {
      return res.status(502).json({ error: err.message, code: err.code });
    }
    console.error('[ai-lookup] error:', err);
    return res.status(502).json({
      error: 'AI lookup failed: ' + (err.message || 'unknown error'),
      code:  err.code || 'API_ERROR',
    });
  }
});

function parseMaterialJSON(row) {
  if (!row) return row;
  return {
    ...row,
    active: !!row.active,
    recommended: !!row.recommended,
    colours: safeJson(row.colours, []).map(normalizeColour),
    finishes: safeJson(row.finishes, []).map(normalizeFinish),
    tags: cleanTextArray(safeJson(row.tags, [])),
    best_for: cleanTextArray(safeJson(row.best_for, [])),
    specs: safeJson(row.specs, []),
    volume_tiers: safeJson(row.volume_tiers, []),
    properties: normalizeProperties(safeJson(row.properties, '{}'))
  };
}

// GET /api/materials/
router.get('/', requireShopAuth, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM materials WHERE shop_id = ? ORDER BY sort_order, name'
  ).all(req.shop.id);

  res.json(rows.map(parseMaterialJSON));
});

// GET /api/materials/page-settings
router.get('/page-settings', requireShopAuth, (req, res) => {
  db.prepare('INSERT OR IGNORE INTO store_settings (shop_id) VALUES (?)').run(req.shop.id);
  const row = db.prepare('SELECT material_page_settings FROM store_settings WHERE shop_id = ?').get(req.shop.id) || {};
  res.json({
    heading: 'Choose your material',
    subtitle: 'Pick based on how your part will be used. You can view detailed specs if needed.',
    helperTitle: 'Not sure what to choose?',
    helperText: 'Start with the recommended material, or filter by what matters most.',
    continueLabel: 'Continue to Quote',
    emptyState: 'No materials are available right now.',
    ...(safeJson(row.material_page_settings, {}) || {}),
  });
});

// PATCH /api/materials/page-settings
router.patch('/page-settings', requireShopAuth, (req, res) => {
  const cur = db.prepare('SELECT material_page_settings FROM store_settings WHERE shop_id = ?').get(req.shop.id) || {};
  const next = {
    ...(safeJson(cur.material_page_settings, {}) || {}),
    ...req.body,
  };
  db.prepare('INSERT OR IGNORE INTO store_settings (shop_id) VALUES (?)').run(req.shop.id);
  db.prepare(`
    UPDATE store_settings
    SET material_page_settings = ?, updated_at = datetime('now')
    WHERE shop_id = ?
  `).run(JSON.stringify(next), req.shop.id);
  res.json(next);
});

// POST /api/materials/assets
router.post('/assets', requireShopAuth, upload.single('asset'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'asset is required' });
  const allowed = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg']);
  const ext = (extname(req.file.originalname || '') || '.png').toLowerCase();
  if (!allowed.has(ext)) return res.status(400).json({ error: 'Unsupported image type' });
  const dir = join(__dirname, '../../uploads/material-assets', String(req.shop.id));
  mkdirSync(dir, { recursive: true });
  const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const path = join(dir, name);
  writeFileSync(path, req.file.buffer);
  res.status(201).json({ url: `/uploads/material-assets/${req.shop.id}/${name}` });
});

// POST /api/materials/
router.post('/', requireShopAuth, (req, res) => {
  const {
    name,
    category = 'FDM',
    description_short = null,
    description_long = null,
    base_price = 0.18,
    min_charge = 4.50,
    pricing_model = 'per_cm3',
    colours = [],
    finishes = [],
    image_url = null,
    image_alt = null,
    price_unit = 'per cm³',
    recommended = 0,
    tags = [],
    best_for = [],
    specs = [],
    stock_status = 'in_stock',
    active = 1,
    volume_tiers = [],
    properties = {},
    sort_order = 0,
    production_days_min = null,
    production_days_max = null,
    min_x_mm = null, min_y_mm = null, min_z_mm = null,
    max_x_mm = null, max_y_mm = null, max_z_mm = null
  } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  // Helper — coerce "" / undefined / NaN to NULL, otherwise a number
  const numOrNull = v => {
    if (v == null || v === '') return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  const normalized = normalizeMaterialPayload({ colours, finishes, properties, tags, best_for, specs });

  const result = db.prepare(`
    INSERT INTO materials
      (shop_id, name, category, description_short, description_long,
       image_url, image_alt, price_unit, recommended, tags, best_for, specs,
       base_price, min_charge, pricing_model, colours, finishes,
       stock_status, active, volume_tiers, properties, sort_order,
       production_days_min, production_days_max,
       min_x_mm, min_y_mm, min_z_mm, max_x_mm, max_y_mm, max_z_mm)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?)
  `).run(
    req.shop.id,
    name,
    category,
    description_short,
    description_long,
    image_url || null,
    image_alt || null,
    price_unit || 'per cm³',
    recommended ? 1 : 0,
    JSON.stringify(normalized.tags),
    JSON.stringify(normalized.best_for),
    JSON.stringify(normalized.specs),
    base_price,
    min_charge,
    pricing_model,
    JSON.stringify(normalized.colours),
    JSON.stringify(normalized.finishes),
    stock_status,
    active ? 1 : 0,
    JSON.stringify(volume_tiers),
    JSON.stringify(normalized.properties),
    sort_order,
    production_days_min != null ? parseInt(production_days_min) : null,
    production_days_max != null ? parseInt(production_days_max) : null,
    numOrNull(min_x_mm), numOrNull(min_y_mm), numOrNull(min_z_mm),
    numOrNull(max_x_mm), numOrNull(max_y_mm), numOrNull(max_z_mm)
  );

  const created = db.prepare('SELECT * FROM materials WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(parseMaterialJSON(created));
});

// PATCH /api/materials/:id
router.patch('/:id', requireShopAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM materials WHERE id = ? AND shop_id = ?')
    .get(req.params.id, req.shop.id);

  if (!existing) {
    return res.status(404).json({ error: 'Material not found' });
  }

  const {
    name = existing.name,
    category = existing.category,
    description_short = existing.description_short,
    description_long = existing.description_long,
    base_price = existing.base_price,
    min_charge = existing.min_charge,
    pricing_model = existing.pricing_model,
    colours,
    finishes,
    image_url = existing.image_url,
    image_alt = existing.image_alt,
    price_unit = existing.price_unit,
    recommended = existing.recommended,
    tags,
    best_for,
    specs,
    stock_status = existing.stock_status,
    active = existing.active,
    volume_tiers,
    properties,
    sort_order = existing.sort_order,
    production_days_min = existing.production_days_min,
    production_days_max = existing.production_days_max,
    min_x_mm, min_y_mm, min_z_mm,
    max_x_mm, max_y_mm, max_z_mm
  } = req.body;

  const normalized = normalizeMaterialPayload({ colours, finishes, properties, tags, best_for, specs }, existing);
  const newColours = JSON.stringify(normalized.colours);
  const newFinishes = JSON.stringify(normalized.finishes);
  const newVolumeTiers = volume_tiers !== undefined ? JSON.stringify(volume_tiers) : existing.volume_tiers;
  const newProperties = JSON.stringify(normalized.properties);

  // Pass-through unless explicitly sent — empty string clears, undefined keeps
  const numField = (val, prev) => {
    if (val === undefined) return prev;       // not sent — keep existing
    if (val === null || val === '') return null;
    const n = parseFloat(val);
    return Number.isFinite(n) ? n : prev;
  };

  db.prepare(`
    UPDATE materials SET
      name = ?, category = ?, description_short = ?, description_long = ?,
      image_url = ?, image_alt = ?, price_unit = ?, recommended = ?,
      tags = ?, best_for = ?, specs = ?,
      base_price = ?, min_charge = ?, pricing_model = ?, colours = ?,
      finishes = ?, stock_status = ?, active = ?, volume_tiers = ?,
      properties = ?, sort_order = ?,
      production_days_min = ?, production_days_max = ?,
      min_x_mm = ?, min_y_mm = ?, min_z_mm = ?,
      max_x_mm = ?, max_y_mm = ?, max_z_mm = ?
    WHERE id = ? AND shop_id = ?
  `).run(
    name, category, description_short, description_long,
    image_url || null, image_alt || null, price_unit || 'per cm³', recommended ? 1 : 0,
    JSON.stringify(normalized.tags), JSON.stringify(normalized.best_for), JSON.stringify(normalized.specs),
    base_price, min_charge, pricing_model, newColours,
    newFinishes, stock_status, active ? 1 : 0, newVolumeTiers,
    newProperties, sort_order,
    production_days_min === null || production_days_min === '' ? null : parseInt(production_days_min),
    production_days_max === null || production_days_max === '' ? null : parseInt(production_days_max),
    numField(min_x_mm, existing.min_x_mm),
    numField(min_y_mm, existing.min_y_mm),
    numField(min_z_mm, existing.min_z_mm),
    numField(max_x_mm, existing.max_x_mm),
    numField(max_y_mm, existing.max_y_mm),
    numField(max_z_mm, existing.max_z_mm),
    req.params.id, req.shop.id
  );

  const updated = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  res.json(parseMaterialJSON(updated));
});

// DELETE /api/materials/:id
router.delete('/:id', requireShopAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM materials WHERE id = ? AND shop_id = ?')
    .get(req.params.id, req.shop.id);

  if (!existing) {
    return res.status(404).json({ error: 'Material not found' });
  }

  db.prepare('DELETE FROM materials WHERE id = ? AND shop_id = ?')
    .run(req.params.id, req.shop.id);

  res.json({ ok: true });
});

export default router;

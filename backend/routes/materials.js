import { Router } from 'express';
import { db, requireShopAuth } from '../middleware/auth.js';
import { MATERIAL_LIBRARY, findMaterialMatch } from '../lib/material-library.js';
import { aiLookupMaterial } from '../lib/material-ai.js';

const router = Router();

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
    colours: JSON.parse(row.colours || '[]'),
    finishes: JSON.parse(row.finishes || '[]'),
    volume_tiers: JSON.parse(row.volume_tiers || '[]'),
    properties: JSON.parse(row.properties || '{}')
  };
}

// GET /api/materials/
router.get('/', requireShopAuth, (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM materials WHERE shop_id = ? ORDER BY sort_order, name'
  ).all(req.shop.id);

  res.json(rows.map(parseMaterialJSON));
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

  const result = db.prepare(`
    INSERT INTO materials
      (shop_id, name, category, description_short, description_long,
       base_price, min_charge, pricing_model, colours, finishes,
       stock_status, active, volume_tiers, properties, sort_order,
       production_days_min, production_days_max,
       min_x_mm, min_y_mm, min_z_mm, max_x_mm, max_y_mm, max_z_mm)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?)
  `).run(
    req.shop.id,
    name,
    category,
    description_short,
    description_long,
    base_price,
    min_charge,
    pricing_model,
    JSON.stringify(colours),
    JSON.stringify(finishes),
    stock_status,
    active ? 1 : 0,
    JSON.stringify(volume_tiers),
    JSON.stringify(properties),
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

  const newColours = colours !== undefined ? JSON.stringify(colours) : existing.colours;
  const newFinishes = finishes !== undefined ? JSON.stringify(finishes) : existing.finishes;
  const newVolumeTiers = volume_tiers !== undefined ? JSON.stringify(volume_tiers) : existing.volume_tiers;
  const newProperties = properties !== undefined ? JSON.stringify(properties) : existing.properties;

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
      base_price = ?, min_charge = ?, pricing_model = ?, colours = ?,
      finishes = ?, stock_status = ?, active = ?, volume_tiers = ?,
      properties = ?, sort_order = ?,
      production_days_min = ?, production_days_max = ?,
      min_x_mm = ?, min_y_mm = ?, min_z_mm = ?,
      max_x_mm = ?, max_y_mm = ?, max_z_mm = ?
    WHERE id = ? AND shop_id = ?
  `).run(
    name, category, description_short, description_long,
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

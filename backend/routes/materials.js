import { Router } from 'express';
import multer from 'multer';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { db, requireShopAuth } from '../middleware/auth.js';
import { MATERIAL_LIBRARY, findMaterialMatch } from '../lib/material-library.js';
import { aiLookupMaterial } from '../lib/material-ai.js';
import {
  normalizeMaterialPayload,
  parseMaterialRow,
  safeJson,
} from '../lib/material-config.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMime = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
    if (!allowedMime.has(file.mimetype || '')) return cb(new Error('Only PNG, JPEG, WebP, or GIF uploads are supported'));
    cb(null, true);
  },
});

function verifiedImageExtension(file) {
  const buf = file.buffer;
  const mime = file.mimetype;
  if (mime === 'image/png' && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (mime === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (mime === 'image/gif' && (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a')) return '.gif';
  if (mime === 'image/webp' && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  return null;
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
  return parseMaterialRow(row);
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
  const ext = verifiedImageExtension(req.file);
  if (!ext) return res.status(400).json({ error: 'Uploaded image content did not match an allowed image type' });
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

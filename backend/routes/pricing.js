import { Router } from 'express';
import { db, requireShopAuth } from '../middleware/auth.js';
import { DEFAULT_GST } from '../config.js';
import { parseInfillTiers, sanitiseTierList } from '../lib/infill-tiers.js';

const router = Router();

function ensurePricingColumns() {
  const cols = db.prepare('PRAGMA table_info(pricing_config)').all().map(c => c.name);
  if (!cols.includes('max_model_quantity')) {
    db.exec('ALTER TABLE pricing_config ADD COLUMN max_model_quantity INTEGER;');
  }
}

function ensurePricingConfig(shopId) {
  ensurePricingColumns();
  const existing = db.prepare('SELECT * FROM pricing_config WHERE shop_id = ?').get(shopId);
  if (!existing) {
    db.prepare(`
      INSERT OR IGNORE INTO pricing_config (shop_id) VALUES (?)
    `).run(shopId);
    return db.prepare('SELECT * FROM pricing_config WHERE shop_id = ?').get(shopId);
  }
  return existing;
}

// GET /api/pricing/
router.get('/', requireShopAuth, (req, res) => {
  try {
    const config = ensurePricingConfig(req.shop.id);
    res.json({
      ...config,
      surcharges:   JSON.parse(config.surcharges || '[]'),
      infill_tiers: parseInfillTiers(config.infill_tiers),
    });
  } catch (err) {
    console.error('Get pricing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/pricing/
router.put('/', requireShopAuth, (req, res) => {
  try {
    const {
      currency, tax_rate, tax_inclusive, min_order_value,
      free_shipping_above, quote_rounding, quote_valid_hours, max_model_quantity,
      show_breakdown, surcharges,
      // Pricing scheme
      pricing_mode,
      mat_include_support,
      time_rate_per_hour, time_rate_per_gram, time_include_support,
      // Infill tier config (optional — falls back to existing value if absent)
      infill_tiers
    } = req.body;

    const prev = ensurePricingConfig(req.shop.id);

    const validModes = ['material', 'time_material'];
    const mode = validModes.includes(pricing_mode) ? pricing_mode : 'material';

    // Only update infill_tiers if explicitly sent. Otherwise keep the existing row.
    const nextInfillTiers = (infill_tiers !== undefined)
      ? JSON.stringify(sanitiseTierList(infill_tiers))
      : (prev.infill_tiers || null);

    db.prepare(`
      INSERT OR REPLACE INTO pricing_config
        (shop_id, currency, tax_rate, tax_inclusive, min_order_value,
         free_shipping_above, quote_rounding, quote_valid_hours, max_model_quantity,
         show_breakdown, surcharges,
         pricing_mode, mat_include_support,
         time_rate_per_hour, time_rate_per_gram, time_include_support,
         infill_tiers,
         updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      req.shop.id,
      currency || 'NZD',
      tax_rate ?? DEFAULT_GST,
      tax_inclusive ? 1 : 0,
      min_order_value ?? 0,
      free_shipping_above ?? 50,
      quote_rounding ?? 0.10,
      quote_valid_hours ?? 24,
      Number.isFinite(Number(max_model_quantity)) && Number(max_model_quantity) > 0 ? Math.floor(Number(max_model_quantity)) : null,
      show_breakdown ? 1 : 0,
      JSON.stringify(Array.isArray(surcharges) ? surcharges : []),
      mode,
      mat_include_support ? 1 : 0,
      parseFloat(time_rate_per_hour) || 0,
      parseFloat(time_rate_per_gram) || 0,
      time_include_support ? 1 : 0,
      nextInfillTiers
    );

    const updated = db.prepare('SELECT * FROM pricing_config WHERE shop_id = ?').get(req.shop.id);
    res.json({
      ...updated,
      surcharges:   JSON.parse(updated.surcharges || '[]'),
      infill_tiers: parseInfillTiers(updated.infill_tiers),
    });
  } catch (err) {
    console.error('Update pricing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Discount codes ─────────────────────────────────────────────

// GET /api/pricing/discounts
router.get('/discounts', requireShopAuth, (req, res) => {
  try {
    const codes = db.prepare(
      'SELECT * FROM discount_codes WHERE shop_id = ? ORDER BY created_at DESC'
    ).all(req.shop.id);
    res.json(codes);
  } catch (err) {
    console.error('List discounts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pricing/discounts
router.post('/discounts', requireShopAuth, (req, res) => {
  try {
    const { code, type, value, min_order, one_time, expires_at, active } = req.body;

    if (!code || !type) {
      return res.status(400).json({ error: 'Code and type are required' });
    }

    const validTypes = ['percent', 'fixed', 'free_shipping'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid discount type' });
    }

    const result = db.prepare(`
      INSERT INTO discount_codes
        (shop_id, code, type, value, min_order, one_time, expires_at, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.shop.id,
      code.trim().toUpperCase(),
      type,
      value ?? 0,
      min_order ?? 0,
      one_time ? 1 : 0,
      expires_at || null,
      active === false ? 0 : 1
    );

    const created = db.prepare('SELECT * FROM discount_codes WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(created);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'A discount with this code already exists' });
    }
    console.error('Create discount error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/pricing/discounts/:id
router.patch('/discounts/:id', requireShopAuth, (req, res) => {
  try {
    const existing = db.prepare(
      'SELECT * FROM discount_codes WHERE id = ? AND shop_id = ?'
    ).get(req.params.id, req.shop.id);

    if (!existing) {
      return res.status(404).json({ error: 'Discount not found' });
    }

    const { code, type, value, min_order, one_time, expires_at, active } = req.body;

    db.prepare(`
      UPDATE discount_codes
      SET code = ?, type = ?, value = ?, min_order = ?, one_time = ?,
          expires_at = ?, active = ?
      WHERE id = ? AND shop_id = ?
    `).run(
      (code || existing.code).trim().toUpperCase(),
      type || existing.type,
      value ?? existing.value,
      min_order ?? existing.min_order,
      one_time !== undefined ? (one_time ? 1 : 0) : existing.one_time,
      expires_at !== undefined ? expires_at : existing.expires_at,
      active !== undefined ? (active ? 1 : 0) : existing.active,
      req.params.id,
      req.shop.id
    );

    const updated = db.prepare('SELECT * FROM discount_codes WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('Update discount error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/pricing/discounts/:id
router.delete('/discounts/:id', requireShopAuth, (req, res) => {
  try {
    const existing = db.prepare(
      'SELECT * FROM discount_codes WHERE id = ? AND shop_id = ?'
    ).get(req.params.id, req.shop.id);

    if (!existing) {
      return res.status(404).json({ error: 'Discount not found' });
    }

    db.prepare('DELETE FROM discount_codes WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete discount error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/pricing/validate-discount  (public — customer checkout)
router.post('/validate-discount', (req, res) => {
  res.status(409).json({
    valid: false,
    code: 'DISCOUNTS_DEFERRED',
    error: 'Discount codes are not applied to live checkout in Pricing V1.',
  });
});

export default router;

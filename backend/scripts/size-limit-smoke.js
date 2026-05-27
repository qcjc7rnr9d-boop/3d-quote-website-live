import { DatabaseSync } from 'node:sqlite';
import { calculateQuoteForShopSlug, PricingError } from '../lib/pricing-engine.js';
import { parseInfillTiers } from '../lib/infill-tiers.js';

const db = new DatabaseSync('data/rfdewi.db');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(value, fallback = []) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function firstEnabled(list = []) {
  return list.find(item => item && item.enabled !== false && item.active !== false) || null;
}

let materialId = null;

try {
  const shop = db.prepare("SELECT * FROM shops WHERE slug = 'trennen'").get();
  assert(shop, 'Trennen shop is missing; run npm run demo:seed:trennen first');

  const reference = db.prepare(`
    SELECT *
    FROM materials
    WHERE shop_id = ? AND active = 1 AND json_array_length(colours) > 0 AND json_array_length(finishes) > 0
    ORDER BY id
    LIMIT 1
  `).get(shop.id);
  assert(reference, 'No active material with colours and finishes found');

  const inserted = db.prepare(`
    INSERT INTO materials (
      shop_id, name, description_short, description_long, category, colours, finishes,
      pricing_model, base_price, min_charge, volume_tiers, properties, active,
      stock_status, sort_order, max_x_mm, max_y_mm, max_z_mm, price_unit,
      recommended, tags, best_for, specs
    )
    VALUES (?, 'Launch Size Limit Smoke', 'Temporary size limit material', '', 'FDM', ?, ?,
      'per_cm3', 1, 1, '[]', '{}', 1, 'in_stock', 99999, 100, 100, 50, 'per cm³',
      0, '[]', '[]', '[]')
  `).run(shop.id, reference.colours, reference.finishes);
  materialId = inserted.lastInsertRowid;

  const colour = firstEnabled(parseJson(reference.colours));
  const finish = firstEnabled(parseJson(reference.finishes));
  const pricing = db.prepare('SELECT infill_tiers FROM pricing_config WHERE shop_id = ?').get(shop.id) || {};
  const infill = firstEnabled(parseInfillTiers(pricing.infill_tiers));
  const settings = db.prepare('SELECT shipping_zones FROM store_settings WHERE shop_id = ?').get(shop.id) || {};
  const shipping = firstEnabled(parseJson(settings.shipping_zones));
  assert(colour?.id, 'reference material needs a colour');
  assert(finish?.id, 'reference material needs a finish');
  assert(infill?.id, 'pricing config needs an infill tier');
  assert(shipping?.id, 'store settings need a shipping option');

  const validPayload = {
    materialId,
    colourId: colour.id,
    finishId: finish.id,
    infillTierId: infill.id,
    shippingId: shipping.id,
    volumeCm3: 8,
    dimensions: { xMm: 80, yMm: 80, zMm: 40 },
    quantity: 1,
  };
  const valid = calculateQuoteForShopSlug(db, shop.slug, validPayload);
  assert(valid.totalCents > 0, 'compatible size-limited quote should calculate');

  try {
    calculateQuoteForShopSlug(db, shop.slug, {
      ...validPayload,
      dimensions: { xMm: 80, yMm: 80, zMm: 51 },
    });
    throw new Error('oversized model was accepted');
  } catch (err) {
    assert(err instanceof PricingError, 'oversized model should throw PricingError');
    assert(err.code === 'MODEL_TOO_LARGE', `oversized model returned ${err.code}`);
  }

  try {
    calculateQuoteForShopSlug(db, shop.slug, { ...validPayload, dimensions: null });
    throw new Error('missing dimensions were accepted for a size-limited material');
  } catch (err) {
    assert(err instanceof PricingError, 'missing dimensions should throw PricingError');
    assert(err.code === 'MODEL_DIMENSIONS_REQUIRED', `missing dimensions returned ${err.code}`);
  }

  console.log('Size-limit smoke checks passed.');
} finally {
  if (materialId) {
    try { db.prepare('DELETE FROM materials WHERE id = ?').run(materialId); } catch {}
  }
  db.close();
}

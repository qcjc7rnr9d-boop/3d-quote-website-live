import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { calculateQuoteForShopSlug, PricingError } from '../lib/pricing-engine.js';
import { parseInfillTiers } from '../lib/infill-tiers.js';

const db = new DatabaseSync('data/rfdewi.db');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(value, fallback = null) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

try {
  const schema = readFileSync('db/schema.sql', 'utf8');
  const quoteHtml = readFileSync('../quote.html', 'utf8');
  const checkoutHtml = readFileSync('../checkout.html', 'utf8');
  const checkoutJs = readFileSync('../assets/checkout.js', 'utf8');
  const customerDashboard = readFileSync('../customer/dashboard.html', 'utf8');

  assert(schema.includes('CREATE TABLE IF NOT EXISTS order_files'), 'schema must define order_files');
  assert(schema.includes('CREATE TABLE IF NOT EXISTS order_items'), 'schema must define order_items');
  assert(quoteHtml.includes('multiple'), 'quote upload input must allow multiple files');
  assert(quoteHtml.includes('MAX_MODELS_PER_GROUP = 20'), 'quote page must cap uploads at 20 models per group');
  assert(quoteHtml.includes('modelFiles'), 'quote page must track modelFiles');
  assert(quoteHtml.includes('modelList'), 'quote page must render a compact model list');
  assert(quoteHtml.includes('previewModelId'), 'quote page must persist the selected preview model');
  assert(quoteHtml.includes('previewModelById'), 'quote page must support clickable model preview selection');
  assert(quoteHtml.includes('model:${id}'), 'quote page must store per-model preview buffers');
  assert(quoteHtml.includes('normaliseCart'), 'quote page must normalise multi-line carts');
  assert(quoteHtml.includes('addAnotherBtn'), 'quote page must expose add-another-group action');
  assert(checkoutHtml.includes('cartItemsReview'), 'checkout must include grouped cart item review');
  assert(checkoutHtml.includes('cart-item-files'), 'checkout must include grouped file list styling');
  assert(checkoutJs.includes('cartModels'), 'checkout script must render bundled model files');
  assert(checkoutJs.includes('normaliseCart'), 'checkout script must support multi-line cart shape');
  assert(checkoutJs.includes('Group total'), 'checkout must show grouped totals for every material group');
  assert(checkoutJs.includes('modelVolumeText'), 'checkout must show model volume when available');
  assert(customerDashboard.includes('quoteFilesMarkup'), 'customer dashboard must show saved quote files');

  const shop = db.prepare("SELECT id FROM shops WHERE slug = 'mahi3d'").get();
  assert(shop, 'Mahi3D shop is missing; run npm run demo:seed:mahi3d first');
  const material = db.prepare(`
    SELECT id, name, colours, finishes
    FROM materials
    WHERE shop_id = ? AND active = 1 AND name = 'PETG'
  `).get(shop.id);
  assert(material, 'PETG material is missing');
  const colour = (parseJson(material.colours, []) || []).find(c => c.enabled !== false);
  const finish = (parseJson(material.finishes, []) || []).find(f => f.enabled !== false);
  const pricingRows = db.prepare('SELECT infill_tiers FROM pricing_config WHERE shop_id = ?').get(shop.id) || {};
  const infill = parseInfillTiers(pricingRows.infill_tiers).find(t => t.active !== false);
  const shippingRows = db.prepare('SELECT shipping_zones FROM store_settings WHERE shop_id = ?').get(shop.id) || {};
  const shipping = (parseJson(shippingRows.shipping_zones, []) || []).find(s => s.active !== false);
  assert(infill?.id, 'Mahi3D infill tier is missing');
  assert(shipping?.id, 'Mahi3D shipping option is missing');

  const single = calculateQuoteForShopSlug(db, 'mahi3d', {
    materialId: material.id,
    volumeCm3: 10,
    dimensions: { xMm: 20, yMm: 20, zMm: 20 },
    colourId: colour?.id,
    finishId: finish?.id,
    infillTierId: infill?.id,
    quantity: 1,
    shippingId: shipping?.id,
  });

  const bundle = calculateQuoteForShopSlug(db, 'mahi3d', {
    materialId: material.id,
    models: [
      { name: 'Bracket.stl', size: 1024, volumeCm3: 4, quantity: 3, dimensions: { xMm: 20, yMm: 12, zMm: 8 } },
      { name: 'Clip.obj', size: 2048, volumeCm3: 6, quantity: 2, dimensions: { xMm: 15, yMm: 14, zMm: 7 } },
    ],
    colourId: colour?.id,
    finishId: finish?.id,
    infillTierId: infill?.id,
    quantity: 999,
    shippingId: shipping?.id,
  });

  assert(bundle.selected.models?.length === 2, 'bundle quote must return selected.models');
  assert(bundle.selected.quantity === 1, 'bundle quote must force quantity to 1');
  assert(bundle.selected.models[0].quantity === 3, 'bundle quote must preserve first model quantity');
  assert(bundle.selected.models[1].quantity === 2, 'bundle quote must preserve second model quantity');
  assert(bundle.selected.volumeCm3 === 24, `bundle volume should be weighted to 24, got ${bundle.selected.volumeCm3}`);
  assert(bundle.lineItems.itemSubtotal > single.lineItems.itemSubtotal, 'bundle should price by quantity-weighted summed volume');

  const oneEachBundle = calculateQuoteForShopSlug(db, 'mahi3d', {
    materialId: material.id,
    models: [
      { name: 'Small A.stl', size: 1024, volumeCm3: 1, quantity: 1, dimensions: { xMm: 10, yMm: 10, zMm: 5 } },
      { name: 'Small B.stl', size: 1024, volumeCm3: 1, quantity: 1, dimensions: { xMm: 10, yMm: 10, zMm: 5 } },
    ],
    colourId: colour?.id,
    finishId: finish?.id,
    infillTierId: infill?.id,
    shippingId: shipping?.id,
  });
  const copiedBundle = calculateQuoteForShopSlug(db, 'mahi3d', {
    materialId: material.id,
    models: [
      { name: 'Small A.stl', size: 1024, volumeCm3: 1, quantity: 2, dimensions: { xMm: 10, yMm: 10, zMm: 5 } },
      { name: 'Small B.stl', size: 1024, volumeCm3: 1, quantity: 1, dimensions: { xMm: 10, yMm: 10, zMm: 5 } },
    ],
    colourId: colour?.id,
    finishId: finish?.id,
    infillTierId: infill?.id,
    shippingId: shipping?.id,
  });
  assert(copiedBundle.lineItems.itemSubtotal > oneEachBundle.lineItems.itemSubtotal, 'increasing a model quantity must increase the final item subtotal');

  try {
    calculateQuoteForShopSlug(db, 'mahi3d', {
      materialId: material.id,
      models: Array.from({ length: 21 }, (_, index) => ({
        name: `Extra ${index + 1}.stl`,
        size: 512,
        volumeCm3: 1,
        dimensions: { xMm: 10, yMm: 10, zMm: 10 },
      })),
      colourId: colour?.id,
      finishId: finish?.id,
      infillTierId: infill?.id,
      shippingId: shipping?.id,
    });
    throw new Error('oversized model bundle was accepted');
  } catch (err) {
    assert(err instanceof PricingError, 'too-many-models bundle should throw PricingError');
    assert(err.code === 'TOO_MANY_MODELS', `expected TOO_MANY_MODELS, got ${err.code}`);
  }

  const currentPricing = db.prepare('SELECT max_model_quantity FROM pricing_config WHERE shop_id = ?').get(shop.id) || {};
  db.prepare('INSERT OR IGNORE INTO pricing_config (shop_id) VALUES (?)').run(shop.id);
  db.prepare('UPDATE pricing_config SET max_model_quantity = 2 WHERE shop_id = ?').run(shop.id);
  try {
    calculateQuoteForShopSlug(db, 'mahi3d', {
      materialId: material.id,
      models: [
        { name: 'Too Many Copies.stl', size: 100, volumeCm3: 1, quantity: 3, dimensions: { xMm: 5, yMm: 5, zMm: 5 } },
        { name: 'Allowed Copy.stl', size: 100, volumeCm3: 1, quantity: 1, dimensions: { xMm: 5, yMm: 5, zMm: 5 } },
      ],
      colourId: colour?.id,
      finishId: finish?.id,
      infillTierId: infill?.id,
      shippingId: shipping?.id,
    });
    throw new Error('over-limit per-model quantity was accepted');
  } catch (err) {
    assert(err instanceof PricingError, 'over-limit per-model quantity should throw PricingError');
    assert(err.code === 'MODEL_QUANTITY_TOO_HIGH', `expected MODEL_QUANTITY_TOO_HIGH, got ${err.code}`);
  } finally {
    db.prepare('UPDATE pricing_config SET max_model_quantity = ? WHERE shop_id = ?').run(currentPricing.max_model_quantity ?? null, shop.id);
  }

  const tempMaterial = db.prepare(`
    INSERT INTO materials (shop_id, name, active, base_price, max_x_mm, max_y_mm, max_z_mm, colours, finishes)
    VALUES (?, 'Bundle Smoke Limit', 1, 1, 30, 30, 10, ?, ?)
  `).run(shop.id, material.colours, material.finishes).lastInsertRowid;
  try {
    calculateQuoteForShopSlug(db, 'mahi3d', {
      materialId: tempMaterial,
      models: [
        { name: 'Too Tall.stl', size: 100, volumeCm3: 1, dimensions: { xMm: 5, yMm: 5, zMm: 25 } },
      ],
      colourId: colour?.id,
      finishId: finish?.id,
      infillTierId: infill?.id,
      shippingId: shipping?.id,
    });
    throw new Error('oversized bundle model was accepted');
  } catch (err) {
    assert(err instanceof PricingError, 'oversized bundle should throw PricingError');
    assert(err.code === 'MODEL_TOO_LARGE', `expected MODEL_TOO_LARGE, got ${err.code}`);
    assert(err.message.includes('Too Tall.stl'), 'oversized error should name the failing model');
  } finally {
    db.prepare('DELETE FROM materials WHERE id = ?').run(tempMaterial);
  }

  console.log('Multi-model smoke checks passed.');
} finally {
  db.close();
}

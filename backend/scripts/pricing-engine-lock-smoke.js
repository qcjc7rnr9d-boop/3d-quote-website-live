import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  LIVE_PRICING_SCHEME,
  PricingError,
  calculateQuoteForShopSlug,
  grossUpForIncludedPlatformFee,
  toCents,
} from '../lib/pricing-engine.js';
import { previewCartForShop, validateCartForShop } from '../lib/cart.js';

function makeDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE shops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'community'
    );
    CREATE TABLE materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      description_short TEXT,
      category TEXT NOT NULL DEFAULT 'FDM',
      colours TEXT NOT NULL DEFAULT '[]',
      finishes TEXT NOT NULL DEFAULT '[]',
      image_url TEXT,
      image_alt TEXT,
      price_unit TEXT NOT NULL DEFAULT 'per cm³',
      recommended INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      best_for TEXT NOT NULL DEFAULT '[]',
      specs TEXT NOT NULL DEFAULT '[]',
      pricing_model TEXT NOT NULL DEFAULT 'per_cm3',
      base_price REAL NOT NULL DEFAULT 0,
      min_charge REAL NOT NULL DEFAULT 0,
      volume_tiers TEXT NOT NULL DEFAULT '[]',
      properties TEXT NOT NULL DEFAULT '{}',
      max_x_mm REAL,
      max_y_mm REAL,
      max_z_mm REAL,
      active INTEGER NOT NULL DEFAULT 1,
      stock_status TEXT NOT NULL DEFAULT 'in_stock',
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE pricing_config (
      shop_id INTEGER PRIMARY KEY,
      currency TEXT DEFAULT 'NZD',
      tax_rate REAL DEFAULT 0,
      tax_inclusive INTEGER DEFAULT 0,
      min_order_value REAL DEFAULT 0,
      free_shipping_above REAL DEFAULT 0,
      quote_rounding REAL DEFAULT 0,
      quote_valid_hours INTEGER DEFAULT 24,
      max_model_quantity INTEGER,
      show_breakdown INTEGER DEFAULT 0,
      surcharges TEXT DEFAULT '[]',
      pricing_mode TEXT DEFAULT 'material',
      mat_include_support INTEGER DEFAULT 0,
      time_rate_per_hour REAL DEFAULT 0,
      time_rate_per_gram REAL DEFAULT 0,
      time_include_support INTEGER DEFAULT 0,
      infill_tiers TEXT DEFAULT '[]'
    );
    CREATE TABLE store_settings (
      shop_id INTEGER PRIMARY KEY,
      shipping_zones TEXT DEFAULT '[]'
    );
    CREATE TABLE platform_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      platform_fee_percent REAL NOT NULL DEFAULT 5
    );
  `);

  const colours = JSON.stringify([{ id: 'grey', name: 'Grey', hex: '#999999', enabled: true }]);
  const finishes = JSON.stringify([
    { id: 'standard', name: 'Standard', layerHeight: '0.20 mm', priceMultiplier: 1, enabled: true, default: true },
    { id: 'fine', name: 'Fine', layerHeight: '0.12 mm', priceMultiplier: 1.5, enabled: true },
  ]);
  const infill = JSON.stringify([
    { id: 'light', label: 'Light', percent: 10, multiplier: 1, active: true, is_default: true },
    { id: 'strong', label: 'Strong', percent: 50, multiplier: 1.2, active: true },
  ]);
  const shipping = JSON.stringify([
    { id: 'pickup', courier: 'Trennen', service: 'Pickup', price: 0, active: true },
    { id: 'courier', courier: 'Courier', service: 'Tracked', price: 10, active: true },
  ]);

  db.prepare(`
    INSERT INTO shops (id, name, slug, email, password_hash, plan)
    VALUES (1, 'Pricing Test', 'pricing-test', 'owner@example.test', 'hash', 'community')
  `).run();
  db.prepare('INSERT INTO platform_settings (id, platform_fee_percent) VALUES (1, 5)').run();
  db.prepare(`
    INSERT INTO pricing_config
      (shop_id, currency, tax_rate, tax_inclusive, min_order_value, free_shipping_above,
       quote_rounding, max_model_quantity, surcharges, pricing_mode, mat_include_support,
       time_rate_per_hour, time_rate_per_gram, time_include_support, infill_tiers)
    VALUES (1, 'NZD', 0.15, 0, 0, 50, 0.05, 10, '[{"label":"Ignored","amount":999}]',
            'time_material', 1, 999, 999, 1, ?)
  `).run(infill);
  db.prepare('INSERT INTO store_settings (shop_id, shipping_zones) VALUES (1, ?)').run(shipping);
  db.prepare(`
    INSERT INTO materials
      (shop_id, name, category, colours, finishes, base_price, min_charge, volume_tiers, properties,
       max_x_mm, max_y_mm, max_z_mm, active)
    VALUES
      (1, 'Locked PLA', 'FDM', ?, ?, 2, 5,
       '[{"from_cm3":20,"price_per_cm3":1.5},{"from_cm3":50,"price_per_cm3":1}]',
       '{"density_g_cm3":1.25}', 300, 300, 300, 1),
      (1, 'PVA Support', 'FDM', ?, ?, 3, 6, '[]', '{"density_g_cm3":1.19}', 200, 200, 200, 1)
  `).run(colours, finishes, colours, finishes);
  return db;
}

function customerCentsFromSellerNet(amount, feePercent = 5) {
  return grossUpForIncludedPlatformFee(toCents(amount), feePercent).customerTotalCents;
}

function quotePayload(overrides = {}) {
  return {
    materialName: 'Locked PLA',
    volumeCm3: 10,
    dimensions: { xMm: 10, yMm: 10, zMm: 10 },
    colourId: 'grey',
    finishId: 'fine',
    infillTierId: 'strong',
    quantity: 2,
    shippingId: 'pickup',
    ...overrides,
  };
}

const db = makeDb();
try {
  assert.equal(LIVE_PRICING_SCHEME.id, 'pricing-v1-per-volume');
  assert.equal(LIVE_PRICING_SCHEME.adminPricingMode, 'material');
  assert.equal(Object.isFrozen(LIVE_PRICING_SCHEME), true, 'live pricing scheme descriptor must be frozen');

  const single = calculateQuoteForShopSlug(db, 'pricing-test', quotePayload());
  assert.equal(single.pricingVersion, LIVE_PRICING_SCHEME.id);
  assert.equal(single.selected.volumeCm3, 10);
  assert.equal(single.lineItems.ratePerCm3, 2);
  assert.equal(single.lineItems.finishMultiplier, 1.5);
  assert.equal(single.lineItems.infillMultiplier, 1.2);
  assert.equal(single.lineItems.unit, 36);
  assert.equal(single.lineItems.itemSubtotal, 72);
  assert.equal(single.lineItems.tax, 10.8);
  assert.equal(single.lineItems.sellerNetTotalCents, 8280);
  assert.equal(single.totalCents, customerCentsFromSellerNet(82.8));

  const paidShippingQuote = calculateQuoteForShopSlug(db, 'pricing-test', quotePayload({ shippingId: 'courier' }));
  assert.equal(paidShippingQuote.selected.shipping?.freeApplied, false, 'legacy quote pricing must not silently apply free shipping thresholds');
  assert.equal(paidShippingQuote.lineItems.shipping, 10, 'legacy quote pricing must charge the selected shipping rate exactly');

  for (let i = 0; i < 5; i += 1) {
    const repeated = calculateQuoteForShopSlug(db, 'pricing-test', quotePayload());
    assert.deepEqual(repeated.lineItems, single.lineItems, 'identical quote input must produce identical line items');
    assert.deepEqual(repeated.selected, single.selected, 'identical quote input must produce identical selected output');
    assert.equal(repeated.totalCents, single.totalCents, 'identical quote input must produce identical cents');
  }

  const supportMaterial = calculateQuoteForShopSlug(db, 'pricing-test', quotePayload({
    materialName: 'PVA Support',
    volumeCm3: 4,
    quantity: 1,
    finishId: 'standard',
    infillTierId: 'light',
  }));
  assert.equal(supportMaterial.lineItems.unit, 12, 'support filament materials are quoted through the same locked formula');
  assert.equal(supportMaterial.lineItems.itemSubtotal, 12);
  assert.equal(supportMaterial.totalCents, customerCentsFromSellerNet(13.8));

  const bundle = calculateQuoteForShopSlug(db, 'pricing-test', quotePayload({
    models: [
      { id: 'small', name: 'Small part.stl', size: 100, volumeCm3: 1, quantity: 3, dimensions: { xMm: 10, yMm: 10, zMm: 10 } },
      { id: 'large', name: 'Large part.stl', size: 200, volumeCm3: 10, quantity: 1, dimensions: { xMm: 30, yMm: 20, zMm: 10 } },
    ],
    quantity: 999,
    finishId: 'standard',
    infillTierId: 'light',
  }));
  assert.equal(bundle.selected.quantity, 1, 'multi-model group quantity is fixed at group level');
  assert.equal(bundle.selected.volumeCm3, 13);
  assert.deepEqual(bundle.lineItems.models.map(item => [item.id, item.unit, item.quantity, item.subtotal]), [
    ['small', 5, 3, 15],
    ['large', 20, 1, 20],
  ]);
  assert.equal(bundle.lineItems.itemSubtotal, 35, 'minimum charge applies per copied model in a bundle');
  assert.equal(bundle.totalCents, customerCentsFromSellerNet(40.25));

  const tiered = calculateQuoteForShopSlug(db, 'pricing-test', quotePayload({
    volumeCm3: 55,
    quantity: 1,
    finishId: 'standard',
    infillTierId: 'light',
  }));
  assert.equal(tiered.lineItems.ratePerCm3, 1, 'volume tiers use the highest matching threshold');
  assert.equal(tiered.lineItems.unit, 55);

  assert.throws(
    () => calculateQuoteForShopSlug(db, 'pricing-test', quotePayload({ shippingId: undefined })),
    err => err instanceof PricingError && err.code === 'SHIPPING_REQUIRED'
  );
  const preview = calculateQuoteForShopSlug(db, 'pricing-test', quotePayload({
    shippingId: undefined,
    previewWithoutShipping: true,
  }));
  assert.equal(preview.selected.shipping, null);
  assert.equal(preview.lineItems.shipping, 0);

  const shop = db.prepare("SELECT * FROM shops WHERE slug = 'pricing-test'").get();
  const cartPreview = previewCartForShop(db, shop, {
    shopSlug: 'pricing-test',
    items: [
      { materialName: 'Locked PLA', file: { models: [{ name: 'A.stl', volumeCm3: 10, quantity: 1, dimensions: { xMm: 10, yMm: 10, zMm: 10 } }] }, colorId: 'grey', finishId: 'standard', infillTierId: 'light' },
      { materialName: 'Locked PLA', file: { models: [{ name: 'B.stl', volumeCm3: 20, quantity: 1, dimensions: { xMm: 20, yMm: 10, zMm: 10 } }] }, colorId: 'grey', finishId: 'standard', infillTierId: 'light' },
    ],
  });
  assert.equal(cartPreview.checkoutReady, false);
  assert.equal(cartPreview.shippingOptions.length, 2);
  assert.throws(
    () => validateCartForShop(db, shop, cartPreview),
    err => err instanceof PricingError && err.code === 'SHIPPING_REQUIRED'
  );
  const cartWithShipping = validateCartForShop(db, shop, { ...cartPreview, shipping: { id: 'courier' } });
  assert.equal(cartWithShipping.checkoutReady, true);
  assert.equal(cartWithShipping.shipping?.id, 'courier');
  assert.equal(cartWithShipping.shipping?.freeApplied, false, 'checkout must not silently apply free shipping thresholds');
  assert.equal(cartWithShipping.shippingNzd, 10);
  assert.equal(cartWithShipping.totalCents, cartPreview.totalCents + 1000);

  console.log('Pricing engine lock smoke checks passed.');
} finally {
  db.close();
}

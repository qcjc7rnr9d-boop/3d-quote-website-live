import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DEMO_LEGACY_SHOP_SLUG, DEMO_SHOP_SLUG } from './seed-mahi3d-demo.js';
import { reconcileTrennenDemoBranding } from './reconcile-trennen-demo-branding.js';
import { getShopBySlug, normaliseShopSlug } from '../lib/shop-lookup.js';

if (process.env.NODE_ENV !== 'production') {
  reconcileTrennenDemoBranding({ backup: false });
}

const db = new DatabaseSync(join(import.meta.dirname, '..', 'data', 'rfdewi.db'));
const legacyOnlyDb = new DatabaseSync(':memory:');
const root = resolve(import.meta.dirname, '../..');

let failures = 0;

function expect(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`✕ ${message}`);
    return;
  }
  console.log(`✓ ${message}`);
}

try {
  expect(normaliseShopSlug(DEMO_SHOP_SLUG) === DEMO_SHOP_SLUG, 'canonical slug stays canonical');
  expect(normaliseShopSlug(DEMO_LEGACY_SHOP_SLUG) === DEMO_SHOP_SLUG, 'legacy slug maps to canonical slug');

  legacyOnlyDb.exec(`
    CREATE TABLE shops (
      id INTEGER PRIMARY KEY,
      name TEXT,
      slug TEXT,
      plan TEXT
    )
  `);
  legacyOnlyDb.prepare('INSERT INTO shops (id, name, slug, plan) VALUES (1, ?, ?, ?)')
    .run('Trennen', DEMO_LEGACY_SHOP_SLUG, 'starter');
  const fallbackCanonical = getShopBySlug(legacyOnlyDb, DEMO_SHOP_SLUG);
  const fallbackLegacy = getShopBySlug(legacyOnlyDb, DEMO_LEGACY_SHOP_SLUG);
  expect(fallbackCanonical?.slug === DEMO_SHOP_SLUG, 'canonical slug resolves against a legacy-only live row');
  expect(fallbackLegacy?.slug === DEMO_SHOP_SLUG, 'legacy slug resolves against a legacy-only live row');
  expect(fallbackCanonical?.id === fallbackLegacy?.id, 'legacy-only fallback still resolves one shop row');

  const canonical = getShopBySlug(db, DEMO_SHOP_SLUG);
  const legacy = getShopBySlug(db, DEMO_LEGACY_SHOP_SLUG);

  expect(Boolean(canonical), 'canonical Trennen demo shop exists');
  expect(Boolean(legacy), 'legacy Mahi3D alias resolves');
  expect(canonical?.id === legacy?.id, 'legacy alias resolves to the canonical shop row');
  expect(legacy?.slug === DEMO_SHOP_SLUG, 'legacy alias returns canonical slug');
  expect(legacy?.name === 'Trennen', 'legacy alias returns Trennen branding');

  if (canonical) {
    const settings = db.prepare(`
      SELECT support_email_mode, support_email, logo_url, about, shipping_zones
      FROM store_settings
      WHERE shop_id = ?
    `).get(canonical.id) || {};
    expect(settings.support_email_mode === 'custom', 'Trennen demo uses custom support email mode');
    expect(settings.support_email === 'support@trennen.co.nz', 'Trennen demo uses Trennen support email');
    expect(!String(settings.logo_url || '').toLowerCase().includes('mahi3d'), 'Trennen demo does not use a Mahi3D logo URL');
    expect(!String(settings.about || '').includes('Mahi3D'), 'Trennen demo about copy does not mention Mahi3D');
    expect(!String(settings.shipping_zones || '').includes('Mahi3D'), 'Trennen demo shipping labels do not mention Mahi3D');
    const pricing = db.prepare('SELECT free_shipping_above FROM pricing_config WHERE shop_id = ?').get(canonical.id) || {};
    expect(Number(pricing.free_shipping_above || 0) === 0, 'Trennen demo has no silent free-shipping threshold');
  }

  const quoteHtml = readFileSync(join(root, 'quote.html'), 'utf8');
  const checkoutHtml = readFileSync(join(root, 'checkout.html'), 'utf8');
  expect(!quoteHtml.includes('shop=mahi3d'), 'quote page static fallback links use canonical Trennen slug');
  expect(!checkoutHtml.includes('shop=mahi3d'), 'checkout page static fallback links use canonical Trennen slug');
} finally {
  db.close();
  legacyOnlyDb.close();
}

if (failures) process.exit(1);
console.log('Trennen demo alias smoke checks passed.');

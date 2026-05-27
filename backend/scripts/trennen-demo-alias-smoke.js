import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { DEMO_LEGACY_SHOP_SLUG, DEMO_SHOP_SLUG } from './seed-mahi3d-demo.js';
import { getShopBySlug, normaliseShopSlug } from '../lib/shop-lookup.js';

const db = new DatabaseSync(join(import.meta.dirname, '..', 'data', 'rfdewi.db'));
const legacyOnlyDb = new DatabaseSync(':memory:');

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
} finally {
  db.close();
  legacyOnlyDb.close();
}

if (failures) process.exit(1);
console.log('Trennen demo alias smoke checks passed.');

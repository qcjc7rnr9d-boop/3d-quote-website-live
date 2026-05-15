import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { normaliseCart, validateCartForShop } from '../lib/cart.js';

const db = new DatabaseSync('data/rfdewi.db');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(value, fallback = null) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

try {
  const checkoutJs = readFileSync('../assets/checkout.js', 'utf8');
  const quoteHtml = readFileSync('../quote.html', 'utf8');
  assert(checkoutJs.includes('orderData: cart'), 'checkout must submit the full cart to Stripe');
  assert(quoteHtml.includes('cart.items.push(cartItem)'), 'quote page must append cart items instead of replacing cart');
  assert(quoteHtml.includes("localStorage.removeItem('form_file')"), 'add-another flow must clear active form_file only');
  assert(!quoteHtml.includes("localStorage.removeItem('cart')"), 'add-another flow must not clear cart');
  assert(quoteHtml.includes('index.html?shop='), 'add-another flow must return to the home upload prompt');
  assert(quoteHtml.includes('&newGroup=1&promptUpload=1'), 'add-another flow must preserve prompt params');

  const shop = db.prepare("SELECT * FROM shops WHERE slug = 'mahi3d'").get();
  assert(shop, 'Mahi3D shop is missing; run npm run demo:seed:mahi3d first');
  const materials = db.prepare(`
    SELECT id, name, colours, finishes
    FROM materials
    WHERE shop_id = ? AND active = 1 AND name IN ('PETG', 'ASA')
    ORDER BY name
  `).all(shop.id);
  assert(materials.length >= 2, 'PETG and ASA demo materials are required for cart smoke');

  const itemFor = (material, name, volumeCm3) => {
    const colour = (parseJson(material.colours, []) || []).find(c => c.enabled !== false);
    const finish = (parseJson(material.finishes, []) || []).find(f => f.enabled !== false);
    return {
      id: `smoke-${material.name}`,
      shopSlug: shop.slug,
      materialId: material.id,
      colorId: colour?.id,
      finishId: finish?.id,
      quantity: 1,
      file: {
        name,
        size: 2048,
        volumeCm3,
        dimensions: { xMm: 20, yMm: 20, zMm: 12 },
        models: [{ name, size: 2048, volumeCm3, quantity: 2, dimensions: { xMm: 20, yMm: 20, zMm: 12 } }],
      },
      models: [{ name, size: 2048, volumeCm3, quantity: 2, dimensions: { xMm: 20, yMm: 20, zMm: 12 } }],
    };
  };

  const cart = normaliseCart({
    shopSlug: shop.slug,
    items: [
      itemFor(materials[0], 'Outdoor bracket.stl', 4),
      itemFor(materials[1], 'Sensor cover.stl', 6),
    ],
  }, shop.slug);

  assert(cart.items.length === 2, 'normalised cart must keep two material groups');
  const validated = validateCartForShop(db, shop, cart);
  assert(validated.items.length === 2, 'validated cart must keep two material groups');
  assert(validated.totalCents === validated.items.reduce((sum, item) => sum + item.totalCents, 0), 'cart total cents must equal item totals');
  assert(new Set(validated.items.map(item => item.materialId)).size === 2, 'cart items must preserve different materials');
  assert(validated.items.every(item => item.models.length === 1), 'cart items must preserve model metadata');
  assert(validated.items.every(item => item.models[0].quantity === 1), 'single-model cart items must keep group quantity behavior');

  console.log('Multi-line cart smoke checks passed.');
} finally {
  db.close();
}

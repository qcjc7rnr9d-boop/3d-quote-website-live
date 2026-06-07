import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import dotenv from 'dotenv';
import { DatabaseSync } from 'node:sqlite';

dotenv.config();

const require = createRequire(import.meta.url);
const signature = require('cookie-signature');
const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const secret = process.env.SESSION_SECRET || 'dev-secret-change-me';
const db = new DatabaseSync('data/rfdewi.db');

const createdSessionIds = [];
const createdShopIds = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertStaticContracts() {
  const ordersRouteSource = readFileSync('routes/orders.js', 'utf8');
  const ordersHtml = readFileSync('../admin/orders.html', 'utf8');
  const statsRouteIndex = ordersRouteSource.indexOf("router.get('/stats'");
  const dynamicRouteIndex = ordersRouteSource.indexOf("router.get('/:id'");

  assert(statsRouteIndex !== -1, 'Orders route must implement GET /api/orders/stats');
  assert(dynamicRouteIndex !== -1, 'Orders route must implement GET /api/orders/:id');
  assert(statsRouteIndex < dynamicRouteIndex, '/api/orders/stats must be declared before /api/orders/:id');
  assert(ordersHtml.includes('/api/orders/stats'), 'Admin orders page must load /api/orders/stats');
  assert(ordersHtml.includes('data.pages || data.total_pages'), 'Admin orders page must support pages and legacy total_pages');
}

async function api(path, cookie, expected = 200) {
  const res = await fetch(`${base}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: 'manual',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== expected) {
    throw new Error(`${path} returned ${res.status}, expected ${expected}: ${JSON.stringify(data).slice(0, 240)}`);
  }
  return data;
}

function makeShopCookie(shopId) {
  const sessionId = randomUUID();
  createdSessionIds.push(sessionId);
  const expires = Date.now() + 15 * 60 * 1000;
  db.prepare(`
    INSERT INTO app_sessions (sid, sess, expires_at)
    VALUES (?, ?, ?)
  `).run(sessionId, JSON.stringify({
    cookie: {
      originalMaxAge: 15 * 60 * 1000,
      expires: new Date(expires).toISOString(),
      secure: false,
      httpOnly: true,
      path: '/',
      sameSite: 'strict',
    },
    shopId,
  }), expires);
  return `connect.sid=${encodeURIComponent(`s:${signature.sign(sessionId, secret)}`)}`;
}

function createShop(slug) {
  const result = db.prepare(`
    INSERT INTO shops (name, slug, email, password_hash, is_temp_password, plan)
    VALUES (?, ?, ?, ?, 0, 'starter')
  `).run(
    `Admin Orders Smoke ${slug}`,
    slug,
    `${slug}@example.test`,
    'not-a-real-login-hash'
  );
  createdShopIds.push(result.lastInsertRowid);
  return result.lastInsertRowid;
}

function createMaterial(shopId, name) {
  return db.prepare(`
    INSERT INTO materials (shop_id, name, category, active)
    VALUES (?, ?, 'FDM', 1)
  `).run(shopId, name).lastInsertRowid;
}

function createOrder(shopId, materialId, values = {}) {
  return db.prepare(`
    INSERT INTO orders (
      shop_id, customer_email, customer_name, file_name, material_id,
      colour, finish, quantity, subtotal, tax, shipping, total,
      customer_total_cents, payment_status, fulfilment_status, stripe_payment_id,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    shopId,
    values.customerEmail || 'admin-orders-smoke@example.test',
    values.customerName || 'Admin Orders Smoke',
    values.fileName || 'smoke-part.stl',
    materialId,
    values.colour || 'Black',
    values.finish || 'Standard',
    values.quantity ?? 1,
    values.subtotal ?? 10,
    values.tax ?? 1.5,
    values.shipping ?? 2,
    values.total ?? 13.5,
    values.customerTotalCents ?? Math.round(Number(values.total ?? 13.5) * 100),
    values.paymentStatus || 'paid',
    values.fulfilmentStatus || 'pending',
    values.stripePaymentId || `pi_smoke_${randomUUID().replace(/-/g, '')}`
  ).lastInsertRowid;
}

try {
  assertStaticContracts();
  await api('/api/orders', null, 401);

  const slug = `admin-orders-smoke-${randomUUID().slice(0, 8)}`;
  const otherSlug = `admin-orders-other-${randomUUID().slice(0, 8)}`;
  const shopId = createShop(slug);
  const otherShopId = createShop(otherSlug);
  const materialId = createMaterial(shopId, 'Smoke PLA');
  const otherMaterialId = createMaterial(otherShopId, 'Other PLA');
  const orderOneId = createOrder(shopId, materialId, { total: 42, customerTotalCents: 4200 });
  createOrder(shopId, materialId, { total: 25, customerTotalCents: 2500, fulfilmentStatus: 'complete' });
  createOrder(shopId, materialId, { total: 11, customerTotalCents: 1100, paymentStatus: 'pending', stripePaymentId: null });
  const otherOrderId = createOrder(otherShopId, otherMaterialId, { total: 99, customerTotalCents: 9900 });
  const cookie = makeShopCookie(shopId);

  const stats = await api('/api/orders/stats', cookie);
  assert(typeof stats.today_count === 'number', '/api/orders/stats today_count must be numeric');
  assert(typeof stats.month_revenue === 'number', '/api/orders/stats month_revenue must be numeric');
  assert(typeof stats.pending_count === 'number', '/api/orders/stats pending_count must be numeric');
  assert(stats.today_count === 3, `Expected 3 shop orders today, got ${stats.today_count}`);
  assert(Math.round(stats.month_revenue * 100) === 6700, `Expected paid month revenue NZ$67.00, got ${stats.month_revenue}`);
  assert(stats.pending_count === 2, `Expected 2 pending fulfilment orders, got ${stats.pending_count}`);

  const list = await api('/api/orders?limit=10', cookie);
  assert(Array.isArray(list.orders), '/api/orders did not return orders array');
  assert(list.total === 3, `Expected total 3 scoped orders, got ${list.total}`);
  assert(list.pages === 1, `Expected pages 1, got ${list.pages}`);
  assert(list.orders.every(o => o.material_name === 'Smoke PLA'), 'Order list must include scoped material_name values');
  assert(list.orders.every(o => o.material === o.material_name), 'Order list material compatibility alias mismatch');
  assert(!list.orders.some(o => o.id === otherOrderId), 'Order list leaked another shop order');

  const detail = await api(`/api/orders/${orderOneId}`, cookie);
  assert(detail.material_name === 'Smoke PLA', 'Order detail missing material_name');
  assert(detail.material === detail.material_name, 'Order detail material compatibility alias mismatch');
  await api(`/api/orders/${otherOrderId}`, cookie, 404);

  console.log('Admin orders smoke checks passed.');
} finally {
  for (const sessionId of createdSessionIds) {
    db.prepare('DELETE FROM app_sessions WHERE sid = ?').run(sessionId);
  }
  for (const shopId of createdShopIds) {
    db.prepare('DELETE FROM shops WHERE id = ?').run(shopId);
  }
  db.close();
}

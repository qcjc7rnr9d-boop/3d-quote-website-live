import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import dotenv from 'dotenv';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
dotenv.config();
const require = createRequire(import.meta.url);
const signature = require('cookie-signature');
const sessionSecret = process.env.SESSION_SECRET || 'dev-secret-change-me';
const db = new DatabaseSync('data/rfdewi.db');
let otherShopId = null;
let otherOrderId = null;
let createdSessionId = null;
const otherSlug = `portal-smoke-${randomUUID().slice(0, 8)}`;

async function api(path, options = {}, expected = 200) {
  const res = await fetch(`${base}${path}`, {
    redirect: 'manual',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== expected) {
    throw new Error(`${path} returned ${res.status}, expected ${expected}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { res, data };
}

function cookieFrom(res) {
  const raw = res.headers.get('set-cookie') || '';
  return raw.split(';')[0];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function createOtherShopOrder() {
  const result = db.prepare(`
    INSERT INTO shops (name, slug, email, password_hash, is_temp_password, plan)
    VALUES (?, ?, ?, ?, 0, 'starter')
  `).run(
    'Portal Smoke Other',
    otherSlug,
    `${otherSlug}@example.test`,
    'not-a-real-login-hash'
  );
  otherShopId = result.lastInsertRowid;
  const order = db.prepare(`
    INSERT INTO orders (
      shop_id, customer_email, customer_name, file_name, quantity,
      subtotal, tax, shipping, total, payment_status, fulfilment_status
    )
    VALUES (?, ?, ?, ?, 1, 10, 1.5, 2, 13.5, 'paid', 'complete')
  `).run(otherShopId, 'alex@mahi3d-demo.test', 'Alex Morgan', 'Other Shop Part.stl');
  otherOrderId = order.lastInsertRowid;
}

try {
  createOtherShopOrder();

  await api('/api/customer/me', {}, 401);
  await api('/api/customer/orders', {}, 401);

  const demoAccount = db.prepare(`
    SELECT ca.id, ca.shop_id
    FROM customer_accounts ca
    JOIN shops s ON s.id = ca.shop_id
    WHERE s.slug = 'mahi3d' AND ca.email = 'alex@mahi3d-demo.test'
  `).get();
  assert(demoAccount, 'Demo customer account does not exist; run npm run demo:seed:mahi3d first');
  createdSessionId = randomUUID();
  const expires = Date.now() + 15 * 60 * 1000;
  db.prepare(`
    INSERT INTO app_sessions (sid, sess, expires_at)
    VALUES (?, ?, ?)
  `).run(createdSessionId, JSON.stringify({
    cookie: {
      originalMaxAge: 15 * 60 * 1000,
      expires: new Date(expires).toISOString(),
      secure: false,
      httpOnly: true,
      path: '/',
      sameSite: 'strict',
    },
    customerId: demoAccount.id,
    customerShopId: demoAccount.shop_id,
  }), expires);
  const cookie = `connect.sid=${encodeURIComponent(`s:${signature.sign(createdSessionId, sessionSecret)}`)}`;

  const { data: me } = await api('/api/customer/me?shop=mahi3d', { headers: { Cookie: cookie } });
  assert(me.shop?.slug === 'mahi3d', '/me returned the wrong shop');
  assert(me.email === 'alex@mahi3d-demo.test', '/me returned the wrong customer');
  assert(me.stats && typeof me.stats === 'object', '/me missing stats object');

  const { data: orders } = await api('/api/customer/orders?shop=mahi3d', { headers: { Cookie: cookie } });
  assert(Array.isArray(orders), '/orders did not return an array');
  assert(orders.length === 5, `Expected 5 demo orders, got ${orders.length}`);
  assert(orders.every(o => typeof o.total === 'number'), 'Order totals must be numeric');

  const paid = orders.filter(o => o.payment_status === 'paid');
  const expectedTotal = roundMoney(paid.reduce((sum, order) => sum + order.total, 0));
  const active = paid.filter(o => !['complete', 'cancelled'].includes(o.fulfilment_status)).length;
  const delivered = paid.filter(o => o.fulfilment_status === 'complete').length;

  assert(me.stats.total_orders === paid.length, `stats.total_orders mismatch: ${me.stats.total_orders} vs ${paid.length}`);
  assert(me.stats.active_orders === active, `stats.active_orders mismatch: ${me.stats.active_orders} vs ${active}`);
  assert(me.stats.delivered_orders === delivered, `stats.delivered_orders mismatch: ${me.stats.delivered_orders} vs ${delivered}`);
  assert(roundMoney(me.stats.total_spent) === expectedTotal, `stats.total_spent mismatch: ${me.stats.total_spent} vs ${expectedTotal}`);
  assert(me.order_count === me.stats.total_orders, 'legacy order_count does not match stats.total_orders');
  assert(roundMoney(me.total_spent) === roundMoney(me.stats.total_spent), 'legacy total_spent does not match stats.total_spent');

  const shipped = orders.find(o => o.fulfilment_status === 'shipped');
  assert(shipped?.tracking_number, 'Shipped demo order should include tracking number');
  const activeOrder = orders.find(o => o.fulfilment_status === 'in_production');
  assert(activeOrder && !activeOrder.customer_message, 'Active non-shipped orders must not expose customer_message');

  await api(`/api/customer/orders/${shipped.id}?shop=mahi3d`, { headers: { Cookie: cookie } });
  await api(`/api/customer/orders/${otherOrderId}?shop=mahi3d`, { headers: { Cookie: cookie } }, 404);
  await api(`/api/customer/me?shop=${encodeURIComponent(otherSlug)}`, { headers: { Cookie: cookie } }, 403);
  await api(`/api/customer/orders?shop=${encodeURIComponent(otherSlug)}`, { headers: { Cookie: cookie } }, 403);

  console.log('Customer portal smoke checks passed.');
} finally {
  if (createdSessionId) {
    db.prepare('DELETE FROM app_sessions WHERE sid = ?').run(createdSessionId);
  }
  if (otherShopId) {
    db.prepare('DELETE FROM shops WHERE id = ?').run(otherShopId);
  }
  db.close();
}

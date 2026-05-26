import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { DatabaseSync } from 'node:sqlite';

dotenv.config();

const require = createRequire(import.meta.url);
const signature = require('cookie-signature');
const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const secret = process.env.SESSION_SECRET || 'dev-secret-change-me';
const db = new DatabaseSync('data/rfdewi.db');
let sessionId = null;
const ordersRouteSource = readFileSync(new URL('../routes/orders.js', import.meta.url), 'utf8');

async function api(path, cookie, expected = 200, options = {}) {
  const res = await fetch(`${base}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.csrfToken ? { 'X-CSRF-Token': options.csrfToken } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: 'manual',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== expected) {
    throw new Error(`${path} returned ${res.status}, expected ${expected}: ${JSON.stringify(data).slice(0, 240)}`);
  }
  return data;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert.match = (actual, expected, message) => {
  if (!expected.test(String(actual))) throw new Error(message);
};

function makeShopCookie(shopId) {
  sessionId = randomUUID();
  const csrfToken = randomUUID();
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
    csrfToken,
  }), expires);
  return {
    cookie: `connect.sid=${encodeURIComponent(`s:${signature.sign(sessionId, secret)}`)}`,
    csrfToken,
  };
}

try {
  const adminOrderFields = ordersRouteSource.match(/const ADMIN_ORDER_FIELDS = `([\s\S]*?)`;/)?.[1] || '';
  assert(adminOrderFields, 'orders route should use an explicit admin order field allowlist');
  assert(!adminOrderFields.includes('public_token'), 'admin order responses must not include public confirmation tokens');
  assert(!adminOrderFields.includes('checkout_idempotency_key'), 'admin order responses must not include checkout idempotency keys');
  assert(!ordersRouteSource.includes('SELECT o.*'), 'admin order list/detail should not select every order column');
  assert.match(
    ordersRouteSource,
    /function publicOrderResponse[\s\S]*items: \(attached\.items \|\| \[\]\)\.map\(\(\{ quoteSnapshot, \.\.\.item \}\) => item\)/,
    'public order responses should strip internal quote snapshots from line items',
  );
  assert.match(ordersRouteSource, /res\.json\(publicOrderResponse\(row\)\)/, 'public order route should use the sanitized response helper');

  await api('/api/orders', null, 401);

  const shop = db.prepare("SELECT id FROM shops WHERE slug = 'mahi3d'").get();
  assert(shop, 'Mahi3D shop is missing; run npm run demo:seed:mahi3d first');
  const { cookie, csrfToken } = makeShopCookie(shop.id);

  const list = await api('/api/orders?limit=10', cookie);
  assert(Array.isArray(list.orders), '/api/orders did not return orders array');
  assert(list.orders.length >= 5, `Expected at least 5 demo orders, got ${list.orders.length}`);

  const expected = new Set(['PETG', 'PLA', 'ASA', 'TPU', 'Nylon']);
  for (const order of list.orders.filter(o => o.customer_email === 'alex@mahi3d-demo.test')) {
    assert(order.material_name, `Order #${order.id} missing material_name`);
    assert(order.material, `Order #${order.id} missing material compatibility alias`);
    assert(order.material === order.material_name, `Order #${order.id} material alias mismatch`);
    expected.delete(order.material_name);

    const detail = await api(`/api/orders/${order.id}`, cookie);
    assert(detail.material_name, `Order detail #${order.id} missing material_name`);
    assert(detail.material, `Order detail #${order.id} missing material compatibility alias`);
    assert(detail.material === detail.material_name, `Order detail #${order.id} material alias mismatch`);
  }
  assert(expected.size === 0, `Missing demo material names: ${[...expected].join(', ')}`);

  const orderForPatch = list.orders[0];
  assert(orderForPatch, 'Need at least one order to test order update validation');
  await api(`/api/orders/${orderForPatch.id}`, cookie, 400, {
    method: 'PATCH',
    csrfToken,
    body: { fulfilment_status: 'shipped', tracking_url: 'javascript:alert(1)' },
  });
  await api(`/api/orders/${orderForPatch.id}`, cookie, 400, {
    method: 'PATCH',
    csrfToken,
    body: { fulfilment_status: 'totally_fake' },
  });

  console.log('Admin orders smoke checks passed.');
} finally {
  if (sessionId) {
    db.prepare('DELETE FROM app_sessions WHERE sid = ?').run(sessionId);
  }
  db.close();
}

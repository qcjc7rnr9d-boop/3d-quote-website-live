import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import dotenv from 'dotenv';
import { DatabaseSync } from 'node:sqlite';

dotenv.config();

const require = createRequire(import.meta.url);
const signature = require('cookie-signature');
const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const secret = process.env.SESSION_SECRET || 'dev-secret-change-me';
const db = new DatabaseSync('data/rfdewi.db');
let sessionId = null;

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeShopCookie(shopId) {
  sessionId = randomUUID();
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

try {
  await api('/api/orders', null, 401);

  const shop = db.prepare("SELECT id FROM shops WHERE slug = 'trennen'").get();
  assert(shop, 'Trennen shop is missing; run npm run demo:seed:trennen first');
  const cookie = makeShopCookie(shop.id);

  const list = await api('/api/orders?limit=10', cookie);
  assert(Array.isArray(list.orders), '/api/orders did not return orders array');
  assert(list.orders.length >= 5, `Expected at least 5 demo orders, got ${list.orders.length}`);

  const expected = new Set(['PETG', 'PLA', 'ASA', 'TPU', 'Nylon']);
  for (const order of list.orders.filter(o => o.customer_email === 'alex@trennen-demo.test')) {
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

  console.log('Admin orders smoke checks passed.');
} finally {
  if (sessionId) {
    db.prepare('DELETE FROM app_sessions WHERE sid = ?').run(sessionId);
  }
  db.close();
}

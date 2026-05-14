import { randomBytes } from 'crypto';
import { createRequire } from 'module';
import { DatabaseSync } from 'node:sqlite';
import dotenv from 'dotenv';

dotenv.config();

const require = createRequire(import.meta.url);
const signature = require('cookie-signature');
const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const secret = process.env.SESSION_SECRET || 'dev-secret-change-me';
const db = new DatabaseSync('data/rfdewi.db');
const createdSessions = [];

function makeCookie(sessionPatch) {
  const sid = randomBytes(18).toString('base64url');
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const sess = {
    cookie: {
      originalMaxAge: 15 * 60 * 1000,
      expires,
      secure: false,
      httpOnly: true,
      path: '/',
      sameSite: 'strict',
    },
    ...sessionPatch,
  };
  db.prepare(`
    INSERT INTO app_sessions (sid, sess, expires_at)
    VALUES (?, ?, ?)
  `).run(sid, JSON.stringify(sess), new Date(expires).getTime());
  createdSessions.push(sid);
  return `connect.sid=${encodeURIComponent(`s:${signature.sign(sid, secret)}`)}`;
}

async function api(path, cookie, expected = 200) {
  const res = await fetch(`${base}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: 'manual',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== expected) {
    throw new Error(`${path} returned ${res.status}, expected ${expected}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

function assertNoSensitiveKeys(value, path = '$') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    const bad = [
      'password_hash',
      'reset_token',
      'stripe_secret_key',
      'secret_key',
      'raw_session',
      'payment_method',
      'card',
    ];
    if (bad.includes(lower)) {
      throw new Error(`Sensitive field returned at ${path}.${key}`);
    }
    assertNoSensitiveKeys(child, `${path}.${key}`);
  }
}

try {
  const platformCookie = makeCookie({ platformAdmin: true, platformAdminId: 1 });
  const firstShop = db.prepare('SELECT id FROM shops ORDER BY id LIMIT 1').get();
  const firstOrder = db.prepare('SELECT id FROM orders ORDER BY id DESC LIMIT 1').get();
  const firstCustomer = db.prepare(`
    SELECT shop_id, email FROM (
      SELECT shop_id, email FROM customers
      UNION ALL
      SELECT shop_id, email FROM customer_accounts
    )
    ORDER BY shop_id
    LIMIT 1
  `).get();

  const overview = await api('/api/platform/overview', platformCookie);
  for (const key of ['total_shops', 'customer_accounts', 'customer_records', 'paid_checkouts', 'revenue']) {
    if (!(key in overview)) throw new Error(`/api/platform/overview missing ${key}`);
  }
  assertNoSensitiveKeys(overview);

  const orders = await api('/api/platform/orders?limit=5', platformCookie);
  if (!Array.isArray(orders.orders)) throw new Error('/api/platform/orders did not return orders array');
  assertNoSensitiveKeys(orders);

  const customers = await api('/api/platform/customers?limit=5', platformCookie);
  if (!Array.isArray(customers.customers)) throw new Error('/api/platform/customers did not return customers array');
  assertNoSensitiveKeys(customers);

  if (firstShop) {
    const shopOverview = await api(`/api/platform/shops/${firstShop.id}/overview`, platformCookie);
    if (!shopOverview.shop || !shopOverview.metrics) throw new Error('Shop overview missing shop/metrics');
    assertNoSensitiveKeys(shopOverview);

    const shopCookie = makeCookie({ shopId: firstShop.id });
    await api('/api/platform/overview', shopCookie, 401);
  }

  if (firstOrder) {
    const detail = await api(`/api/platform/orders/${firstOrder.id}`, platformCookie);
    if (!detail.shop || !detail.customer || !('stripe_payment_id' in detail)) {
      throw new Error('Order detail missing allowed operational fields');
    }
    assertNoSensitiveKeys(detail);
  }

  if (firstCustomer) {
    const id = encodeURIComponent(`${firstCustomer.shop_id}:${firstCustomer.email}`);
    const detail = await api(`/api/platform/customers/${id}`, platformCookie);
    if (!detail.shop || !detail.customer || !Array.isArray(detail.orders)) {
      throw new Error('Customer detail missing shop/customer/orders');
    }
    assertNoSensitiveKeys(detail);
  }

  const audit = await api('/api/platform/audit-events?limit=20', platformCookie);
  if (!Array.isArray(audit.events)) throw new Error('/api/platform/audit-events did not return events array');
  if (firstOrder && !audit.events.some(e => e.action === 'view_order_detail' && String(e.target_id) === String(firstOrder.id))) {
    throw new Error('Viewing order detail did not create an audit event');
  }
  if (firstCustomer && !audit.events.some(e => e.action === 'view_customer_detail')) {
    throw new Error('Viewing customer detail did not create an audit event');
  }
  assertNoSensitiveKeys(audit);

  console.log('Platform reporting smoke checks passed.');
} finally {
  const del = db.prepare('DELETE FROM app_sessions WHERE sid = ?');
  for (const sid of createdSessions) del.run(sid);
  db.close();
}

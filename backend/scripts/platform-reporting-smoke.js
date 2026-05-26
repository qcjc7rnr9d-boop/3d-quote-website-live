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
const createdShopIds = [];

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

function createTempShop() {
  const suffix = randomBytes(8).toString('hex');
  const result = db.prepare(`
    INSERT INTO shops (name, slug, email, password_hash, is_temp_password, plan)
    VALUES (?, ?, ?, ?, 0, 'starter')
  `).run(
    'Platform Impersonation Smoke',
    `platform-impersonation-${suffix}`,
    `platform-impersonation-${suffix}@example.test`,
    '$2a$04$platformimpersonationsmokehashonly'
  );
  createdShopIds.push(result.lastInsertRowid);
  return { id: result.lastInsertRowid };
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

async function csrfHeaders(cookie) {
  const res = await fetch(`${base}/api/csrf-token`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.csrfToken) {
    throw new Error(`/api/csrf-token returned ${res.status}`);
  }
  return {
    Cookie: cookie,
    'Content-Type': 'application/json',
    'X-CSRF-Token': data.csrfToken,
  };
}

async function jsonApi(path, cookie, options = {}, expected = 200) {
  const headers = options.csrf
    ? await csrfHeaders(cookie)
    : { ...(cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json' };
  const res = await fetch(`${base}${path}`, {
    method: options.method || 'POST',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: 'manual',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== expected) {
    throw new Error(`${path} returned ${res.status}, expected ${expected}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

async function createPlatformShop(cookie, body) {
  const headers = await csrfHeaders(cookie);
  const res = await fetch(`${base}/api/platform/shops`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  const data = await res.json().catch(() => ({}));
  if (data?.id) createdShopIds.push(data.id);
  return { res, data };
}

function rememberCreatedShopsByIdentity(slug, email) {
  const rows = db.prepare(`
    SELECT id
    FROM shops
    WHERE lower(slug) = lower(?)
       OR lower(email) = lower(?)
  `).all(String(slug || '').trim(), String(email || '').trim());
  for (const row of rows) {
    if (!createdShopIds.includes(row.id)) createdShopIds.push(row.id);
  }
  return rows;
}

async function expectBadShopCreateRejected(platformCookie, body) {
  const { res, data } = await createPlatformShop(platformCookie, body);
  const rows = rememberCreatedShopsByIdentity(body.slug, body.email);
  if (res.status !== 400) {
    throw new Error(`/api/platform/shops accepted invalid shop payload with ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }
  if (rows.length) {
    throw new Error(`/api/platform/shops persisted invalid shop rows: ${rows.map(row => row.id).join(', ')}`);
  }
}

async function expectPlatformShopCreationValidationAndAtomicity(platformCookie) {
  const invalidSlug = `bad slug ${randomBytes(3).toString('hex')}`;
  await expectBadShopCreateRejected(platformCookie, {
    name: 'Bad Slug Smoke',
    slug: invalidSlug,
    email: `${invalidSlug.replace(/\s+/g, '-')}@example.test`,
    password: 'ValidShop!2026',
    plan: 'community',
  });

  const invalidEmailSlug = `bad-email-${randomBytes(4).toString('hex')}`;
  await expectBadShopCreateRejected(platformCookie, {
    name: 'Bad Email Smoke',
    slug: invalidEmailSlug,
    email: 'not-an-email',
    password: 'ValidShop!2026',
    plan: 'community',
  });

  const weakPasswordSlug = `weak-password-${randomBytes(4).toString('hex')}`;
  await expectBadShopCreateRejected(platformCookie, {
    name: 'Weak Password Smoke',
    slug: weakPasswordSlug,
    email: `${weakPasswordSlug}@example.test`,
    password: 'password',
    plan: 'community',
  });

  const raceSlug = `platform-create-race-${randomBytes(5).toString('hex')}`;
  const raceEmail = `${raceSlug}@example.test`;
  const payload = {
    name: '  Platform Race Shop  ',
    slug: ` ${raceSlug.toUpperCase()} `,
    email: ` ${raceEmail.toUpperCase()} `,
    password: 'RaceShop!2026',
    plan: 'community',
  };

  const attempts = await Promise.all(Array.from({ length: 6 }, () => createPlatformShop(platformCookie, payload)));
  const statuses = attempts.map(({ res }) => res.status);
  const created = statuses.filter(status => status === 201).length;
  if (created !== 1) {
    throw new Error(`Concurrent platform shop create should create exactly one shop, got statuses ${statuses.join(', ')}`);
  }
  if (!statuses.every(status => [201, 400, 409].includes(status))) {
    throw new Error(`Concurrent platform shop create returned unexpected statuses ${statuses.join(', ')}`);
  }

  const shops = db.prepare(`
    SELECT id, name, slug, email
    FROM shops
    WHERE slug = ? OR email = ?
  `).all(raceSlug, raceEmail);
  for (const shop of shops) {
    if (!createdShopIds.includes(shop.id)) createdShopIds.push(shop.id);
  }
  if (shops.length !== 1) {
    throw new Error(`Concurrent platform shop create persisted ${shops.length} shop rows`);
  }
  if (shops[0].name !== 'Platform Race Shop' || shops[0].slug !== raceSlug || shops[0].email !== raceEmail) {
    throw new Error(`Concurrent platform shop create did not normalize shop identity: ${JSON.stringify(shops[0])}`);
  }

  const pricingRows = db.prepare('SELECT COUNT(*) AS n FROM pricing_config WHERE shop_id = ?').get(shops[0].id).n;
  const settingsRows = db.prepare('SELECT COUNT(*) AS n FROM store_settings WHERE shop_id = ?').get(shops[0].id).n;
  const billingRows = db.prepare('SELECT COUNT(*) AS n FROM merchant_subscriptions WHERE shop_id = ?').get(shops[0].id).n;
  if (pricingRows !== 1 || settingsRows !== 1 || billingRows !== 1) {
    throw new Error(`Concurrent platform shop create left incomplete setup: pricing=${pricingRows}, settings=${settingsRows}, billing=${billingRows}`);
  }

  console.log('✓ platform shop creation validates identity and is atomic under duplicate concurrency');
}

async function expectPlatformImpersonationBoundary(platformCookie) {
  const tempShop = createTempShop();
  const impersonation = await jsonApi(
    '/api/platform/impersonate',
    platformCookie,
    { csrf: true, body: { shopId: tempShop.id } },
    200
  );
  if (!impersonation.impersonation?.active || impersonation.impersonation.shop_id !== tempShop.id) {
    throw new Error('/api/platform/impersonate did not return active impersonation metadata');
  }

  const me = await api('/api/auth/me', platformCookie);
  if (!me.impersonation?.active || me.impersonation.shop_id !== tempShop.id) {
    throw new Error('/api/auth/me did not expose active platform impersonation metadata');
  }

  const blockedChange = await jsonApi(
    '/api/auth/change-password',
    platformCookie,
    {
      csrf: true,
      body: { currentPassword: 'not-the-real-password', newPassword: 'BlockedChange!2026' },
    },
    403
  );
  if (blockedChange.code !== 'PLATFORM_IMPERSONATION_RESTRICTED') {
    throw new Error('/api/auth/change-password did not return the impersonation restriction code');
  }

  await jsonApi('/api/auth/sessions/revoke-all', platformCookie, { csrf: true, body: {} }, 403);
  await jsonApi('/api/stripe/connect-url', platformCookie, { method: 'GET', csrf: false }, 403);

  const blockedSettings = await jsonApi(
    '/api/settings',
    platformCookie,
    { method: 'PUT', csrf: true, body: { name: 'Blocked impersonation edit' } },
    403
  );
  if (blockedSettings.code !== 'PLATFORM_IMPERSONATION_RESTRICTED') {
    throw new Error('/api/settings did not return the impersonation restriction code');
  }

  const blockedPricing = await jsonApi(
    '/api/pricing',
    platformCookie,
    { method: 'PUT', csrf: true, body: { currency: 'NZD', tax_rate: 0.15 } },
    403
  );
  if (blockedPricing.code !== 'PLATFORM_IMPERSONATION_RESTRICTED') {
    throw new Error('/api/pricing did not return the impersonation restriction code');
  }

  const blockedOrderEdit = await jsonApi(
    '/api/orders/999999999',
    platformCookie,
    { method: 'PATCH', csrf: true, body: { notes: 'Blocked impersonation edit' } },
    403
  );
  if (blockedOrderEdit.code !== 'PLATFORM_IMPERSONATION_RESTRICTED') {
    throw new Error('/api/orders/:id did not return the impersonation restriction code');
  }

  const stopped = await jsonApi('/api/platform/impersonate/stop', platformCookie, { csrf: true, body: {} }, 200);
  if (stopped.impersonation?.active) {
    throw new Error('/api/platform/impersonate/stop left impersonation active');
  }
  await api('/api/auth/me', platformCookie, 401);

  console.log('✓ platform impersonation is marked and shop write actions are blocked');
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

  await expectPlatformImpersonationBoundary(platformCookie);
  await expectPlatformShopCreationValidationAndAtomicity(platformCookie);

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
  const delShop = db.prepare('DELETE FROM shops WHERE id = ?');
  for (const id of createdShopIds) delShop.run(id);
  db.close();
}

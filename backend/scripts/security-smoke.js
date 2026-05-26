const dotenv = (await import('dotenv')).default;
dotenv.config();

const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const { dirname, resolve } = await import('path');
const { mkdirSync, readFileSync, rmSync, writeFileSync } = await import('fs');
const { createRequire } = await import('module');
const { randomUUID } = await import('node:crypto');
const bcrypt = (await import('bcryptjs')).default;
const jwt = (await import('jsonwebtoken')).default;
const { resetTokenDigest } = await import('../lib/reset-tokens.js');
const require = createRequire(import.meta.url);
const signature = require('cookie-signature');
const sessionSecret = process.env.SESSION_SECRET || 'dev-secret-change-me';
let existingOrderId = null;
let db = null;
let tempOrderId = null;
let tempOrderToken = null;
let tempNonFdmMaterialId = null;
let sessionFixationShopId = null;
let sessionFixationCustomerId = null;
let platformLogoutSessionId = null;
const syntheticSessionIds = [];
const createdUploadSmokePaths = [];
try {
  const { DatabaseSync } = await import('node:sqlite');
  db = new DatabaseSync('data/rfdewi.db');
  existingOrderId = db.prepare('SELECT id FROM orders ORDER BY id LIMIT 1').get()?.id || null;
  const shop = db.prepare("SELECT id FROM shops WHERE slug = 'mahi3d'").get();
  if (shop) {
    db.prepare(`
      DELETE FROM materials
      WHERE shop_id = ?
        AND (
          name LIKE 'FDM-only hidden resin %'
          OR properties LIKE '%"libraryKey":"security_smoke_resin"%'
          OR properties LIKE '%"library_key":"security_smoke_resin"%'
        )
    `).run(shop.id);

    const cols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
    if (!cols.includes('public_token')) {
      db.exec('ALTER TABLE orders ADD COLUMN public_token TEXT');
    }
    tempOrderToken = `smoke-${randomUUID()}`;
    const result = db.prepare(`
      INSERT INTO orders (
        shop_id, customer_email, customer_name, file_name, quantity,
        subtotal, tax, shipping, total, payment_status, fulfilment_status, public_token
      )
      VALUES (?, 'private@example.test', 'Private Customer', 'Private Part.stl', 1, 1, 0, 0, 1, 'paid', 'pending', ?)
    `).run(shop.id, tempOrderToken);
    tempOrderId = result.lastInsertRowid;

    const materialCols = new Set(db.prepare('PRAGMA table_info(materials)').all().map(c => c.name));
    const materialPayload = {
      shop_id: shop.id,
      name: `FDM-only hidden resin ${randomUUID()}`,
      category: 'Resin',
      description_short: 'Temporary non-FDM smoke material',
      description_long: '',
      base_price: 0.42,
      min_charge: 10,
      pricing_model: 'per_cm3',
      colours: JSON.stringify([{ id: 'colour_white', name: 'White', hex: '#ffffff', enabled: true, sortOrder: 0 }]),
      finishes: JSON.stringify([{ id: 'finish_standard', name: 'Standard', layerHeight: '0.05 mm', priceMultiplier: 1, enabled: true, default: true, sortOrder: 0 }]),
      active: 1,
      recommended: 0,
      tags: JSON.stringify(['Resin']),
      best_for: JSON.stringify(['Smoke test']),
      specs: JSON.stringify([]),
      properties: JSON.stringify({ libraryKey: 'security_smoke_resin' }),
      sort_order: -999,
    };
    const entries = Object.entries(materialPayload).filter(([key]) => materialCols.has(key));
    const columns = entries.map(([key]) => key);
    const placeholders = columns.map(() => '?').join(', ');
    const materialResult = db.prepare(`
      INSERT INTO materials (${columns.join(', ')})
      VALUES (${placeholders})
    `).run(...entries.map(([, value]) => value));
    tempNonFdmMaterialId = materialResult.lastInsertRowid;

    const suffix = randomUUID().slice(0, 10);
    const password = `FixationSmoke!${suffix}`;
    const hash = await bcrypt.hash(password, 4);
    const sessionShop = db.prepare(`
      INSERT INTO shops (name, slug, email, password_hash, is_temp_password, plan)
      VALUES (?, ?, ?, ?, 0, 'starter')
    `).run(
      'Session Fixation Smoke',
      `session-fixation-${suffix}`,
      `session-fixation-${suffix}@example.test`,
      hash
    );
    sessionFixationShopId = sessionShop.lastInsertRowid;
    const customerResult = db.prepare(`
      INSERT INTO customer_accounts (shop_id, email, name, password_hash)
      VALUES (?, ?, ?, ?)
    `).run(
      sessionFixationShopId,
      `customer-${suffix}@example.test`,
      'Session Fixation Customer',
      hash
    );
    sessionFixationCustomerId = customerResult.lastInsertRowid;
    globalThis.sessionFixationSmoke = {
      slug: `session-fixation-${suffix}`,
      shopEmail: `session-fixation-${suffix}@example.test`,
      customerEmail: `customer-${suffix}@example.test`,
      password,
      changedShopPassword: `FixationShopChanged!${suffix}`,
      changedCustomerPassword: `FixationCustomerChanged!${suffix}`,
      resetShopPassword: `FixationShopReset!${suffix}`,
      resetCustomerPassword: `FixationCustomerReset!${suffix}`,
    };
  }
} catch {}

function cleanup() {
  try {
    if (db) {
      if (tempNonFdmMaterialId) db.prepare('DELETE FROM materials WHERE id = ?').run(tempNonFdmMaterialId);
      db.prepare(`
        DELETE FROM materials
        WHERE name LIKE 'FDM-only hidden resin %'
           OR properties LIKE '%"libraryKey":"security_smoke_resin"%'
           OR properties LIKE '%"library_key":"security_smoke_resin"%'
      `).run();
    }
    if (sessionFixationShopId && db) {
      db.prepare('DELETE FROM app_sessions WHERE sess LIKE ?').run(`%"shopId":${sessionFixationShopId}%`);
      db.prepare('DELETE FROM app_sessions WHERE sess LIKE ?').run(`%"customerShopId":${sessionFixationShopId}%`);
      db.prepare('DELETE FROM sessions WHERE shop_id = ?').run(sessionFixationShopId);
      db.prepare('DELETE FROM shops WHERE id = ?').run(sessionFixationShopId);
    }
    if (platformLogoutSessionId && db) {
      db.prepare('DELETE FROM app_sessions WHERE sid = ?').run(platformLogoutSessionId);
    }
    if (db) {
      const delSynthetic = db.prepare('DELETE FROM app_sessions WHERE sid = ?');
      for (const sid of syntheticSessionIds) delSynthetic.run(sid);
    }
    for (const path of createdUploadSmokePaths) {
      rmSync(path, { force: true });
    }
    if (tempOrderId && db) db.prepare('DELETE FROM orders WHERE id = ?').run(tempOrderId);
    if (db) db.close();
  } catch {}
}
process.on('exit', cleanup);

async function expectStatus(path, expected) {
  const res = await fetch(`${base}${path}`, { method: 'HEAD', redirect: 'manual' });
  if (!expected.includes(res.status)) {
    throw new Error(`${path} returned ${res.status}, expected ${expected.join('/')}`);
  }
  console.log(`✓ ${path} -> ${res.status}`);
}

async function expectJson(path, requiredKeys = []) {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  const data = await res.json();
  for (const key of requiredKeys) {
    if (!(key in data)) throw new Error(`${path} missing key ${key}`);
  }
  console.log(`✓ ${path} -> JSON`);
}

async function expectSecurityHeaders() {
  const res = await fetch(`${base}/api/health`);
  if (!res.ok) throw new Error(`/api/health returned ${res.status}`);
  const required = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'SAMEORIGIN',
    'referrer-policy': 'no-referrer',
    'x-permitted-cross-domain-policies': 'none',
    'x-download-options': 'noopen',
    'x-dns-prefetch-control': 'off',
  };
  for (const [header, expected] of Object.entries(required)) {
    const actual = res.headers.get(header);
    if (actual !== expected) {
      throw new Error(`/api/health ${header} was ${actual || '<missing>'}, expected ${expected}`);
    }
  }
  const permissions = res.headers.get('permissions-policy') || '';
  for (const directive of ['camera=()', 'microphone=()', 'geolocation=()', 'payment=(self)']) {
    if (!permissions.includes(directive)) {
      throw new Error(`/api/health permissions-policy missing ${directive}: ${permissions || '<missing>'}`);
    }
  }
  const csp = res.headers.get('content-security-policy') || '';
  for (const directive of ["base-uri 'self'", "object-src 'none'", "frame-ancestors 'self'"]) {
    if (!csp.includes(directive)) {
      throw new Error(`/api/health content-security-policy missing ${directive}: ${csp || '<missing>'}`);
    }
  }
  const serverSource = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  if (!serverSource.includes('Strict-Transport-Security') || !serverSource.includes('max-age=31536000')) {
    throw new Error('server.js should set production Strict-Transport-Security with a one-year max-age');
  }
  console.log('✓ security response headers are present');
}

async function expectUploadsServeImagesOnly() {
  if (!/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i.test(base)) {
    console.log('↷ uploads active-content check skipped for non-local smoke base');
    return;
  }
  const uploadPath = resolve('..', 'uploads', `security-smoke-active-content-${Date.now()}.html`);
  mkdirSync(dirname(uploadPath), { recursive: true });
  writeFileSync(uploadPath, '<!doctype html><script>window.__uploadSmoke = true;</script>');
  createdUploadSmokePaths.push(uploadPath);
  const publicPath = `/uploads/${uploadPath.split('/uploads/').pop()}`;
  await expectStatus(publicPath, [404]);
  console.log('✓ uploads static surface rejects active content');
}

async function expectFdmOnlyCustomerMaterialApis() {
  const catalogRes = await fetch(`${base}/api/customer/catalog?shop=mahi3d`);
  if (!catalogRes.ok) throw new Error(`/api/customer/catalog?shop=mahi3d returned ${catalogRes.status}`);
  const catalog = await catalogRes.json();
  const materials = catalog.materials || [];
  if (!materials.length) throw new Error('/api/customer/catalog?shop=mahi3d returned no materials');
  const nonFdm = materials.filter(material => material.category !== 'FDM');
  if (nonFdm.length) {
    throw new Error(`/api/customer/catalog exposed non-FDM materials: ${nonFdm.map(m => `${m.name} (${m.category})`).join(', ')}`);
  }
  const nonFdmFilters = (catalog.filters || []).filter(label => ['resin', 'sls', 'specialty'].includes(String(label).toLowerCase()));
  if (nonFdmFilters.length) {
    throw new Error(`/api/customer/catalog exposed non-FDM filters: ${nonFdmFilters.join(', ')}`);
  }
  console.log('✓ customer catalog is FDM-only');

  const pricingRes = await fetch(`${base}/api/customer/pricing?shop=mahi3d`);
  if (!pricingRes.ok) throw new Error(`/api/customer/pricing?shop=mahi3d returned ${pricingRes.status}`);
  const pricing = await pricingRes.json();
  const ids = new Set(materials.map(material => String(material.id)));
  const leakedPricing = (pricing.materials || []).filter(material => !ids.has(String(material.id)));
  if (leakedPricing.length) {
    throw new Error(`/api/customer/pricing exposed materials outside the FDM catalog: ${leakedPricing.map(m => m.name || m.id).join(', ')}`);
  }
  console.log('✓ customer pricing follows the FDM-only catalog');
}

async function expectNonFdmQuoteRejected() {
  if (!tempNonFdmMaterialId || !db) {
    console.log('↷ non-FDM quote rejection skipped (no temporary material)');
    return;
  }
  const pricingRows = db.prepare("SELECT infill_tiers FROM pricing_config WHERE shop_id = (SELECT id FROM shops WHERE slug = 'mahi3d')").get() || {};
  let infill = null;
  try {
    infill = JSON.parse(pricingRows.infill_tiers || '[]').find(tier => tier?.active !== false);
  } catch {}
  const body = {
    shopSlug: 'mahi3d',
    materialId: tempNonFdmMaterialId,
    models: [{
      name: 'blocked-resin-smoke.stl',
      size: 1000,
      volumeCm3: 4,
      dimensions: { xMm: 20, yMm: 20, zMm: 20 },
      quantity: 1,
    }],
    colourId: 'colour_white',
    finishId: 'finish_standard',
    infillTierId: infill?.id || 'light',
    previewWithoutShipping: true,
  };
  const quote = await fetch(`${base}/api/customer/quote-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const quoteData = await quote.json().catch(() => ({}));
  if (quote.status !== 400 || quoteData.code !== 'MATERIAL_UNAVAILABLE') {
    throw new Error(`/api/customer/quote-preview non-FDM returned ${quote.status}/${quoteData.code || 'no-code'}`);
  }
  console.log('✓ non-FDM quote-preview material is rejected');

  const cart = await fetch(`${base}/api/customer/cart-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shopSlug: 'mahi3d',
      items: [{
        materialId: tempNonFdmMaterialId,
        file: {
          name: 'blocked-resin-smoke.stl',
          size: 1000,
          volumeCm3: 4,
          models: body.models,
          dimensions: { xMm: 20, yMm: 20, zMm: 20 },
        },
        colourId: body.colourId,
        colorId: body.colourId,
        finishId: body.finishId,
        infillTierId: body.infillTierId,
      }],
    }),
  });
  const cartData = await cart.json().catch(() => ({}));
  if (cart.status !== 400 || cartData.code !== 'MATERIAL_UNAVAILABLE') {
    throw new Error(`/api/customer/cart-preview non-FDM returned ${cart.status}/${cartData.code || 'no-code'}`);
  }
  console.log('✓ non-FDM cart-preview material is rejected');
}

async function expectPostJson(path, body, expectedStatus) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!expectedStatus.includes(res.status)) {
    throw new Error(`${path} returned ${res.status}, expected ${expectedStatus.join('/')}`);
  }
  console.log(`✓ ${path} -> ${res.status}`);
}

async function expectStripeCheckoutRequiresIdempotencyKey() {
  const res = await fetch(`${base}/api/stripe/create-payment-intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      paymentMethodId: 'pm_smoke',
      shopSlug: 'mahi3d',
      amount: 1,
      customerEmail: 'security-smoke@example.test',
      customerName: 'Security Smoke',
      orderData: { shopSlug: 'mahi3d', items: [] },
      restrictedItemsCertification: {
        accepted: true,
        version: 'restricted-items-v1-2026-05-24',
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== 400 || data.code !== 'CHECKOUT_IDEMPOTENCY_REQUIRED') {
    throw new Error(`/api/stripe/create-payment-intent missing checkout idempotency returned ${res.status}/${data.code || 'no-code'}`);
  }
  console.log('✓ Stripe checkout requires a checkout idempotency key');
}

function sessionCookieFrom(res) {
  const raw = res.headers.get('set-cookie') || '';
  const match = raw.match(/connect\.sid=[^;]+/);
  return match ? match[0] : '';
}

async function freshAnonymousSessionCookie() {
  const res = await fetch(`${base}/api/csrf-token`);
  if (res.status !== 200) throw new Error(`/api/csrf-token returned ${res.status}`);
  const cookie = sessionCookieFrom(res);
  if (!cookie) throw new Error('/api/csrf-token did not issue an anonymous session cookie');
  return cookie;
}

async function expectLoginRotatesSession(path, body, label) {
  const beforeCookie = await freshAnonymousSessionCookie();
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Smoke-Test': '1',
      Cookie: beforeCookie,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${label} login returned ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  const afterCookie = sessionCookieFrom(res);
  if (!afterCookie) throw new Error(`${label} login did not issue a fresh authenticated session cookie`);
  if (afterCookie === beforeCookie) throw new Error(`${label} login reused the pre-auth session cookie`);
  console.log(`✓ ${label} login rotates the pre-auth session id`);
  return afterCookie;
}

async function csrfHeadersFor(cookie) {
  const res = await fetch(`${base}/api/csrf-token`, { headers: { Cookie: cookie } });
  if (res.status !== 200) throw new Error(`/api/csrf-token with authenticated cookie returned ${res.status}`);
  const data = await res.json().catch(() => ({}));
  if (!data.csrfToken) throw new Error('/api/csrf-token did not return a CSRF token');
  return {
    Cookie: cookie,
    'Content-Type': 'application/json',
    'X-CSRF-Token': data.csrfToken,
  };
}

function expectLogoutClearsCookie(res, label) {
  const raw = res.headers.get('set-cookie') || '';
  if (!/connect\.sid=;/i.test(raw) || !/(max-age=0|expires=Thu, 01 Jan 1970)/i.test(raw)) {
    throw new Error(`${label} logout should clear the browser session cookie`);
  }
}

async function expectLogoutInvalidatesSession({ logoutPath, probePath, cookie, label }) {
  const res = await fetch(`${base}${logoutPath}`, {
    method: 'POST',
    headers: await csrfHeadersFor(cookie),
    body: '{}',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== 200 || data.ok !== true) {
    throw new Error(`${label} logout returned ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  expectLogoutClearsCookie(res, label);
  const probe = await fetch(`${base}${probePath}`, { headers: { Cookie: cookie } });
  if (probe.status !== 401) {
    throw new Error(`${label} old session still reached ${probePath}: ${probe.status}`);
  }
  console.log(`✓ ${label} logout clears and invalidates the authenticated session`);
}

function signedSessionCookie(sid) {
  return `connect.sid=${encodeURIComponent(`s:${signature.sign(sid, sessionSecret)}`)}`;
}

function createAppSessionCookie(sessionPatch, label = 'smoke') {
  const sid = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const expires = Date.now() + 15 * 60 * 1000;
  db.prepare(`
    INSERT INTO app_sessions (sid, sess, expires_at)
    VALUES (?, ?, ?)
  `).run(sid, JSON.stringify({
    cookie: {
      originalMaxAge: 15 * 60 * 1000,
      expires: new Date(expires).toISOString(),
      secure: false,
      httpOnly: true,
      path: '/',
      sameSite: 'strict',
    },
    ...sessionPatch,
  }), expires);
  syntheticSessionIds.push(sid);
  return { sid, cookie: signedSessionCookie(sid) };
}

function createPlatformSessionCookie() {
  const created = createAppSessionCookie({ platformAdmin: true, platformAdminId: 1 }, 'platform-logout');
  platformLogoutSessionId = created.sid;
  return created.cookie;
}

async function expectProbeUnauthorized(path, cookie, label) {
  const probe = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
  if (probe.status !== 401) {
    throw new Error(`${label} old session still reached ${path}: ${probe.status}`);
  }
}

async function expectPasswordChangesRevokeSessions(creds) {
  const shopCookie = await expectLoginRotatesSession('/api/auth/login', {
    email: creds.shopEmail,
    password: creds.password,
  }, 'shop admin password-change');
  const staleShop = createAppSessionCookie({ shopId: sessionFixationShopId }, 'shop-stale');
  const shopChange = await fetch(`${base}/api/auth/change-password`, {
    method: 'POST',
    headers: { ...(await csrfHeadersFor(shopCookie)), 'X-Smoke-Test': '1' },
    body: JSON.stringify({
      currentPassword: creds.password,
      newPassword: creds.changedShopPassword,
    }),
  });
  if (shopChange.status !== 200) {
    throw new Error(`shop password change returned ${shopChange.status}`);
  }
  await expectProbeUnauthorized('/api/auth/me', staleShop.cookie, 'shop password change');
  console.log('✓ shop password change revokes existing sessions');

  const customerCookie = await expectLoginRotatesSession('/api/customer/login', {
    shopSlug: creds.slug,
    email: creds.customerEmail,
    password: creds.password,
  }, 'customer password-change');
  const staleCustomer = createAppSessionCookie({
    customerId: sessionFixationCustomerId,
    customerShopId: sessionFixationShopId,
  }, 'customer-stale');
  const customerChange = await fetch(`${base}/api/customer/change-password`, {
    method: 'POST',
    headers: { ...(await csrfHeadersFor(customerCookie)), 'X-Smoke-Test': '1' },
    body: JSON.stringify({
      currentPassword: creds.password,
      newPassword: creds.changedCustomerPassword,
    }),
  });
  if (customerChange.status !== 200) {
    throw new Error(`customer password change returned ${customerChange.status}`);
  }
  await expectProbeUnauthorized(`/api/customer/me?shop=${encodeURIComponent(creds.slug)}`, staleCustomer.cookie, 'customer password change');
  console.log('✓ customer password change revokes existing sessions');

  const staleShopReset = createAppSessionCookie({ shopId: sessionFixationShopId }, 'shop-reset-stale');
  const shopRaceToken = jwt.sign({ shopId: sessionFixationShopId, jti: randomUUID() }, process.env.JWT_SECRET, { expiresIn: '1h' });
  db.prepare(`
    INSERT INTO reset_tokens (shop_id, token, expires_at)
    VALUES (?, ?, datetime('now', '+1 hour'))
  `).run(sessionFixationShopId, resetTokenDigest(shopRaceToken));
  const shopRaceAttempts = await Promise.all([
    fetch(`${base}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Smoke-Test': '1' },
      body: JSON.stringify({ token: shopRaceToken, newPassword: `${creds.resetShopPassword}A!` }),
    }),
    fetch(`${base}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Smoke-Test': '1' },
      body: JSON.stringify({ token: shopRaceToken, newPassword: `${creds.resetShopPassword}B!` }),
    }),
  ]);
  const shopRaceStatuses = shopRaceAttempts.map(res => res.status);
  if (shopRaceStatuses.filter(status => status === 200).length !== 1 || shopRaceStatuses.filter(status => status === 400).length !== 1) {
    throw new Error(`shop reset token race should allow exactly one reset, got ${shopRaceStatuses.join(', ')}`);
  }
  console.log('✓ shop password reset token is single-use under concurrent submissions');

  const shopResetToken = jwt.sign({ shopId: sessionFixationShopId }, process.env.JWT_SECRET, { expiresIn: '1h' });
  db.prepare(`
    INSERT INTO reset_tokens (shop_id, token, expires_at)
    VALUES (?, ?, datetime('now', '+1 hour'))
  `).run(sessionFixationShopId, resetTokenDigest(shopResetToken));
  const shopReset = await fetch(`${base}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Smoke-Test': '1' },
    body: JSON.stringify({ token: shopResetToken, newPassword: creds.resetShopPassword }),
  });
  if (shopReset.status !== 200) {
    throw new Error(`shop reset password returned ${shopReset.status}`);
  }
  await expectProbeUnauthorized('/api/auth/me', staleShopReset.cookie, 'shop password reset');
  console.log('✓ shop password reset revokes existing sessions');

  const staleCustomerReset = createAppSessionCookie({
    customerId: sessionFixationCustomerId,
    customerShopId: sessionFixationShopId,
  }, 'customer-reset-stale');
  const customerRaceToken = jwt.sign(
    { customerAccountId: sessionFixationCustomerId, shopId: sessionFixationShopId, jti: randomUUID() },
    process.env.JWT_SECRET || 'dev-jwt-secret',
    { expiresIn: '1h' }
  );
  db.prepare(`
    INSERT INTO customer_reset_tokens (shop_id, customer_account_id, token, expires_at)
    VALUES (?, ?, ?, datetime('now', '+1 hour'))
  `).run(sessionFixationShopId, sessionFixationCustomerId, resetTokenDigest(customerRaceToken));
  const customerRaceAttempts = await Promise.all([
    fetch(`${base}/api/customer/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Smoke-Test': '1' },
      body: JSON.stringify({ token: customerRaceToken, newPassword: `${creds.resetCustomerPassword}A!` }),
    }),
    fetch(`${base}/api/customer/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Smoke-Test': '1' },
      body: JSON.stringify({ token: customerRaceToken, newPassword: `${creds.resetCustomerPassword}B!` }),
    }),
  ]);
  const customerRaceStatuses = customerRaceAttempts.map(res => res.status);
  if (customerRaceStatuses.filter(status => status === 200).length !== 1 || customerRaceStatuses.filter(status => status === 400).length !== 1) {
    throw new Error(`customer reset token race should allow exactly one reset, got ${customerRaceStatuses.join(', ')}`);
  }
  console.log('✓ customer password reset token is single-use under concurrent submissions');

  const customerResetToken = jwt.sign(
    { customerAccountId: sessionFixationCustomerId, shopId: sessionFixationShopId },
    process.env.JWT_SECRET || 'dev-jwt-secret',
    { expiresIn: '1h' }
  );
  db.prepare(`
    INSERT INTO customer_reset_tokens (shop_id, customer_account_id, token, expires_at)
    VALUES (?, ?, ?, datetime('now', '+1 hour'))
  `).run(sessionFixationShopId, sessionFixationCustomerId, resetTokenDigest(customerResetToken));
  const customerReset = await fetch(`${base}/api/customer/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Smoke-Test': '1' },
    body: JSON.stringify({ token: customerResetToken, newPassword: creds.resetCustomerPassword }),
  });
  if (customerReset.status !== 200) {
    throw new Error(`customer reset password returned ${customerReset.status}`);
  }
  await expectProbeUnauthorized(`/api/customer/me?shop=${encodeURIComponent(creds.slug)}`, staleCustomerReset.cookie, 'customer password reset');
  console.log('✓ customer password reset revokes existing sessions');
}

async function expectAuthenticatedLoginsRotateSessions() {
  const creds = globalThis.sessionFixationSmoke;
  if (!creds) {
    console.log('↷ session rotation login checks skipped (temporary shop unavailable)');
    return;
  }
  const shopCookie = await expectLoginRotatesSession('/api/auth/login', {
    email: creds.shopEmail,
    password: creds.password,
  }, 'shop admin');
  const customerCookie = await expectLoginRotatesSession('/api/customer/login', {
    shopSlug: creds.slug,
    email: creds.customerEmail,
    password: creds.password,
  }, 'customer');

  const platformSource = readFileSync('routes/platform.js', 'utf8');
  if (!/await regenerateSession\(req\);\s*req\.session\.platformAdmin\s*=\s*true/s.test(platformSource)) {
    throw new Error('Platform login must regenerate the session before setting platform auth state');
  }
  if (!/if \(new_password\) \{\s*revokePlatformSessions\(db, \{ exceptSid: req\.sessionID \}\);/s.test(platformSource)) {
    throw new Error('Platform password change must revoke other platform sessions');
  }
  if (!/if \(!markPlatformResetTokenUsed\(token\)\) \{\s*return res\.status\(400\)\.json\(\{ error: 'Token expired or invalid' \}\);\s*\}\s*await updatePlatformAdminAccount\(\{ newPassword \}\);\s*revokePlatformSessions\(db\);/s.test(platformSource)) {
    throw new Error('Platform password reset must revoke platform sessions');
  }
  console.log('✓ platform login source regenerates session before auth state is used');

  await expectLogoutInvalidatesSession({
    logoutPath: '/api/auth/logout',
    probePath: '/api/auth/me',
    cookie: shopCookie,
    label: 'shop admin',
  });
  await expectLogoutInvalidatesSession({
    logoutPath: '/api/customer/logout',
    probePath: `/api/customer/me?shop=${encodeURIComponent(creds.slug)}`,
    cookie: customerCookie,
    label: 'customer',
  });

  const platformCookie = createPlatformSessionCookie();
  await expectLogoutInvalidatesSession({
    logoutPath: '/api/platform/logout',
    probePath: '/api/platform/me',
    cookie: platformCookie,
    label: 'platform',
  });
  const platformSession = db.prepare('SELECT sid FROM app_sessions WHERE sid = ?').get(platformLogoutSessionId);
  if (platformSession) throw new Error('Platform logout left the server-side session row behind');

  await expectPasswordChangesRevokeSessions(creds);
}

async function expectPublicOrderTokenBoundary() {
  if (!tempOrderId || !tempOrderToken) {
    console.log('↷ public order token boundary skipped (no demo shop available)');
    return;
  }
  await expectStatus(`/api/orders/public/${tempOrderId}`, [400]);
  await expectStatus(`/api/orders/public/${tempOrderId}?token=wrong`, [404]);
  const res = await fetch(`${base}/api/orders/public/${tempOrderId}?token=${encodeURIComponent(tempOrderToken)}`);
  if (res.status !== 200) throw new Error(`/api/orders/public/${tempOrderId}?token=<valid> returned ${res.status}`);
  const data = await res.json();
  if ('customer_email' in data || 'customer_name' in data) {
    throw new Error('/api/orders/public returned customer PII');
  }
  console.log('✓ /api/orders/public/:id requires token and omits customer PII');
}

async function expectOversizeRejectedIfConfigured() {
  const res = await fetch(`${base}/api/customer/catalog?shop=mahi3d`);
  if (!res.ok) throw new Error(`/api/customer/catalog?shop=mahi3d returned ${res.status}`);
  const catalog = await res.json();
  const material = (catalog.materials || []).find(m =>
    Number(m.max_x_mm) > 0 || Number(m.max_y_mm) > 0 || Number(m.max_z_mm) > 0
  );
  if (!material) {
    console.log('↷ oversized quote rejection skipped (no material size limits configured)');
    return;
  }

  const dimensions = {
    xMm: Number(material.max_x_mm) > 0 ? Number(material.max_x_mm) + 1 : 1,
    yMm: Number(material.max_y_mm) > 0 ? Number(material.max_y_mm) + 1 : 1,
    zMm: Number(material.max_z_mm) > 0 ? Number(material.max_z_mm) + 1 : 1,
  };
  const body = {
    shopSlug: 'mahi3d',
    materialId: material.id,
    volumeCm3: 1,
    dimensions,
    colourId: material.colours?.[0]?.id || null,
    finishId: material.finishes?.[0]?.id || null,
    quantity: 1,
  };
  const missingDimensions = await fetch(`${base}/api/customer/quote-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, dimensions: null }),
  });
  const missingData = await missingDimensions.json().catch(() => ({}));
  if (missingDimensions.status !== 400 || missingData.code !== 'MODEL_DIMENSIONS_REQUIRED') {
    throw new Error(`/api/customer/quote-preview missing dimensions returned ${missingDimensions.status}/${missingData.code || 'no-code'}`);
  }
  console.log('✓ size-limited quote requires dimensions -> 400');

  const quote = await fetch(`${base}/api/customer/quote-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await quote.json().catch(() => ({}));
  if (quote.status !== 400 || !['MODEL_TOO_LARGE', 'MODEL_DIMENSIONS_REQUIRED'].includes(data.code)) {
    throw new Error(`/api/customer/quote-preview oversize returned ${quote.status}/${data.code || 'no-code'}`);
  }
  console.log('✓ oversized quote rejection -> 400');
}

function expectPlatformEnvFallbackLockedAfterBootstrap() {
  const source = readFileSync('lib/platform-auth.js', 'utf8');
  if (!/if \(admin\?\.\password_hash\) \{\s*return await bcrypt\.compare\(password \|\| '', admin\.password_hash\);\s*\}/s.test(source)) {
    throw new Error('Platform env password fallback must be disabled once a DB password hash exists');
  }
  console.log('✓ platform env fallback is bootstrap-only after DB password exists');
}

function expectResetTokensStoredAsDigests() {
  const adminAuth = readFileSync('routes/auth.js', 'utf8');
  const customerAuth = readFileSync('routes/customer-portal.js', 'utf8');
  const platformAuth = readFileSync('lib/platform-auth.js', 'utf8');
  for (const [label, source] of [
    ['shop admin reset', adminAuth],
    ['customer reset', customerAuth],
    ['platform reset', platformAuth],
  ]) {
    if (!source.includes('resetTokenDigest(token)') || !source.includes('resetTokenLookupValues(token)')) {
      throw new Error(`${label} flow must store reset token digests and look up by digest`);
    }
    if (!/UPDATE [a-z_]*reset_tokens\s*[\s\S]*SET used = 1\s*[\s\S]*AND used = 0\s*[\s\S]*AND expires_at > datetime\('now'\)/.test(source)) {
      throw new Error(`${label} flow must atomically claim unused reset tokens before changing passwords`);
    }
  }
  console.log('✓ password reset tokens are stored as digests with legacy lookup fallback');
}

expectPlatformEnvFallbackLockedAfterBootstrap();
expectResetTokensStoredAsDigests();
await expectStatus('/backend/server.js', [404]);
await expectStatus('/backend/data/rfdewi.db', [404]);
await expectStatus('/.git/config', [404]);
await expectStatus('/SECURITY.md', [404]);
await expectStatus('/research/.env', [404]);
await expectStatus('/research/data/discovered-prospects.json', [404]);
await expectSecurityHeaders();
await expectUploadsServeImagesOnly();
await expectStatus('/api/platform/shops', [401]);
await expectStatus('/api/platform/stats', [401]);
await expectStatus('/api/platform/overview', [401]);
await expectStatus('/api/platform/shops/1/overview', [401]);
await expectStatus('/api/platform/orders', [401]);
await expectStatus('/api/platform/orders/1', [401]);
await expectStatus('/api/platform/customers', [401]);
await expectStatus('/api/platform/audit-events', [401]);
if (existingOrderId) {
  await expectStatus(`/api/orders/public/${existingOrderId}`, [400]);
} else {
  await expectStatus('/api/orders/public/1', [400, 404]);
}
await expectPublicOrderTokenBoundary();
await expectStatus('/api/settings', [401]);
await expectPostJson('/api/settings/logo', {}, [401]);
await expectStatus('/api/pricing', [401]);
await expectStatus('/api/materials', [401]);
await expectStatus('/api/customer/me', [401]);
await expectStatus('/api/customer/orders', [401]);
await expectJson('/api/customer/catalog?shop=mahi3d', ['materials', 'settings']);
await expectFdmOnlyCustomerMaterialApis();
await expectJson('/api/customer/exchange-rates?base=NZD&quotes=AUD,USD,GBP,EUR,CAD,JPY,SGD,HKD,CHF,CNY', ['base', 'rates', 'provider', 'stale']);
await expectPostJson('/api/customer/quote-preview', { shopSlug: 'mahi3d' }, [400]);
await expectNonFdmQuoteRejected();
await expectPostJson('/api/materials/assets', {}, [401]);
await expectPostJson('/api/stripe/create-payment-intent', {}, [400, 429]);
await expectStripeCheckoutRequiresIdempotencyKey();
await expectPostJson('/api/customer/change-password', {}, [401, 429]);
await expectOversizeRejectedIfConfigured();
await expectAuthenticatedLoginsRotateSessions();

cleanup();
console.log('Security smoke checks passed.');

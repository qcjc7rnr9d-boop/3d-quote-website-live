import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import dotenv from 'dotenv';
import { DatabaseSync } from 'node:sqlite';
import { parseInfillTiers } from '../lib/infill-tiers.js';

dotenv.config();

const require = createRequire(import.meta.url);
const signature = require('cookie-signature');
const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const secret = process.env.SESSION_SECRET || 'dev-secret-change-me';
const slug = process.env.PILOT_SHOP_SLUG || 'trennen-pilot';
const db = new DatabaseSync('data/rfdewi.db');
const sessionIds = [];

function parseJson(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function makeCookie(session) {
  const sid = randomUUID();
  sessionIds.push(sid);
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
    ...session,
  }), expires);
  return `connect.sid=${encodeURIComponent(`s:${signature.sign(sid, secret)}`)}`;
}

async function request(path, {
  method = 'GET',
  body,
  cookie,
  expected = 200,
  headers = {},
} = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
  const expectedStatuses = Array.isArray(expected) ? expected : [expected];
  if (!expectedStatuses.includes(res.status)) {
    throw new Error(`${method} ${path} returned ${res.status}, expected ${expectedStatuses.join('/')} ${JSON.stringify(data).slice(0, 400)}`);
  }
  return { res, data };
}

async function csrfHeaders(cookie) {
  const { data } = await request('/api/csrf-token', { cookie });
  assert.ok(data.csrfToken, 'CSRF token route should return a token');
  return { Cookie: cookie, 'X-CSRF-Token': data.csrfToken };
}

function firstActive(list) {
  return (Array.isArray(list) ? list : []).find(item => item && item.active !== false && item.enabled !== false) || null;
}

try {
  const shop = db.prepare('SELECT * FROM shops WHERE slug = ?').get(slug);
  assert.ok(shop, `Pilot shop ${slug} is missing; run npm run pilot:seed:trennen first`);
  assert.equal(shop.plan, 'community', 'pilot shop must stay on the free community plan');
  assert.equal(shop.billing_status, 'active', 'free pilot billing should be active');

  const pricing = db.prepare('SELECT * FROM pricing_config WHERE shop_id = ?').get(shop.id);
  assert.ok(pricing, 'pilot pricing_config is missing');
  assert.equal(pricing.currency, 'NZD');
  assert.ok(Number(pricing.min_order_value) >= 0, 'pilot minimum order should be configured');

  const settings = db.prepare('SELECT * FROM store_settings WHERE shop_id = ?').get(shop.id);
  assert.ok(settings, 'pilot store_settings are missing');
  const shipping = parseJson(settings.shipping_zones, []);
  assert.ok(shipping.filter(s => s.active !== false).length >= 2, 'pilot needs at least two active shipping methods');
  assert.equal(settings.support_email_mode, 'custom', 'pilot should use a custom support email');
  assert.match(settings.support_email || '', /@trennen\.co\.nz$/i, 'pilot support email should be a Trennen address');
  assert.equal(settings.payment_fee_mode, 'merchant_absorbs', 'pilot should include Trennen/order fees in the customer-facing price');

  const materials = db.prepare('SELECT * FROM materials WHERE shop_id = ? AND active = 1 ORDER BY sort_order, id').all(shop.id);
  assert.ok(materials.length >= 3, `pilot needs at least three active materials, got ${materials.length}`);

  const platformFee = db.prepare('SELECT platform_fee_percent FROM platform_settings WHERE id = 1').get()?.platform_fee_percent;
  assert.equal(Number(platformFee), 5, 'Trennen platform fee should default to 5%');

  const shopCookie = makeCookie({ shopId: shop.id });
  const platformCookie = makeCookie({ platformAdmin: true, platformAdminId: 1 });
  const customer = db.prepare('SELECT * FROM customer_accounts WHERE shop_id = ? ORDER BY id LIMIT 1').get(shop.id);
  assert.ok(customer, 'pilot customer account is missing');
  const customerCookie = makeCookie({ customerId: customer.id, customerShopId: shop.id });

  await request('/api/health');

  const { data: catalog } = await request(`/api/customer/catalog?shop=${encodeURIComponent(slug)}`);
  assert.ok(Array.isArray(catalog.materials) && catalog.materials.length >= 3, 'customer catalog should return pilot materials');
  assert.ok(catalog.settings?.heading, 'customer catalog should include material-page settings');

  const { data: rates } = await request('/api/shipping/rates', {
    method: 'POST',
    body: { shopSlug: slug },
  });
  assert.ok(Array.isArray(rates.rates) && rates.rates.length >= 2, 'shipping rates should return at least two methods');

  const material = materials[0];
  const colours = parseJson(material.colours, []);
  const finishes = parseJson(material.finishes, []);
  const infill = firstActive(parseInfillTiers(pricing.infill_tiers));
  const quoteBody = {
    shopSlug: slug,
    materialId: material.id,
    colourId: firstActive(colours)?.id,
    finishId: firstActive(finishes)?.id,
    infillTierId: infill?.id,
    shippingId: rates.rates[0]?.id,
    quantity: 1,
    volumeCm3: 18,
    dimensions: { xMm: 40, yMm: 30, zMm: 20 },
    models: [{
      id: 'pilot-smoke-model',
      name: 'pilot-smoke.stl',
      size: 2048,
      volumeCm3: 18,
      quantity: 1,
      dimensions: { xMm: 40, yMm: 30, zMm: 20 },
    }],
  };
  const { data: quote } = await request('/api/customer/quote-preview', {
    method: 'POST',
    body: quoteBody,
  });
  assert.equal(quote.ok, true, 'quote preview should succeed for pilot shop');
  assert.equal(quote.currency, 'NZD');
  assert.equal(quote.lineItems?.platformFeePercent, 5);
  assert.ok(quote.lineItems?.sellerNetTotal > 0, 'quote should include sellerNetTotal');
  assert.ok(quote.lineItems?.platformFeeIncluded > 0, 'quote should include the 5% platform fee inside the total');
  assert.equal(quote.lineItems.total, quote.totalCents / 100, 'quote total should match totalCents');

  const { data: adminMaterials } = await request('/api/materials', { cookie: shopCookie });
  const shopCsrf = await csrfHeaders(shopCookie);
  const platformCsrf = await csrfHeaders(platformCookie);
  assert.ok(adminMaterials.length >= 3, 'admin materials API should list pilot materials');
  const patchMaterial = adminMaterials[0];
  await request(`/api/materials/${patchMaterial.id}`, {
    method: 'PATCH',
    headers: shopCsrf,
    body: {
      name: patchMaterial.name,
      active: patchMaterial.active,
      sort_order: patchMaterial.sort_order,
      colours: patchMaterial.colours,
      finishes: patchMaterial.finishes,
      tags: patchMaterial.tags,
      best_for: patchMaterial.best_for,
      specs: patchMaterial.specs,
      properties: patchMaterial.properties,
    },
  });

  const { data: adminPricing } = await request('/api/pricing', { cookie: shopCookie });
  await request('/api/pricing', {
    method: 'PUT',
    headers: shopCsrf,
    body: {
      ...adminPricing,
      currency: 'NZD',
      tax_inclusive: !!adminPricing.tax_inclusive,
      show_breakdown: !!adminPricing.show_breakdown,
      mat_include_support: !!adminPricing.mat_include_support,
      time_include_support: !!adminPricing.time_include_support,
    },
  });

  const { data: adminSettings } = await request('/api/settings', { cookie: shopCookie });
  await request('/api/settings', {
    method: 'PUT',
    headers: shopCsrf,
    body: {
      ...adminSettings,
      support_email_mode: 'custom',
      support_email: settings.support_email,
      invoice_logo: !!adminSettings.invoice_logo,
      email_use_platform_fallback: adminSettings.email_domain?.use_platform_fallback !== false,
    },
  });

  const { data: orders } = await request('/api/orders?limit=10', { cookie: shopCookie });
  assert.ok(Array.isArray(orders.orders), 'admin orders API should return an order list');
  const pilotOrder = orders.orders.find(order => order.customer_email === customer.email);
  assert.ok(pilotOrder, 'seeded pilot order should appear in admin orders');
  await request(`/api/orders/${pilotOrder.id}`, { cookie: shopCookie });

  const { data: customers } = await request('/api/customers', { cookie: shopCookie });
  assert.ok(Array.isArray(customers), 'admin customers API should return a customer list');
  const pilotCustomer = customers.find(row => row.email === customer.email);
  assert.ok(pilotCustomer, 'pilot customer should appear in admin customers');
  await request(`/api/customers/${pilotCustomer.id}`, { cookie: shopCookie });

  const { data: paymentStatus } = await request('/api/stripe/keys-status', { cookie: shopCookie, expected: [200, 500] });
  if (paymentStatus.error) {
    assert.match(paymentStatus.error, /Stripe|status|load/i, 'payments status error should be clear');
  } else {
    assert.equal(paymentStatus.billing_active, true, 'free pilot should not require Stripe Billing subscription');
    if (shop.stripe_account_id) {
      assert.ok(paymentStatus.connected_account_id, 'payments status should include connected account id when attached');
    }
  }

  const publicKey = await request(`/api/stripe/public-key?shop=${encodeURIComponent(slug)}`, { expected: [200, 409, 503] });
  if (publicKey.res.status !== 200) {
    assert.ok(
      ['PLATFORM_STRIPE_NOT_CONFIGURED', 'NO_CONNECTED_ACCOUNT', 'ONBOARDING_INCOMPLETE'].includes(publicKey.data.code),
      `checkout blocker should be a known readiness code, got ${publicKey.data.code}`,
    );
  }

  const { data: me } = await request(`/api/customer/me?shop=${encodeURIComponent(slug)}`, { cookie: customerCookie });
  assert.equal(me.shop?.slug, slug, 'customer portal /me should be scoped to pilot shop');
  const { data: customerOrders } = await request(`/api/customer/orders?shop=${encodeURIComponent(slug)}`, { cookie: customerCookie });
  assert.ok(Array.isArray(customerOrders), 'customer portal orders should return an array');
  assert.ok(customerOrders.some(order => order.id === pilotOrder.id), 'customer portal should show the seeded pilot order');

  const { data: platformShops } = await request('/api/platform/shops', { cookie: platformCookie });
  assert.ok(Array.isArray(platformShops), 'platform shop list should return an array');
  assert.ok(platformShops.some(row => row.slug === slug && row.plan === 'community'), 'platform shop list should include free pilot shop');
  const { data: overview } = await request(`/api/platform/shops/${shop.id}/overview`, { cookie: platformCookie });
  assert.equal(overview.shop?.slug, slug, 'platform shop overview should load the pilot shop');
  assert.equal(overview.shop?.plan, 'community', 'platform overview should report free pilot plan');
  const billingRes = await request(`/api/platform/shops/${shop.id}/billing-session`, {
    method: 'POST',
    headers: platformCsrf,
    expected: 400,
  });
  assert.equal(billingRes.data.code, 'FREE_PLAN_NO_BILLING_REQUIRED');

  console.log('Controlled pilot rehearsal smoke checks passed.');
} finally {
  for (const sid of sessionIds) {
    db.prepare('DELETE FROM app_sessions WHERE sid = ?').run(sid);
  }
  db.close();
}

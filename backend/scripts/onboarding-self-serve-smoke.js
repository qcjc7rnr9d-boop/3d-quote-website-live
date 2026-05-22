import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const backendRoot = resolve(root, 'backend');
const port = Number(process.env.ONBOARDING_SMOKE_PORT || 3187);
const base = process.env.SMOKE_BASE_URL || `http://127.0.0.1:${port}`;
const suffix = randomUUID().slice(0, 8);
const slug = `layerworks-${suffix}`;
const email = `owner-${suffix}@example.test`;
const password = 'TestPass!234';
const db = new DatabaseSync(resolve(backendRoot, 'data/rfdewi.db'));

function cleanup() {
  db.prepare('DELETE FROM shops WHERE slug = ? OR email = ?').run(slug, email);
}

function parseCookie(headers) {
  const raw = headers.get('set-cookie') || '';
  return raw.split(',').map(part => part.split(';')[0]).filter(Boolean).join('; ');
}

async function json(path, options = {}, expectedStatus = 200) {
  const res = await fetch(`${base}${path}`, {
    redirect: 'manual',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  assert.equal(res.status, expectedStatus, `${path} expected ${expectedStatus}, got ${res.status}: ${text}`);
  return { res, data };
}

async function text(path, expectedStatus = 200) {
  const res = await fetch(`${base}${path}`, { redirect: 'manual' });
  const body = await res.text();
  assert.equal(res.status, expectedStatus, `${path} expected ${expectedStatus}, got ${res.status}: ${body.slice(0, 500)}`);
  return { res, body };
}

async function csrfToken(cookie) {
  const token = await json('/api/csrf-token', { headers: { Cookie: cookie } });
  assert.equal(typeof token.data.csrfToken, 'string', 'Authenticated setup smoke should receive a CSRF token');
  return token.data.csrfToken;
}

function startServer() {
  if (process.env.SMOKE_BASE_URL) return null;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: backendRoot,
    env: {
      ...process.env,
      PORT: String(port),
      SESSION_SECRET: process.env.SESSION_SECRET || 'onboarding-smoke-session-secret',
      JWT_SECRET: process.env.JWT_SECRET || 'onboarding-smoke-jwt-secret',
      BASE_URL: base,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => process.stdout.write(`[server] ${chunk}`));
  child.stderr.on('data', chunk => process.stderr.write(`[server] ${chunk}`));
  return child;
}

async function waitForServer(child) {
  const deadline = Date.now() + 10_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child?.exitCode != null) throw new Error(`Server exited before smoke test could run (${child.exitCode})`);
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch (err) {
      lastError = err;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw lastError || new Error('Timed out waiting for onboarding smoke server');
}

const onboardingHtml = readFileSync(resolve(root, 'onboarding.html'), 'utf8');
const onboardingJs = readFileSync(resolve(root, 'assets/onboarding.js'), 'utf8');
const setupHtml = readFileSync(resolve(root, 'admin/setup.html'), 'utf8');
const settingsHtml = readFileSync(resolve(root, 'admin/settings.html'), 'utf8');

assert.match(onboardingHtml, /name="shopName"/, 'Onboarding form should collect the shop name directly');
assert.match(onboardingHtml, /name="slug"/, 'Onboarding form should collect a shop slug');
assert.match(onboardingHtml, /name="password"/, 'Onboarding form should collect an owner password');
assert.match(onboardingJs, /\/api\/onboarding\/slug-availability/, 'Onboarding UI should check slug availability');
assert.match(onboardingJs, /\/api\/onboarding\/signup/, 'Onboarding UI should submit to the self-serve signup API');
assert.doesNotMatch(onboardingJs, /\/api\/sales\/demo-request/, 'Onboarding UI should no longer submit a sales lead');
assert.match(onboardingHtml, /quote\.html\?shop=mahi3d&amp;demoStart=1/, 'View demo should stay pointed at the Mahi3D clean demo');
assert.match(onboardingHtml, /admin\/setup\.html/, 'Onboarding page should reference the authenticated setup checklist');
assert.match(setupHtml, /Install Trennen/, 'Setup page should put install options near the start');
assert.match(setupHtml, /Use hosted page/, 'Setup page should offer a full hosted page option');
assert.match(setupHtml, /Embed on my website/, 'Setup page should offer a website embed option');
assert.match(setupHtml, /data-install-hosted-url/, 'Setup page should render the hosted shop URL');
assert.match(setupHtml, /data-install-iframe-code/, 'Setup page should render iframe embed code');
assert.match(setupHtml, /data-install-script-code/, 'Setup page should render script widget code');
assert.match(setupHtml, /function escHtml/, 'Setup page should define HTML escaping for dynamic checklist content');
assert.match(setupHtml, /escHtml\(detail\)/, 'Setup checklist should escape dynamic detail text before rendering HTML');
assert.doesNotMatch(settingsHtml, /cdn\.yourdomain\.com|your-shop-slug/, 'Settings install card should not use placeholder CDN or shop slug values');

let server = null;
try {
  cleanup();
  server = startServer();
  await waitForServer(server);

  const existing = await json('/api/onboarding/slug-availability?slug=mahi3d');
  assert.equal(existing.data.available, false, 'Existing demo slug should not be available');

  const available = await json(`/api/onboarding/slug-availability?slug=${encodeURIComponent(slug.toUpperCase())}`);
  assert.equal(available.data.slug, slug, 'Slug availability should normalize to lowercase kebab-case');
  assert.equal(available.data.available, true, 'Fresh smoke slug should be available');

  const weak = await json('/api/onboarding/signup', {
    method: 'POST',
    body: JSON.stringify({
      ownerName: 'Morgan Lee',
      shopName: 'LayerWorks Smoke',
      slug,
      email,
      password: 'weak',
      plan: 'starter',
      monthlyQuoteVolume: '1-25',
      paymentPath: 'bank_transfer_first',
    }),
  }, 400);
  assert.match(weak.data.errors?.password || '', /Password/i, 'Signup should reject weak owner passwords');

  const unsafeEmail = await json('/api/onboarding/signup', {
    method: 'POST',
    body: JSON.stringify({
      ownerName: 'Morgan Lee',
      shopName: 'LayerWorks Unsafe Email',
      slug: `${slug}-unsafe-email`,
      email: `<svg/onload=alert(1)>-${suffix}@example.test`,
      password,
      plan: 'starter',
      monthlyQuoteVolume: '1-25',
      paymentPath: 'bank_transfer_first',
    }),
  }, 400);
  assert.match(unsafeEmail.data.errors?.email || '', /valid work email/i, 'Signup should reject HTML-shaped owner emails');

  const created = await json('/api/onboarding/signup', {
    method: 'POST',
    body: JSON.stringify({
      ownerName: 'Morgan Lee',
      shopName: 'LayerWorks Smoke',
      slug,
      email,
      password,
      plan: 'starter',
      monthlyQuoteVolume: '1-25',
      paymentPath: 'bank_transfer_first',
    }),
  }, 201);

  const cookie = parseCookie(created.res.headers);
  assert(cookie.includes('connect.sid='), 'Signup should create a logged-in admin session');
  assert.equal(created.data.ok, true, 'Signup response should be explicit JSON');
  assert.equal(created.data.shop.slug, slug, 'Signup response should include the created shop slug');
  assert.equal(created.data.shop.plan, 'starter', 'Signup should preserve the selected Starter plan');
  assert.equal(created.data.redirectUrl, '/admin/setup.html', 'Signup should land owners on the setup checklist');

  const duplicateEmail = await json('/api/onboarding/signup', {
    method: 'POST',
    body: JSON.stringify({
      ownerName: 'Morgan Lee',
      shopName: 'LayerWorks Duplicate Email',
      slug: `${slug}-duplicate-email`,
      email,
      password,
      plan: 'starter',
      monthlyQuoteVolume: '1-25',
      paymentPath: 'bank_transfer_first',
    }),
  }, 409);
  assert.doesNotMatch(JSON.stringify(duplicateEmail.data), /already exists|registered|account with that email/i, 'Duplicate owner email signup should not reveal that the email exists');

  const me = await json('/api/auth/me', { headers: { Cookie: cookie } });
  assert.equal(me.data.slug, slug, 'Signup session should authenticate as the new shop');
  assert.equal(me.data.email, email, 'Signup session should expose the owner email');
  assert.equal(me.data.is_temp_password, 0, 'Self-serve owners should not be forced through temp-password reset');

  const shop = db.prepare('SELECT * FROM shops WHERE slug = ?').get(slug);
  assert(shop, 'Signup should create a shops row');
  assert.equal(shop.name, 'LayerWorks Smoke', 'Shop row should store the shop name');
  assert.equal(shop.email, email, 'Shop row should normalize owner email');
  assert.equal(shop.plan, 'starter', 'Shop row should store Starter without changing pricing standards');
  assert.equal(shop.billing_status, 'trialing', 'Starter signup should begin on the plan trial while bank transfer is first');
  assert.equal(shop.billing_checkout_session_id, null, 'Bank-transfer-first signup should not create a Stripe checkout session');

  const auditEvent = db.prepare(`
    SELECT action, target_type, shop_id, metadata
    FROM platform_audit_events
    WHERE shop_id = ? AND action = 'self_serve_signup'
    ORDER BY id DESC
    LIMIT 1
  `).get(shop.id);
  assert(auditEvent, 'Signup should record a platform audit event for store ownership tracking');
  assert.equal(auditEvent.target_type, 'shop', 'Signup audit event should target the created shop');
  assert.equal(JSON.parse(auditEvent.metadata || '{}').source, 'self_serve', 'Signup audit metadata should mark self-serve origin');

  const pricing = db.prepare('SELECT * FROM pricing_config WHERE shop_id = ?').get(shop.id);
  assert(pricing, 'Signup should create pricing_config');
  assert.equal(pricing.currency, 'NZD', 'Pricing defaults should remain NZD');
  assert.equal(pricing.tax_rate, 0.15, 'Pricing defaults should preserve NZ GST');

  const settings = db.prepare('SELECT * FROM store_settings WHERE shop_id = ?').get(shop.id);
  assert(settings, 'Signup should create store_settings');
  assert.equal(settings.payment_fee_mode, 'bank_transfer_only', 'Signup should default payments to bank transfer only');
  assert.equal(settings.support_email_mode, 'hidden', 'Signup should keep the owner email private by default');

  const publicInfoDefault = await json(`/api/customer/shop-info?shop=${encodeURIComponent(slug)}`);
  assert.equal(publicInfoDefault.data.support_email, null, 'Public shop info should not expose the signup email by default');
  assert.equal(publicInfoDefault.data.support_email_mode, 'hidden', 'Public shop info should declare the hidden support-email mode');
  const { renderTemplate } = await import('../lib/email-templates/index.js');
  const hiddenSupportTemplate = renderTemplate('customer_welcome', {
    shop,
    customerName: 'Taylor',
    dashboardUrl: `${base}/customer/dashboard.html?shop=${slug}`,
  });
  assert.equal(hiddenSupportTemplate.replyTo, undefined, 'Customer emails should not use the owner email as Reply-To while support contact is hidden');

  const csrf = await csrfToken(cookie);
  await json('/api/settings', {
    method: 'PUT',
    headers: { Cookie: cookie, 'X-CSRF-Token': csrf },
    body: JSON.stringify({ support_email_mode: 'signup' }),
  });
  const publicInfoSignup = await json(`/api/customer/shop-info?shop=${encodeURIComponent(slug)}`);
  assert.equal(publicInfoSignup.data.support_email, email, 'Owner should be able to explicitly publish their signup email');
  assert.equal(publicInfoSignup.data.support_email_mode, 'signup', 'Public shop info should expose signup mode after explicit owner choice');
  const signupSupportTemplate = renderTemplate('customer_welcome', {
    shop,
    customerName: 'Taylor',
    dashboardUrl: `${base}/customer/dashboard.html?shop=${slug}`,
  });
  assert.equal(signupSupportTemplate.replyTo, email, 'Customer emails should use the owner email as Reply-To only after explicit owner choice');

  const customSupportEmail = `help-${suffix}@example.test`;
  await json('/api/settings', {
    method: 'PUT',
    headers: { Cookie: cookie, 'X-CSRF-Token': csrf },
    body: JSON.stringify({ support_email_mode: 'custom', support_email: customSupportEmail }),
  });
  const publicInfoCustom = await json(`/api/customer/shop-info?shop=${encodeURIComponent(slug)}`);
  assert.equal(publicInfoCustom.data.support_email, customSupportEmail, 'Owner should be able to explicitly publish a custom support email');
  assert.equal(publicInfoCustom.data.support_email_mode, 'custom', 'Public shop info should expose custom mode after explicit owner choice');
  const customSupportTemplate = renderTemplate('customer_welcome', {
    shop,
    customerName: 'Taylor',
    dashboardUrl: `${base}/customer/dashboard.html?shop=${slug}`,
  });
  assert.equal(customSupportTemplate.replyTo, customSupportEmail, 'Customer emails should use the custom support email as Reply-To after explicit owner choice');

  const materialCount = db.prepare('SELECT COUNT(*) AS c FROM materials WHERE shop_id = ? AND active = 1').get(shop.id).c;
  assert(materialCount >= 5, 'Signup should seed starter materials');

  const subscription = db.prepare('SELECT * FROM merchant_subscriptions WHERE shop_id = ?').get(shop.id);
  assert(subscription, 'Signup should create merchant subscription defaults');
  assert.equal(subscription.plan_id, 'starter', 'Merchant subscription should follow the selected plan');
  assert.equal(subscription.status, 'trialing', 'Merchant subscription should begin as trialing');
  assert(subscription.trial_start, 'Merchant subscription should record trial_start');
  assert(subscription.trial_end, 'Merchant subscription should record trial_end');

  const checkout = await json(`/api/billing/public-checkout-settings?shop=${encodeURIComponent(slug)}`);
  assert.equal(checkout.data.bank_transfer_enabled, true, 'Public checkout settings should allow bank transfer');
  assert.equal(checkout.data.card_enabled, false, 'Public checkout settings should keep cards off until the owner opts in later');

  const hostedDemo = await text('/q/mahi3d');
  assert.match(hostedDemo.body, /<iframe/i, 'Hosted /q/mahi3d should load the quote app in a full-page frame');
  assert.match(hostedDemo.body, /quote\.html\?shop=mahi3d|embed\/quote\?shop=mahi3d/i, 'Hosted /q/mahi3d should keep the shop slug in the page');

  const hostedNewShop = await text(`/q/${encodeURIComponent(slug)}`);
  assert.match(hostedNewShop.body, /<iframe/i, 'Hosted /q/:slug should load the quote app in a full-page frame');
  assert.match(hostedNewShop.body, new RegExp(slug), 'Hosted /q/:slug should include the new shop slug');

  await text('/q/not-a-real-shop', 404);

  console.log('Self-serve onboarding smoke checks passed.');
} finally {
  cleanup();
  db.close();
  if (server) {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('close', resolve));
  }
}

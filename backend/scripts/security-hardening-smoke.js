import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { generateTotpCode } from '../lib/mfa.js';

dotenv.config();

const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const db = new DatabaseSync('data/rfdewi.db');
const slug = `hardening-${randomUUID().slice(0, 8)}`;
const shopEmail = `${slug}@example.test`;
const customerEmail = `customer-${slug}@example.test`;
let shopId = null;
let cookie = '';
let csrfToken = '';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function api(path, options = {}, expected = 200) {
  const res = await fetch(`${base}${path}`, {
    redirect: 'manual',
    ...options,
    headers: {
      'X-Smoke-Test': '1',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== expected) {
    throw new Error(`${path} returned ${res.status}, expected ${expected}: ${JSON.stringify(data).slice(0, 400)}`);
  }
  const setCookie = res.headers.get('set-cookie');
  if (setCookie && setCookie.includes('connect.sid=')) {
    cookie = setCookie.split(';')[0];
  }
  return { res, data };
}

async function csrfHeaders() {
  const { data } = await api('/api/csrf-token');
  assert(data.csrfToken, 'CSRF token route must return a token');
  csrfToken = data.csrfToken;
  return { 'X-CSRF-Token': csrfToken };
}

try {
  const config = readFileSync('config.js', 'utf8');
  const authRoutes = readFileSync('routes/auth.js', 'utf8');
  const platformRoutes = readFileSync('routes/platform.js', 'utf8');
  const customerRoutes = readFileSync('routes/customer-portal.js', 'utf8');
  const hardeningLib = readFileSync('lib/security-hardening.js', 'utf8');
  const stripeRoutes = readFileSync('routes/stripe.js', 'utf8');
  const ordersAdmin = readFileSync('../admin/orders.html', 'utf8');

  assert(config.includes('MIN_PASSWORD_LENGTH  = 12'), 'minimum password length must be 12');
  assert(authRoutes.includes('/mfa/setup') && authRoutes.includes('/mfa/enable'), 'shop admin MFA setup/enable routes are required');
  assert(platformRoutes.includes('/mfa/setup') && platformRoutes.includes('/mfa/enable'), 'platform MFA setup/enable routes are required');
  assert(customerRoutes.includes('/verify-email'), 'customer email verification routes are required');
  assert(customerRoutes.includes('/sessions') && hardeningLib.includes('customer_sessions'), 'customer session management routes/table are required');
  assert(stripeRoutes.includes("router.post('/orders/:id/refund'"), 'Stripe refund endpoint is required');
  assert(stripeRoutes.includes('refund_application_fee') && stripeRoutes.includes('reverse_transfer'), 'Stripe refund must reverse transfer and application fee where possible');
  assert(ordersAdmin.includes('refundOrderBtn') && ordersAdmin.includes('/api/stripe/orders/'), 'admin orders UI must expose refund action');

  const hash = await bcrypt.hash('OwnerHardening!2026', 4);
  const created = db.prepare(`
    INSERT INTO shops (name, slug, email, password_hash, is_temp_password, plan)
    VALUES (?, ?, ?, ?, 0, 'starter')
  `).run('Security Hardening Smoke', slug, shopEmail, hash);
  shopId = created.lastInsertRowid;
  db.prepare('INSERT OR IGNORE INTO pricing_config (shop_id) VALUES (?)').run(shopId);
  db.prepare('INSERT OR IGNORE INTO store_settings (shop_id) VALUES (?)').run(shopId);

  const shopLogin = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: shopEmail, password: 'OwnerHardening!2026' }),
  });
  assert(shopLogin.data.ok === true, 'shop admin login must succeed before MFA is enabled');
  const shopCsrf = await csrfHeaders();
  const mfaSetup = await api('/api/auth/mfa/setup', {
    method: 'POST',
    headers: shopCsrf,
  });
  assert(mfaSetup.data.secret, 'shop MFA setup must return a secret');
  const mfaCode = generateTotpCode(mfaSetup.data.secret);
  await api('/api/auth/mfa/enable', {
    method: 'POST',
    headers: shopCsrf,
    body: JSON.stringify({ code: mfaCode }),
  });
  await api('/api/auth/logout', {
    method: 'POST',
    headers: shopCsrf,
  });
  cookie = '';

  const challenged = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: shopEmail, password: 'OwnerHardening!2026' }),
  }, 202);
  assert(challenged.data.mfa_required === true, 'shop admin login must require MFA once enabled');
  const mfaLogin = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: shopEmail, password: 'OwnerHardening!2026', mfaCode }),
  });
  assert(mfaLogin.data.ok === true, 'shop admin login with valid MFA code must succeed');
  const mfaLoginCsrf = await csrfHeaders();
  await api('/api/auth/logout', {
    method: 'POST',
    headers: mfaLoginCsrf,
  });
  cookie = '';

  await api('/api/customer/register', {
    method: 'POST',
    body: JSON.stringify({
      shopSlug: slug,
      name: 'Weak Customer',
      email: customerEmail,
      password: 'short',
    }),
  }, 400);

  const registered = await api('/api/customer/register', {
    method: 'POST',
    body: JSON.stringify({
      shopSlug: slug,
      name: 'Verified Later',
      email: customerEmail,
      password: 'CustomerHardening!2026',
    }),
  }, 201);
  assert(registered.data.email_verification_required === true, 'registration must require email verification');

  const account = db.prepare('SELECT * FROM customer_accounts WHERE shop_id = ? AND email = ?').get(shopId, customerEmail);
  assert(account, 'customer account was not created');
  assert(account.email_verified === 0, 'new customer account must start unverified');

  const blocked = await api('/api/customer/login', {
    method: 'POST',
    body: JSON.stringify({ shopSlug: slug, email: customerEmail, password: 'CustomerHardening!2026' }),
  }, 403);
  assert(blocked.data.code === 'EMAIL_VERIFICATION_REQUIRED', 'unverified customer login must be blocked with explicit code');

  const tokenRow = db.prepare(`
    SELECT token
    FROM customer_email_verification_tokens
    WHERE shop_id = ? AND customer_account_id = ? AND used = 0
    ORDER BY id DESC
  `).get(shopId, account.id);
  assert(tokenRow?.token, 'registration must create an email verification token');

  const verified = await api('/api/customer/verify-email', {
    method: 'POST',
    body: JSON.stringify({ token: tokenRow.token }),
  });
  assert(verified.data.ok === true, 'email verification endpoint must succeed');

  const login = await api('/api/customer/login', {
    method: 'POST',
    body: JSON.stringify({ shopSlug: slug, email: customerEmail, password: 'CustomerHardening!2026' }),
  });
  assert(login.data.ok === true, 'verified customer must be able to log in');

  const sessions = await api('/api/customer/sessions');
  assert(Array.isArray(sessions.data.sessions), 'customer sessions endpoint must return sessions');
  assert(sessions.data.sessions.some(s => s.is_current), 'customer sessions must identify current session');

  await api('/api/customer/change-password', {
    method: 'POST',
    headers: await csrfHeaders(),
    body: JSON.stringify({
      currentPassword: 'CustomerHardening!2026',
      newPassword: 'CustomerHardeningChanged!2026',
    }),
  });
  await api('/api/customer/me', {}, 401);

  console.log('Security hardening smoke checks passed.');
} finally {
  if (shopId) db.prepare('DELETE FROM shops WHERE id = ?').run(shopId);
  db.close();
}

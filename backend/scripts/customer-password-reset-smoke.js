import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const db = new DatabaseSync('data/rfdewi.db');
const email = 'alex@trennen-demo.test';
const shopSlug = 'trennen';
let originalHash = null;
let token = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function api(path, options = {}, expected = 200) {
  const res = await fetch(`${base}${path}`, {
    redirect: 'manual',
    ...options,
    headers: {
      'X-Smoke-Test': '1',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== expected) {
    throw new Error(`${path} returned ${res.status}, expected ${expected}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

try {
  const loginHtml = readFileSync('../customer/login.html', 'utf8');
  const forgotHtml = readFileSync('../customer/forgot-password.html', 'utf8');
  const resetHtml = readFileSync('../customer/reset-password.html', 'utf8');

  assert(loginHtml.includes('forgot-password.html'), 'Customer login page must link to forgot password');
  assert(forgotHtml.includes('/api/customer/forgot-password'), 'Forgot password page must call customer forgot endpoint');
  assert(resetHtml.includes('/api/customer/reset-password/verify'), 'Reset page must verify customer reset token');
  assert(resetHtml.includes('/api/customer/reset-password'), 'Reset page must submit customer reset password');

  const account = db.prepare(`
    SELECT ca.*
    FROM customer_accounts ca
    JOIN shops s ON s.id = ca.shop_id
    WHERE s.slug = ? AND ca.email = ?
  `).get(shopSlug, email);
  assert(account, 'Demo customer account is missing; run npm run demo:seed:trennen first');
  originalHash = account.password_hash;

  const neutral = await api('/api/customer/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ shopSlug, email: 'missing-customer@example.test' }),
  });
  assert(neutral.ok && /receive a reset link/i.test(neutral.message), 'Forgot endpoint should return a neutral response');

  const created = await api('/api/customer/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ shopSlug, email }),
  });
  assert(created.ok, 'Forgot endpoint did not accept existing customer');

  const tokenRow = db.prepare(`
    SELECT *
    FROM customer_reset_tokens
    WHERE shop_id = ? AND customer_account_id = ? AND used = 0
    ORDER BY id DESC
  `).get(account.shop_id, account.id);
  assert(tokenRow?.token, 'Forgot endpoint did not store a customer reset token');
  token = tokenRow.token;

  const verified = await api(`/api/customer/reset-password/verify?token=${encodeURIComponent(token)}`);
  assert(verified.valid === true, 'Reset token should verify before use');

  const newPassword = 'CustomerReset!2026';
  await api('/api/customer/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, newPassword }),
  });

  const updated = db.prepare('SELECT password_hash FROM customer_accounts WHERE id = ?').get(account.id);
  assert(await bcrypt.compare(newPassword, updated.password_hash), 'Reset password did not update customer hash');

  await api(`/api/customer/reset-password/verify?token=${encodeURIComponent(token)}`, {}, 400);
  console.log('Customer password reset smoke checks passed.');
} finally {
  if (originalHash) {
    db.prepare('UPDATE customer_accounts SET password_hash = ? WHERE email = ?').run(originalHash, email);
  }
  if (token) {
    db.prepare('DELETE FROM customer_reset_tokens WHERE token = ?').run(token);
  }
  db.close();
}

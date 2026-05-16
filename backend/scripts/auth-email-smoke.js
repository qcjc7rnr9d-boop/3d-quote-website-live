import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const db = new DatabaseSync('data/rfdewi.db');
const slug = `email-smoke-${randomUUID().slice(0, 8)}`;
let shopId = null;

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
  return { res, data };
}

try {
  const hash = await bcrypt.hash('OwnerSmoke!2026', 4);
  const created = db.prepare(`
    INSERT INTO shops (name, slug, email, password_hash, is_temp_password, plan)
    VALUES (?, ?, ?, ?, 0, 'starter')
  `).run('Email Smoke Shop', slug, `${slug}@example.test`, hash);
  shopId = created.lastInsertRowid;

  await api('/api/customer/register', {
    method: 'POST',
    body: JSON.stringify({
      shopSlug: slug,
      name: 'Invalid Email',
      email: 'not-an-email',
      password: 'CustomerSmoke!2026',
    }),
  }, 400);

  await api('/api/customer/register', {
    method: 'POST',
    body: JSON.stringify({
      shopSlug: slug,
      name: '  Plus Alias Customer  ',
      email: '  QA+Smoke@Sub.Example.COM  ',
      password: 'CustomerSmoke!2026',
    }),
  }, 201);

  const account = db.prepare('SELECT email, name FROM customer_accounts WHERE shop_id = ?').get(shopId);
  assert(account.email === 'qa+smoke@sub.example.com', `Customer email was not normalized: ${account.email}`);
  assert(account.name === 'Plus Alias Customer', `Customer name was not trimmed: ${account.name}`);

  await api('/api/customer/register', {
    method: 'POST',
    body: JSON.stringify({
      shopSlug: slug,
      name: 'Duplicate Customer',
      email: 'QA+SMOKE@SUB.EXAMPLE.COM',
      password: 'CustomerSmoke!2026',
    }),
  }, 400);

  await api('/api/customer/login', {
    method: 'POST',
    body: JSON.stringify({
      shopSlug: slug,
      email: ' QA+SMOKE@SUB.EXAMPLE.COM ',
      password: 'CustomerSmoke!2026',
    }),
  });

  const neutral = await api('/api/customer/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ shopSlug: slug, email: 'not-an-email' }),
  });
  assert(neutral.data.ok === true, 'Forgot password should stay neutral for invalid emails');

  console.log('Auth email smoke checks passed.');
} finally {
  if (shopId) {
    db.prepare('DELETE FROM shops WHERE id = ?').run(shopId);
  }
  db.close();
}

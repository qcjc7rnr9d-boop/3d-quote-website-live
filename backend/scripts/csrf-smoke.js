import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const db = new DatabaseSync('data/rfdewi.db');
db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function cookieHeader(res) {
  const setCookie = res.headers.get('set-cookie') || '';
  return setCookie.split(',').map(part => part.split(';')[0].trim()).filter(Boolean).join('; ');
}

async function jsonFetch(path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-smoke-test': '1',
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

const suffix = randomUUID().slice(0, 8);
const email = `csrf-${suffix}@example.test`;
const password = `CsrfSmoke!${suffix}`;
let shopId = null;

try {
  const hash = await bcrypt.hash(password, 4);
  const inserted = db.prepare(`
    INSERT INTO shops (name, slug, email, password_hash, is_temp_password, plan)
    VALUES (?, ?, ?, ?, 0, 'pro')
  `).run(`CSRF Smoke ${suffix}`, `csrf-smoke-${suffix}`, email, hash);
  shopId = inserted.lastInsertRowid;
  db.prepare('INSERT OR IGNORE INTO pricing_config (shop_id) VALUES (?)').run(shopId);
  db.prepare('INSERT OR IGNORE INTO store_settings (shop_id) VALUES (?)').run(shopId);

  const login = await jsonFetch('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  assert(login.res.status === 200, `login returned ${login.res.status}`);
  const cookie = cookieHeader(login.res);
  assert(cookie.includes('connect.sid='), 'login did not set a session cookie');

  const missing = await jsonFetch('/api/settings', {
    method: 'PUT',
    headers: { Cookie: cookie },
    body: JSON.stringify({ tagline: 'missing csrf should fail' }),
  });
  assert(missing.res.status === 403, `settings PUT without CSRF returned ${missing.res.status}`);
  assert(missing.data.code === 'CSRF_REQUIRED', `missing CSRF returned code ${missing.data.code || 'none'}`);

  const tokenRes = await jsonFetch('/api/csrf-token', {
    method: 'GET',
    headers: { Cookie: cookie },
  });
  assert(tokenRes.res.status === 200, `csrf token route returned ${tokenRes.res.status}`);
  assert(typeof tokenRes.data.csrfToken === 'string' && tokenRes.data.csrfToken.length >= 24, 'csrf token missing or too short');

  const queryToken = await jsonFetch(`/api/settings?_csrf=${encodeURIComponent(tokenRes.data.csrfToken)}`, {
    method: 'PUT',
    headers: { Cookie: cookie },
    body: JSON.stringify({ tagline: 'csrf query token should fail' }),
  });
  assert(queryToken.res.status === 403, `settings PUT with query CSRF token returned ${queryToken.res.status}`);

  const allowed = await jsonFetch('/api/settings', {
    method: 'PUT',
    headers: { Cookie: cookie, 'X-CSRF-Token': tokenRes.data.csrfToken },
    body: JSON.stringify({ tagline: 'csrf smoke ok' }),
  });
  assert(allowed.res.status === 200, `settings PUT with CSRF returned ${allowed.res.status}`);

  console.log('CSRF smoke checks passed.');
} finally {
  if (shopId) {
    try { db.prepare('DELETE FROM shops WHERE id = ?').run(shopId); } catch {}
  }
  db.close();
}

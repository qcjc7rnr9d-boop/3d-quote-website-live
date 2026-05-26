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

async function csrfHeader(cookie) {
  const token = await jsonFetch('/api/csrf-token', {
    method: 'GET',
    headers: { Cookie: cookie },
  });
  assert(token.res.status === 200, `csrf token route returned ${token.res.status}`);
  return { Cookie: cookie, 'X-CSRF-Token': token.data.csrfToken };
}

const suffix = randomUUID().slice(0, 8);
const email = `pricing-${suffix}@example.test`;
const password = `PricingSmoke!${suffix}`;
let shopId = null;

try {
  const hash = await bcrypt.hash(password, 4);
  const inserted = db.prepare(`
    INSERT INTO shops (name, slug, email, password_hash, is_temp_password, plan)
    VALUES (?, ?, ?, ?, 0, 'pro')
  `).run(`Pricing Smoke ${suffix}`, `pricing-smoke-${suffix}`, email, hash);
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
  const csrf = await csrfHeader(cookie);

  const invalid = await jsonFetch('/api/pricing', {
    method: 'PUT',
    headers: csrf,
    body: JSON.stringify({
      currency: 'NZD',
      tax_rate: -0.15,
      min_order_value: -20,
      free_shipping_above: -1,
      quote_rounding: -0.10,
      quote_valid_hours: 0,
      max_model_quantity: -5,
      time_rate_per_hour: -10,
      time_rate_per_gram: -1,
      surcharges: [{ label: 'bad', amount: -99 }],
      pricing_mode: 'material',
    }),
  });
  assert(invalid.res.status === 400, `invalid pricing save returned ${invalid.res.status}: ${JSON.stringify(invalid.data).slice(0, 300)}`);
  assert(invalid.data.code === 'INVALID_PRICING_CONFIG', `invalid pricing save returned code ${invalid.data.code || 'none'}`);

  const rowAfterInvalid = db.prepare('SELECT * FROM pricing_config WHERE shop_id = ?').get(shopId);
  assert(rowAfterInvalid.tax_rate === 0.15, 'invalid pricing save must not persist negative tax_rate');
  assert(rowAfterInvalid.min_order_value === 0, 'invalid pricing save must not persist negative min_order_value');
  assert(rowAfterInvalid.quote_rounding === 0.1, 'invalid pricing save must not persist negative quote_rounding');

  const valid = await jsonFetch('/api/pricing', {
    method: 'PUT',
    headers: csrf,
    body: JSON.stringify({
      currency: 'NZD',
      tax_rate: 0.15,
      min_order_value: 12.5,
      free_shipping_above: 80,
      quote_rounding: 0.1,
      quote_valid_hours: 48,
      max_model_quantity: 25,
      show_breakdown: true,
      surcharges: [{ label: 'Careful packing', amount: 2.5 }],
      pricing_mode: 'material',
      mat_include_support: true,
      time_rate_per_hour: 0,
      time_rate_per_gram: 0,
      time_include_support: true,
    }),
  });
  assert(valid.res.status === 200, `valid pricing save returned ${valid.res.status}: ${JSON.stringify(valid.data).slice(0, 300)}`);
  assert(valid.data.min_order_value === 12.5, 'valid pricing save did not persist min_order_value');
  assert(valid.data.max_model_quantity === 25, 'valid pricing save did not persist max_model_quantity');

  console.log('Pricing route smoke checks passed.');
} finally {
  if (shopId) {
    try { db.prepare('DELETE FROM shops WHERE id = ?').run(shopId); } catch {}
  }
  db.close();
}

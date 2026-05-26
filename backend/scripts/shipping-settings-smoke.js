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
const email = `shipping-${suffix}@example.test`;
const password = `ShippingSmoke!${suffix}`;
const slug = `shipping-smoke-${suffix}`;
let shopId = null;

try {
  const hash = await bcrypt.hash(password, 4);
  const inserted = db.prepare(`
    INSERT INTO shops (name, slug, email, password_hash, is_temp_password, plan)
    VALUES (?, ?, ?, ?, 0, 'pro')
  `).run(`Shipping Smoke ${suffix}`, slug, email, hash);
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

  const nonArray = await jsonFetch('/api/settings', {
    method: 'PUT',
    headers: csrf,
    body: JSON.stringify({ shipping_zones: { courier: 'Object Courier' } }),
  });
  assert(nonArray.res.status === 400, `non-array shipping settings returned ${nonArray.res.status}: ${JSON.stringify(nonArray.data).slice(0, 300)}`);
  assert(nonArray.data.code === 'INVALID_SHIPPING_CONFIG', `non-array shipping settings returned code ${nonArray.data.code || 'none'}`);

  const invalid = await jsonFetch('/api/settings', {
    method: 'PUT',
    headers: csrf,
    body: JSON.stringify({
      shipping_zones: [{
        id: 'bad',
        courier: 'Bad Courier',
        service: 'Negative parcel',
        price: -8,
        days_min: 5,
        days_max: 2,
        active: true,
        bands: [{ label: 'Bad band', maxWeightKg: -1, price: -4 }],
      }],
    }),
  });
  assert(invalid.res.status === 400, `invalid shipping settings returned ${invalid.res.status}: ${JSON.stringify(invalid.data).slice(0, 300)}`);
  assert(invalid.data.code === 'INVALID_SHIPPING_CONFIG', `invalid shipping settings returned code ${invalid.data.code || 'none'}`);
  const afterInvalid = db.prepare('SELECT shipping_zones FROM store_settings WHERE shop_id = ?').get(shopId);
  assert(!String(afterInvalid.shipping_zones || '').includes('Bad Courier'), 'invalid shipping settings must not be persisted');

  const valid = await jsonFetch('/api/settings', {
    method: 'PUT',
    headers: csrf,
    body: JSON.stringify({
      shipping_zones: [{
        id: 'standard',
        courier: 'Demo Courier',
        service: 'Tracked',
        price: 8.5,
        days_min: 2,
        days_max: 5,
        active: true,
        recommended: true,
        bands: [
          { id: 'small', label: 'Small parcel', maxWeightKg: 2, maxLongestMm: 300, maxVolumeCm3: 8000, price: 8.5 },
          { id: 'large', label: 'Large parcel', maxWeightKg: 10, maxLongestMm: 600, maxVolumeCm3: 48000, price: 18 },
        ],
      }],
    }),
  });
  assert(valid.res.status === 200, `valid shipping settings returned ${valid.res.status}: ${JSON.stringify(valid.data).slice(0, 300)}`);
  assert(valid.data.shipping_zones?.[0]?.price === 8.5, 'valid shipping settings did not persist method price');
  assert(valid.data.shipping_zones?.[0]?.bands?.length === 2, 'valid shipping settings did not persist bands');

  db.prepare('UPDATE store_settings SET shipping_zones = ? WHERE shop_id = ?').run('{not valid json', shopId);
  const settingsAfterMalformed = await jsonFetch('/api/settings', {
    method: 'GET',
    headers: { Cookie: cookie },
  });
  assert(settingsAfterMalformed.res.status === 200, `settings GET with malformed shipping JSON returned ${settingsAfterMalformed.res.status}`);
  assert(Array.isArray(settingsAfterMalformed.data.shipping_zones), 'settings GET should fall back to an empty shipping list for malformed JSON');

  const ratesAfterMalformed = await jsonFetch('/api/shipping/rates', {
    method: 'POST',
    body: JSON.stringify({ shopSlug: slug, package: { estimatedWeightKg: 1, maxLongestSideMm: 100, packageVolumeCm3: 1000 } }),
  });
  assert(ratesAfterMalformed.res.status === 200, `shipping rates with malformed DB JSON returned ${ratesAfterMalformed.res.status}`);
  assert(Array.isArray(ratesAfterMalformed.data.rates), 'shipping rates should return a rates array even for malformed DB JSON');

  db.prepare('UPDATE store_settings SET shipping_zones = ? WHERE shop_id = ?').run('{"legacy":"object"}', shopId);
  const settingsAfterWrongType = await jsonFetch('/api/settings', {
    method: 'GET',
    headers: { Cookie: cookie },
  });
  assert(settingsAfterWrongType.res.status === 200, `settings GET with object shipping JSON returned ${settingsAfterWrongType.res.status}`);
  assert(Array.isArray(settingsAfterWrongType.data.shipping_zones), 'settings GET should fall back to an empty shipping list for object JSON');

  const unrelatedSave = await jsonFetch('/api/settings', {
    method: 'PUT',
    headers: csrf,
    body: JSON.stringify({ name: `Shipping Smoke Renamed ${suffix}` }),
  });
  assert(unrelatedSave.res.status === 200, `unrelated settings save with legacy object shipping JSON returned ${unrelatedSave.res.status}: ${JSON.stringify(unrelatedSave.data).slice(0, 300)}`);
  assert(Array.isArray(unrelatedSave.data.shipping_zones), 'unrelated settings save should normalize legacy object shipping JSON to an array');

  console.log('Shipping settings smoke checks passed.');
} finally {
  if (shopId) {
    try { db.prepare('DELETE FROM shops WHERE id = ?').run(shopId); } catch {}
  }
  db.close();
}

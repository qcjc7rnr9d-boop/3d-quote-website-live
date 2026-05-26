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
const email = `materials-${suffix}@example.test`;
const password = `MaterialsSmoke!${suffix}`;
let shopId = null;
let materialId = null;

try {
  const hash = await bcrypt.hash(password, 4);
  const inserted = db.prepare(`
    INSERT INTO shops (name, slug, email, password_hash, is_temp_password, plan)
    VALUES (?, ?, ?, ?, 0, 'pro')
  `).run(`Materials Smoke ${suffix}`, `materials-smoke-${suffix}`, email, hash);
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

  const invalidCreate = await jsonFetch('/api/materials', {
    method: 'POST',
    headers: csrf,
    body: JSON.stringify({
      name: 'Bad Negative PLA',
      base_price: -0.2,
      min_charge: -5,
      finishes: [{ id: 'bad', name: 'Bad', priceMultiplier: -1, enabled: true }],
      colours: [{ id: 'black', name: 'Black', hex: '#111111', enabled: true }],
      volume_tiers: [{ from_cm3: 10, price_per_cm3: -0.1 }],
      max_x_mm: -100,
    }),
  });
  assert(invalidCreate.res.status === 400, `invalid material create returned ${invalidCreate.res.status}: ${JSON.stringify(invalidCreate.data).slice(0, 300)}`);
  assert(invalidCreate.data.code === 'INVALID_MATERIAL_CONFIG', `invalid material create returned code ${invalidCreate.data.code || 'none'}`);

  const validCreate = await jsonFetch('/api/materials', {
    method: 'POST',
    headers: csrf,
    body: JSON.stringify({
      name: 'Safe PLA',
      base_price: 0.25,
      min_charge: 5,
      finishes: [{ id: 'standard', name: 'Standard', priceMultiplier: 1, enabled: true }],
      colours: [{ id: 'black', name: 'Black', hex: '#111111', enabled: true }],
      volume_tiers: [{ from_cm3: 20, price_per_cm3: 0.2 }],
      max_x_mm: 220,
    }),
  });
  assert(validCreate.res.status === 201, `valid material create returned ${validCreate.res.status}: ${JSON.stringify(validCreate.data).slice(0, 300)}`);
  materialId = validCreate.data.id;

  const duplicateCreate = await jsonFetch('/api/materials', {
    method: 'POST',
    headers: csrf,
    body: JSON.stringify({
      name: ' safe  pla ',
      base_price: 0.25,
      min_charge: 5,
      finishes: [{ id: 'standard', name: 'Standard', priceMultiplier: 1, enabled: true }],
      colours: [{ id: 'black', name: 'Black', hex: '#111111', enabled: true }],
      active: 1,
    }),
  });
  assert(duplicateCreate.res.status === 409, `duplicate material create returned ${duplicateCreate.res.status}: ${JSON.stringify(duplicateCreate.data).slice(0, 300)}`);
  assert(duplicateCreate.data.code === 'MATERIAL_NAME_EXISTS', `duplicate material create returned code ${duplicateCreate.data.code || 'none'}`);

  const invalidPatch = await jsonFetch(`/api/materials/${materialId}`, {
    method: 'PATCH',
    headers: csrf,
    body: JSON.stringify({
      base_price: -0.3,
      min_charge: -9,
      finishes: [{ id: 'standard', name: 'Standard', priceMultiplier: -2, enabled: true }],
    }),
  });
  assert(invalidPatch.res.status === 400, `invalid material patch returned ${invalidPatch.res.status}: ${JSON.stringify(invalidPatch.data).slice(0, 300)}`);
  assert(invalidPatch.data.code === 'INVALID_MATERIAL_CONFIG', `invalid material patch returned code ${invalidPatch.data.code || 'none'}`);

  const rowAfterInvalid = db.prepare('SELECT base_price, min_charge, finishes FROM materials WHERE id = ?').get(materialId);
  assert(rowAfterInvalid.base_price === 0.25, 'invalid material patch must not persist negative base_price');
  assert(rowAfterInvalid.min_charge === 5, 'invalid material patch must not persist negative min_charge');
  assert(!rowAfterInvalid.finishes.includes('-2'), 'invalid material patch must not persist negative finish multiplier');

  console.log('Materials route smoke checks passed.');
} finally {
  if (shopId) {
    try { db.prepare('DELETE FROM shops WHERE id = ?').run(shopId); } catch {}
  }
  db.close();
}

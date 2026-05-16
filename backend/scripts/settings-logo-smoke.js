import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const require = createRequire(import.meta.url);
const signature = require('cookie-signature');
const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const sessionSecret = process.env.SESSION_SECRET || 'dev-secret-change-me';
const db = new DatabaseSync('data/rfdewi.db');
const root = resolve(import.meta.dirname, '../..');
let sessionId = null;
let uploadedPath = null;
let originalLogoUrl = null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function api(path, options = {}, expected = 200) {
  const res = await fetch(`${base}${path}`, {
    redirect: 'manual',
    ...options,
    headers: {
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== expected) {
    throw new Error(`${path} returned ${res.status}, expected ${expected}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return { res, data };
}

async function csrfHeader(cookie, extra = {}) {
  const { data } = await api('/api/csrf-token', { headers: { Cookie: cookie } });
  return { Cookie: cookie, 'X-CSRF-Token': data.csrfToken, ...extra };
}

function makeShopCookie(shopId) {
  sessionId = randomUUID();
  const expires = Date.now() + 15 * 60 * 1000;
  db.prepare(`
    INSERT INTO app_sessions (sid, sess, expires_at)
    VALUES (?, ?, ?)
  `).run(sessionId, JSON.stringify({
    cookie: {
      originalMaxAge: 15 * 60 * 1000,
      expires: new Date(expires).toISOString(),
      secure: false,
      httpOnly: true,
      path: '/',
      sameSite: 'strict',
    },
    shopId,
  }), expires);
  return `connect.sid=${encodeURIComponent(`s:${signature.sign(sessionId, sessionSecret)}`)}`;
}

function formWithFile(field, bytes, type, name) {
  const fd = new FormData();
  fd.append(field, new Blob([bytes], { type }), name);
  return fd;
}

try {
  const png1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
  );

  await api('/api/settings/logo', {
    method: 'POST',
    body: formWithFile('logo', png1x1, 'image/png', 'logo.png'),
  }, 401);

  const shop = db.prepare("SELECT id FROM shops WHERE slug = 'mahi3d'").get();
  assert(shop, 'Mahi3D shop is missing; run npm run demo:seed:mahi3d first');
  const settings = db.prepare('SELECT logo_url FROM store_settings WHERE shop_id = ?').get(shop.id) || {};
  originalLogoUrl = settings.logo_url || null;
  const cookie = makeShopCookie(shop.id);
  const csrf = await csrfHeader(cookie);

  await api('/api/settings/logo', {
    method: 'POST',
    headers: csrf,
    body: formWithFile('logo', Buffer.from('<svg></svg>'), 'image/svg+xml', 'logo.svg'),
  }, 400);

  await api('/api/settings/logo', {
    method: 'POST',
    headers: csrf,
    body: formWithFile('logo', Buffer.from('not really a png'), 'image/png', 'logo.png'),
  }, 400);

  const { data } = await api('/api/settings/logo', {
    method: 'POST',
    headers: csrf,
    body: formWithFile('logo', png1x1, 'image/png', 'logo.png'),
  }, 201);

  assert(data.url && data.url.startsWith(`/uploads/logos/${shop.id}/`), `Unexpected logo URL: ${data.url}`);
  uploadedPath = join(root, data.url.replace(/^\/+/, ''));

  const publicRes = await fetch(`${base}${data.url}`);
  assert(publicRes.status === 200, `Uploaded logo URL returned ${publicRes.status}`);

  const update = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: await csrfHeader(cookie, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ logo_url: data.url, invoice_logo: true }),
  });
  const updated = await update.json().catch(() => ({}));
  assert(update.status === 200, `Settings save failed after logo upload: ${JSON.stringify(updated).slice(0, 300)}`);
  assert(updated.logo_url === data.url, 'Settings response did not persist logo_url');

  const preserve = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: await csrfHeader(cookie, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ tagline: 'Logo preserve smoke', invoice_logo: true }),
  });
  const preserved = await preserve.json().catch(() => ({}));
  assert(preserve.status === 200, `Settings preserve save failed: ${JSON.stringify(preserved).slice(0, 300)}`);
  assert(preserved.logo_url === data.url, 'Settings save without logo_url should preserve the existing logo');

  console.log('Settings logo smoke checks passed.');
} finally {
  if (originalLogoUrl !== null) {
    const shop = db.prepare("SELECT id FROM shops WHERE slug = 'mahi3d'").get();
    if (shop) {
      db.prepare('UPDATE store_settings SET logo_url = ? WHERE shop_id = ?').run(originalLogoUrl, shop.id);
    }
  }
  if (uploadedPath) rmSync(uploadedPath, { force: true });
  if (sessionId) db.prepare('DELETE FROM app_sessions WHERE sid = ?').run(sessionId);
  db.close();
}

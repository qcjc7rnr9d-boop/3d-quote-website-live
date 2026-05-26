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
db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000');
const root = resolve(import.meta.dirname, '../..');
let sessionId = null;
let uploadedPath = null;
let uploadedMaterialPath = null;
let originalLogoUrl = null;
let originalSettings = null;
let originalShopName = null;
const createdMaterialIds = [];

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

  await api('/api/materials/assets', {
    method: 'POST',
    body: formWithFile('asset', png1x1, 'image/png', 'material.png'),
  }, 401);

  const shop = db.prepare("SELECT id FROM shops WHERE slug = 'mahi3d'").get();
  assert(shop, 'Mahi3D shop is missing; run npm run demo:seed:mahi3d first');
  const settings = db.prepare('SELECT * FROM store_settings WHERE shop_id = ?').get(shop.id) || {};
  const shopRow = db.prepare('SELECT name FROM shops WHERE id = ?').get(shop.id) || {};
  originalLogoUrl = settings.logo_url || null;
  originalSettings = settings;
  originalShopName = shopRow.name || null;
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

  await api('/api/materials/assets', {
    method: 'POST',
    headers: csrf,
    body: formWithFile('asset', Buffer.from('<svg></svg>'), 'image/svg+xml', 'material.svg'),
  }, 400);

  await api('/api/materials/assets', {
    method: 'POST',
    headers: csrf,
    body: formWithFile('asset', Buffer.from('not really a png'), 'image/png', 'material.png'),
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

  const materialUpload = await api('/api/materials/assets', {
    method: 'POST',
    headers: csrf,
    body: formWithFile('asset', png1x1, 'image/png', 'material.png'),
  }, 201);
  assert(
    materialUpload.data.url && materialUpload.data.url.startsWith(`/uploads/material-assets/${shop.id}/`),
    `Unexpected material asset URL: ${materialUpload.data.url}`
  );
  uploadedMaterialPath = join(root, materialUpload.data.url.replace(/^\/+/, ''));
  const materialPublicRes = await fetch(`${base}${materialUpload.data.url}`);
  assert(materialPublicRes.status === 200, `Uploaded material asset URL returned ${materialPublicRes.status}`);

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

  const unsafeLogo = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: await csrfHeader(cookie, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ logo_url: 'javascript:alert(1)', invoice_logo: true }),
  });
  const unsafeLogoBody = await unsafeLogo.json().catch(() => ({}));
  assert(unsafeLogo.status === 400, `Unsafe logo URL should return 400, got ${unsafeLogo.status}: ${JSON.stringify(unsafeLogoBody).slice(0, 300)}`);
  assert(unsafeLogoBody.code === 'INVALID_LOGO_URL', `Unsafe logo URL returned code ${unsafeLogoBody.code || 'none'}`);
  const logoAfterUnsafe = db.prepare('SELECT logo_url FROM store_settings WHERE shop_id = ?').get(shop.id)?.logo_url || null;
  assert(logoAfterUnsafe === data.url, 'Unsafe logo URL must not overwrite the existing logo');

  const crossShopLogo = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: await csrfHeader(cookie, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ logo_url: `/uploads/logos/${shop.id + 999}/other.png`, invoice_logo: true }),
  });
  const crossShopLogoBody = await crossShopLogo.json().catch(() => ({}));
  assert(crossShopLogo.status === 400, `Cross-shop logo URL should return 400, got ${crossShopLogo.status}: ${JSON.stringify(crossShopLogoBody).slice(0, 300)}`);
  assert(crossShopLogoBody.code === 'INVALID_LOGO_URL', `Cross-shop logo URL returned code ${crossShopLogoBody.code || 'none'}`);

  const unsafeMaterial = await fetch(`${base}/api/materials`, {
    method: 'POST',
    headers: await csrfHeader(cookie, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      name: `Unsafe image material ${Date.now()}`,
      image_url: 'data:image/svg+xml,<svg onload=alert(1)>',
      colours: [{ id: 'white', name: 'White', hex: '#ffffff', active: true }],
      finishes: [{ id: 'standard', name: 'Standard', layerHeight: '0.20 mm', priceMultiplier: 1, active: true }],
    }),
  });
  const unsafeMaterialBody = await unsafeMaterial.json().catch(() => ({}));
  if (unsafeMaterial.status === 201 && unsafeMaterialBody.id) createdMaterialIds.push(unsafeMaterialBody.id);
  assert(unsafeMaterial.status === 400, `Unsafe material image URL should return 400, got ${unsafeMaterial.status}: ${JSON.stringify(unsafeMaterialBody).slice(0, 300)}`);
  assert(unsafeMaterialBody.code === 'INVALID_MATERIAL_CONFIG', `Unsafe material image URL returned code ${unsafeMaterialBody.code || 'none'}`);

  const unsafeFinish = await fetch(`${base}/api/materials`, {
    method: 'POST',
    headers: await csrfHeader(cookie, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      name: `Unsafe finish material ${Date.now()}`,
      image_url: materialUpload.data.url,
      colours: [{ id: 'white', name: 'White', hex: '#ffffff', active: true }],
      finishes: [{ id: 'standard', name: 'Standard', layerHeight: '0.20 mm', priceMultiplier: 1, active: true, previewImageUrl: 'javascript:alert(1)' }],
    }),
  });
  const unsafeFinishBody = await unsafeFinish.json().catch(() => ({}));
  if (unsafeFinish.status === 201 && unsafeFinishBody.id) createdMaterialIds.push(unsafeFinishBody.id);
  assert(unsafeFinish.status === 400, `Unsafe finish preview URL should return 400, got ${unsafeFinish.status}: ${JSON.stringify(unsafeFinishBody).slice(0, 300)}`);
  assert(unsafeFinishBody.code === 'INVALID_MATERIAL_CONFIG', `Unsafe finish preview URL returned code ${unsafeFinishBody.code || 'none'}`);

  const validMaterial = await fetch(`${base}/api/materials`, {
    method: 'POST',
    headers: await csrfHeader(cookie, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      name: `Valid uploaded image material ${Date.now()}`,
      image_url: materialUpload.data.url,
      colours: [{ id: 'white', name: 'White', hex: '#ffffff', active: true }],
      finishes: [{ id: 'standard', name: 'Standard', layerHeight: '0.20 mm', priceMultiplier: 1, active: true, previewImageUrl: materialUpload.data.url }],
    }),
  });
  const validMaterialBody = await validMaterial.json().catch(() => ({}));
  if (validMaterial.status === 201 && validMaterialBody.id) createdMaterialIds.push(validMaterialBody.id);
  assert(validMaterial.status === 201, `Valid uploaded material URLs should be accepted, got ${validMaterial.status}: ${JSON.stringify(validMaterialBody).slice(0, 300)}`);
  assert(validMaterialBody.image_url === materialUpload.data.url, 'Valid material image URL was not persisted');
  assert(validMaterialBody.finishes?.[0]?.previewImageUrl === materialUpload.data.url, 'Valid finish preview URL was not persisted');

  const beforeAtomic = {
    name: db.prepare('SELECT name FROM shops WHERE id = ?').get(shop.id)?.name || '',
    tagline: db.prepare('SELECT tagline FROM store_settings WHERE shop_id = ?').get(shop.id)?.tagline || '',
  };
  const invalidDomain = await fetch(`${base}/api/settings`, {
    method: 'PUT',
    headers: await csrfHeader(cookie, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      name: `Should Not Persist ${Date.now()}`,
      tagline: 'Partial settings write should not persist',
      email_sending_domain: 'not a valid domain',
      email_use_platform_fallback: true,
    }),
  });
  const invalidBody = await invalidDomain.json().catch(() => ({}));
  assert(invalidDomain.status === 400, `Invalid email domain should return 400, got ${invalidDomain.status}: ${JSON.stringify(invalidBody).slice(0, 300)}`);
  const afterAtomic = {
    name: db.prepare('SELECT name FROM shops WHERE id = ?').get(shop.id)?.name || '',
    tagline: db.prepare('SELECT tagline FROM store_settings WHERE shop_id = ?').get(shop.id)?.tagline || '',
  };
  assert(afterAtomic.name === beforeAtomic.name, 'Invalid settings save must not partially update shop name');
  assert(afterAtomic.tagline === beforeAtomic.tagline, 'Invalid settings save must not partially update store settings');

  console.log('Settings and material asset upload smoke checks passed.');
} finally {
  const shop = db.prepare("SELECT id FROM shops WHERE slug = 'mahi3d'").get();
  if (shop) {
    for (const id of createdMaterialIds) {
      try { db.prepare('DELETE FROM materials WHERE id = ? AND shop_id = ?').run(id, shop.id); } catch {}
    }
    if (originalShopName !== null) {
      db.prepare('UPDATE shops SET name = ? WHERE id = ?').run(originalShopName, shop.id);
    }
    if (originalSettings) {
      db.prepare(`
        UPDATE store_settings SET
          logo_url = ?,
          tagline = ?,
          email_sending_domain = ?,
          email_sending_domain_status = ?,
          email_sending_domain_records = ?,
          email_sending_domain_verified_at = ?,
          email_sending_domain_last_checked_at = ?,
          email_use_platform_fallback = ?
        WHERE shop_id = ?
      `).run(
        originalSettings.logo_url || null,
        originalSettings.tagline || null,
        originalSettings.email_sending_domain || null,
        originalSettings.email_sending_domain_status || 'not_configured',
        originalSettings.email_sending_domain_records || '[]',
        originalSettings.email_sending_domain_verified_at || null,
        originalSettings.email_sending_domain_last_checked_at || null,
        originalSettings.email_use_platform_fallback ?? 1,
        shop.id
      );
    } else if (originalLogoUrl !== null) {
      db.prepare('UPDATE store_settings SET logo_url = ? WHERE shop_id = ?').run(originalLogoUrl, shop.id);
    }
  }
  if (uploadedPath) rmSync(uploadedPath, { force: true });
  if (uploadedMaterialPath) rmSync(uploadedMaterialPath, { force: true });
  if (sessionId) db.prepare('DELETE FROM app_sessions WHERE sid = ?').run(sessionId);
  db.close();
}

import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';
import { parseInfillTiers } from '../lib/infill-tiers.js';

dotenv.config();

const require = createRequire(import.meta.url);
const signature = require('cookie-signature');
const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const sessionSecret = process.env.SESSION_SECRET || 'dev-secret-change-me';
const db = new DatabaseSync('data/rfdewi.db');
let sessionId = null;
let savedQuoteId = null;

async function api(path, options = {}, expected = 200) {
  const res = await fetch(`${base}${path}`, {
    redirect: 'manual',
    ...options,
    headers: {
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(value, fallback = null) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function makeCustomerCookie(account) {
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
    customerId: account.id,
    customerShopId: account.shop_id,
  }), expires);
  return `connect.sid=${encodeURIComponent(`s:${signature.sign(sessionId, sessionSecret)}`)}`;
}

function firstEnabled(values) {
  return (Array.isArray(values) ? values : []).find(item => item && item.enabled !== false) || null;
}

try {
  await api('/api/customer/quotes?shop=mahi3d', {}, 401);

  const account = db.prepare(`
    SELECT ca.id, ca.shop_id
    FROM customer_accounts ca
    JOIN shops s ON s.id = ca.shop_id
    WHERE s.slug = 'mahi3d' AND ca.email = 'alex@mahi3d-demo.test'
  `).get();
  assert(account, 'Demo customer account is missing; run npm run demo:seed:mahi3d first');
  const cookie = makeCustomerCookie(account);

  const material = db.prepare(`
    SELECT id, name, colours, finishes
    FROM materials
    WHERE shop_id = ? AND active = 1 AND name = 'PETG'
  `).get(account.shop_id);
  assert(material, 'PETG material is missing from Mahi3D');
  const colour = firstEnabled(parseJson(material.colours, []));
  const finish = firstEnabled(parseJson(material.finishes, []));
  assert(colour?.id, 'PETG colour is missing');
  assert(finish?.id, 'PETG finish is missing');
  const shippingRows = db.prepare('SELECT shipping_zones FROM store_settings WHERE shop_id = ?').get(account.shop_id) || {};
  const shipping = firstEnabled(parseJson(shippingRows.shipping_zones, []));
  const pricingRows = db.prepare('SELECT infill_tiers FROM pricing_config WHERE shop_id = ?').get(account.shop_id) || {};
  const infill = firstEnabled(parseInfillTiers(pricingRows.infill_tiers));
  assert(shipping?.id, 'Mahi3D shipping zone is missing');
  assert(infill?.id, 'Mahi3D infill tier is missing');

  const quoteRequest = {
    shopSlug: 'mahi3d',
    materialId: material.id,
    volumeCm3: 12.5,
    colourId: colour.id,
    finishId: finish.id,
    infillTierId: infill.id,
    quantity: 2,
    shippingId: shipping.id,
    dimensions: { xMm: 42, yMm: 28, zMm: 16 },
  };

  const forged = {
    shopSlug: 'mahi3d',
    quoteRequest,
    file: { name: 'Saved Quote Smoke.stl', size: 2048, volumeCm3: 12.5, dimensions: quoteRequest.dimensions },
    selection: { materialName: 'Fake Material', totalCents: 1 },
    totalCents: 1,
  };
  const { data: created } = await api('/api/customer/quotes', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: JSON.stringify(forged),
  }, 201);
  savedQuoteId = created.quote?.id;
  assert(savedQuoteId, 'Saved quote response missing id');
  assert(created.quote.totalCents > 100, 'Saved quote trusted forged client total');
  assert(created.quote.material_name === 'PETG', `Saved quote material mismatch: ${created.quote.material_name}`);
  assert(created.quote.file_name === 'Saved Quote Smoke.stl', 'Saved quote file name missing');

  const { data: quotes } = await api('/api/customer/quotes?shop=mahi3d', { headers: { Cookie: cookie } });
  assert(Array.isArray(quotes), 'Quotes endpoint did not return an array');
  assert(quotes.some(quote => quote.id === savedQuoteId), 'Saved quote did not appear in list');

  await api('/api/customer/quotes?shop=portal-smoke-other', { headers: { Cookie: cookie } }, 403);
  await api(`/api/customer/quotes/${savedQuoteId}?shop=mahi3d`, {
    method: 'DELETE',
    headers: { Cookie: cookie },
  });
  savedQuoteId = null;

  const { data: afterDelete } = await api('/api/customer/quotes?shop=mahi3d', { headers: { Cookie: cookie } });
  assert(!afterDelete.some(quote => quote.id === created.quote.id), 'Deleted quote still appears in list');

  console.log('Customer saved quotes smoke checks passed.');
} finally {
  if (savedQuoteId) {
    try {
      db.prepare('UPDATE customer_saved_quotes SET status = ? WHERE id = ?').run('deleted', savedQuoteId);
    } catch {}
  }
  if (sessionId) db.prepare('DELETE FROM app_sessions WHERE sid = ?').run(sessionId);
  db.close();
}

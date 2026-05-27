const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
let existingOrderId = null;
let db = null;
let tempOrderId = null;
let tempOrderToken = null;
try {
  const { DatabaseSync } = await import('node:sqlite');
  const { randomUUID } = await import('node:crypto');
  db = new DatabaseSync('data/rfdewi.db');
  existingOrderId = db.prepare('SELECT id FROM orders ORDER BY id LIMIT 1').get()?.id || null;
  const shop = db.prepare("SELECT id FROM shops WHERE slug = 'trennen'").get();
  if (shop) {
    const cols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
    if (!cols.includes('public_token')) {
      db.exec('ALTER TABLE orders ADD COLUMN public_token TEXT');
    }
    tempOrderToken = `smoke-${randomUUID()}`;
    const result = db.prepare(`
      INSERT INTO orders (
        shop_id, customer_email, customer_name, file_name, quantity,
        subtotal, tax, shipping, total, payment_status, fulfilment_status, public_token
      )
      VALUES (?, 'private@example.test', 'Private Customer', 'Private Part.stl', 1, 1, 0, 0, 1, 'paid', 'pending', ?)
    `).run(shop.id, tempOrderToken);
    tempOrderId = result.lastInsertRowid;
  }
} catch {}

function cleanup() {
  try {
    if (tempOrderId && db) db.prepare('DELETE FROM orders WHERE id = ?').run(tempOrderId);
    if (db) db.close();
  } catch {}
}
process.on('exit', cleanup);

async function expectStatus(path, expected) {
  const res = await fetch(`${base}${path}`, { method: 'HEAD', redirect: 'manual' });
  if (!expected.includes(res.status)) {
    throw new Error(`${path} returned ${res.status}, expected ${expected.join('/')}`);
  }
  console.log(`✓ ${path} -> ${res.status}`);
}

async function expectJson(path, requiredKeys = []) {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  const data = await res.json();
  for (const key of requiredKeys) {
    if (!(key in data)) throw new Error(`${path} missing key ${key}`);
  }
  console.log(`✓ ${path} -> JSON`);
}

async function expectPostJson(path, body, expectedStatus) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!expectedStatus.includes(res.status)) {
    throw new Error(`${path} returned ${res.status}, expected ${expectedStatus.join('/')}`);
  }
  console.log(`✓ ${path} -> ${res.status}`);
}

async function expectPublicOrderTokenBoundary() {
  if (!tempOrderId || !tempOrderToken) {
    console.log('↷ public order token boundary skipped (no demo shop available)');
    return;
  }
  await expectStatus(`/api/orders/public/${tempOrderId}`, [400]);
  await expectStatus(`/api/orders/public/${tempOrderId}?token=wrong`, [404]);
  const res = await fetch(`${base}/api/orders/public/${tempOrderId}?token=${encodeURIComponent(tempOrderToken)}`);
  if (res.status !== 200) throw new Error(`/api/orders/public/${tempOrderId}?token=<valid> returned ${res.status}`);
  const data = await res.json();
  if ('customer_email' in data || 'customer_name' in data) {
    throw new Error('/api/orders/public returned customer PII');
  }
  console.log('✓ /api/orders/public/:id requires token and omits customer PII');
}

async function expectOversizeRejectedIfConfigured() {
  const res = await fetch(`${base}/api/customer/catalog?shop=trennen`);
  if (!res.ok) throw new Error(`/api/customer/catalog?shop=trennen returned ${res.status}`);
  const catalog = await res.json();
  const material = (catalog.materials || []).find(m =>
    Number(m.max_x_mm) > 0 || Number(m.max_y_mm) > 0 || Number(m.max_z_mm) > 0
  );
  if (!material) {
    console.log('↷ oversized quote rejection skipped (no material size limits configured)');
    return;
  }

  const dimensions = {
    xMm: Number(material.max_x_mm) > 0 ? Number(material.max_x_mm) + 1 : 1,
    yMm: Number(material.max_y_mm) > 0 ? Number(material.max_y_mm) + 1 : 1,
    zMm: Number(material.max_z_mm) > 0 ? Number(material.max_z_mm) + 1 : 1,
  };
  const body = {
    shopSlug: 'trennen',
    materialId: material.id,
    volumeCm3: 1,
    dimensions,
    colourId: material.colours?.[0]?.id || null,
    finishId: material.finishes?.[0]?.id || null,
    quantity: 1,
  };
  const missingDimensions = await fetch(`${base}/api/customer/quote-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, dimensions: null }),
  });
  const missingData = await missingDimensions.json().catch(() => ({}));
  if (missingDimensions.status !== 400 || missingData.code !== 'MODEL_DIMENSIONS_REQUIRED') {
    throw new Error(`/api/customer/quote-preview missing dimensions returned ${missingDimensions.status}/${missingData.code || 'no-code'}`);
  }
  console.log('✓ size-limited quote requires dimensions -> 400');

  const quote = await fetch(`${base}/api/customer/quote-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await quote.json().catch(() => ({}));
  if (quote.status !== 400 || !['MODEL_TOO_LARGE', 'MODEL_DIMENSIONS_REQUIRED'].includes(data.code)) {
    throw new Error(`/api/customer/quote-preview oversize returned ${quote.status}/${data.code || 'no-code'}`);
  }
  console.log('✓ oversized quote rejection -> 400');
}

await expectStatus('/backend/server.js', [404]);
await expectStatus('/backend/data/rfdewi.db', [404]);
await expectStatus('/.git/config', [404]);
await expectStatus('/SECURITY.md', [404]);
await expectStatus('/research/.env', [404]);
await expectStatus('/research/data/discovered-prospects.json', [404]);
await expectStatus('/api/platform/shops', [401]);
await expectStatus('/api/platform/stats', [401]);
await expectStatus('/api/platform/overview', [401]);
await expectStatus('/api/platform/shops/1/overview', [401]);
await expectStatus('/api/platform/orders', [401]);
await expectStatus('/api/platform/orders/1', [401]);
await expectStatus('/api/platform/customers', [401]);
await expectStatus('/api/platform/audit-events', [401]);
if (existingOrderId) {
  await expectStatus(`/api/orders/public/${existingOrderId}`, [400]);
} else {
  await expectStatus('/api/orders/public/1', [400, 404]);
}
await expectPublicOrderTokenBoundary();
await expectStatus('/api/settings', [401]);
await expectPostJson('/api/settings/logo', {}, [401]);
await expectStatus('/api/pricing', [401]);
await expectStatus('/api/materials', [401]);
await expectStatus('/api/customer/me', [401]);
await expectStatus('/api/customer/orders', [401]);
await expectJson('/api/customer/catalog?shop=trennen', ['materials', 'settings']);
await expectJson('/api/customer/exchange-rates?base=NZD&quotes=AUD,USD,GBP,EUR,CAD,JPY,SGD,HKD,CHF,CNY', ['base', 'rates', 'provider', 'stale']);
await expectPostJson('/api/customer/quote-preview', { shopSlug: 'trennen' }, [400]);
await expectPostJson('/api/materials/assets', {}, [401]);
await expectPostJson('/api/stripe/create-payment-intent', {}, [400, 429]);
await expectPostJson('/api/customer/change-password', {}, [401, 429]);
await expectOversizeRejectedIfConfigured();

if (tempOrderId && db) db.prepare('DELETE FROM orders WHERE id = ?').run(tempOrderId);
if (db) db.close();
console.log('Security smoke checks passed.');

const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
let existingOrderId = null;
let db = null;
let tempOrderId = null;
let tempOrderToken = null;
let tempNonFdmMaterialId = null;
try {
  const { DatabaseSync } = await import('node:sqlite');
  const { randomUUID } = await import('node:crypto');
  db = new DatabaseSync('data/rfdewi.db');
  existingOrderId = db.prepare('SELECT id FROM orders ORDER BY id LIMIT 1').get()?.id || null;
  const shop = db.prepare("SELECT id FROM shops WHERE slug = 'mahi3d'").get();
  if (shop) {
    db.prepare(`
      DELETE FROM materials
      WHERE shop_id = ?
        AND (
          name LIKE 'FDM-only hidden resin %'
          OR properties LIKE '%"libraryKey":"security_smoke_resin"%'
          OR properties LIKE '%"library_key":"security_smoke_resin"%'
        )
    `).run(shop.id);

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

    const materialCols = new Set(db.prepare('PRAGMA table_info(materials)').all().map(c => c.name));
    const materialPayload = {
      shop_id: shop.id,
      name: `FDM-only hidden resin ${randomUUID()}`,
      category: 'Resin',
      description_short: 'Temporary non-FDM smoke material',
      description_long: '',
      base_price: 0.42,
      min_charge: 10,
      pricing_model: 'per_cm3',
      colours: JSON.stringify([{ id: 'colour_white', name: 'White', hex: '#ffffff', enabled: true, sortOrder: 0 }]),
      finishes: JSON.stringify([{ id: 'finish_standard', name: 'Standard', layerHeight: '0.05 mm', priceMultiplier: 1, enabled: true, default: true, sortOrder: 0 }]),
      active: 1,
      recommended: 0,
      tags: JSON.stringify(['Resin']),
      best_for: JSON.stringify(['Smoke test']),
      specs: JSON.stringify([]),
      properties: JSON.stringify({ libraryKey: 'security_smoke_resin' }),
      sort_order: -999,
    };
    const entries = Object.entries(materialPayload).filter(([key]) => materialCols.has(key));
    const columns = entries.map(([key]) => key);
    const placeholders = columns.map(() => '?').join(', ');
    const materialResult = db.prepare(`
      INSERT INTO materials (${columns.join(', ')})
      VALUES (${placeholders})
    `).run(...entries.map(([, value]) => value));
    tempNonFdmMaterialId = materialResult.lastInsertRowid;
  }
} catch {}

function cleanup() {
  try {
    if (db) {
      if (tempNonFdmMaterialId) db.prepare('DELETE FROM materials WHERE id = ?').run(tempNonFdmMaterialId);
      db.prepare(`
        DELETE FROM materials
        WHERE name LIKE 'FDM-only hidden resin %'
           OR properties LIKE '%"libraryKey":"security_smoke_resin"%'
           OR properties LIKE '%"library_key":"security_smoke_resin"%'
      `).run();
    }
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

async function expectFdmOnlyCustomerMaterialApis() {
  const catalogRes = await fetch(`${base}/api/customer/catalog?shop=mahi3d`);
  if (!catalogRes.ok) throw new Error(`/api/customer/catalog?shop=mahi3d returned ${catalogRes.status}`);
  const catalog = await catalogRes.json();
  const materials = catalog.materials || [];
  if (!materials.length) throw new Error('/api/customer/catalog?shop=mahi3d returned no materials');
  const nonFdm = materials.filter(material => material.category !== 'FDM');
  if (nonFdm.length) {
    throw new Error(`/api/customer/catalog exposed non-FDM materials: ${nonFdm.map(m => `${m.name} (${m.category})`).join(', ')}`);
  }
  const nonFdmFilters = (catalog.filters || []).filter(label => ['resin', 'sls', 'specialty'].includes(String(label).toLowerCase()));
  if (nonFdmFilters.length) {
    throw new Error(`/api/customer/catalog exposed non-FDM filters: ${nonFdmFilters.join(', ')}`);
  }
  console.log('✓ customer catalog is FDM-only');

  const pricingRes = await fetch(`${base}/api/customer/pricing?shop=mahi3d`);
  if (!pricingRes.ok) throw new Error(`/api/customer/pricing?shop=mahi3d returned ${pricingRes.status}`);
  const pricing = await pricingRes.json();
  const ids = new Set(materials.map(material => String(material.id)));
  const leakedPricing = (pricing.materials || []).filter(material => !ids.has(String(material.id)));
  if (leakedPricing.length) {
    throw new Error(`/api/customer/pricing exposed materials outside the FDM catalog: ${leakedPricing.map(m => m.name || m.id).join(', ')}`);
  }
  console.log('✓ customer pricing follows the FDM-only catalog');
}

async function expectNonFdmQuoteRejected() {
  if (!tempNonFdmMaterialId || !db) {
    console.log('↷ non-FDM quote rejection skipped (no temporary material)');
    return;
  }
  const pricingRows = db.prepare("SELECT infill_tiers FROM pricing_config WHERE shop_id = (SELECT id FROM shops WHERE slug = 'mahi3d')").get() || {};
  let infill = null;
  try {
    infill = JSON.parse(pricingRows.infill_tiers || '[]').find(tier => tier?.active !== false);
  } catch {}
  const body = {
    shopSlug: 'mahi3d',
    materialId: tempNonFdmMaterialId,
    models: [{
      name: 'blocked-resin-smoke.stl',
      size: 1000,
      volumeCm3: 4,
      dimensions: { xMm: 20, yMm: 20, zMm: 20 },
      quantity: 1,
    }],
    colourId: 'colour_white',
    finishId: 'finish_standard',
    infillTierId: infill?.id || 'light',
    previewWithoutShipping: true,
  };
  const quote = await fetch(`${base}/api/customer/quote-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const quoteData = await quote.json().catch(() => ({}));
  if (quote.status !== 400 || quoteData.code !== 'MATERIAL_UNAVAILABLE') {
    throw new Error(`/api/customer/quote-preview non-FDM returned ${quote.status}/${quoteData.code || 'no-code'}`);
  }
  console.log('✓ non-FDM quote-preview material is rejected');

  const cart = await fetch(`${base}/api/customer/cart-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shopSlug: 'mahi3d',
      items: [{
        materialId: tempNonFdmMaterialId,
        file: {
          name: 'blocked-resin-smoke.stl',
          size: 1000,
          volumeCm3: 4,
          models: body.models,
          dimensions: { xMm: 20, yMm: 20, zMm: 20 },
        },
        colourId: body.colourId,
        colorId: body.colourId,
        finishId: body.finishId,
        infillTierId: body.infillTierId,
      }],
    }),
  });
  const cartData = await cart.json().catch(() => ({}));
  if (cart.status !== 400 || cartData.code !== 'MATERIAL_UNAVAILABLE') {
    throw new Error(`/api/customer/cart-preview non-FDM returned ${cart.status}/${cartData.code || 'no-code'}`);
  }
  console.log('✓ non-FDM cart-preview material is rejected');
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
  const res = await fetch(`${base}/api/customer/catalog?shop=mahi3d`);
  if (!res.ok) throw new Error(`/api/customer/catalog?shop=mahi3d returned ${res.status}`);
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
    shopSlug: 'mahi3d',
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
await expectJson('/api/customer/catalog?shop=mahi3d', ['materials', 'settings']);
await expectFdmOnlyCustomerMaterialApis();
await expectJson('/api/customer/exchange-rates?base=NZD&quotes=AUD,USD,GBP,EUR,CAD,JPY,SGD,HKD,CHF,CNY', ['base', 'rates', 'provider', 'stale']);
await expectPostJson('/api/customer/quote-preview', { shopSlug: 'mahi3d' }, [400]);
await expectNonFdmQuoteRejected();
await expectPostJson('/api/materials/assets', {}, [401]);
await expectPostJson('/api/stripe/create-payment-intent', {}, [400, 429]);
await expectPostJson('/api/customer/change-password', {}, [401, 429]);
await expectOversizeRejectedIfConfigured();

cleanup();
console.log('Security smoke checks passed.');

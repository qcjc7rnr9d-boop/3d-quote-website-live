const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';

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
await expectStatus('/api/settings', [401]);
await expectStatus('/api/pricing', [401]);
await expectStatus('/api/materials', [401]);
await expectStatus('/api/customer/me', [401]);
await expectStatus('/api/customer/orders', [401]);
await expectJson('/api/customer/catalog?shop=mahi3d', ['materials', 'settings']);
await expectPostJson('/api/customer/quote-preview', { shopSlug: 'mahi3d' }, [400]);
await expectPostJson('/api/materials/assets', {}, [401]);
await expectPostJson('/api/stripe/create-payment-intent', {}, [400, 429]);
await expectPostJson('/api/customer/change-password', {}, [401, 429]);
await expectOversizeRejectedIfConfigured();

console.log('Security smoke checks passed.');

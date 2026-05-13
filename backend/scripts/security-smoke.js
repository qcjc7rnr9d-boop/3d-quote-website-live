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

await expectStatus('/backend/server.js', [404]);
await expectStatus('/backend/data/rfdewi.db', [404]);
await expectStatus('/.git/config', [404]);
await expectStatus('/SECURITY.md', [404]);
await expectJson('/api/customer/catalog?shop=mahi3d', ['materials', 'settings']);
await expectPostJson('/api/materials/assets', {}, [401]);
await expectPostJson('/api/stripe/create-payment-intent', {}, [400, 429]);

console.log('Security smoke checks passed.');

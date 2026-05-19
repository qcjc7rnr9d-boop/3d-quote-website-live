const directUrl = process.env.HEALTH_DIRECT_URL || 'http://127.0.0.1:3001/api/health';
const proxyUrl = process.env.HEALTH_PROXY_URL || 'http://127.0.0.1/api/health';

async function check(url) {
  const res = await fetch(url, { redirect: 'manual' });
  if (!res.ok) {
    throw new Error(`${url} returned ${res.status}`);
  }
  const data = await res.json();
  if (data.ok !== true) {
    throw new Error(`${url} returned ok=${data.ok}`);
  }
  if (data.database?.status !== 'ok') {
    throw new Error(`${url} database status is ${data.database?.status || 'missing'}`);
  }
  console.log(`✓ ${url} ok (${data.database.engine}, uptime ${data.uptime_seconds}s)`);
  return data;
}

await check(directUrl);
await check(proxyUrl);

console.log('Production health smoke checks passed.');

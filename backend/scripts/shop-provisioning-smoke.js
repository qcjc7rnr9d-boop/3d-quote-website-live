import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const signature = require('cookie-signature');
const db = new DatabaseSync('data/rfdewi.db');
const slug = `provision-${randomUUID().slice(0, 8)}`;
const apiSlug = `provision-api-${randomUUID().slice(0, 8)}`;
const email = `${slug}@example.test`;
const apiEmail = `${apiSlug}@example.test`;
const port = 4750 + Math.floor(Math.random() * 180);
const base = `http://127.0.0.1:${port}`;
const sessionSecret = 'shop-provisioning-smoke-session';
let shopId = null;
let apiShopId = null;
let platformSessionId = null;
let server = null;

const {
  buildShopInstallPackage,
  normaliseShopSlug,
  renderShopInstallEmail,
  saveShopEmbedOrigins,
} = await import('../lib/shop-provisioning.js');

function makePlatformCookie() {
  platformSessionId = randomUUID();
  const expires = Date.now() + 15 * 60 * 1000;
  db.prepare(`
    INSERT INTO app_sessions (sid, sess, expires_at)
    VALUES (?, ?, ?)
  `).run(platformSessionId, JSON.stringify({
    cookie: {
      originalMaxAge: 15 * 60 * 1000,
      expires: new Date(expires).toISOString(),
      secure: false,
      httpOnly: true,
      path: '/',
      sameSite: 'strict',
    },
    platformAdmin: true,
    platformAdminId: 1,
  }), expires);
  return `connect.sid=${encodeURIComponent(`s:${signature.sign(platformSessionId, sessionSecret)}`)}`;
}

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/platform-info`);
      if (res.status === 200) return;
    } catch (err) {
      lastErr = err;
    }
    await delay(150);
  }
  throw new Error(`Server did not start in time: ${lastErr?.message || 'no response'}`);
}

async function csrfHeaders(cookie) {
  const res = await fetch(`${base}/api/csrf-token`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200, 'csrf token should load for platform session');
  const data = await res.json();
  assert.ok(data.csrfToken, 'csrf token response should include csrfToken');
  return {
    Cookie: cookie,
    'Content-Type': 'application/json',
    'X-CSRF-Token': data.csrfToken,
  };
}

try {
  assert.equal(normaliseShopSlug('  ACME Print Shop  '), 'acme-print-shop');
  assert.equal(normaliseShopSlug('Bad_Characters!!'), 'bad-characters');

  const result = db.prepare(`
    INSERT INTO shops (name, slug, email, password_hash, is_temp_password, plan)
    VALUES (?, ?, ?, ?, 1, 'community')
  `).run('Provision Smoke Shop', slug, email, 'not-a-real-hash');
  shopId = result.lastInsertRowid;
  db.prepare('INSERT INTO pricing_config (shop_id) VALUES (?)').run(shopId);
  db.prepare('INSERT INTO store_settings (shop_id) VALUES (?)').run(shopId);

  const origins = saveShopEmbedOrigins(db, shopId, [
    'https://client.example',
    'https://client.example/',
    'https://store.example.nz',
  ]);
  assert.deepEqual(origins, ['https://client.example', 'https://store.example.nz']);

  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId);
  const install = buildShopInstallPackage(shop, {
    db,
    baseUrl: 'https://app.trennen.co.nz',
    allowedOrigins: origins,
  });

  const tenantId = db.prepare('SELECT public_tenant_id FROM shops WHERE id = ?').get(shopId).public_tenant_id;
  assert.equal(install.shop.slug, slug);
  assert.equal(install.shop.public_tenant_id, tenantId);
  assert.equal(install.embed.allowed_origins.length, 2);
  assert.ok(install.embed.script.includes('https://embed.trennen.co.nz/widget.js'));
  assert.ok(install.embed.script.includes(`data-tenant-id="${tenantId}"`));
  assert.ok(install.embed.iframe.includes(`tenant=${tenantId}`));
  assert.ok(install.embed.iframe.includes('embed=1'));
  assert.equal(install.embed.dns_target, 'quotes.trennen.co.nz');
  assert.ok(install.links.quote.includes(`/index.html?shop=${slug}`));
  assert.ok(install.links.admin.includes('/admin/login.html'));
  assert.ok(!install.embed.script.includes('sk_'), 'install code must not expose Stripe secrets');
  assert.ok(!install.embed.script.includes('password'), 'install code must not expose passwords');

  const emailMessage = renderShopInstallEmail(shop, install);
  assert.equal(emailMessage.to, email);
  assert.match(emailMessage.subject, /Trennen quote widget/i);
  assert.match(emailMessage.text, /data-tenant-id=/);
  assert.match(emailMessage.text, /Approved website origins/);
  assert.match(emailMessage.html, /embed\.trennen\.co\.nz\/widget\.js/);
  assert.doesNotMatch(emailMessage.text, /password_hash|sk_test|sk_live/i);
  assert.doesNotMatch(emailMessage.html, /password_hash|sk_test|sk_live/i);

  const platformRoutes = readFileSync('routes/platform.js', 'utf8');
  assert.ok(platformRoutes.includes('buildShopInstallPackage'), 'platform shop creation should build install package');
  assert.ok(platformRoutes.includes('sendShopInstallEmail'), 'platform shop creation should send install email');
  assert.ok(platformRoutes.includes("router.post('/shops/:id/install-email'"), 'platform should expose a safe install-email resend endpoint');
  assert.ok(platformRoutes.includes('install_email_sent'), 'platform response should report install email state');

  const platformAdmin = readFileSync('../platform/admin.html', 'utf8');
  assert.ok(platformAdmin.includes('newWebsiteOrigin'), 'platform admin should collect the first approved embed origin');
  assert.ok(platformAdmin.includes('newSendInstallEmail'), 'platform admin should let admins send the install email');
  assert.ok(platformAdmin.includes('installCode'), 'platform admin should display the generated install code');

  const cookie = makePlatformCookie();
  server = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      BASE_URL: 'https://app.trennen.co.nz',
      SESSION_SECRET: sessionSecret,
      JWT_SECRET: 'shop-provisioning-smoke-jwt',
      PLATFORM_CONFIG_ENCRYPTION_KEY: 'shop-provisioning-smoke-encryption',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  server.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
  server.stderr.on('data', chunk => { serverOutput += chunk.toString(); });
  server.on('exit', code => {
    if (code && code !== 143 && code !== 130) {
      console.error(serverOutput);
    }
  });
  await waitForServer();

  const createRes = await fetch(`${base}/api/platform/shops`, {
    method: 'POST',
    headers: await csrfHeaders(cookie),
    body: JSON.stringify({
      name: 'Provision API Shop',
      slug: apiSlug,
      email: apiEmail,
      password: 'ProvisionTemp!2026',
      website_origin: 'https://client-api.example',
      send_install_email: false,
    }),
  });
  const createData = await createRes.json().catch(() => ({}));
  assert.equal(createRes.status, 201, `platform create shop should succeed: ${JSON.stringify(createData)}`);
  apiShopId = createData.id;
  assert.equal(createData.slug, apiSlug);
  assert.equal(createData.install_email_sent, false);
  assert.ok(createData.install?.shop?.public_tenant_id, 'create response should include public tenant ID');
  assert.ok(createData.install?.embed?.script?.includes('data-tenant-id='), 'create response should include tenant-specific script code');
  assert.ok(createData.install?.embed?.iframe?.includes(`tenant=${createData.install.shop.public_tenant_id}`), 'create response should include tenant-specific iframe code');
  assert.deepEqual(createData.install?.embed?.allowed_origins, ['https://client-api.example']);
  assert.ok(!JSON.stringify(createData).includes('password_hash'), 'platform create response must not expose password_hash');
  assert.ok(!JSON.stringify(createData).includes('sk_test'), 'platform create response must not expose Stripe secrets');

  console.log('Shop provisioning smoke checks passed.');
} finally {
  if (server && !server.killed) server.kill('SIGTERM');
  if (platformSessionId) db.prepare('DELETE FROM app_sessions WHERE sid = ?').run(platformSessionId);
  if (apiShopId) db.prepare('DELETE FROM shops WHERE id = ?').run(apiShopId);
  if (shopId) db.prepare('DELETE FROM shops WHERE id = ?').run(shopId);
  db.close();
}

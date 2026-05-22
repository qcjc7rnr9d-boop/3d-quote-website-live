import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const signature = require('cookie-signature');

const port = 4410 + Math.floor(Math.random() * 200);
const base = `http://127.0.0.1:${port}`;
const sessionSecret = 'saas-launch-smoke-session-secret';
const slug = `embed-smoke-${randomUUID().slice(0, 8)}`;
const allowedOrigins = ['https://example.com', 'https://quotes.example.net'];
const db = new DatabaseSync('data/rfdewi.db');
const root = resolve(import.meta.dirname, '../..');
let shopId = null;
let sessionId = null;
let server = null;

function cleanup() {
  try {
    if (server && !server.killed) server.kill('SIGTERM');
  } catch {}
  try {
    if (sessionId) db.prepare('DELETE FROM app_sessions WHERE sid = ?').run(sessionId);
    if (shopId) db.prepare('DELETE FROM shops WHERE id = ?').run(shopId);
    db.close();
  } catch {}
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

function assertStatus(res, expected, label) {
  assert.equal(res.status, expected, `${label} returned ${res.status}, expected ${expected}`);
}

async function api(path, options = {}) {
  return fetch(`${base}${path}`, { redirect: 'manual', ...options });
}

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await api('/api/platform-info');
      if (res.status === 200) return;
    } catch (err) {
      lastError = err;
    }
    await delay(150);
  }
  throw new Error(`Server did not start in time: ${lastError?.message || 'no response'}`);
}

async function csrfHeader(cookie, extra = {}) {
  const res = await api('/api/csrf-token', { headers: { Cookie: cookie } });
  assertStatus(res, 200, '/api/csrf-token');
  const data = await res.json();
  assert.ok(data.csrfToken, 'CSRF response should include csrfToken');
  return { Cookie: cookie, 'X-CSRF-Token': data.csrfToken, ...extra };
}

function makeShopCookie() {
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

function seedShop() {
  const result = db.prepare(`
    INSERT INTO shops (name, slug, email, password_hash, is_temp_password, plan)
    VALUES (?, ?, ?, ?, 0, 'starter')
  `).run('Embed Smoke Shop', slug, `${slug}@example.test`, 'not-a-real-hash');
  shopId = result.lastInsertRowid;
  db.prepare('INSERT INTO pricing_config (shop_id) VALUES (?)').run(shopId);
  db.prepare(`
    INSERT INTO store_settings (shop_id, embed_allowed_origins)
    VALUES (?, ?)
  `).run(shopId, JSON.stringify(allowedOrigins));
}

function htmlFilesUnder(relativeDir) {
  return readdirSync(resolve(root, relativeDir), { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.html'))
    .map(entry => `${relativeDir}/${entry.name}`);
}

function assertNoShopifyCspDomains(relativePath) {
  const html = readFileSync(resolve(root, relativePath), 'utf8');
  assert.doesNotMatch(html, /sdks\.shopifycdn\.com|checkout\.shopify\.com/, `${relativePath} CSP should not include Shopify domains in the lean release`);
}

function assertSelfServeHomepage(html, label) {
  assert.match(html, /Turn messy print requests into clear, professional quotes/i, `${label} should serve the self-serve sales homepage`);
  assert.match(html, /Start free/i, `${label} should include the self-serve signup CTA`);
  assert.match(html, /quote\.html\?shop=mahi3d&amp;demoStart=1/i, `${label} should keep the Mahi3D demo CTA`);
  assert.match(html, /No card required\. Start with bank transfer\. Upgrade when ready\./i, `${label} should explain the no-card trial path`);
  assert.doesNotMatch(html, /sdks\.shopifycdn\.com|checkout\.shopify\.com|\/api\/shopify/i, `${label} should not expose Shopify code`);
}

async function run() {
  const settingsHtml = readFileSync(resolve(root, 'admin/settings.html'), 'utf8');
  assert.match(settingsHtml, /embedAllowedOrigins/, 'admin settings should expose embed allowed origins control');
  assert.match(settingsHtml, /embed_allowed_origins/, 'admin settings should save embed_allowed_origins');

  const nginxExample = resolve(root, 'deploy/lightsail-nginx.conf.example');
  assert.ok(existsSync(nginxExample), 'Lightsail Nginx example should exist');
  assert.match(readFileSync(nginxExample, 'utf8'), /proxy_pass http:\/\/127\.0\.0\.1:3001/, 'Nginx example should proxy to the Node app');

  const launchDoc = resolve(root, 'docs/deployment/staged-saas-launch.md');
  assert.ok(existsSync(launchDoc), 'Staged SaaS launch deployment doc should exist');
  const launchDocText = readFileSync(launchDoc, 'utf8');
  assert.match(launchDocText, /pm2 restart 3d-quote-website/, 'deployment doc should include pm2 restart command');
  assert.match(launchDocText, /npm run migrate/, 'deployment doc should include migration command');
  assert.match(launchDocText, /80 and 443/, 'deployment doc should call out public firewall ports');
  assert.doesNotMatch(launchDocText, /SHOPIFY_|Shopify file uploads/i, 'active deployment doc should not include Shopify setup');

  const liveHtmlFiles = [
    'catalog.html',
    'checkout.html',
    'confirmation.html',
    'materials.html',
    'options.html',
    'privacy.html',
    'pricing.html',
    'quote.html',
    'stripe-callback.html',
    'terms.html',
    ...htmlFilesUnder('admin'),
    ...htmlFilesUnder('customer'),
    ...htmlFilesUnder('platform'),
  ];
  liveHtmlFiles.forEach(assertNoShopifyCspDomains);

  const checkoutJs = readFileSync(resolve(root, 'assets/checkout.js'), 'utf8');
  assert.doesNotMatch(checkoutJs, /\/api\/shopify|checkoutProvider\s*===\s*['"]shopify['"]|Shopify checkout/i, 'checkout should not expose Shopify mode in lean release');
  const quoteHtml = readFileSync(resolve(root, 'quote.html'), 'utf8');
  assert.doesNotMatch(quoteHtml, /CHECKOUT_PROVIDER|shopify_shop|checkout['"],\s*['"]shopify/i, 'quote should not preserve Shopify checkout mode in lean release');

  seedShop();

  server = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      BASE_URL: base,
      SESSION_SECRET: sessionSecret,
      JWT_SECRET: 'saas-launch-smoke-jwt-secret',
      PLATFORM_CONFIG_ENCRYPTION_KEY: 'saas-launch-smoke-encryption-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverOutput = '';
  server.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
  server.stderr.on('data', chunk => { serverOutput += chunk.toString(); });
  server.on('exit', code => {
    if (code !== null && code !== 0 && !server.killed) {
      console.error(serverOutput);
    }
  });

  await waitForServer();

  const health = await api('/api/health');
  assertStatus(health, 200, '/api/health');
  const healthData = await health.json();
  assert.equal(healthData.ok, true, 'health should report ok=true');
  assert.equal(healthData.database.status, 'ok', 'health should verify database status');
  assert.equal(healthData.storage.uploads.mode, 'local', 'health should include upload storage mode');
  assert.equal(Object.hasOwn(healthData.storage, 'shopify'), false, 'health should not report Shopify storage in lean release');
  assert.ok(Number.isFinite(healthData.uptime_seconds), 'health should include uptime_seconds');

  const rootLanding = await api('/');
  assertStatus(rootLanding, 200, '/');
  assertSelfServeHomepage(await rootLanding.text(), '/');

  const indexLanding = await api('/index.html?shop=mahi3d');
  assertStatus(indexLanding, 200, '/index.html');
  assertSelfServeHomepage(await indexLanding.text(), '/index.html');

  const onboarding = await api('/onboarding.html');
  assertStatus(onboarding, 200, '/onboarding.html');
  const onboardingHtml = await onboarding.text();
  const onboardingJs = readFileSync(resolve(root, 'assets/onboarding.js'), 'utf8');
  assert.match(onboardingHtml, /Create your shop/i, 'onboarding should serve the self-serve signup flow');
  assert.match(onboardingHtml, /assets\/onboarding\.js/i, 'onboarding should load the self-serve signup script');
  assert.match(onboardingJs, /\/api\/onboarding\/signup/i, 'onboarding script should submit to the self-serve signup API');
  assert.doesNotMatch(onboardingHtml, /card number|payment method/i, 'onboarding should not collect card details directly');

  for (const shopifyPath of ['/api/shopify', '/api/shopify/draft-order', '/apps/3d-quote', '/app']) {
    const res = await api(shopifyPath);
    assertStatus(res, 404, shopifyPath);
  }

  const widget = await api('/embed/v1/widget.js');
  assertStatus(widget, 200, '/embed/v1/widget.js');
  assert.match(widget.headers.get('content-type') || '', /javascript/i, 'widget should be JavaScript');
  const widgetJs = await widget.text();
  assert.match(widgetJs, /data-shop/, 'widget should read data-shop');
  assert.match(widgetJs, /iframe/, 'widget should render an iframe');
  assert.match(widgetJs, /\/embed\/quote/, 'widget should point at the embed quote route');

  const embed = await api(`/embed/quote?shop=${encodeURIComponent(slug)}`, {
    headers: { Referer: 'https://example.com/page' },
  });
  assertStatus(embed, 200, '/embed/quote');
  assert.equal(embed.headers.get('x-frame-options'), null, 'embed route must not emit X-Frame-Options');
  const csp = embed.headers.get('content-security-policy') || '';
  assert.match(csp, /frame-ancestors/, 'embed route should set frame-ancestors');
  assert.match(csp, /https:\/\/example\.com/, 'embed CSP should include approved origin');
  assert.doesNotMatch(csp, /https:\/\/evil\.example/, 'embed CSP should not include unapproved origins');
  assert.match(await embed.text(), /Drop your STL or OBJ files here|New uploads|Instant/i, 'embed route should serve quote content');

  const normalQuote = await api('/quote.html?shop=mahi3d');
  assertStatus(normalQuote, 200, '/quote.html');
  assert.equal(normalQuote.headers.get('x-frame-options'), 'SAMEORIGIN', 'normal quote page should keep frame protection');

  const unknownEmbed = await api('/embed/quote?shop=not-a-real-shop');
  assertStatus(unknownEmbed, 404, 'unknown embed shop');

  const cookie = makeShopCookie();
  const settings = await api('/api/settings', { headers: { Cookie: cookie } });
  assertStatus(settings, 200, '/api/settings');
  const settingsData = await settings.json();
  assert.deepEqual(settingsData.embed_allowed_origins, allowedOrigins, 'settings should expose embed_allowed_origins as an array');

  const invalidUpdate = await api('/api/settings', {
    method: 'PUT',
    headers: await csrfHeader(cookie, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ embed_allowed_origins: ['https://valid.example', 'javascript:alert(1)'] }),
  });
  assertStatus(invalidUpdate, 400, 'invalid embed origin update');

  const nextOrigins = ['https://customer-site.example'];
  const update = await api('/api/settings', {
    method: 'PUT',
    headers: await csrfHeader(cookie, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ embed_allowed_origins: nextOrigins }),
  });
  assertStatus(update, 200, 'valid embed origin update');
  const updated = await update.json();
  assert.deepEqual(updated.embed_allowed_origins, nextOrigins, 'settings should persist normalised embed origins');

  console.log('SaaS launch smoke checks passed.');
}

try {
  await run();
} finally {
  cleanup();
}

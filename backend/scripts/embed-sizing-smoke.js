import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '../../research/node_modules/playwright/index.mjs';

const require = createRequire(import.meta.url);
const signature = require('cookie-signature');

const appPort = 4560 + Math.floor(Math.random() * 120);
const parentPort = appPort + 900;
const base = `http://127.0.0.1:${appPort}`;
const parentBase = `http://127.0.0.1:${parentPort}`;
const sessionSecret = 'embed-sizing-smoke-session-secret';
const slug = `embed-sizing-${randomUUID().slice(0, 8)}`;
const tenantId = `ten_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
const legacyDemoSlug = 'mahi3d';
const db = new DatabaseSync('data/rfdewi.db');

let shopId = null;
let sessionId = null;
let appServer = null;
let parentServer = null;

function cleanup() {
  try {
    if (appServer && !appServer.killed) appServer.kill('SIGTERM');
  } catch {}
  try {
    parentServer?.close();
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

function seedShop() {
  const result = db.prepare(`
    INSERT INTO shops (name, slug, public_tenant_id, email, password_hash, is_temp_password, plan)
    VALUES (?, ?, ?, ?, ?, 0, 'starter')
  `).run('Embed Sizing Smoke', slug, tenantId, `${slug}@example.test`, 'not-a-real-hash');
  shopId = result.lastInsertRowid;
  db.prepare('INSERT INTO pricing_config (shop_id) VALUES (?)').run(shopId);
  db.prepare(`
    INSERT INTO store_settings (shop_id, embed_allowed_origins)
    VALUES (?, ?)
  `).run(shopId, JSON.stringify([parentBase]));
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

async function waitForServer() {
  const deadline = Date.now() + 10_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.status === 200) return;
    } catch (err) {
      lastError = err;
    }
    await delay(150);
  }
  throw new Error(`Server did not start in time: ${lastError?.message || 'no response'}`);
}

function startParentServer() {
  parentServer = http.createServer((req, res) => {
    if (req.url !== '/') {
      res.writeHead(404).end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Embed smoke parent</title>
    <style>
      body { margin: 0; padding: 24px; font-family: system-ui, sans-serif; }
      #mount { width: min(100%, 720px); margin: 0 auto; border: 1px solid #ddd; }
    </style>
  </head>
  <body>
    <div id="mount"></div>
    <script
      src="${base}/embed/v1/widget.js"
      data-tenant-id="${tenantId}"
      data-mount="#mount"
      data-min-height="320"
      data-max-height="1800"
      data-theme-primary="#5f8b62"
      data-theme-font="Inter"
      data-title="Smoke quote">
    </script>
  </body>
</html>`);
  });
  return new Promise(resolve => parentServer.listen(parentPort, '127.0.0.1', resolve));
}

async function run() {
  seedShop();
  await startParentServer();

  appServer = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(appPort),
      NODE_ENV: 'development',
      BASE_URL: base,
      SESSION_SECRET: sessionSecret,
      JWT_SECRET: 'embed-sizing-smoke-jwt-secret',
      PLATFORM_CONFIG_ENCRYPTION_KEY: 'embed-sizing-smoke-encryption-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverOutput = '';
  appServer.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
  appServer.stderr.on('data', chunk => { serverOutput += chunk.toString(); });
  appServer.on('exit', code => {
    if (code !== null && code !== 0 && !appServer.killed) {
      console.error(serverOutput);
    }
  });

  await waitForServer();

  const widgetRes = await fetch(`${base}/embed/v1/widget.js`);
  assert.equal(widgetRes.status, 200, 'widget should load');
  const widgetJs = await widgetRes.text();
  assert.match(widgetJs, /postMessage|message/, 'widget should listen for iframe resize messages');
  assert.match(widgetJs, /data-tenant-id|tenantId/, 'widget should support data-tenant-id');
  assert.match(widgetJs, /data-shop/, 'widget should keep legacy data-shop support');
  assert.match(widgetJs, /data-theme-primary/, 'widget should support theme primary');
  assert.match(widgetJs, /data-theme-font/, 'widget should support theme font');
  assert.match(widgetJs, /data-min-height/, 'widget should support data-min-height');
  assert.match(widgetJs, /data-max-height/, 'widget should support data-max-height');
  assert.match(widgetJs, /embed:\s*'1'|searchParams\.set\(['"]embed['"],\s*['"]1['"]\)/, 'widget iframe src should enable embedded mode');
  assert.doesNotMatch(widgetJs, /quote\.html/, 'widget iframe must not start on the empty quote review page');

  const normalQuote = await fetch(`${base}/quote.html?shop=${slug}`);
  assert.equal(normalQuote.headers.get('x-frame-options'), 'SAMEORIGIN', 'normal quote page should keep frame protection');

  const embedQuote = await fetch(`${base}/embed/quote?shop=${slug}`, {
    headers: { Referer: `${parentBase}/` },
  });
  assert.equal(embedQuote.status, 200, 'embed quote should load');
  assert.equal(embedQuote.headers.get('x-frame-options'), null, 'embed route should not set X-Frame-Options');
  assert.match(embedQuote.headers.get('content-security-policy') || '', new RegExp(parentBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'embed route should allow the approved parent origin');
  const embedQuoteHtml = await embedQuote.text();
  assert.match(embedQuoteHtml, /Your 3D file,\s*priced instantly|Drop your STL or OBJ files here/i, 'legacy embed route should serve the upload homepage');
  assert.doesNotMatch(embedQuoteHtml, /id="quotePageTitle"|id="viewerEmptyTitle"/i, 'legacy embed route must not serve the empty quote review page');

  const tenantConfig = await fetch(`${base}/api/embed/config?tenant=${tenantId}`);
  assert.equal(tenantConfig.status, 200, 'tenant embed config should load');
  const tenantConfigData = await tenantConfig.json();
  assert.equal(tenantConfigData.tenant_id, tenantId, 'tenant embed config should return tenant ID');
  assert.equal(tenantConfigData.shop_slug, slug, 'tenant embed config should resolve the correct shop slug');

  const tenantEmbedQuote = await fetch(`${base}/embed/quote?tenant=${tenantId}&embed=1`, {
    headers: { Referer: `${parentBase}/` },
  });
  assert.equal(tenantEmbedQuote.status, 200, 'tenant embed quote should load');
  assert.match(await tenantEmbedQuote.text(), /Drop your STL or OBJ files here/i, 'tenant embed quote should serve upload homepage');

  const demoShop = db.prepare("SELECT id FROM shops WHERE slug = 'trennen'").get();
  if (demoShop) {
    const legacyEmbedQuote = await fetch(`${base}/embed/quote?shop=${legacyDemoSlug}`);
    assert.equal(legacyEmbedQuote.status, 200, 'legacy mahi3d embed URL should resolve to the canonical Trennen demo shop');
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(parentBase, { waitUntil: 'domcontentloaded' });
    const iframe = page.locator('iframe[title="Smoke quote"]');
    await iframe.waitFor({ state: 'attached', timeout: 7000 });
    await page.waitForFunction(() => {
      const frame = document.querySelector('iframe');
      return frame && frame.style.height && parseInt(frame.style.height, 10) > 320;
    }, null, { timeout: 7000 });

    const frameState = await page.evaluate(() => {
      const frame = document.querySelector('iframe');
      return {
        src: frame?.getAttribute('src') || '',
        width: frame?.getBoundingClientRect().width || 0,
        height: frame?.getBoundingClientRect().height || 0,
        docWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    assert.match(frameState.src, /\/index\.html\?/, 'widget iframe should use the upload homepage route after tenant resolution');
    assert.match(frameState.src, /embed=1/, 'widget iframe should include embed=1');
    assert.match(frameState.src, new RegExp(tenantId), 'widget iframe should preserve tenant context');
    assert.match(frameState.src, new RegExp(`shop=${slug}`), 'tenant-only widget iframe should include the backend-resolved shop context');
    assert.doesNotMatch(frameState.src, /#uploadZone$/, 'widget iframe should start at the top of the software, not jump down to the upload card');
    assert(frameState.height > 320, `iframe should auto-size above fallback height, got ${frameState.height}`);
    assert(frameState.docWidth <= frameState.viewportWidth + 1, `parent page should not horizontally overflow (${frameState.docWidth} > ${frameState.viewportWidth})`);

    const child = page.frame({ url: /\/index\.html/ });
    assert(child, 'embedded quote frame should be accessible');
    const childState = await child.evaluate(() => {
      const uploadZone = document.querySelector('#uploadZone');
      const continueLink = document.querySelector('#continueBtn')?.getAttribute('href') || '';
      const navRect = document.querySelector('.nav')?.getBoundingClientRect();
      const heroRect = document.querySelector('.hero')?.getBoundingClientRect();
      return {
        embeddedClass: document.documentElement.classList.contains('is-embedded') || document.body.classList.contains('is-embedded'),
        uploadText: uploadZone?.textContent || '',
        continueLink,
        scrollY: window.scrollY,
        navHeight: navRect?.height || 0,
        heroTop: heroRect?.top ?? 9999,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    assert(childState.embeddedClass, 'embedded quote page should expose an embedded-mode class');
    assert.match(childState.uploadText, /Drop your STL or OBJ files here/i, 'embedded first screen should show the upload homepage');
    assert.match(childState.continueLink, /embed=1/, 'quote-flow links should preserve embed=1');
    assert(childState.scrollY < 20, `embedded first screen should not auto-scroll past the top, got scrollY ${childState.scrollY}`);
    assert(childState.navHeight >= 44, `embedded first screen should keep the top navigation visible, got ${childState.navHeight}px`);
    assert(childState.heroTop < 120, `embedded first screen should start with the homepage hero/top area, got hero top ${childState.heroTop}`);
    assert(childState.scrollWidth <= childState.clientWidth + 1, `embedded child should not horizontally overflow (${childState.scrollWidth} > ${childState.clientWidth})`);
    assert.equal(errors.length, 0, `embed parent runtime errors: ${errors.join('; ')}`);

    const materialPage = await context.newPage();
    await materialPage.addInitScript(() => {
      localStorage.setItem('form_file', JSON.stringify({
        name: 'embed-layout-test.stl',
        size: 2048,
        volumeCm3: 12.5,
        dimensions: { x: 42, y: 36, z: 28 },
        models: [{
          id: 'embed-model-1',
          name: 'embed-layout-test.stl',
          size: 2048,
          volumeCm3: 12.5,
          dimensions: { x: 42, y: 36, z: 28 },
          quantity: 1,
        }],
      }));
    });
    await materialPage.goto(`${base}/materials.html?shop=trennen&embed=1`, { waitUntil: 'networkidle' });
    await materialPage.locator('.material-card').first().waitFor({ state: 'visible', timeout: 7000 });
    const materialLayout = await materialPage.evaluate(() => {
      const card = document.querySelector('.material-card');
      const columns = [...document.querySelectorAll('.material-card .column')].slice(0, 3).map(el => {
        const style = getComputedStyle(el);
        return `${style.gridColumnStart} / ${style.gridColumnEnd}`;
      });
      const topbar = document.querySelector('.topbar')?.getBoundingClientRect();
      return {
        topbarHeight: topbar?.height || 0,
        cardWidth: card?.getBoundingClientRect().width || 0,
        docWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        columnPlacements: columns,
      };
    });
    assert(materialLayout.topbarHeight >= 54, `embedded materials page should keep the top progress header visible, got ${materialLayout.topbarHeight}px`);
    assert(materialLayout.cardWidth > 0, 'embedded materials page should render material cards');
    assert(materialLayout.docWidth <= materialLayout.viewportWidth + 1, `embedded materials page should not horizontally overflow (${materialLayout.docWidth} > ${materialLayout.viewportWidth})`);
    assert(
      materialLayout.columnPlacements.every(value => value === '1 / -1'),
      `embedded material detail columns should span the card instead of auto-placing into a cramped grid, got ${materialLayout.columnPlacements.join(', ')}`
    );

    const demoCatalogRes = await fetch(`${base}/api/customer/catalog?shop=trennen`);
    assert.equal(demoCatalogRes.status, 200, 'demo catalog should load for embedded options layout check');
    const demoCatalog = await demoCatalogRes.json();
    const firstDemoMaterial = (demoCatalog.materials || []).find(material => String(material.category || '').toLowerCase() === 'fdm');
    assert(firstDemoMaterial?.id, 'demo catalog should expose an FDM material for embedded options layout check');

    const optionPage = await context.newPage();
    await optionPage.addInitScript(({ materialId, materialName }) => {
      localStorage.setItem('form_file', JSON.stringify({
        name: 'embed-options-test.stl',
        size: 4096,
        volumeCm3: 18.5,
        dimensions: { x: 52, y: 44, z: 31 },
        models: [{
          id: 'embed-options-model-1',
          name: 'embed-options-test.stl',
          size: 4096,
          volumeCm3: 18.5,
          dimensions: { x: 52, y: 44, z: 31 },
          quantity: 1,
        }],
      }));
      localStorage.setItem('form_selection', JSON.stringify({
        materialId,
        materialName,
        requiredSelections: { material: true },
      }));
    }, { materialId: firstDemoMaterial.id, materialName: firstDemoMaterial.name });
    await optionPage.goto(`${base}/options.html?shop=trennen&embed=1`, { waitUntil: 'networkidle' });
    await optionPage.locator('.option-card').first().waitFor({ state: 'visible', timeout: 7000 });
    const optionLayout = await optionPage.evaluate(() => {
      const cards = [...document.querySelectorAll('.option-card')].map(card => {
        const rect = card.getBoundingClientRect();
        const style = getComputedStyle(card);
        return {
          top: rect.top,
          bottom: rect.bottom,
          overflowY: style.overflowY,
          maxHeight: style.maxHeight,
        };
      });
      const summary = document.querySelector('.summary-bar');
      const summaryRect = summary?.getBoundingClientRect();
      const summaryStyle = summary ? getComputedStyle(summary) : null;
      const overlap = cards.some(card => summaryRect && summaryRect.top < card.bottom && summaryRect.bottom > card.top);
      return {
        summaryPosition: summaryStyle?.position || '',
        summaryTop: summaryRect?.top || 0,
        cardBottom: Math.max(...cards.map(card => card.bottom)),
        overlap,
        cardOverflowModes: cards.map(card => card.overflowY),
        cardMaxHeights: cards.map(card => card.maxHeight),
        docWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    assert.notEqual(optionLayout.summaryPosition, 'fixed', 'embedded options summary should be in normal document flow, not fixed over choices');
    assert(optionLayout.summaryTop >= optionLayout.cardBottom, `embedded options summary should render below option cards, got summary top ${optionLayout.summaryTop} before card bottom ${optionLayout.cardBottom}`);
    assert.equal(optionLayout.overlap, false, 'embedded options summary must not overlap option choices');
    assert(optionLayout.cardOverflowModes.every(value => value === 'visible'), `embedded option cards should expand instead of trapping scroll, got ${optionLayout.cardOverflowModes.join(', ')}`);
    assert(optionLayout.cardMaxHeights.every(value => value === 'none'), `embedded option cards should not use viewport-based max-height, got ${optionLayout.cardMaxHeights.join(', ')}`);
    assert(optionLayout.docWidth <= optionLayout.viewportWidth + 1, `embedded options page should not horizontally overflow (${optionLayout.docWidth} > ${optionLayout.viewportWidth})`);
    await context.close();
  } finally {
    await browser.close();
  }

  const cookie = makeShopCookie();
  const settings = await fetch(`${base}/api/settings`, { headers: { Cookie: cookie } });
  assert.equal(settings.status, 200, 'settings should load for shop admin');
  const settingsHtml = await fetch(`${base}/admin/settings.html`).then(res => res.text());
  assert.match(settingsHtml, /embed\.trennen\.co\.nz\/widget\.js/, 'settings page should show the production tenant embed script');
  assert.match(settingsHtml, /data-tenant-id/, 'settings page should show tenant ID embed attribute');
  assert.match(settingsHtml, /quotes\.trennen\.co\.nz/, 'settings page should show custom-domain CNAME target');
  assert.doesNotMatch(settingsHtml, /cdn\.yourdomain\.com/, 'settings page should not show placeholder CDN embed code');

  console.log('Embed sizing smoke checks passed.');
}

try {
  await run();
} finally {
  cleanup();
}

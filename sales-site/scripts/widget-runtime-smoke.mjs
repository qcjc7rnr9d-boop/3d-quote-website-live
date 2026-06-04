import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { chromium } from '../../research/node_modules/playwright/index.mjs';
import { defaultPublicRoot, resolveStaticRequest } from '../server.mjs';

const base = 'http://localhost:3000';

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route(`${base}/**`, async route => {
    const url = new URL(route.request().url());
    const resolved = resolveStaticRequest(`${url.pathname}${url.search}`, defaultPublicRoot);
    if (resolved.status !== 200 || !resolved.filePath || !existsSync(resolved.filePath)) {
      await route.fulfill({ status: 404, contentType: 'text/plain; charset=utf-8', body: 'Not found' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: resolved.contentType,
      body: await readFile(resolved.filePath),
    });
  });

  const consoleMessages = [];
  page.on('console', message => {
    const text = message.text();
    if (/Content Security Policy|Refused to frame|trennen/i.test(text)) {
      consoleMessages.push(text);
    }
  });

  await page.goto(`${base}/index.html#demo`, { waitUntil: 'domcontentloaded' });

  const frameLocator = page.locator('iframe[title="Instant 3D quote"]');
  await frameLocator.waitFor({ state: 'attached', timeout: 10_000 });
  await page.waitForFunction(() => {
    const frame = document.querySelector('iframe[title="Instant 3D quote"]');
    return frame?.getAttribute('src')?.includes('/index.html?');
  }, null, { timeout: 10_000 });

  const frameSrc = await frameLocator.getAttribute('src');
  assert.match(frameSrc || '', /^https:\/\/embed\.trennen\.co\.nz\/index\.html\?/, 'sales homepage widget iframe should navigate to the hosted upload homepage');
  assert.match(frameSrc || '', /tenant=ten_XtI4xnABbNGOdSUv6Uqm/, 'sales homepage widget iframe should use the Trennen demo tenant');
  await page.waitForFunction(() => (
    window.frames.length > 0
  ), null, { timeout: 10_000 });
  await page.waitForFunction(() => (
    performance.getEntriesByType('resource').some(entry => entry.name.includes('https://embed.trennen.co.nz/index.html'))
  ), null, { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(500);

  const embeddedFrame = page.frame({ url: /https:\/\/embed\.trennen\.co\.nz\/index\.html/ });
  assert.ok(
    embeddedFrame,
    `sales homepage widget iframe should not remain blank/about:blank. Console: ${consoleMessages.join(' | ')}`,
  );

  await embeddedFrame.getByText(/Your 3D file|Drop your STL or OBJ files here/i).first().waitFor({ state: 'visible', timeout: 12_000 });
  const uploadControls = (
    await embeddedFrame.locator('#uploadZone').count()
    + await embeddedFrame.locator('[aria-label*="Drop your STL"]').count()
    + await embeddedFrame.getByText(/Browse Files|Choose files/i).count()
  );
  assert.ok(uploadControls > 0, 'embedded quote runtime should show upload controls');
} finally {
  await browser.close();
}

console.log('Sales-site widget runtime checks passed.');

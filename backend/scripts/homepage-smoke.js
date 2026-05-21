import { chromium } from '../../research/node_modules/playwright/index.mjs';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectVisible(page, selector, label) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible', timeout: 5000 });
  assert(await el.isVisible(), `${label} should be visible`);
  return el;
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  const response = await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  assert(response && response.status() < 500, `Homepage returned ${response?.status() || 'no response'}`);
  await page.waitForLoadState('networkidle');
  assert(pageErrors.length === 0, `Homepage runtime errors: ${pageErrors.join('; ')}`);

  assert(/\/(?:index\.html)?(?:\?|$)/.test(new URL(page.url()).pathname + new URL(page.url()).search), `Homepage should stay on the public root, got ${page.url()}`);
  const title = await page.title();
  assert(/Trennen/i.test(title), 'Homepage title should identify Trennen');

  assert(await page.locator('link[href="assets/sales.css"]').count() === 1, 'Homepage should load sales.css');
  assert(await page.locator('script[src="assets/sales.js"]').count() === 1, 'Homepage should load sales.js');
  assert(await page.locator('script[src*="shopify"]').count() === 0, 'Homepage should not load Shopify scripts');

  const h1 = await expectVisible(page, 'h1', 'homepage headline');
  assert(/messy print requests/i.test(await h1.textContent()), 'Hero headline should be the self-serve sales message');

  assert(await page.locator('#uploadZone').count() === 0, 'Root homepage should not expose the legacy upload zone');
  assert(await page.locator('#fileInput').count() === 0, 'Root homepage should not expose direct file upload controls');
  assert(await page.locator('a[href="onboarding.html"]').count() >= 1, 'Homepage should link to self-serve signup');
  assert(await page.locator('a[href="quote.html?shop=mahi3d&demoStart=1"]').count() >= 1, 'Homepage demo CTA should keep the mahi3d demo URL');
  assert(/Bank transfer/i.test(await page.textContent('body')), 'Homepage should mention bank transfer readiness');

  console.log('Homepage smoke checks passed.');
} finally {
  await browser.close();
}

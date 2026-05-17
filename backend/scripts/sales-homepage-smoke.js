import { chromium } from '../../research/node_modules/playwright/index.mjs';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectVisible(page, selector, label) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible', timeout: 3000 });
  assert(await el.isVisible(), `${label} should be visible`);
  return el;
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  const response = await page.goto(base, { waitUntil: 'domcontentloaded' });
  assert(response && response.status() < 500, `Homepage returned ${response?.status() || 'no response'}`);
  await page.waitForLoadState('networkidle');
  assert(pageErrors.length === 0, `Homepage runtime errors: ${pageErrors.join('; ')}`);

  const title = await page.title();
  assert(/3D Print On Demand/i.test(title), 'Homepage title should be the customer quote storefront');

  assert(await page.locator('script[src*="brand.js"]').count() === 1, 'Software homepage should load brand.js');
  assert(await page.locator('link[href="assets/sales.css"]').count() === 0, 'Software homepage should not load sales.css');
  assert(await page.locator('script[src="assets/sales.js"]').count() === 0, 'Software homepage should not load sales.js');

  const h1 = await expectVisible(page, 'h1', 'quote homepage headline');
  assert(/Your 3D file/i.test(await h1.textContent()), 'Hero headline should be the quote-upload message');

  const uploadZone = await expectVisible(page, '#uploadZone', 'upload zone');
  assert(/Drop your STL or OBJ files here/i.test(await uploadZone.textContent()), 'Upload zone should invite STL/OBJ uploads');

  const fileInputMultiple = await page.locator('#fileInput').evaluate(input => input.hasAttribute('multiple'));
  assert(fileInputMultiple, 'Homepage upload input should support multiple models');

  const continueHref = await page.locator('#continueBtn').getAttribute('href');
  assert(/materials\.html\?shop=mahi3d/.test(continueHref || ''), 'Choose Material should route into the material selection step');

  assert(await page.locator('#demo-form').count() === 0, 'Sales demo form should not be present on the software homepage');
  assert(!/Quote Every Job/i.test(await page.textContent('body')), 'Dark software-sales copy should not be present');

  console.log('Software homepage smoke checks passed.');
} finally {
  await browser.close();
}

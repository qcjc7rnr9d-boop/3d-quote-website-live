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
  assert(/Trennen/i.test(title), 'Homepage title should use Trennen branding');

  const brandScriptCount = await page.locator('script[src*="brand.js"]').count();
  assert(brandScriptCount === 0, 'Sales homepage must not load brand.js');

  const stylesheetCount = await page.locator('link[href="assets/sales.css"]').count();
  assert(stylesheetCount === 1, 'Sales homepage should load assets/sales.css');

  const scriptCount = await page.locator('script[src="assets/sales.js"]').count();
  assert(scriptCount === 1, 'Sales homepage should load assets/sales.js');

  const h1 = await expectVisible(page, 'h1', 'hero headline');
  assert(/instant quoting software/i.test(await h1.textContent()), 'Hero headline should pitch instant quoting software');

  const heroImage = await expectVisible(page, '.hero-product-image', 'hero product image');
  const imageReady = await heroImage.evaluate(img => img.complete && img.naturalWidth > 600 && img.naturalHeight > 350);
  assert(imageReady, 'Hero product image should load with useful dimensions');

  const primaryCta = await expectVisible(page, 'a[href="#demo"]', 'book demo CTA');
  assert(/book a demo/i.test(await primaryCta.textContent()), 'Primary CTA should invite demo booking');

  const secondaryHref = await page.locator('a[data-sales-quote-demo]').first().getAttribute('href');
  assert(secondaryHref === 'quote.html?shop=mahi3d', 'Secondary CTA should point to the existing quote flow');

  assert(await page.locator('#demo-form').count() === 1, 'Demo form should exist');
  assert(await page.locator('#uploadZone').count() === 0, 'Legacy homepage upload zone should be removed');

  await page.locator('#demo-form button[type="submit"]').click();
  await expectVisible(page, '#demo-form [data-field-error="name"]', 'name validation error');
  await expectVisible(page, '#demo-form [data-field-error="email"]', 'email validation error');

  await page.fill('#demo-name', 'Alex Taylor');
  await page.fill('#demo-email', 'not-an-email');
  await page.fill('#demo-company', 'LayerWorks');
  await page.selectOption('#demo-volume', '26-100');
  await page.fill('#demo-message', 'We quote a lot of FDM parts and need a better intake flow.');
  await page.locator('#demo-form button[type="submit"]').click();
  const emailError = await expectVisible(page, '#demo-form [data-field-error="email"]', 'invalid email validation error');
  assert(/valid work email/i.test(await emailError.textContent()), 'Invalid email should show a specific validation message');

  await page.fill('#demo-email', 'alex@layerworks.example');
  await page.locator('#demo-form button[type="submit"]').click();
  const success = await expectVisible(page, '#demo-success', 'demo form success state');
  assert(/prototype only/i.test(await success.textContent()), 'Demo form success should make frontend-only behavior clear');

  await page.setViewportSize({ width: 390, height: 860 });
  await page.locator('.nav-toggle').click();
  const mobileOpen = await page.locator('.site-nav').evaluate(nav => nav.classList.contains('is-open'));
  assert(mobileOpen, 'Mobile navigation should open from the toggle');

  console.log('Sales homepage smoke checks passed.');
} finally {
  await browser.close();
}

import { chromium } from '../../research/node_modules/playwright/index.mjs';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pages = [
  '/?shop=trennen',
  '/index.html?shop=trennen',
  '/catalog.html?shop=trennen',
  '/materials.html?shop=trennen',
  '/options.html?shop=trennen',
  '/quote.html?shop=trennen',
  '/checkout.html?shop=trennen',
  '/confirmation.html?shop=trennen',
  '/terms.html?shop=trennen',
  '/privacy.html?shop=trennen',
  '/pricing.html',
  '/customer/login.html?shop=trennen',
  '/customer/forgot-password.html?shop=trennen',
  '/customer/reset-password.html?shop=trennen&token=invalid',
  '/customer/dashboard.html?shop=trennen#overview',
  '/admin/login.html',
  '/admin/forgot-password.html',
  '/admin/reset-password.html?token=invalid',
  '/admin/dashboard.html',
  '/admin/materials.html',
  '/admin/orders.html',
  '/admin/pricing.html',
  '/admin/settings.html',
  '/admin/shipping.html',
  '/admin/payments.html',
  '/admin/customers.html',
  '/admin/notifications.html',
  '/platform/login.html',
  '/platform/forgot-password.html',
  '/platform/reset-password.html?token=invalid',
  '/platform/admin.html',
];

function sameOriginLocalHref(raw, currentUrl) {
  if (!raw || raw.startsWith('#')) return null;
  if (/^(mailto:|tel:|javascript:)/i.test(raw)) return null;
  const url = new URL(raw, currentUrl);
  if (url.origin !== new URL(base).origin) return null;
  return url;
}

async function evalAfterSettling(page, selector, fn) {
  try {
    return await page.$$eval(selector, fn);
  } catch (err) {
    if (!/Execution context was destroyed/i.test(String(err?.message || err))) {
      throw err;
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(250);
    return page.$$eval(selector, fn);
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const checkedLinks = new Set();

  for (const path of pages) {
    const page = await context.newPage();
    const pageErrors = [];
    const cspErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error' && /Content Security Policy/i.test(msg.text())) {
        cspErrors.push(msg.text());
      }
    });
    const response = await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
    assert(response && response.status() < 500, `${path} returned ${response?.status() || 'no response'}`);
    await page.waitForTimeout(250);
    assert(pageErrors.length === 0, `${path} runtime errors: ${pageErrors.join('; ')}`);
    assert(cspErrors.length === 0, `${path} CSP errors: ${cspErrors.join('; ')}`);

    const title = await page.title();
    assert(title && title.trim().length > 0, `${path} is missing a document title`);

    const unlabeledVisibleInputs = await evalAfterSettling(page, 'input, select, textarea', controls => controls
      .filter(el => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (el.type === 'hidden') return false;
        if (el.disabled) return false;
        return !el.id || !document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      })
      .filter(el => !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !el.closest('label'))
      .map(el => `${el.tagName.toLowerCase()}#${el.id || '(no-id)'}`));
    assert(unlabeledVisibleInputs.length === 0, `${path} has unlabeled visible controls: ${unlabeledVisibleInputs.join(', ')}`);

    const hrefs = await evalAfterSettling(page, 'a[href]', links => links.map(a => a.getAttribute('href')));
    for (const href of hrefs) {
      const url = sameOriginLocalHref(href, page.url());
      if (!url) continue;
      const key = `${url.pathname}${url.search}`;
      if (checkedLinks.has(key)) continue;
      checkedLinks.add(key);
      if (url.pathname.startsWith('/api/')) continue;
      const res = await fetch(url.toString(), { redirect: 'manual' });
      assert(res.status < 500, `Local link ${key} returned ${res.status}`);
      assert(res.status !== 404, `Local link ${key} returned 404`);
    }
    await page.close();
  }

  console.log(`Frontend page smoke checks passed for ${pages.length} pages and ${checkedLinks.size} local links.`);
} finally {
  await browser.close();
}

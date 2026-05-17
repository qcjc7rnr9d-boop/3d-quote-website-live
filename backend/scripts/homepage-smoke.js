import { chromium } from '../../research/node_modules/playwright/index.mjs';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeStlBuffer() {
  const tri = 12;
  const buf = new ArrayBuffer(84 + tri * 50);
  const dv = new DataView(buf);
  dv.setUint32(80, tri, true);
  let off = 84;
  const v = [
    [-10, -10, -10], [10, -10, -10], [10, 10, -10], [-10, 10, -10],
    [-10, -10, 10], [10, -10, 10], [10, 10, 10], [-10, 10, 10],
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ];
  for (const face of faces) {
    off += 12;
    for (const idx of face) {
      for (const n of v[idx]) {
        dv.setFloat32(off, n, true);
        off += 4;
      }
    }
    dv.setUint16(off, 0, true);
    off += 2;
  }
  return Buffer.from(buf);
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

  assert(/\/(?:index\.html)?(?:\?|$)/.test(new URL(page.url()).pathname + new URL(page.url()).search), `Homepage should not redirect into quote.html, got ${page.url()}`);
  const title = await page.title();
  assert(/3D Print On Demand/i.test(title), 'Homepage title should be the upload-first storefront');

  assert(await page.locator('script[src*="brand.js"]').count() === 1, 'Homepage should load brand.js');
  assert(await page.locator('link[href="assets/sales.css"]').count() === 0, 'Homepage should not load sales.css');
  assert(await page.locator('script[src="assets/sales.js"]').count() === 0, 'Homepage should not load sales.js');
  assert(await page.locator('script[src*="shopify"]').count() === 0, 'Homepage should not load Shopify scripts');

  const h1 = await expectVisible(page, 'h1', 'homepage headline');
  assert(/Your 3D file/i.test(await h1.textContent()), 'Hero headline should be the quote-upload message');

  const uploadZone = await expectVisible(page, '#uploadZone', 'upload zone');
  assert(/Drop your STL or OBJ files here/i.test(await uploadZone.textContent()), 'Upload zone should invite STL/OBJ uploads');

  const fileInputMultiple = await page.locator('#fileInput').evaluate(input => input.hasAttribute('multiple'));
  assert(fileInputMultiple, 'Homepage upload input should support multiple models');
  assert(await page.locator('#demo-form').count() === 0, 'Sales demo form should not be present on the upload homepage');
  assert(!/Quote Every Job/i.test(await page.textContent('body')), 'SaaS sales copy should not be present');

  await page.setInputFiles('#fileInput', {
    name: 'homepage-smoke.stl',
    mimeType: 'model/stl',
    buffer: makeStlBuffer(),
  });
  await page.waitForSelector('#fileCard.visible', { timeout: 5000 });
  const uploadState = await page.evaluate(async () => {
    const formFile = JSON.parse(localStorage.getItem('form_file') || 'null');
    const idbModel = await new Promise(resolve => {
      const req = indexedDB.open('mahi3d-quote', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('files', 'readonly');
        const getReq = tx.objectStore('files').get('current_model');
        getReq.onerror = () => resolve(null);
        getReq.onsuccess = () => resolve(getReq.result || null);
      };
    });
    return {
      name: formFile?.models?.[0]?.name || formFile?.name || '',
      modelCount: formFile?.models?.length || 0,
      dimensions: formFile?.dimensions || null,
      hasIndexedModel: !!idbModel?.buffer,
      continueHref: document.querySelector('#continueBtn')?.getAttribute('href') || '',
    };
  });
  assert(uploadState.name === 'homepage-smoke.stl', `Uploaded model metadata was not saved, got ${uploadState.name}`);
  assert(uploadState.modelCount === 1, `Expected one uploaded model, got ${uploadState.modelCount}`);
  assert(Number(uploadState.dimensions?.xMm) > 0, 'Uploaded model dimensions were not saved');
  assert(uploadState.hasIndexedModel, 'Uploaded model buffer was not saved for the viewer');
  assert(/materials\.html\?shop=mahi3d$/.test(uploadState.continueHref), `Choose Material link should include shop slug, got ${uploadState.continueHref}`);

  await page.click('#continueBtn');
  await page.waitForURL(/\/materials\.html\?shop=mahi3d$/, { timeout: 7000 });

  console.log('Homepage smoke checks passed.');
} finally {
  await browser.close();
}

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '../../research/node_modules/playwright/index.mjs';

const root = resolve(import.meta.dirname, '../..');
const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const quoteHtml = readFileSync(resolve(root, 'quote.html'), 'utf8');
const materialsHtml = readFileSync(resolve(root, 'materials.html'), 'utf8');
const optionsHtml = readFileSync(resolve(root, 'options.html'), 'utf8');

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

assert(!quoteHtml.includes('window.confirm('), 'Quote page still uses a native browser confirm prompt');
assert(!quoteHtml.includes('const RATES = {'), 'Quote page should not use a hard-coded currency rate table');
assert(quoteHtml.includes('/api/customer/exchange-rates'), 'Quote page should load display exchange rates from the backend');
assert(quoteHtml.includes('Converted estimate. Checkout charges NZD.'), 'Quote page should explain non-NZD prices are converted estimates');
assert(quoteHtml.includes('<option value="CNY">CNY</option>'), 'Quote page currency selector should include the supported major currencies');
assert(quoteHtml.includes('id="saveQuoteAuthModal"'), 'Quote page is missing the themed save-quote auth modal');
assert(quoteHtml.includes('id="saveQuoteAuthContinue"'), 'Quote page is missing the modal continue button');
assert(quoteHtml.includes('DoubleSide'), 'Quote viewer material should render both sides of uploaded geometry');
assert(quoteHtml.includes('previewModelId'), 'Quote page must persist the active preview model id');
assert(quoteHtml.includes('previewModelById'), 'Quote page must expose clickable model preview switching');
assert(quoteHtml.includes('aria-current'), 'Quote model rows must expose selected state');
assert(quoteHtml.includes('promptUpload'), 'Quote page must support upload prompt routing');
assert(quoteHtml.includes('newGroup=1&promptUpload=1'), 'Add another group must route back to an upload prompt with prompt params');
assert(quoteHtml.includes('quote.html?shop='), 'Add another group must route back to the quote upload prompt');
assert(!quoteHtml.includes('id="colourSelect"'), 'Quote review should not duplicate colour selection controls');
assert(!quoteHtml.includes('id="infillSelect"'), 'Quote review should not duplicate infill selection controls');
assert(!quoteHtml.includes('aria-label="Finish"'), 'Quote review should not duplicate finish selection controls');
assert(materialsHtml.includes('options.html?shop='), 'Material step should continue to the new Options step');
assert(!materialsHtml.includes('data-colour-id'), 'Material step should not render selectable colour buttons');
assert(!materialsHtml.includes('data-finish-id'), 'Material step should not render selectable finish cards');
assert(optionsHtml.includes('Colour'), 'Options step should render colour controls');
assert(optionsHtml.includes('Print quality'), 'Options step should render finish controls');
assert(optionsHtml.includes('Infill'), 'Options step should render infill controls');
assert(
  quoteHtml.includes('New uploads') && quoteHtml.includes('SHOULD_PROMPT_UPLOAD'),
  'Quote page must be the quote-first upload experience',
);

const browser = await chromium.launch({ headless: true });
try {
  const catalogRes = await fetch(`${base}/api/customer/catalog?shop=mahi3d`);
  const catalog = await catalogRes.json();
  const pricingRes = await fetch(`${base}/api/customer/pricing?shop=mahi3d`);
  const pricing = await pricingRes.json();
  const shippingRes = await fetch(`${base}/api/shipping/rates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shopSlug: 'mahi3d' }),
  });
  const shippingData = await shippingRes.json();
  const material = (catalog.materials || []).find(m => m.enabled !== false);
  assert(material?.id, 'Quote UI smoke needs at least one enabled demo material');
  const colour = (material.colours || []).find(c => c.enabled !== false) || {};
  const finish = (material.finishes || []).find(f => f.enabled !== false) || {};
  const infill = (pricing.infill_tiers || []).find(t => t.active !== false) || {};
  const shipping = (shippingData.rates || []).find(r => r.active !== false) || (shippingData.rates || [])[0] || {};
  assert(infill?.id, 'Quote UI smoke needs at least one active infill tier');
  assert(shipping?.id, 'Quote UI smoke needs at least one shipping option');

  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.goto(`${base}/quote.html?shop=mahi3d`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#viewerEmpty', { state: 'visible', timeout: 5000 });
  const freshState = await page.evaluate(() => ({
    activeProgress: document.querySelector('.quote-progress-step.active')?.textContent?.replace(/\s+/g, ' ').trim() || '',
    emptyTitle: document.querySelector('#viewerEmptyTitle')?.textContent?.trim() || '',
    emptyCopy: document.querySelector('#viewerEmptyCopy')?.textContent?.trim() || '',
    materialsDisabled: document.querySelector('[data-quote-nav="materials"]')?.getAttribute('aria-disabled') || '',
    materialsHref: document.querySelector('[data-quote-nav="materials"]')?.getAttribute('href') || '',
  }));
  assert(/^1\s*Upload$/.test(freshState.activeProgress), `Fresh quote should start on Upload progress, got ${freshState.activeProgress}`);
  assert(freshState.emptyTitle === 'Upload your model', `Fresh quote empty title should invite the first upload, got ${freshState.emptyTitle}`);
  assert(!/next model group|same model again/i.test(freshState.emptyCopy), `Fresh quote copy should not describe add-another flow: ${freshState.emptyCopy}`);
  assert(freshState.materialsDisabled === 'true', 'Fresh quote should disable Materials nav until a model is uploaded');
  assert(freshState.materialsHref === '#upload', `Fresh quote Materials nav should target upload prompt, got ${freshState.materialsHref}`);

  await page.evaluate(({ material, colour, finish, infill }) => {
    localStorage.removeItem('cart');
    localStorage.setItem('form_file', JSON.stringify({
      name: 'no-shipping-preview.stl',
      size: 1024,
      volumeCm3: 8,
      dimensions: { xMm: 20, yMm: 20, zMm: 20 },
      models: [{ id: 'no-shipping-model', name: 'no-shipping-preview.stl', size: 1024, volumeCm3: 8, quantity: 1, dimensions: { xMm: 20, yMm: 20, zMm: 20 } }],
    }));
    localStorage.setItem('form_selection', JSON.stringify({
      shopSlug: 'mahi3d',
      materialId: material.id,
      materialName: material.name,
      colorId: colour.id || null,
      colorName: colour.name || '',
      colorHex: colour.hex || null,
      finishId: finish.id || null,
      finish: finish.id || null,
      finishLabel: finish.name || '',
      finishLayerHeight: finish.layerHeight || '',
      infillTierId: infill.id || null,
      infillLabel: infill.label || infill.name || '',
      requiredSelections: { material: true, colour: true, finish: true, infill: true },
      qty: 1,
      currency: 'NZD',
    }));
  }, { material, colour, finish, infill });
  await page.goto(`${base}/quote.html?shop=mahi3d`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const price = document.querySelector('#priceInt')?.textContent?.trim() || '';
    const helper = document.querySelector('#priceHelper')?.textContent || '';
    return price && price !== '—' && /Shipping not included/.test(helper);
  }, null, { timeout: 7000 });
  const noShippingPreview = await page.evaluate(() => ({
    price: `${document.querySelector('#priceSymbol')?.textContent || ''}${document.querySelector('#priceInt')?.textContent || ''}${document.querySelector('#priceDec')?.textContent || ''}`,
    helper: document.querySelector('#priceHelper')?.textContent || '',
    checkoutDisabled: document.querySelector('#checkoutCartBtn')?.getAttribute('aria-disabled') || '',
    cartCount: JSON.parse(localStorage.getItem('cart') || '{}').items?.length || 0,
  }));
  assert(noShippingPreview.price !== '$—', 'Quote review should show a backend price before shipping is selected');
  assert(/Shipping not included/.test(noShippingPreview.helper), `Quote helper should say shipping is not included, got ${noShippingPreview.helper}`);
  assert(noShippingPreview.checkoutDisabled === 'true', 'Checkout should remain disabled before explicit shipping selection');
  assert(noShippingPreview.cartCount === 0, `Preview-only quote should not auto-save a checkout cart item, got ${noShippingPreview.cartCount}`);
  await page.click('#saveQuoteBtn');
  await page.waitForTimeout(250);
  const noShippingBlocked = await page.evaluate(() => ({
    toast: document.querySelector('#toast')?.textContent || '',
    shippingInvalid: document.querySelector('#shippingBlock')?.classList.contains('invalid') || false,
  }));
  assert(/shipping/i.test(noShippingBlocked.toast), `Checkout without shipping should show a shipping validation toast, got ${noShippingBlocked.toast}`);
  assert(noShippingBlocked.shippingInvalid, 'Checkout without shipping should highlight the shipping section');

  const stlBase64 = makeStlBuffer().toString('base64');
  await page.evaluate(async ({ encoded, material, colour, finish, infill, shipping }) => {
    const bin = atob(encoded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const buffer = bytes.buffer;
    localStorage.setItem('form_file', JSON.stringify({
      name: 'viewer-smoke.stl',
      size: buffer.byteLength,
      volumeCm3: 8,
      dimensions: { xMm: 20, yMm: 20, zMm: 20 },
    }));
    localStorage.setItem('form_selection', JSON.stringify({
      shopSlug: 'mahi3d',
      materialId: material.id,
      materialName: material.name,
      colorId: colour.id || null,
      colorName: colour.name || '',
      colorHex: colour.hex || null,
      finishId: finish.id || null,
      finish: finish.id || null,
      finishLabel: finish.name || '',
      finishLayerHeight: finish.layerHeight || '',
      infillTierId: infill.id || null,
      infillLabel: infill.label || infill.name || '',
      shippingOptionId: shipping.id || null,
      shippingOptionLabel: shipping.label || shipping.service || shipping.carrier || '',
      shippingOptionPrice: shipping.price ?? shipping.finalPrice ?? null,
      requiredSelections: { material: true, colour: true, finish: true, infill: true, shipping: true },
      qty: 1,
      currency: 'NZD',
    }));
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('mahi3d-quote', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    await new Promise(resolve => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put({ buffer, ext: 'stl' }, 'current_model');
      tx.oncomplete = resolve;
    });
  }, { encoded: stlBase64, material, colour, finish, infill, shipping });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  const state = await page.evaluate(() => ({
    emptyDisplay: getComputedStyle(document.querySelector('#viewerEmpty')).display,
    fileName: document.querySelector('#fileName')?.textContent,
    dimensions: document.querySelector('#fileDimensions')?.textContent,
    canvasWidth: document.querySelector('#viewerCanvas')?.width || 0,
    canvasHeight: document.querySelector('#viewerCanvas')?.height || 0,
    materialsDisabled: document.querySelector('[data-quote-nav="materials"]')?.getAttribute('aria-disabled') || '',
    materialsHref: document.querySelector('[data-quote-nav="materials"]')?.getAttribute('href') || '',
  }));
  assert(errors.length === 0, `Quote page runtime errors: ${errors.join('; ')}`);
  assert(state.emptyDisplay === 'none', `Viewer empty state should be hidden after loading STL, got ${state.emptyDisplay}`);
  assert(state.fileName === 'viewer-smoke.stl', `Viewer file name did not load, got ${state.fileName}`);
  assert(/20 mm/.test(state.dimensions || ''), `Viewer dimensions did not render, got ${state.dimensions}`);
  assert(state.canvasWidth > 100 && state.canvasHeight > 100, 'Viewer canvas did not size correctly');
  assert(state.materialsDisabled === 'false', 'Quote should enable Materials nav once a model is loaded');
  assert(/materials\.html\?shop=mahi3d$/.test(state.materialsHref), `Loaded quote Materials nav should link to materials, got ${state.materialsHref}`);

  await page.selectOption('#currencySelect', 'USD');
  await page.waitForFunction(() => document.querySelector('#currencyEstimateNote')?.classList.contains('show'), null, { timeout: 5000 });
  const currencyState = await page.evaluate(() => ({
    summaryCurrency: document.querySelector('#currencySelect')?.value,
    navCurrency: document.querySelector('#navCurrency')?.value,
    note: document.querySelector('#currencyEstimateNote')?.textContent || '',
  }));
  assert(currencyState.summaryCurrency === 'USD' && currencyState.navCurrency === 'USD', 'Currency selectors did not stay in sync');
  assert(/Converted estimate/.test(currencyState.note) && /Checkout charges NZD/.test(currencyState.note), `Currency note did not explain display-only conversion: ${currencyState.note}`);

  await page.evaluate(({ material, colour, finish, infill, shipping }) => {
    localStorage.setItem('form_file', JSON.stringify({
      name: '2 models',
      size: 2048,
      volumeCm3: 2,
      dimensions: { xMm: 20, yMm: 20, zMm: 20 },
      models: [
        { id: 'qty-a', name: 'Qty A.stl', size: 1024, volumeCm3: 1, quantity: 1, dimensions: { xMm: 20, yMm: 20, zMm: 20 } },
        { id: 'qty-b', name: 'Qty B.stl', size: 1024, volumeCm3: 1, quantity: 1, dimensions: { xMm: 20, yMm: 20, zMm: 20 } },
      ],
      previewModelId: 'qty-a',
    }));
    localStorage.setItem('form_selection', JSON.stringify({
      shopSlug: 'mahi3d',
      materialId: material.id,
      materialName: material.name,
      colorId: colour.id || null,
      colorName: colour.name || '',
      colorHex: colour.hex || null,
      finishId: finish.id || null,
      finish: finish.id || null,
      finishLabel: finish.name || '',
      finishLayerHeight: finish.layerHeight || '',
      infillTierId: infill.id || null,
      infillLabel: infill.label || infill.name || '',
      shippingOptionId: shipping.id || null,
      shippingOptionLabel: shipping.label || shipping.service || shipping.carrier || '',
      shippingOptionPrice: shipping.price ?? shipping.finalPrice ?? null,
      requiredSelections: { material: true, colour: true, finish: true, infill: true, shipping: true },
      qty: 1,
      currency: 'NZD',
    }));
  }, { material, colour, finish, infill, shipping });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const beforeQtyPrice = await page.locator('#sumSubtotal').innerText();
  await page.locator('[data-model-qty="qty-a"]').fill('4');
  await page.waitForFunction(() => {
    const saved = JSON.parse(localStorage.getItem('form_file') || '{}');
    return saved.models?.[0]?.quantity === 4;
  }, null, { timeout: 3000 });
  await page.waitForFunction((before) => {
    const current = document.querySelector('#sumSubtotal')?.textContent || '';
    return current && current !== before;
  }, beforeQtyPrice, { timeout: 5000 });
  const quantityState = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('form_file') || '{}');
    return {
      storedQty: saved.models?.[0]?.quantity,
      subtotal: document.querySelector('#sumSubtotal')?.textContent || '',
    };
  });
  assert(quantityState.storedQty === 4, `Typed model quantity was not persisted before blur, got ${quantityState.storedQty}`);
  assert(quantityState.subtotal !== beforeQtyPrice, 'Typed model quantity did not update displayed subtotal');

  await page.click('#saveQuoteBtn');
  await page.waitForSelector('#saveQuoteAuthModal:not(.hidden)', { timeout: 5000 });
  const modalText = await page.locator('#saveQuoteAuthModal').innerText();
  assert(/Sign in or create account/.test(modalText), 'Save quote auth modal did not show themed account action');

  await page.evaluate(({ material, colour, finish, infill, shipping }) => {
    localStorage.setItem('cart', JSON.stringify({
      shopSlug: 'mahi3d',
      items: [{
        id: 'existing-cart-group',
        shopSlug: 'mahi3d',
        materialId: material.id,
        materialName: material.name,
        colorId: colour.id || null,
        colorName: colour.name || '',
        finishId: finish.id || null,
        finishLabel: finish.name || '',
        infillTierId: infill.id || null,
        infillLabel: infill.label || infill.name || '',
        shipping: { id: shipping.id || null, label: shipping.label || shipping.service || shipping.carrier || '', price: shipping.price ?? shipping.finalPrice ?? 0 },
        file: {
          name: 'Existing group.stl',
          size: 1024,
          volumeCm3: 2,
          dimensions: { xMm: 20, yMm: 20, zMm: 20 },
          models: [{ id: 'existing-model', name: 'Existing group.stl', size: 1024, volumeCm3: 2, quantity: 1, dimensions: { xMm: 20, yMm: 20, zMm: 20 } }],
        },
        models: [{ id: 'existing-model', name: 'Existing group.stl', size: 1024, volumeCm3: 2, quantity: 1, dimensions: { xMm: 20, yMm: 20, zMm: 20 } }],
        quoteSnapshot: { selected: { material, colour, finish, infill, shipping, quantity: 1, models: [] }, lineItems: { itemSubtotal: 9, shipping: shipping.price ?? 0, total: 9 }, totalCents: 900 },
        totalNzd: 9,
        totalCents: 900,
      }],
    }));
    localStorage.setItem('form_file', JSON.stringify({
      name: 'Current group.stl',
      size: 1024,
      volumeCm3: 2,
      dimensions: { xMm: 20, yMm: 20, zMm: 20 },
      models: [{ id: 'current-model', name: 'Current group.stl', size: 1024, volumeCm3: 2, quantity: 1, dimensions: { xMm: 20, yMm: 20, zMm: 20 } }],
    }));
    localStorage.setItem('form_selection', JSON.stringify({
      shopSlug: 'mahi3d',
      materialId: material.id,
      materialName: material.name,
      colorId: colour.id || null,
      colorName: colour.name || '',
      finishId: finish.id || null,
      finish: finish.id || null,
      finishLabel: finish.name || '',
      infillTierId: infill.id || null,
      infillLabel: infill.label || infill.name || '',
      shippingOptionId: shipping.id || null,
      shippingOptionLabel: shipping.label || shipping.service || shipping.carrier || '',
      shippingOptionPrice: shipping.price ?? shipping.finalPrice ?? null,
      requiredSelections: { material: true, colour: true, finish: true, infill: true, shipping: true },
    }));
  }, { material, colour, finish, infill, shipping });
  await page.goto(`${base}/quote.html?shop=mahi3d`, { waitUntil: 'networkidle' });
  await page.click('#addAnotherBtn');
  await page.waitForURL(/quote\.html\?shop=mahi3d/, { timeout: 7000 });
  await page.waitForSelector('#newUploadBanner.show', { timeout: 5000 });
  await page.waitForTimeout(250);
  const newGroupState = await page.evaluate(() => ({
    cartCount: JSON.parse(localStorage.getItem('cart') || '{}').items?.length || 0,
    formFile: localStorage.getItem('form_file'),
    formSelection: localStorage.getItem('form_selection'),
    uploadDisplay: getComputedStyle(document.querySelector('#viewerEmpty')).display,
    emptyTitle: document.querySelector('#viewerEmptyTitle')?.textContent || '',
    emptyCopy: document.querySelector('#viewerEmptyCopy')?.textContent || '',
    activeElementId: document.activeElement?.id || '',
    bannerText: document.querySelector('#newUploadBanner')?.innerText || '',
    url: location.href,
  }));
  assert(newGroupState.cartCount === 2, `Add-another flow should preserve the existing cart and auto-saved current group, got ${newGroupState.cartCount} items`);
  assert(newGroupState.formFile === null, 'Add-another flow should clear active form_file');
  assert(newGroupState.formSelection === null, 'Add-another flow should clear active form_selection');
  assert(newGroupState.uploadDisplay !== 'none', `Quote upload prompt should be visible, got ${newGroupState.uploadDisplay}`);
  assert(newGroupState.emptyTitle === 'Upload the next model group', `Add-another flow should keep next-group title, got ${newGroupState.emptyTitle}`);
  assert(/same model again/i.test(newGroupState.emptyCopy), 'Add-another flow should keep next-group helper copy');
  assert(/New uploads/.test(newGroupState.bannerText), 'New uploads banner did not render');

  await page.setInputFiles('#fileInput', {
    name: 'Next material group.stl',
    mimeType: 'model/stl',
    buffer: makeStlBuffer(),
  });
  await page.waitForURL(/materials\.html\?shop=mahi3d&newGroup=1/, { timeout: 7000 });
  await page.waitForFunction(() => /Next material group\.stl/.test(document.querySelector('#modelGroupPanel')?.innerText || ''), null, { timeout: 7000 });
  const materialArrival = await page.evaluate(() => ({
    cartCount: JSON.parse(localStorage.getItem('cart') || '{}').items?.length || 0,
    file: JSON.parse(localStorage.getItem('form_file') || 'null'),
    panelText: document.querySelector('#modelGroupPanel')?.innerText || '',
  }));
  assert(materialArrival.cartCount === 2, `New upload handoff should preserve existing material groups, got ${materialArrival.cartCount} items`);
  assert(materialArrival.file?.models?.[0]?.name === 'Next material group.stl', 'New upload handoff did not save the new model group');
  assert(/New material group/.test(materialArrival.panelText), 'Materials page did not show the new-group arrival notice');
  assert(/Next material group\.stl/.test(materialArrival.panelText), 'Materials page did not show the new uploaded model');
} finally {
  await browser.close();
}

console.log('Quote UI smoke checks passed.');

import { DatabaseSync } from 'node:sqlite';
import { chromium } from '../../research/node_modules/playwright/index.mjs';
import { calculateQuoteForShopSlug, PricingError } from '../lib/pricing-engine.js';
import { parseInfillTiers } from '../lib/infill-tiers.js';
import { validateCartForShop } from '../lib/cart.js';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const db = new DatabaseSync('data/rfdewi.db');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(value, fallback = null) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function firstEnabled(list = []) {
  return list.find(item => item?.enabled !== false && item?.active !== false) || null;
}

function expectPricingError(code, fn) {
  try {
    fn();
  } catch (err) {
    assert(err instanceof PricingError, `${code} should throw PricingError`);
    assert(err.code === code, `expected ${code}, got ${err.code}`);
    return;
  }
  throw new Error(`${code} was not enforced`);
}

try {
  const shop = db.prepare("SELECT * FROM shops WHERE slug = 'mahi3d'").get();
  assert(shop, 'Mahi3D shop is missing; run npm run demo:seed:mahi3d first');

  const material = db.prepare(`
    SELECT *
    FROM materials
    WHERE shop_id = ? AND active = 1 AND name = 'PETG'
  `).get(shop.id);
  assert(material, 'PETG material is missing');

  const colour = firstEnabled(parseJson(material.colours, []));
  const finish = firstEnabled(parseJson(material.finishes, []));
  const pricing = db.prepare('SELECT infill_tiers FROM pricing_config WHERE shop_id = ?').get(shop.id) || {};
  const infill = firstEnabled(parseInfillTiers(pricing.infill_tiers));
  const settings = db.prepare('SELECT shipping_zones FROM store_settings WHERE shop_id = ?').get(shop.id) || {};
  const shipping = firstEnabled(parseJson(settings.shipping_zones, []));

  assert(colour?.id, 'PETG needs at least one enabled colour for explicit-selection smoke');
  assert(finish?.id, 'PETG needs at least one enabled finish for explicit-selection smoke');
  assert(infill?.id, 'Mahi3D needs at least one active infill tier for explicit-selection smoke');
  assert(shipping?.id, 'Mahi3D needs at least one active shipping option for explicit-selection smoke');

  const baseQuote = {
    materialId: material.id,
    volumeCm3: 10,
    dimensions: { xMm: 20, yMm: 20, zMm: 20 },
    colourId: colour.id,
    finishId: finish.id,
    infillTierId: infill.id,
    quantity: 1,
    shippingId: shipping.id,
  };

  const valid = calculateQuoteForShopSlug(db, shop.slug, baseQuote);
  assert(valid?.lineItems?.total > 0, 'fully-selected quote should calculate a total');

  expectPricingError('COLOUR_REQUIRED', () => calculateQuoteForShopSlug(db, shop.slug, { ...baseQuote, colourId: undefined }));
  expectPricingError('FINISH_REQUIRED', () => calculateQuoteForShopSlug(db, shop.slug, { ...baseQuote, finishId: undefined }));
  expectPricingError('INFILL_REQUIRED', () => calculateQuoteForShopSlug(db, shop.slug, { ...baseQuote, infillTierId: undefined }));
  expectPricingError('SHIPPING_REQUIRED', () => calculateQuoteForShopSlug(db, shop.slug, { ...baseQuote, shippingId: undefined }));

  const previewWithoutShipping = calculateQuoteForShopSlug(db, shop.slug, {
    ...baseQuote,
    shippingId: undefined,
    previewWithoutShipping: true,
  });
  assert(previewWithoutShipping?.ok, 'preview quote without shipping should calculate');
  assert(previewWithoutShipping.selected?.shipping === null, 'preview quote without shipping should not select shipping');
  assert(previewWithoutShipping.lineItems?.shipping === 0, 'preview quote without shipping should price shipping at zero');
  assert(previewWithoutShipping.lineItems?.total > 0, 'preview quote without shipping should still return a visible total');
  expectPricingError('SHIPPING_REQUIRED', () => validateCartForShop(db, shop, {
    shopSlug: shop.slug,
    items: [{
      shopSlug: shop.slug,
      materialId: material.id,
      materialName: material.name,
      colorId: colour.id,
      colorName: colour.name,
      finishId: finish.id,
      finishLabel: finish.name,
      infillTierId: infill.id,
      file: {
        name: 'missing-shipping-cart.stl',
        size: 2048,
        volumeCm3: 10,
        dimensions: { xMm: 20, yMm: 20, zMm: 20 },
        models: [{ id: 'cart-model', name: 'missing-shipping-cart.stl', size: 2048, volumeCm3: 10, quantity: 1, dimensions: { xMm: 20, yMm: 20, zMm: 20 } }],
      },
      models: [{ id: 'cart-model', name: 'missing-shipping-cart.stl', size: 2048, volumeCm3: 10, quantity: 1, dimensions: { xMm: 20, yMm: 20, zMm: 20 } }],
    }],
  }));

  const missingShippingRes = await fetch(`${base}/api/customer/quote-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...baseQuote, shopSlug: shop.slug, shippingId: undefined }),
  });
  const missingShippingData = await missingShippingRes.json();
  assert(missingShippingRes.status === 400, `missing shipping quote-preview should return 400, got ${missingShippingRes.status}`);
  assert(missingShippingData.code === 'SHIPPING_REQUIRED', `missing shipping quote-preview should return SHIPPING_REQUIRED, got ${missingShippingData.code}`);

  const previewRes = await fetch(`${base}/api/customer/quote-preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...baseQuote, shopSlug: shop.slug, shippingId: undefined, previewWithoutShipping: true }),
  });
  const previewData = await previewRes.json();
  assert(previewRes.ok, `preview quote-preview without shipping should return 200, got ${previewRes.status}/${previewData.code || 'no-code'}`);
  assert(previewData.selected?.shipping === null, 'preview quote-preview without shipping should return no selected shipping');
  assert(previewData.lineItems?.shipping === 0, 'preview quote-preview without shipping should return zero shipping');

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(`${base}/quote.html?shop=${shop.slug}`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(({ materialId, materialName }) => {
      localStorage.setItem('form_file', JSON.stringify({
        name: 'explicit-selection.stl',
        size: 2048,
        volumeCm3: 10,
        dimensions: { xMm: 20, yMm: 20, zMm: 20 },
        models: [{ id: 'explicit-model', name: 'explicit-selection.stl', size: 2048, volumeCm3: 10, quantity: 1, dimensions: { xMm: 20, yMm: 20, zMm: 20 } }],
      }));
      localStorage.setItem('form_selection', JSON.stringify({
        shopSlug: 'mahi3d',
        materialId,
        materialName,
        material: materialName,
      }));
    }, { materialId: material.id, materialName: material.name });

    await page.goto(`${base}/options.html?shop=${shop.slug}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#optionsGrid', { timeout: 5000 });
    await page.waitForTimeout(300);
    const initial = await page.evaluate(() => ({
      selectedSwatches: document.querySelectorAll('.swatch.selected').length,
      selectedChoices: document.querySelectorAll('.choice.selected').length,
      disabled: document.querySelector('#continueBtn')?.getAttribute('aria-disabled'),
      colourPill: document.querySelector('[data-option-card="colour"] .selected-pill')?.textContent?.trim(),
      finishPill: document.querySelector('[data-option-card="finish"] .selected-pill')?.textContent?.trim(),
      infillPill: document.querySelector('[data-option-card="infill"] .selected-pill')?.textContent?.trim(),
    }));
    assert(errors.length === 0, `Options page runtime errors: ${errors.join('; ')}`);
    assert(initial.selectedSwatches === 0, `colour should not be selected by default, got ${initial.selectedSwatches}`);
    assert(initial.selectedChoices === 0, `finish/infill should not be selected by default, got ${initial.selectedChoices}`);
    assert(initial.disabled === 'true', 'Continue should be disabled until every option is selected');
    assert(initial.colourPill === 'Required', `colour pill should say Required, got ${initial.colourPill}`);
    assert(initial.finishPill === 'Required', `finish pill should say Required, got ${initial.finishPill}`);
    assert(initial.infillPill === 'Required', `infill pill should say Required, got ${initial.infillPill}`);

    await page.click('#continueBtn', { force: true });
    await page.waitForTimeout(250);
    const blocked = await page.evaluate(() => ({
      path: location.pathname,
      toast: document.querySelector('#validationToast')?.textContent || '',
      invalidCards: document.querySelectorAll('.option-card.invalid').length,
    }));
    assert(blocked.path.endsWith('/options.html'), `missing options should stay on options page, got ${blocked.path}`);
    assert(/Choose a colour, print quality, and infill/.test(blocked.toast), `missing-option toast did not render: ${blocked.toast}`);
    assert(blocked.invalidCards === 3, `all three option cards should be highlighted, got ${blocked.invalidCards}`);
  } finally {
    await browser.close();
  }

  console.log('Explicit selection smoke checks passed.');
} finally {
  db.close();
}

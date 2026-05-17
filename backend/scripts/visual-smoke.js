import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '../../research/node_modules/playwright/index.mjs';

const base = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const outDir = resolve('data/visual-smoke');
mkdirSync(outDir, { recursive: true });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(path, options = {}) {
  const res = await fetch(`${base}${path}`, options);
  assert(res.ok, `${path} returned ${res.status}`);
  return res.json();
}

function parseModels() {
  return {
    name: '2 models',
    size: 69100,
    volumeCm3: 10,
    dimensions: { xMm: 106.8, yMm: 16.7, zMm: 112.8 },
    models: [
      { id: 'visual-body-76', name: 'Body76.stl', size: 48300, volumeCm3: 0.05, quantity: 1, dimensions: { xMm: 17.5, yMm: 2, zMm: 10 } },
      { id: 'visual-body-77', name: 'Body77.stl', size: 20800, volumeCm3: 8.99, quantity: 1, dimensions: { xMm: 106.8, yMm: 16.7, zMm: 112.8 } },
    ],
  };
}

const catalog = await json('/api/customer/catalog?shop=mahi3d');
const pricing = await json('/api/customer/pricing?shop=mahi3d');
const material = (catalog.materials || []).find(m => Array.isArray(m.colours) && m.colours.length && Array.isArray(m.finishes) && m.finishes.length)
  || (catalog.materials || [])[0];
assert(material, 'No material available for visual smoke');
const colour = material.colours.find(c => c.enabled !== false) || material.colours[0];
const finish = material.finishes.find(f => f.enabled !== false) || material.finishes[0];
const infill = (pricing.infill_tiers || []).find(i => i.enabled !== false) || (pricing.infill_tiers || [])[0];
const shippingRates = await json('/api/shipping/rates', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ shopSlug: 'mahi3d', subtotal: 10 }),
});
const shipping = (shippingRates.rates || [])[0];
assert(colour?.id && finish?.id && infill?.id && shipping?.id, 'Visual smoke needs colour, finish, infill and shipping data');

const formFile = parseModels();
const formSelection = {
  shopSlug: 'mahi3d',
  materialId: material.id,
  materialName: material.name,
  material: material.name,
  colourId: colour.id,
  colorId: colour.id,
  colourName: colour.name,
  colorName: colour.name,
  colourHex: colour.hex,
  colorHex: colour.hex,
  finishId: finish.id,
  finishName: finish.name,
  finish: finish.name,
  finishLayerHeight: finish.layerHeight || finish.layer_height || '',
  infillTierId: infill.id,
  infillName: infill.name,
  infillPercent: infill.percent,
  shippingId: shipping.id,
  shippingName: shipping.label,
  requiredSelections: { material: true, colour: true, finish: true, infill: true, shipping: true },
};
const cart = {
  shopSlug: 'mahi3d',
  items: [{
    id: 'visual-cart-group',
    shopSlug: 'mahi3d',
    models: formFile.models,
    file: formFile,
    materialId: material.id,
    materialName: material.name,
    material: material.name,
    colourId: colour.id,
    colorId: colour.id,
    colourName: colour.name,
    colorName: colour.name,
    colourHex: colour.hex,
    colorHex: colour.hex,
    finishId: finish.id,
    finishName: finish.name,
    finish: finish.name,
    finishLayerHeight: finish.layerHeight || finish.layer_height || '',
    infillTierId: infill.id,
    infillName: infill.name,
    shippingId: shipping.id,
    shippingName: shipping.label,
  }],
};

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.addInitScript(({ formFile, formSelection, cart }) => {
    localStorage.setItem('form_file', JSON.stringify(formFile));
    localStorage.setItem('form_selection', JSON.stringify(formSelection));
    localStorage.setItem('cart', JSON.stringify(cart));
  }, { formFile, formSelection, cart });

  const pages = [
    ['quote-first', '/quote.html?shop=mahi3d'],
    ['materials', '/materials.html?shop=mahi3d'],
    ['options', '/options.html?shop=mahi3d'],
    ['quote', '/quote.html?shop=mahi3d'],
    ['checkout', '/checkout.html?shop=mahi3d'],
    ['customer-login', '/customer/login.html?shop=mahi3d'],
    ['admin-login', '/admin/login.html'],
    ['platform-login', '/platform/login.html'],
  ];

  for (const [name, path] of pages) {
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: resolve(outDir, `${name}.png`), fullPage: true });
    assert((await page.locator('body').innerText()).trim().length > 10, `${name} rendered an empty page`);
  }

  assert(errors.length === 0, `Visual smoke page errors: ${errors.join('; ')}`);
  console.log(`Visual smoke screenshots written to ${outDir}`);
} finally {
  await browser.close();
}

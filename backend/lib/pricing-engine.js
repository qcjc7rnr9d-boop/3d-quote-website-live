import { parseInfillTiers } from './infill-tiers.js';
import { parseMaterialRow, safeJson } from './material-config.js';

export class PricingError extends Error {
  constructor(message, status = 400, code = 'PRICING_ERROR', quote = null) {
    super(message);
    this.name = 'PricingError';
    this.status = status;
    this.code = code;
    this.quote = quote;
  }
}

const DEFAULT_CURRENCY = 'NZD';
export const MAX_MODELS_PER_QUOTE = 20;
export const MAX_MODEL_QUANTITY_SAFETY = 9999;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(value, min, max, fallback = min) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function toCents(value) {
  return Math.round((toNumber(value, 0) + Number.EPSILON) * 100);
}

export function fromCents(cents) {
  return Math.round(toNumber(cents, 0)) / 100;
}

function money(value) {
  return fromCents(toCents(value));
}

function normaliseTaxRate(value) {
  const n = toNumber(value, 0);
  if (n <= 0) return 0;
  return n > 1 ? n / 100 : n;
}

function ceilToStep(value, step) {
  const n = toNumber(value, 0);
  const s = toNumber(step, 0);
  if (s <= 0) return n;
  return Math.ceil((n - 0.0000001) / s) * s;
}

function publicMaterial(material) {
  return {
    id: material.id,
    name: material.name,
    priceUnit: material.price_unit || material.priceUnit || 'per cm³',
    limits: {
      maxX: material.max_x_mm ?? null,
      maxY: material.max_y_mm ?? null,
      maxZ: material.max_z_mm ?? null,
    },
  };
}

function publicColour(colour) {
  if (!colour) return null;
  return {
    id: colour.id,
    name: colour.name,
    hex: colour.hex || null,
  };
}

function publicFinish(finish) {
  if (!finish) return null;
  return {
    id: finish.id,
    name: finish.name,
    layerHeight: finish.layerHeight || '',
    description: finish.description || '',
    priceMultiplier: toNumber(finish.priceMultiplier, 1),
  };
}

function publicInfill(infill) {
  if (!infill) return null;
  return {
    id: infill.id,
    label: infill.label,
    percent: infill.percent ?? null,
    multiplier: toNumber(infill.multiplier, 1),
  };
}

function publicShipping(shipping) {
  if (!shipping) return null;
  return {
    id: shipping.id,
    label: shipping.label,
    price: shipping.originalPrice,
    finalPrice: shipping.price,
    freeApplied: !!shipping.freeApplied,
  };
}

function roundOne(value) {
  const n = toNumber(value, NaN);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}

function publicModel(model) {
  if (!model) return null;
  return {
    id: model.id || null,
    name: model.name,
    size: model.size ?? null,
    ext: model.ext || '',
    volumeCm3: money(model.volumeCm3),
    quantity: clampInt(model.quantity, 1, MAX_MODEL_QUANTITY_SAFETY, 1),
    dimensions: model.dimensions || null,
  };
}

export function normaliseShippingZones(rawZones = []) {
  return (Array.isArray(rawZones) ? rawZones : [])
    .filter(o => o && o.active !== false)
    .map((o, index) => {
      const id = String(o.id || `${o.courier || o.name || 'shipping'}-${o.service || index}`);
      const carrier = String(o.courier || o.name || 'Courier').trim();
      const service = String(o.service || 'Standard').trim();
      const label = (carrier && service && carrier !== service)
        ? `${carrier} · ${service}`
        : (carrier || service || 'Shipping');
      const minDays = toNumber(o.days_min ?? o.est_days_min, null);
      const maxDays = toNumber(o.days_max ?? o.est_days_max, minDays);
      return {
        id,
        label,
        carrier,
        service,
        price: Math.max(0, money(o.price ?? o.rate ?? 0)),
        originalPrice: Math.max(0, money(o.price ?? o.rate ?? 0)),
        est_days_min: minDays,
        est_days_max: maxDays,
        recommended: !!o.recommended,
      };
    })
    .sort((a, b) => {
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      if (a.price !== b.price) return a.price - b.price;
      return toNumber(a.est_days_max, 999) - toNumber(b.est_days_max, 999);
    });
}

function selectVolumeRate(material, volumeCm3) {
  const baseRate = Math.max(0, toNumber(material.base_price, 0));
  const tiers = (Array.isArray(material.volume_tiers) ? material.volume_tiers : [])
    .map(t => ({
      from: toNumber(t.from_cm3 ?? t.from, NaN),
      price: toNumber(t.price_per_cm3 ?? t.price, NaN),
    }))
    .filter(t => Number.isFinite(t.from) && t.from >= 0 && Number.isFinite(t.price) && t.price >= 0)
    .sort((a, b) => a.from - b.from);

  let chosen = { from: 0, price: baseRate };
  for (const tier of tiers) {
    if (volumeCm3 >= tier.from) chosen = tier;
  }
  return chosen.price;
}

function getShopBySlug(db, slug) {
  if (!slug) throw new PricingError('shopSlug is required.', 400, 'SHOP_REQUIRED');
  const shop = db.prepare("SELECT * FROM shops WHERE slug = ? AND plan != 'suspended'").get(slug);
  if (!shop) throw new PricingError('Shop not found.', 404, 'SHOP_NOT_FOUND');
  return shop;
}

function normaliseLookupText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function resolveMaterial(db, shop, input = {}) {
  if (input.materialId != null && input.materialId !== '') {
    const byId = parseMaterialRow(db.prepare(`
      SELECT *
      FROM materials
      WHERE id = ? AND shop_id = ? AND active = 1
    `).get(input.materialId, shop.id), { stableIds: true, publicOnly: true });
    if (byId) return byId;
  }

  const materialName = normaliseLookupText(
    input.materialName
    ?? input.material_name
    ?? (typeof input.material === 'string' ? input.material : input.material?.name)
    ?? input.quoteSnapshot?.selected?.material?.name
  );
  if (!materialName) return null;

  const rows = db.prepare(`
    SELECT *
    FROM materials
    WHERE shop_id = ? AND active = 1
  `).all(shop.id);
  const matches = rows.filter(row => normaliseLookupText(row.name) === materialName);
  if (matches.length !== 1) return null;
  return parseMaterialRow(matches[0], { stableIds: true, publicOnly: true });
}

function loadPricingInputs(db, shop, input = {}) {
  const hasMaterialRef = (input.materialId != null && input.materialId !== '')
    || normaliseLookupText(input.materialName ?? input.material_name ?? (typeof input.material === 'string' ? input.material : input.material?.name));
  if (!hasMaterialRef) {
    throw new PricingError('Selected material is required.', 400, 'MATERIAL_REQUIRED');
  }
  const material = resolveMaterial(db, shop, input);
  if (!material) {
    throw new PricingError('Selected material is not available.', 400, 'MATERIAL_UNAVAILABLE');
  }

  const cfg = db.prepare('SELECT * FROM pricing_config WHERE shop_id = ?').get(shop.id) || {};
  const settings = db.prepare('SELECT shipping_zones FROM store_settings WHERE shop_id = ?').get(shop.id) || {};
  return { material, cfg, shippingZones: normaliseShippingZones(safeJson(settings.shipping_zones, [])) };
}

export function buildQuoteRequestFromCart(cart = {}) {
  return {
    shopSlug: cart.shopSlug,
    materialId: cart.materialId,
    materialName: cart.materialName ?? cart.material_name ?? (typeof cart.material === 'string' ? cart.material : cart.material?.name) ?? cart.quoteSnapshot?.selected?.material?.name,
    models: cart.file?.models ?? cart.models ?? cart.quoteSnapshot?.selected?.models ?? null,
    volumeCm3: cart.file?.volumeCm3 ?? cart.volumeCm3 ?? cart.quoteSnapshot?.selected?.volumeCm3,
    colourId: cart.colorId ?? cart.colourId,
    colour: cart.colorName ?? cart.colour,
    finishId: cart.finishId ?? cart.finish,
    finish: cart.finish,
    infillTierId: cart.infillTierId,
    quantity: cart.quantity,
    shippingId: cart.shipping?.id ?? cart.shippingId,
    dimensions: cart.file?.dimensions ?? cart.dimensions ?? cart.quoteSnapshot?.selected?.dimensions,
  };
}

function normaliseDimensions(input = {}) {
  const source = input.dimensions || input.file?.dimensions || {};
  const xMm = toNumber(source.xMm ?? source.x_mm ?? source.x, NaN);
  const yMm = toNumber(source.yMm ?? source.y_mm ?? source.y, NaN);
  const zMm = toNumber(source.zMm ?? source.z_mm ?? source.z ?? source.heightMm ?? source.height, NaN);
  if (![xMm, yMm, zMm].every(n => Number.isFinite(n) && n >= 0)) return null;
  return { xMm, yMm, zMm };
}

function modelQuantity(model = {}, index = 0, maxQuantity = MAX_MODEL_QUANTITY_SAFETY) {
  const raw = model.quantity ?? 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new PricingError(`Quantity must be a whole number of 1 or more for ${model?.name || `model ${index + 1}`}.`, 400, 'INVALID_MODEL_QUANTITY');
  }
  const limit = Math.max(1, Math.min(MAX_MODEL_QUANTITY_SAFETY, clampInt(maxQuantity, 1, MAX_MODEL_QUANTITY_SAFETY, MAX_MODEL_QUANTITY_SAFETY)));
  if (n > limit) {
    throw new PricingError(`Quantity for ${model?.name || `model ${index + 1}`} cannot be more than ${limit}.`, 400, 'MODEL_QUANTITY_TOO_HIGH');
  }
  return n;
}

function normaliseModels(input = {}, options = {}) {
  const rawModels = Array.isArray(input.models) && input.models.length
    ? input.models
    : null;
  const sourceModels = rawModels || [{
    id: input.file?.id || null,
    name: input.file?.name || input.fileName || 'Uploaded model',
    size: input.file?.size ?? input.fileSize ?? null,
    ext: input.file?.ext || input.file?.type || '',
    volumeCm3: input.volumeCm3 ?? input.file?.volumeCm3,
    dimensions: input.dimensions || input.file?.dimensions || null,
  }];

  if (sourceModels.length > MAX_MODELS_PER_QUOTE) {
    throw new PricingError(
      `Upload up to ${MAX_MODELS_PER_QUOTE} models at one time.`,
      400,
      'TOO_MANY_MODELS'
    );
  }

  return sourceModels.map((model, index) => {
    const volumeCm3 = toNumber(model?.volumeCm3, NaN);
    if (!Number.isFinite(volumeCm3) || volumeCm3 <= 0) {
      throw new PricingError(`Model volume is missing or invalid for ${model?.name || `model ${index + 1}`}.`, 400, 'INVALID_VOLUME');
    }
    const dimensions = normaliseDimensions({ dimensions: model?.dimensions });
    const name = String(model?.name || `Model ${index + 1}`).slice(0, 240);
    const ext = String(model?.ext || name.split('.').pop() || '').toLowerCase().slice(0, 12);
    return {
      id: model?.id || `model-${index + 1}`,
      name,
      size: Number.isFinite(Number(model?.size)) ? Number(model.size) : null,
      ext,
      volumeCm3,
      quantity: rawModels ? modelQuantity(model, index, options.maxModelQuantity) : 1,
      dimensions,
    };
  });
}

function aggregateDimensions(models = []) {
  const dims = models.map(m => m.dimensions).filter(Boolean);
  if (!dims.length) return null;
  return {
    xMm: Math.max(...dims.map(d => toNumber(d.xMm, 0))),
    yMm: Math.max(...dims.map(d => toNumber(d.yMm, 0))),
    zMm: Math.max(...dims.map(d => toNumber(d.zMm, 0))),
  };
}

function checkMaterialSize(material, input = {}, models = null) {
  const checks = [
    { key: 'xMm', label: 'width/X', limit: toNumber(material.max_x_mm, 0) },
    { key: 'yMm', label: 'depth/Y', limit: toNumber(material.max_y_mm, 0) },
    { key: 'zMm', label: 'height/Z', limit: toNumber(material.max_z_mm, 0) },
  ];
  const hasConfiguredLimit = checks.some(c => c.limit > 0);
  const bundle = models || normaliseModels(input);
  const missingModel = bundle.find(model => !model.dimensions);
  const dimensions = aggregateDimensions(bundle);
  if (!dimensions) {
    if (hasConfiguredLimit) {
      throw new PricingError(
        'Model dimensions are required before this material can be quoted.',
        400,
        'MODEL_DIMENSIONS_REQUIRED'
      );
    }
    return null;
  }
  if (missingModel && hasConfiguredLimit) {
    throw new PricingError(
      `Model dimensions are required before ${missingModel.name} can be quoted with this material.`,
      400,
      'MODEL_DIMENSIONS_REQUIRED'
    );
  }
  for (const model of bundle) {
    if (!model.dimensions) continue;
    const failed = checks.find(c => c.limit > 0 && model.dimensions[c.key] > c.limit);
    if (!failed) continue;
    const actual = Math.round(model.dimensions[failed.key] * 10) / 10;
    const limit = Math.round(failed.limit * 10) / 10;
    throw new PricingError(
      `${model.name} ${failed.label} is ${actual} mm, but this material allows up to ${limit} mm.`,
      400,
      'MODEL_TOO_LARGE'
    );
  }
  return dimensions;
}

export function calculateQuote({ shop, material, cfg = {}, shippingZones = [], input = {} }) {
  const warnings = [];
  const currency = String(cfg.currency || DEFAULT_CURRENCY).toUpperCase();
  if (currency !== DEFAULT_CURRENCY) {
    warnings.push('Live checkout currently charges in NZD; other currencies are display-only.');
  }

  const maxModelQuantity = toNumber(cfg.max_model_quantity, 0) > 0
    ? toNumber(cfg.max_model_quantity, MAX_MODEL_QUANTITY_SAFETY)
    : MAX_MODEL_QUANTITY_SAFETY;
  const models = normaliseModels(input, { maxModelQuantity });
  const bundleMode = models.length > 1;
  const quantity = bundleMode ? 1 : clampInt(input.quantity, 1, 999, 1);
  if (!bundleMode && models[0]) models[0].quantity = quantity;
  const volumeCm3 = money(models.reduce((sum, model) => sum + (model.volumeCm3 * (bundleMode ? model.quantity : 1)), 0));
  const dimensions = checkMaterialSize(material, input, models);

  const colours = Array.isArray(material.colours) ? material.colours : [];
  let colour = null;
  if (input.colourId) {
    colour = colours.find(c => String(c.id) === String(input.colourId));
    if (!colour) throw new PricingError('Selected colour is not available.', 400, 'COLOUR_UNAVAILABLE');
  } else if (input.colour) {
    colour = colours.find(c => c.name === input.colour) || null;
    if (!colour && colours.length) throw new PricingError('Selected colour is not available.', 400, 'COLOUR_UNAVAILABLE');
  } else {
    if (!colours.length) {
      throw new PricingError('No colours are configured for this material.', 400, 'COLOUR_UNAVAILABLE');
    }
    throw new PricingError('Choose a colour before continuing.', 400, 'COLOUR_REQUIRED');
  }
  if (colours.length && !colour) {
    throw new PricingError('Selected colour is not available.', 400, 'COLOUR_UNAVAILABLE');
  }

  const finishes = Array.isArray(material.finishes) ? material.finishes : [];
  let finish = null;
  if (input.finishId || input.finish) {
    finish = finishes.find(f => String(f.id) === String(input.finishId || input.finish))
      || finishes.find(f => f.name === input.finish)
      || null;
    if (!finish && finishes.length) throw new PricingError('Selected finish is not available.', 400, 'FINISH_UNAVAILABLE');
  } else {
    if (!finishes.length) {
      throw new PricingError('No print-quality options are configured for this material.', 400, 'FINISH_UNAVAILABLE');
    }
    throw new PricingError('Choose a print quality before continuing.', 400, 'FINISH_REQUIRED');
  }
  if (finishes.length && !finish) {
    throw new PricingError('Selected finish is not available.', 400, 'FINISH_UNAVAILABLE');
  }

  const activeInfill = parseInfillTiers(cfg.infill_tiers).filter(t => t.active !== false);
  let infill = null;
  if (input.infillTierId) {
    infill = activeInfill.find(t => String(t.id) === String(input.infillTierId)) || null;
    if (!infill) throw new PricingError('Selected infill option is not available.', 400, 'INFILL_UNAVAILABLE');
  } else {
    if (!activeInfill.length) {
      throw new PricingError('No infill options are configured for this store.', 400, 'INFILL_UNAVAILABLE');
    }
    throw new PricingError('Choose an infill option before continuing.', 400, 'INFILL_REQUIRED');
  }

  const pricingModel = String(material.pricing_model || 'per_cm3');
  if (pricingModel !== 'per_cm3') {
    warnings.push('This material is using Pricing V1 per-volume checkout; other pricing modes are not live yet.');
  }

  const ratePerCm3 = selectVolumeRate(material, volumeCm3);
  const finishMultiplier = Math.max(0, toNumber(finish?.priceMultiplier, 1));
  const infillMultiplier = Math.max(0, toNumber(infill?.multiplier, 1));
  const minCharge = Math.max(0, toNumber(material.min_charge, 0));
  const rawUnit = volumeCm3 * ratePerCm3 * finishMultiplier * infillMultiplier;
  const unit = money(Math.max(rawUnit, minCharge));
  const modelLineItems = models.map((model, index) => {
    const modelRate = selectVolumeRate(material, model.volumeCm3);
    const modelUnit = bundleMode
      ? money(Math.max(model.volumeCm3 * modelRate * finishMultiplier * infillMultiplier, minCharge))
      : unit;
    const modelQuantity = bundleMode ? model.quantity : quantity;
    return {
      id: model.id || null,
      name: model.name || `Model ${index + 1}`,
      quantity: modelQuantity,
      volumeCm3: money(model.volumeCm3),
      ratePerCm3: money(modelRate),
      unit: fromCents(toCents(modelUnit)),
      subtotal: money(modelUnit * modelQuantity),
    };
  });
  const bundleSubtotal = modelLineItems.reduce((sum, item) => sum + item.subtotal, 0);
  const itemSubtotalBeforeMinimum = money(bundleSubtotal);

  const minOrderValue = Math.max(0, toNumber(cfg.min_order_value, 0));
  const minOrderAdjustment = money(Math.max(0, minOrderValue - itemSubtotalBeforeMinimum));
  const itemSubtotal = money(itemSubtotalBeforeMinimum + minOrderAdjustment);

  let shipping = null;
  let shippingAmount = 0;
  if (input.shippingId) {
    shipping = shippingZones.find(z => String(z.id) === String(input.shippingId));
    if (!shipping) {
      throw new PricingError('Selected shipping option is not available.', 400, 'SHIPPING_UNAVAILABLE');
    }
    shipping = { ...shipping };
    const freeAbove = Math.max(0, toNumber(cfg.free_shipping_above, 0));
    if (freeAbove > 0 && itemSubtotal >= freeAbove) {
      shipping.freeApplied = true;
      shipping.price = 0;
    }
    shippingAmount = money(shipping.price);
  } else if (toNumber(input.shipping, 0) > 0) {
    throw new PricingError('Shipping option must be selected from this store.', 400, 'SHIPPING_REQUIRED');
  } else if (input.previewWithoutShipping === true) {
    warnings.push('Shipping is not included in this preview quote.');
  } else {
    if (!shippingZones.length) {
      throw new PricingError('No shipping options are configured for this store.', 400, 'SHIPPING_UNAVAILABLE');
    }
    throw new PricingError('Choose a shipping option before continuing.', 400, 'SHIPPING_REQUIRED');
  }

  const taxableSubtotal = money(itemSubtotal + shippingAmount);
  const taxRate = normaliseTaxRate(cfg.tax_rate);
  const taxInclusive = !!cfg.tax_inclusive;
  const tax = taxRate > 0
    ? money(taxInclusive ? taxableSubtotal - (taxableSubtotal / (1 + taxRate)) : taxableSubtotal * taxRate)
    : 0;
  const totalBeforeRounding = money(taxInclusive ? taxableSubtotal : taxableSubtotal + tax);
  const roundedTotal = money(ceilToStep(totalBeforeRounding, toNumber(cfg.quote_rounding, 0)));
  const roundingAdjustment = money(roundedTotal - totalBeforeRounding);
  const totalCents = toCents(roundedTotal);

  return {
    ok: true,
    pricingVersion: 'pricing-v1-per-volume',
    shop: shop ? { id: shop.id, slug: shop.slug, name: shop.name } : null,
    currency,
    selected: {
      material: publicMaterial(material),
      colour: publicColour(colour),
      finish: publicFinish(finish),
      infill: publicInfill(infill),
      shipping: publicShipping(shipping),
      quantity,
      volumeCm3,
      dimensions,
      models: models.map(publicModel),
      modelCount: models.length,
    },
    lineItems: {
      ratePerCm3: money(ratePerCm3),
      finishMultiplier,
      infillMultiplier,
      unit: fromCents(toCents(unit)),
      itemSubtotalBeforeMinimum,
      minOrderAdjustment,
      itemSubtotal,
      models: modelLineItems,
      shipping: shippingAmount,
      tax,
      roundingAdjustment,
      total: fromCents(totalCents),
    },
    discounts: {
      enabled: false,
      amount: 0,
      note: 'Discount codes are not applied to live checkout in Pricing V1.',
    },
    tax: {
      rate: taxRate,
      inclusive: taxInclusive,
      amount: tax,
    },
    totalCents,
    warnings,
  };
}

export function calculateQuoteForShop(db, shop, input = {}) {
  const parts = loadPricingInputs(db, shop, input);
  return calculateQuote({ shop, input, ...parts });
}

export function calculateQuoteForShopSlug(db, slug, input = {}) {
  const shop = getShopBySlug(db, slug);
  return calculateQuoteForShop(db, shop, input);
}

export function assertClaimedTotalMatches(quote, claimedAmount) {
  const claimedCents = toCents(claimedAmount);
  if (!Number.isFinite(claimedCents) || claimedCents !== quote.totalCents) {
    throw new PricingError(
      'Checkout total changed. Please review the updated price and try again.',
      409,
      'PRICE_CHANGED',
      quote
    );
  }
}

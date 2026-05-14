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

function loadPricingInputs(db, shop, input = {}) {
  if (input.materialId == null || input.materialId === '') {
    throw new PricingError('Selected material is required.', 400, 'MATERIAL_REQUIRED');
  }
  const material = parseMaterialRow(db.prepare(`
    SELECT *
    FROM materials
    WHERE id = ? AND shop_id = ? AND active = 1
  `).get(input.materialId, shop.id), { stableIds: true, publicOnly: true });
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

function checkMaterialSize(material, input = {}) {
  const checks = [
    { key: 'xMm', label: 'width/X', limit: toNumber(material.max_x_mm, 0) },
    { key: 'yMm', label: 'depth/Y', limit: toNumber(material.max_y_mm, 0) },
    { key: 'zMm', label: 'height/Z', limit: toNumber(material.max_z_mm, 0) },
  ];
  const hasConfiguredLimit = checks.some(c => c.limit > 0);
  const dimensions = normaliseDimensions(input);
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
  const failed = checks.find(c => c.limit > 0 && dimensions[c.key] > c.limit);
  if (!failed) return dimensions;
  const actual = Math.round(dimensions[failed.key] * 10) / 10;
  const limit = Math.round(failed.limit * 10) / 10;
  throw new PricingError(
    `Model ${failed.label} is ${actual} mm, but this material allows up to ${limit} mm.`,
    400,
    'MODEL_TOO_LARGE'
  );
}

export function calculateQuote({ shop, material, cfg = {}, shippingZones = [], input = {} }) {
  const warnings = [];
  const currency = String(cfg.currency || DEFAULT_CURRENCY).toUpperCase();
  if (currency !== DEFAULT_CURRENCY) {
    warnings.push('Live checkout currently charges in NZD; other currencies are display-only.');
  }

  const volumeCm3 = toNumber(input.volumeCm3, NaN);
  if (!Number.isFinite(volumeCm3) || volumeCm3 <= 0) {
    throw new PricingError('Model volume is missing or invalid.', 400, 'INVALID_VOLUME');
  }
  const dimensions = checkMaterialSize(material, input);

  const quantity = clampInt(input.quantity, 1, 999, 1);

  const colours = Array.isArray(material.colours) ? material.colours : [];
  let colour = null;
  if (input.colourId) {
    colour = colours.find(c => String(c.id) === String(input.colourId));
    if (!colour) throw new PricingError('Selected colour is not available.', 400, 'COLOUR_UNAVAILABLE');
  } else if (input.colour) {
    colour = colours.find(c => c.name === input.colour) || null;
    if (!colour && colours.length) throw new PricingError('Selected colour is not available.', 400, 'COLOUR_UNAVAILABLE');
  } else {
    colour = colours[0] || null;
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
    finish = finishes.find(f => f.default) || finishes[0] || null;
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
    infill = activeInfill.find(t => t.is_default) || activeInfill[0] || null;
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
  const itemSubtotalBeforeMinimum = money(unit * quantity);

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
    },
    lineItems: {
      ratePerCm3: money(ratePerCm3),
      finishMultiplier,
      infillMultiplier,
      unit: fromCents(toCents(unit)),
      itemSubtotalBeforeMinimum,
      minOrderAdjustment,
      itemSubtotal,
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

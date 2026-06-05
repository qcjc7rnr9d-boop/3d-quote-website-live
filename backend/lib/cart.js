import {
  PricingError,
  calculateQuoteForShop,
  buildQuoteRequestFromCart,
  fromCents,
  normaliseShippingZones,
  toCents,
} from './pricing-engine.js';

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function money(value) {
  return fromCents(toCents(value));
}

function safeJson(value, fallback = {}) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function normaliseModelList(models = []) {
  return (Array.isArray(models) ? models : []).map((model, index) => ({
    ...model,
    id: model?.id || `model-${index + 1}`,
    quantity: Math.max(1, Math.floor(safeNumber(model?.quantity, 1))),
  }));
}

function makeItemId(index = 0) {
  return `cart-item-${Date.now().toString(36)}-${index}-${Math.random().toString(36).slice(2, 8)}`;
}

function normaliseCartShipping(input = null) {
  if (!input) return null;
  const id = input.id ?? input.methodId ?? input.shippingId;
  if (id == null || id === '') return null;
  return {
    id: String(id),
    methodId: String(input.methodId || id),
    bandId: input.bandId || null,
    bandLabel: input.bandLabel || null,
    label: input.label || input.service || input.carrier || 'Shipping',
    price: safeNumber(input.finalPrice ?? input.price, 0),
    package: input.package || null,
  };
}

function shippingFromLegacyItem(item = {}) {
  return normaliseCartShipping(
    item.shipping
    || item.selectedShipping
    || item.quoteSnapshot?.selected?.shipping
    || (item.shippingId ? { id: item.shippingId, label: item.shippingLabel || 'Shipping', price: item.shippingNzd } : null)
  );
}

export function normaliseCartItem(input = {}, index = 0) {
  const quote = input.quoteSnapshot || input.quote || {};
  const selected = quote.selected || {};
  const file = input.file || {};
  const rawModels = Array.isArray(input.models) && input.models.length
    ? input.models
    : (Array.isArray(file.models) && file.models.length
      ? file.models
      : (Array.isArray(selected.models) ? selected.models : []));
  const models = normaliseModelList(rawModels);
  const itemFile = {
    ...file,
    name: file.name || input.fileName || (models.length > 1 ? `${models.length} models` : models[0]?.name) || 'Uploaded model',
    size: file.size ?? input.fileSize ?? models.reduce((sum, model) => sum + safeNumber(model.size), 0),
    volumeCm3: file.volumeCm3 ?? input.volumeCm3 ?? selected.volumeCm3,
    dimensions: file.dimensions ?? input.dimensions ?? selected.dimensions ?? null,
    models,
  };

  return {
    id: input.id || makeItemId(index),
    shopSlug: input.shopSlug || null,
    file: itemFile,
    models,
    materialId: input.materialId ?? selected.material?.id ?? null,
    materialName: input.materialName ?? (typeof input.material === 'string' ? input.material : input.material?.name) ?? selected.material?.name ?? '',
    colorId: input.colorId ?? input.colourId ?? selected.colour?.id ?? null,
    colorName: input.colorName ?? input.colourName ?? selected.colour?.name ?? '',
    colorHex: input.colorHex ?? input.colourHex ?? selected.colour?.hex ?? null,
    finish: input.finish ?? input.finishId ?? selected.finish?.id ?? null,
    finishId: input.finishId ?? input.finish ?? selected.finish?.id ?? null,
    finishLabel: input.finishLabel ?? selected.finish?.name ?? input.finish ?? '',
    finishLayerHeight: input.finishLayerHeight ?? selected.finish?.layerHeight ?? '',
    finishDescription: input.finishDescription ?? selected.finish?.description ?? '',
    infillTierId: input.infillTierId ?? selected.infill?.id ?? null,
    infillLabel: input.infillLabel ?? selected.infill?.label ?? null,
    quantity: safeNumber(input.quantity ?? selected.quantity, models.length > 1 ? 1 : 1),
    shipping: input.shipping ?? (selected.shipping ? {
      id: selected.shipping.id,
      label: selected.shipping.label || 'Shipping',
      price: safeNumber(selected.shipping.finalPrice ?? selected.shipping.price),
    } : null),
    currency: input.currency || quote.currency || 'NZD',
    unitNzd: safeNumber(input.unitNzd ?? quote.lineItems?.unit),
    itemsNzd: safeNumber(input.itemsNzd ?? quote.lineItems?.itemSubtotal),
    shippingNzd: safeNumber(input.shippingNzd ?? quote.lineItems?.shipping),
    taxNzd: safeNumber(input.taxNzd ?? quote.lineItems?.tax),
    sellerNetTotalNzd: safeNumber(input.sellerNetTotalNzd ?? quote.lineItems?.sellerNetTotal),
    sellerNetTotalCents: safeNumber(input.sellerNetTotalCents ?? quote.lineItems?.sellerNetTotalCents, 0),
    platformFeeIncludedNzd: safeNumber(input.platformFeeIncludedNzd ?? quote.lineItems?.platformFeeIncluded),
    platformFeeIncludedCents: safeNumber(input.platformFeeIncludedCents ?? quote.lineItems?.platformFeeIncludedCents, 0),
    totalNzd: safeNumber(input.totalNzd ?? quote.lineItems?.total),
    totalCents: safeNumber(input.totalCents ?? quote.totalCents, 0),
    quoteSnapshot: quote,
    createdAt: input.createdAt || input.savedAt || new Date().toISOString(),
  };
}

export function normaliseCart(input = {}, fallbackShopSlug = null) {
  const rawItems = Array.isArray(input?.items) && input.items.length
    ? input.items
    : (input && (input.materialId || input.file || input.quoteSnapshot) ? [input] : []);
  const shopSlug = input?.shopSlug || fallbackShopSlug || rawItems[0]?.shopSlug || null;
  const items = rawItems.map((item, index) => normaliseCartItem({ ...item, shopSlug: item.shopSlug || shopSlug }, index));
  const rootShipping = normaliseCartShipping(input?.shipping || (input?.shippingId ? { id: input.shippingId } : null))
    || rawItems.map(shippingFromLegacyItem).find(Boolean)
    || null;
  const totalCents = safeNumber(input?.totalCents, 0)
    || items.reduce((sum, item) => sum + safeNumber(item.totalCents, Math.round(safeNumber(item.totalNzd) * 100)), 0);
  const totalNzd = safeNumber(input?.totalNzd, 0)
    || items.reduce((sum, item) => sum + safeNumber(item.totalNzd), 0);
  return {
    shopSlug,
    items,
    shipping: rootShipping,
    shippingId: rootShipping?.id || null,
    shippingNzd: safeNumber(input?.shippingNzd ?? rootShipping?.price, 0),
    itemsNzd: safeNumber(input?.itemsNzd, items.reduce((sum, item) => sum + safeNumber(item.itemsNzd), 0)),
    taxNzd: safeNumber(input?.taxNzd, items.reduce((sum, item) => sum + safeNumber(item.taxNzd), 0)),
    currency: input?.currency || items[0]?.currency || 'NZD',
    totalCents,
    totalNzd,
    package: input?.package || rootShipping?.package || null,
    shippingOptions: Array.isArray(input?.shippingOptions) ? input.shippingOptions : [],
    savedAt: input?.savedAt || new Date().toISOString(),
  };
}

export function quoteInputForCartItem(item = {}, shopSlug = null) {
  return {
    ...buildQuoteRequestFromCart(item),
    shopSlug: item.shopSlug || shopSlug,
    materialId: item.materialId,
    materialName: item.materialName || (typeof item.material === 'string' ? item.material : item.material?.name) || item.quoteSnapshot?.selected?.material?.name || null,
    models: item.models?.length ? item.models : item.file?.models,
    volumeCm3: item.file?.volumeCm3 ?? item.volumeCm3,
    dimensions: item.file?.dimensions ?? item.dimensions,
    colourId: item.colorId ?? item.colourId,
    colour: item.colorName ?? item.colour,
    finishId: item.finishId ?? item.finish,
    finish: item.finishLabel ?? item.finish,
    infillTierId: item.infillTierId,
    quantity: item.quantity,
    shippingId: item.shipping?.id ?? item.shippingId,
  };
}

function materialDensity(db, shopId, materialId) {
  const fallback = 1.25;
  if (!materialId) return { value: fallback, fallback: true };
  const row = db.prepare('SELECT properties FROM materials WHERE id = ? AND shop_id = ?').get(materialId, shopId);
  const props = safeJson(row?.properties, {});
  const raw = props.density_g_cm3 ?? props.densityGcm3 ?? props.density ?? props.material_density_g_cm3;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return { value: n, fallback: false };
  return { value: fallback, fallback: true };
}

function modelDimensionVolumeCm3(dimensions = {}) {
  const x = safeNumber(dimensions.xMm ?? dimensions.x_mm ?? dimensions.x, 0);
  const y = safeNumber(dimensions.yMm ?? dimensions.y_mm ?? dimensions.y, 0);
  const z = safeNumber(dimensions.zMm ?? dimensions.z_mm ?? dimensions.z ?? dimensions.heightMm ?? dimensions.height, 0);
  return x > 0 && y > 0 && z > 0 ? (x * y * z) / 1000 : 0;
}

function packageMetricsForItems(db, shop, items = []) {
  let totalModelVolumeCm3 = 0;
  let packageVolumeCm3 = 0;
  let estimatedWeightKg = 0;
  let maxX = 0;
  let maxY = 0;
  let maxZ = 0;
  let modelCount = 0;
  let unitCount = 0;
  let usedFallbackDensity = false;

  for (const item of items) {
    const density = materialDensity(db, shop.id, item.materialId);
    usedFallbackDensity = usedFallbackDensity || density.fallback;
    const models = item.models?.length ? item.models : item.file?.models || [];
    for (const model of models) {
      const quantity = Math.max(1, Math.floor(safeNumber(model.quantity, 1)));
      const volume = Math.max(0, safeNumber(model.volumeCm3, 0));
      const dims = model.dimensions || {};
      const x = safeNumber(dims.xMm ?? dims.x_mm ?? dims.x, 0);
      const y = safeNumber(dims.yMm ?? dims.y_mm ?? dims.y, 0);
      const z = safeNumber(dims.zMm ?? dims.z_mm ?? dims.z ?? dims.heightMm ?? dims.height, 0);
      modelCount += 1;
      unitCount += quantity;
      totalModelVolumeCm3 += volume * quantity;
      packageVolumeCm3 += modelDimensionVolumeCm3(dims) * quantity;
      estimatedWeightKg += (volume * quantity * density.value) / 1000;
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }

  return {
    modelCount,
    unitCount,
    totalModelVolumeCm3: money(totalModelVolumeCm3),
    packageVolumeCm3: money(packageVolumeCm3),
    estimatedWeightKg: Math.round(estimatedWeightKg * 1000) / 1000,
    maxDimensionsMm: { xMm: money(maxX), yMm: money(maxY), zMm: money(maxZ) },
    maxLongestSideMm: money(Math.max(maxX, maxY, maxZ)),
    weightEstimateUsesFallbackDensity: usedFallbackDensity,
  };
}

function loadShippingRows(db, shopId) {
  const row = db.prepare('SELECT shipping_zones FROM store_settings WHERE shop_id = ?').get(shopId) || {};
  return safeJson(row.shipping_zones, []);
}

function selectedShippingFromOptions(options = [], requested = null) {
  const id = requested?.methodId || requested?.id || requested;
  if (!id) return null;
  return options.find(option => String(option.id) === String(id) || String(option.methodId) === String(id)) || null;
}

export function previewCartForShop(db, shop, cartInput = {}, options = {}) {
  const cart = normaliseCart(cartInput, shop?.slug);
  const requireShipping = options.requireShipping === true;
  const items = cart.items.map((item, index) => {
    const quote = calculateQuoteForShop(db, shop, {
      ...quoteInputForCartItem(item, shop.slug),
      shippingId: null,
      previewWithoutShipping: true,
    });
    return normaliseCartItem({
      ...item,
      id: item.id || makeItemId(index),
      shopSlug: shop.slug,
      materialId: quote.selected.material.id,
      materialName: quote.selected.material.name,
      colorId: quote.selected.colour?.id || null,
      colorName: quote.selected.colour?.name || '',
      colorHex: quote.selected.colour?.hex || null,
      finish: quote.selected.finish?.id || null,
      finishId: quote.selected.finish?.id || null,
      finishLabel: quote.selected.finish?.name || '',
      finishLayerHeight: quote.selected.finish?.layerHeight || '',
      finishDescription: quote.selected.finish?.description || '',
      infillTierId: quote.selected.infill?.id || null,
      infillLabel: quote.selected.infill?.label || null,
      quantity: quote.selected.quantity,
      quoteSnapshot: quote,
      unitNzd: quote.lineItems.unit,
      itemsNzd: quote.lineItems.itemSubtotal,
      shipping: null,
      shippingNzd: 0,
      taxNzd: quote.lineItems.tax,
      sellerNetTotalNzd: quote.lineItems.sellerNetTotal,
      sellerNetTotalCents: quote.lineItems.sellerNetTotalCents,
      platformFeeIncludedNzd: quote.lineItems.platformFeeIncluded,
      platformFeeIncludedCents: quote.lineItems.platformFeeIncludedCents,
      totalNzd: quote.lineItems.total,
      totalCents: quote.totalCents,
      file: {
        ...(item.file || {}),
        name: quote.selected.models?.length > 1 ? `${quote.selected.models.length} models` : quote.selected.models?.[0]?.name || item.file?.name,
        size: quote.selected.models?.reduce((sum, model) => sum + safeNumber(model.size), 0) || item.file?.size || 0,
        volumeCm3: quote.selected.volumeCm3,
        dimensions: quote.selected.dimensions,
        models: quote.selected.models || [],
      },
      models: quote.selected.models || [],
    }, index);
  });

  const pkg = packageMetricsForItems(db, shop, items);
  const shippingOptions = normaliseShippingZones(loadShippingRows(db, shop.id), pkg);
  const requestedShipping = normaliseCartShipping(options.shipping || (options.shippingId ? { id: options.shippingId } : null))
    || cart.shipping
    || null;
  let shipping = selectedShippingFromOptions(shippingOptions, requestedShipping);
  const cfg = db.prepare('SELECT tax_rate, tax_inclusive FROM pricing_config WHERE shop_id = ?').get(shop.id) || {};
  const itemSubtotal = money(items.reduce((sum, item) => sum + safeNumber(item.itemsNzd), 0));
  if (shipping) {
    shipping = { ...shipping };
  } else if (requestedShipping?.id && requireShipping) {
    throw new PricingError(
      'Selected shipping option is not available for this order size or weight.',
      400,
      'SHIPPING_UNAVAILABLE',
      { ok: true, cart: { ...cart, items, package: pkg, shippingOptions } }
    );
  }

  if (requireShipping && !shipping) {
    const code = shippingOptions.length ? 'SHIPPING_REQUIRED' : 'SHIPPING_UNAVAILABLE';
    throw new PricingError(
      shippingOptions.length
        ? 'Choose one shipping option for this order before payment.'
        : 'No shipping option supports this order size or weight.',
      400,
      code,
      { ok: true, cart: { ...cart, items, package: pkg, shippingOptions } }
    );
  }

  const shippingAmount = money(shipping?.price || 0);
  const shippingTax = 0;
  const itemTax = money(items.reduce((sum, item) => sum + safeNumber(item.taxNzd), 0));
  const tax = money(itemTax + shippingTax);
  const itemTotalCents = items.reduce((sum, item) => sum + safeNumber(item.totalCents, Math.round(safeNumber(item.totalNzd) * 100)), 0);
  const shippingCents = toCents(shippingAmount);
  const totalCents = itemTotalCents + (shipping ? shippingCents : 0);
  const selectedShipping = shipping ? {
    id: shipping.id,
    methodId: shipping.methodId || shipping.id,
    bandId: shipping.bandId || null,
    bandLabel: shipping.bandLabel || null,
    label: shipping.label,
    carrier: shipping.carrier,
    service: shipping.service,
    price: shippingAmount,
    basePrice: shippingAmount,
    finalPrice: shippingAmount,
    tax: shippingTax,
    freeApplied: !!shipping.freeApplied,
    package: pkg,
  } : null;

  return {
    shopSlug: shop.slug,
    items,
    shipping: selectedShipping,
    shippingId: selectedShipping?.id || null,
    shippingOptions: shippingOptions.map(option => ({
      id: option.id,
      methodId: option.methodId || option.id,
      bandId: option.bandId || null,
      bandLabel: option.bandLabel || null,
      label: option.label,
      carrier: option.carrier,
      service: option.service,
      price: option.price,
      currency: 'NZD',
      est_days_min: option.est_days_min,
      est_days_max: option.est_days_max,
      recommended: option.recommended,
      available: true,
      source: 'manual',
    })),
    package: pkg,
    currency: 'NZD',
    itemsNzd: itemSubtotal,
    shippingNzd: selectedShipping?.finalPrice || 0,
    taxNzd: tax,
    totalNzd: fromCents(totalCents),
    totalCents,
    checkoutReady: !!selectedShipping,
    lineItems: {
      itemSubtotal,
      shipping: selectedShipping?.finalPrice || 0,
      tax,
      total: fromCents(totalCents),
      totalCents,
    },
    savedAt: new Date().toISOString(),
  };
}

export function validateCartForShop(db, shop, cartInput = {}) {
  return previewCartForShop(db, shop, cartInput, { requireShipping: true });
}

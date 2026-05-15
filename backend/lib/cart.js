import { calculateQuoteForShop, buildQuoteRequestFromCart } from './pricing-engine.js';

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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
  const totalCents = items.reduce((sum, item) => sum + safeNumber(item.totalCents, Math.round(safeNumber(item.totalNzd) * 100)), 0);
  const totalNzd = items.reduce((sum, item) => sum + safeNumber(item.totalNzd), 0);
  return {
    shopSlug,
    items,
    currency: input?.currency || items[0]?.currency || 'NZD',
    totalCents,
    totalNzd,
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

export function validateCartForShop(db, shop, cartInput = {}) {
  const cart = normaliseCart(cartInput, shop?.slug);
  const items = cart.items.map((item, index) => {
    const quote = calculateQuoteForShop(db, shop, quoteInputForCartItem(item, shop.slug));
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
      shippingNzd: quote.lineItems.shipping,
      taxNzd: quote.lineItems.tax,
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
  return normaliseCart({ shopSlug: shop.slug, currency: 'NZD', items });
}

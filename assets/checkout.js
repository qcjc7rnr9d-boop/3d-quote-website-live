// Checkout page behavior. Kept in a local file so the page can keep a strict CSP.
(function () {
  'use strict';

  const RESTRICTED_ITEMS_CERTIFICATION_VERSION = 'restricted-items-v1-2026-05-24';
  const CERTIFICATION_ERROR_MESSAGE = 'Please certify that your order does not include restricted or unlawful items.';

  // Nav toggle
  const nt = document.getElementById('navToggle');
  const nl = document.getElementById('navLinks');
  if (nt) nt.addEventListener('click', () => {
    const o = nl.classList.toggle('open');
    nt.setAttribute('aria-expanded', o);
  });

  // Load cart (snapshotted from quote.html)
  let cart;
  try { cart = JSON.parse(localStorage.getItem('cart') || 'null'); } catch { cart = null; }
  const SIZE_WARNING_KEY = 'material_size_warning';
  let savedSelection = null;
  try { savedSelection = JSON.parse(localStorage.getItem('form_selection') || 'null'); } catch {}
  const URL_PARAMS = new URLSearchParams(window.location.search);
  const urlShop = URL_PARAMS.get('shop');
  const shopSlug = cart?.shopSlug || urlShop || savedSelection?.shopSlug || 'mahi3d';
  cart = normaliseCart(cart, shopSlug);
  const hasData = cart.items.length > 0;

  function shopHref(path) {
    const url = new URL(path, window.location.href);
    url.searchParams.set('shop', shopSlug);
    return url.pathname + url.search;
  }

  function redirectToMaterialSelection(message) {
    try {
      localStorage.setItem(SIZE_WARNING_KEY, JSON.stringify({
        shopSlug,
        materialId: cart?.items?.[0]?.materialId || cart?.materialId || savedSelection?.materialId || null,
        message: message || 'This model is too large for the selected material.',
      }));
    } catch {}
    const grid = document.getElementById('checkoutGrid');
    if (grid) grid.style.display = 'none';
    window.location.href = shopHref('materials.html');
  }

  document.querySelectorAll('a[href="quote.html"]').forEach(link => { link.href = shopHref('quote.html'); });
  document.querySelectorAll('a[href="materials.html"]').forEach(link => { link.href = shopHref('materials.html'); });
  document.querySelectorAll('[data-checkout-link]').forEach(link => {
    const target = link.dataset.checkoutLink;
    if (target === 'materials') link.href = shopHref('catalog.html');
    if (target === 'quote') link.href = shopHref('quote.html');
    if (target === 'portal') link.href = `customer/dashboard.html?shop=${encodeURIComponent(shopSlug)}#overview`;
    if (target === 'help') link.href = `customer/dashboard.html?shop=${encodeURIComponent(shopSlug)}#help`;
    if (target === 'terms') link.href = `${shopHref('terms.html')}#prohibited-uploads`;
    if (target === 'privacy') link.href = `${shopHref('privacy.html')}#storage`;
  });

  if (!hasData) {
    console.warn('[checkout] no cart data found - showing empty state. localStorage.cart =', cart);
    document.getElementById('checkoutGrid').style.display = 'none';
    document.getElementById('emptyState').style.display = '';

    const clearBtn = document.getElementById('clearStaleCartBtn');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      try {
        localStorage.removeItem('cart');
        localStorage.removeItem('form_file');
        localStorage.removeItem('form_selection');
      } catch {}
      clearBtn.textContent = 'Cleared - heading to quote page...';
      setTimeout(() => { location.href = shopHref('quote.html'); }, 700);
    });
  } else {
    console.info('[checkout] loaded cart:', cart);
  }

  function formatBytes(bytes) {
    if (!bytes) return '-';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[ch]));
  }

  function normaliseDimensions(source) {
    const d = source || {};
    const xMm = Number(d.xMm ?? d.x_mm ?? d.x);
    const yMm = Number(d.yMm ?? d.y_mm ?? d.y);
    const zMm = Number(d.zMm ?? d.z_mm ?? d.z ?? d.heightMm ?? d.height);
    if (![xMm, yMm, zMm].every(Number.isFinite)) return null;
    return { xMm, yMm, zMm };
  }

  function cartDimensions(item = cart.items[0] || {}) {
    return normaliseDimensions(
      item?.file?.dimensions
      || item?.dimensions
      || item?.quoteSnapshot?.selected?.dimensions
      || null
    );
  }

  function cartModels(item = cart.items[0] || {}) {
    const raw = item?.file?.models || item?.models || item?.quoteSnapshot?.selected?.models || [];
    const models = Array.isArray(raw) && raw.length ? raw : (item?.file?.name ? [{
      name: item.file.name,
      size: item.file.size,
      dimensions: item.file.dimensions || item.dimensions || item.quoteSnapshot?.selected?.dimensions,
      volumeCm3: item.file.volumeCm3 || item.volumeCm3,
    }] : []);
    return models.map((model, index) => ({
      ...model,
      id: model?.id || `model-${index + 1}`,
      quantity: Math.max(1, Math.floor(Number(model?.quantity) || 1)),
    }));
  }

  function formatDimensionValue(value) {
    return (Math.round(Number(value) * 10) / 10).toLocaleString('en-NZ', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    });
  }

  function formatDimensions(dimensions) {
    if (!dimensions) return '';
    return `${formatDimensionValue(dimensions.xMm)} × ${formatDimensionValue(dimensions.yMm)} × ${formatDimensionValue(dimensions.zMm)} mm`;
  }

  function finishLayerText(layerHeight) {
    const text = String(layerHeight || '').trim();
    if (!text) return '';
    return /layer/i.test(text) ? text : `${text} layer height`;
  }

  function modelVolumeText(model) {
    const volume = Number(model?.volumeCm3);
    if (!Number.isFinite(volume) || volume <= 0) return '';
    return `${Math.round(volume * 100) / 100} cm³`;
  }

  function swatchMarkup(hex) {
    const safeHex = String(hex || '').trim();
    if (!safeHex || safeHex === '-') return '';
    return `<span class="color-swatch" style="background:${escapeHtml(safeHex)}"></span>`;
  }

  function modelPriceLines(item, models) {
    const explicit = item?.quoteSnapshot?.lineItems?.models;
    if (Array.isArray(explicit) && explicit.length) return explicit;

    const itemSubtotal = Number(item?.itemsNzd) || 0;
    if (!models.length || itemSubtotal <= 0) return [];
    const weightedVolumes = models.map(model => {
      const volume = Number(model?.volumeCm3) || 0;
      const quantity = Math.max(1, Math.floor(Number(model?.quantity) || 1));
      return volume * quantity;
    });
    const totalWeight = weightedVolumes.reduce((total, value) => total + value, 0);
    if (totalWeight <= 0) {
      const unit = itemSubtotal / models.length;
      return models.map((model, index) => ({
        id: model.id || null,
        name: model.name || `Model ${index + 1}`,
        quantity: Math.max(1, Math.floor(Number(model?.quantity) || 1)),
        unit,
        subtotal: unit,
      }));
    }
    return models.map((model, index) => {
      const quantity = Math.max(1, Math.floor(Number(model?.quantity) || 1));
      const subtotal = itemSubtotal * (weightedVolumes[index] / totalWeight);
      return {
        id: model.id || null,
        name: model.name || `Model ${index + 1}`,
        quantity,
        unit: quantity > 0 ? subtotal / quantity : subtotal,
        subtotal,
      };
    });
  }

  function priceLineForModel(lines, model, index) {
    return lines.find(line => line?.id && model?.id && String(line.id) === String(model.id))
      || lines[index]
      || null;
  }

  // All payments charge in NZD (the platform's home currency).
  // The currency picker on the quote page is for display only.
  const fmtNzd = n => '$' + (Number(n) || 0).toFixed(2);

  function sum(items, key) {
    return items.reduce((total, item) => total + (Number(item[key]) || 0), 0);
  }

  function normaliseCartItem(input = {}, index = 0) {
    const quote = input.quoteSnapshot || {};
    const selected = quote.selected || {};
    const file = input.file || {};
    const rawModels = Array.isArray(input.models) && input.models.length
      ? input.models
      : (Array.isArray(file.models) && file.models.length ? file.models : (Array.isArray(selected.models) ? selected.models : []));
    const models = rawModels.map((model, modelIndex) => ({
      ...model,
      id: model?.id || `model-${modelIndex + 1}`,
      quantity: Math.max(1, Math.floor(Number(model?.quantity) || 1)),
    }));
    return {
      id: input.id || `cart-item-${index + 1}`,
      shopSlug: input.shopSlug || shopSlug,
      file: {
        ...file,
        name: file.name || input.fileName || (models.length > 1 ? `${models.length} models` : models[0]?.name) || 'Uploaded model',
        size: file.size ?? input.fileSize ?? models.reduce((total, model) => total + (Number(model.size) || 0), 0),
        volumeCm3: file.volumeCm3 ?? input.volumeCm3 ?? selected.volumeCm3,
        dimensions: file.dimensions ?? input.dimensions ?? selected.dimensions ?? null,
        models,
      },
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
      quantity: Number(input.quantity ?? selected.quantity) || 1,
      shipping: input.shipping ?? (selected.shipping ? {
        id: selected.shipping.id,
        label: selected.shipping.label || 'Shipping',
        price: Number(selected.shipping.finalPrice ?? selected.shipping.price) || 0,
      } : null),
      unitNzd: Number(input.unitNzd ?? quote.lineItems?.unit) || 0,
      itemsNzd: Number(input.itemsNzd ?? quote.lineItems?.itemSubtotal) || 0,
      shippingNzd: Number(input.shippingNzd ?? quote.lineItems?.shipping) || 0,
      taxNzd: Number(input.taxNzd ?? quote.lineItems?.tax) || 0,
      totalNzd: Number(input.totalNzd ?? quote.lineItems?.total) || 0,
      totalCents: Number(input.totalCents ?? quote.totalCents) || 0,
      quoteSnapshot: quote,
      createdAt: input.createdAt || input.savedAt || new Date().toISOString(),
    };
  }

  function normaliseCart(input, fallbackShopSlug) {
    if (!input) return { shopSlug: fallbackShopSlug, items: [], totalNzd: 0, totalCents: 0, currency: 'NZD' };
    const rawItems = Array.isArray(input.items) && input.items.length
      ? input.items
      : ((input.materialId || input.file || input.quoteSnapshot) ? [input] : []);
    const items = rawItems.map((item, index) => normaliseCartItem({ ...item, shopSlug: item.shopSlug || input.shopSlug || fallbackShopSlug }, index));
    return {
      shopSlug: input.shopSlug || fallbackShopSlug,
      items,
      currency: input.currency || items[0]?.currency || 'NZD',
      totalNzd: Number(input.totalNzd) || sum(items, 'totalNzd'),
      totalCents: Number(input.totalCents) || items.reduce((total, item) => total + (Number(item.totalCents) || Math.round((Number(item.totalNzd) || 0) * 100)), 0),
      savedAt: input.savedAt || new Date().toISOString(),
    };
  }

  function persistCart() {
    cart.totalNzd = sum(cart.items, 'totalNzd');
    cart.totalCents = cart.items.reduce((total, item) => total + (Number(item.totalCents) || Math.round((Number(item.totalNzd) || 0) * 100)), 0);
    try { localStorage.setItem('cart', JSON.stringify(cart)); } catch {}
  }

  let totalNzd = 0;
  let processingFeeCents = 0;
  let paymentFeeMode = 'merchant_absorbs';
  let checkoutSettings = null;
  let selectedPaymentMethod = 'card';
  let quoteValidated = false;
  let stripeReady = false;
  let paymentUnavailable = false;

  function restrictedItemsCertified() {
    return Boolean(document.getElementById('restrictedItemsCertification')?.checked);
  }

  function restrictedItemsCertificationPayload() {
    return {
      accepted: true,
      version: RESTRICTED_ITEMS_CERTIFICATION_VERSION,
    };
  }

  function updateBankTransferButton() {
    const bankBtn = document.getElementById('bankTransferBtn');
    if (!bankBtn) return;
    bankBtn.disabled = selectedPaymentMethod !== 'bank_transfer' || !quoteValidated || !restrictedItemsCertified();
    bankBtn.style.opacity = bankBtn.disabled ? '0.7' : '';
    bankBtn.style.cursor = bankBtn.disabled ? 'not-allowed' : '';
  }

  function updatePayButton(message) {
    const payBtn = document.getElementById('payBtn');
    if (payBtn && totalNzd > 0) {
      const defaultLabel = 'Pay ' + fmtNzd(totalNzd + processingFeeCents / 100);
      const certificationMissing = !restrictedItemsCertified();
      const certBlocksPayment = quoteValidated && stripeReady && !paymentUnavailable && certificationMissing;
      payBtn.textContent = paymentUnavailable ? 'Payment unavailable' : (certBlocksPayment ? 'Review certification' : (message || defaultLabel));
      payBtn.disabled = selectedPaymentMethod !== 'card' || !(quoteValidated && stripeReady) || paymentUnavailable || certificationMissing;
      payBtn.style.opacity = payBtn.disabled ? '0.7' : '';
      payBtn.style.cursor = payBtn.disabled ? 'not-allowed' : '';
      const errEl = document.getElementById('card-errors');
      if (errEl && certBlocksPayment && (!errEl.textContent || errEl.textContent === CERTIFICATION_ERROR_MESSAGE)) {
        errEl.textContent = CERTIFICATION_ERROR_MESSAGE;
      } else if (errEl && restrictedItemsCertified() && errEl.textContent === CERTIFICATION_ERROR_MESSAGE) {
        errEl.textContent = '';
      }
    } else if (payBtn) {
      payBtn.textContent = 'No price set - contact the shop';
      payBtn.disabled = true;
      payBtn.style.opacity = '0.6';
      payBtn.style.cursor = 'not-allowed';
    }
    updateBankTransferButton();
  }

  function setPaymentFieldsDisabled(disabled) {
    ['customerEmail', 'cardName'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
  }

  function showPaymentSetupError(message) {
    paymentUnavailable = true;
    stripeReady = false;
    setPaymentFieldsDisabled(true);
    const box = document.getElementById('paymentSetupError');
    const text = document.getElementById('paymentSetupErrorText');
    if (text) text.textContent = message || 'This store cannot accept card payments yet.';
    if (box) box.classList.add('show');
    updatePayButton('Payment unavailable');
  }

  function clearPaymentSetupError() {
    paymentUnavailable = false;
    setPaymentFieldsDisabled(false);
    const box = document.getElementById('paymentSetupError');
    if (box) box.classList.remove('show');
  }

  async function loadCheckoutSettings() {
    const amountCents = cart?.totalCents || Math.round((cart?.totalNzd || 0) * 100);
    const res = await fetch(`/api/billing/public-checkout-settings?shop=${encodeURIComponent(shopSlug)}&amount_cents=${amountCents}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not load payment options.');
    checkoutSettings = data;
    paymentFeeMode = data.payment_fee_mode || 'merchant_absorbs';
    processingFeeCents = Number(data.estimated_payment_processing_fee_cents || 0);
    renderPaymentOptions();
    return data;
  }

  function renderPaymentOptions() {
    if (!checkoutSettings) return;
    const bankOption = document.getElementById('bankTransferOption');
    const cardOption = document.getElementById('cardPaymentOption');
    const cardPanel = document.getElementById('cardPanel');
    const bankPanel = document.getElementById('bankTransferPanel');
    const cardSummary = document.getElementById('cardFeeSummary');
    const bankRadio = bankOption?.querySelector('input');
    const cardRadio = cardOption?.querySelector('input');

    if (bankOption) bankOption.style.display = checkoutSettings.bank_transfer_enabled ? '' : 'none';
    if (cardOption) cardOption.style.display = checkoutSettings.card_enabled ? '' : 'none';
    if (cardSummary) {
      cardSummary.textContent = paymentFeeMode === 'pass_to_customer_at_cost'
        ? 'Card — processing fee applies at cost and is shown before payment.'
        : 'Card — no added card processing fee.';
    }
    if (!checkoutSettings.card_enabled) selectedPaymentMethod = 'bank_transfer';
    if (!checkoutSettings.bank_transfer_enabled) selectedPaymentMethod = 'card';
    if (bankRadio) bankRadio.checked = selectedPaymentMethod === 'bank_transfer';
    if (cardRadio) cardRadio.checked = selectedPaymentMethod === 'card';
    if (cardPanel) cardPanel.style.display = selectedPaymentMethod === 'card' ? '' : 'none';
    if (bankPanel) bankPanel.classList.toggle('show', selectedPaymentMethod === 'bank_transfer');
  }

  function showReviewValidationError(message) {
    const box = document.getElementById('reviewValidationError');
    const text = document.getElementById('reviewValidationErrorText');
    const link = document.getElementById('reviewValidationEditLink');
    if (text) text.textContent = message || 'This order needs to be reviewed before payment.';
    if (link) link.href = shopHref('quote.html');
    if (box) box.classList.add('show');
  }

  function clearReviewValidationError() {
    const box = document.getElementById('reviewValidationError');
    if (box) box.classList.remove('show');
  }

  function applyQuoteSnapshotToItem(item, quote) {
    if (!quote?.lineItems || !quote?.selected) return;
    const selected = quote.selected;
    const lines = quote.lineItems;
    item.shopSlug = shopSlug;
    item.materialId = selected.material?.id || item.materialId;
    item.materialName = selected.material?.name || item.materialName;
    item.colorId = selected.colour?.id || item.colorId || null;
    item.colorName = selected.colour?.name || item.colorName || '—';
    item.colorHex = selected.colour?.hex || item.colorHex || null;
    item.finish = selected.finish?.id || item.finish || null;
    item.finishId = selected.finish?.id || item.finishId || item.finish || null;
    item.finishLabel = selected.finish?.name || item.finishLabel || '—';
    item.finishLayerHeight = selected.finish?.layerHeight || item.finishLayerHeight || '';
    item.finishDescription = selected.finish?.description || item.finishDescription || '';
    item.infillTierId = selected.infill?.id || item.infillTierId || null;
    item.infillLabel = selected.infill?.label || item.infillLabel || null;
    item.quantity = selected.quantity || item.quantity || 1;
    item.unitNzd = Number(lines.unit) || 0;
    item.itemsNzd = Number(lines.itemSubtotal) || 0;
    item.shippingNzd = Number(lines.shipping) || 0;
    item.taxNzd = Number(lines.tax) || 0;
    item.totalNzd = Number(lines.total) || 0;
    item.totalCents = quote.totalCents;
    item.quoteSnapshot = quote;
    item.models = selected.models || item.models || [];
    item.file = {
      ...(item.file || {}),
      name: selected.models?.length > 1 ? `${selected.models.length} models` : selected.models?.[0]?.name || item.file?.name,
      size: selected.models?.reduce((total, model) => total + (Number(model.size) || 0), 0) || item.file?.size || 0,
      volumeCm3: selected.volumeCm3,
      dimensions: selected.dimensions || item.file?.dimensions || null,
      models: selected.models || item.file?.models || [],
    };
    if (selected.shipping) {
      item.shipping = {
        id: selected.shipping.id,
        label: selected.shipping.label || 'Shipping',
        price: Number(selected.shipping.finalPrice ?? selected.shipping.price) || 0,
      };
    }
  }

  function quotePayload(item) {
    const file = item.file || {};
    return {
      shopSlug,
      materialId: item.materialId,
      materialName: item.materialName || (typeof item.material === 'string' ? item.material : item.material?.name) || item.quoteSnapshot?.selected?.material?.name || null,
      models: item.models?.length ? item.models : file.models,
      volumeCm3: file.volumeCm3 ?? item.volumeCm3 ?? item.quoteSnapshot?.selected?.volumeCm3,
      dimensions: file.dimensions ?? item.dimensions ?? item.quoteSnapshot?.selected?.dimensions ?? null,
      colourId: item.colorId || null,
      colour: item.colorName || null,
      finishId: item.finishId || null,
      finish: item.finishLabel || item.finish || null,
      infillTierId: item.infillTierId || null,
      quantity: item.quantity,
      shippingId: item.shipping?.id || null,
    };
  }

  async function refreshCheckoutQuote() {
    quoteValidated = false;
    clearReviewValidationError();
    updatePayButton('Validating price...');
    for (const item of cart.items) {
      const res = await fetch('/api/customer/quote-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(quotePayload(item)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        if (data.code === 'MODEL_TOO_LARGE' || data.code === 'MODEL_DIMENSIONS_REQUIRED') {
          redirectToMaterialSelection(data.error || 'This model is too large for the selected material.');
          const err = new Error(data.error || 'This model is too large for the selected material.');
          err.redirected = true;
          throw err;
        }
        const err = new Error(data.error || 'Could not refresh checkout total.');
        err.checkoutValidation = true;
        throw err;
      }
      applyQuoteSnapshotToItem(item, data);
    }
    persistCart();
    await loadCheckoutSettings();
    quoteValidated = true;
    renderCart();
    return cart;
  }

  function renderCart() {
    const cartItemsReview = document.getElementById('cartItemsReview');
    if (cartItemsReview) {
      cartItemsReview.innerHTML = cart.items.map((item, index) => {
        const models = cartModels(item);
        const priceLines = modelPriceLines(item, models);
        const finishDetails = [finishLayerText(item.finishLayerHeight), item.finishDescription || ''].filter(Boolean).join(' · ');
        const colourText = item.colorName || 'No colour selected';
        const finishText = [item.finishLabel || item.finish || 'Standard', finishDetails].filter(Boolean).join(' · ');
        const infillText = item.infillLabel || 'Standard';
        const quantityText = models.length > 1 ? 'Per model' : `x ${Math.max(1, parseInt(item.quantity, 10) || 1)}`;
        const shippingLabel = item.shipping?.label || (Number(item.shippingNzd) > 0 ? 'Shipping' : 'No shipping selected');
        return `<section class="cart-item-review" data-cart-item-id="${escapeHtml(item.id)}">
          <div class="cart-item-head">
            <div>
              <span class="cart-item-kicker">Material group ${index + 1}</span>
              <strong>${escapeHtml(item.materialName || `Material group ${index + 1}`)}</strong>
              <span>${escapeHtml([colourText, finishText].filter(Boolean).join(' · '))}</span>
            </div>
            <div class="cart-item-total">${fmtNzd(item.totalNzd)}</div>
          </div>
          <div class="cart-item-section">
            <span class="cart-item-section-title">Files</span>
            <div class="cart-item-files">
            ${models.map((model, modelIndex) => {
              const dimsText = formatDimensions(normaliseDimensions(model.dimensions));
              const quantity = Math.max(1, Math.floor(Number(model.quantity) || 1));
              const qtyText = ` · Qty ${quantity}`;
              const volumeText = modelVolumeText(model);
              return `<div class="cart-item-file"><strong>${escapeHtml(model.name || 'Model')}</strong><span>${[formatBytes(model.size), dimsText, volumeText].filter(Boolean).join(' · ')}${qtyText}</span></div>`;
            }).join('')}
            </div>
          </div>
          <div class="cart-item-section">
            <span class="cart-item-section-title">Per-item pricing</span>
            <div class="cart-item-pricing">
              ${models.map((model, modelIndex) => {
                const priceLine = priceLineForModel(priceLines, model, modelIndex);
                const quantity = Math.max(1, Math.floor(Number(priceLine?.quantity ?? model.quantity) || 1));
                const unit = Number(priceLine?.unit) || 0;
                const subtotal = Number(priceLine?.subtotal) || 0;
                return `<div class="cart-item-price-row">
                  <strong>${escapeHtml(model.name || priceLine?.name || `Model ${modelIndex + 1}`)}</strong>
                  <span class="price-each">${fmtNzd(unit)} each × ${quantity}</span>
                  <span class="price-total">${fmtNzd(subtotal)}</span>
                </div>`;
              }).join('')}
              ${Number(item.quoteSnapshot?.lineItems?.minOrderAdjustment) > 0 ? `<div class="cart-item-price-row">
                <strong>Minimum order adjustment</strong>
                <span class="price-each">Store minimum</span>
                <span class="price-total">${fmtNzd(item.quoteSnapshot.lineItems.minOrderAdjustment)}</span>
              </div>` : ''}
            </div>
          </div>
          <div class="cart-item-section">
            <span class="cart-item-section-title">Options</span>
            <div class="cart-item-options">
              <div class="cart-option"><span class="label">Material</span><span class="value">${escapeHtml(item.materialName || '—')}</span></div>
              <div class="cart-option"><span class="label">Colour</span><span class="value">${swatchMarkup(item.colorHex)}${escapeHtml(colourText)}</span></div>
              <div class="cart-option cart-option-wide"><span class="label">Finish</span><span class="value">${escapeHtml(finishText)}</span></div>
              <div class="cart-option"><span class="label">Infill</span><span class="value">${escapeHtml(infillText)}</span></div>
              <div class="cart-option"><span class="label">Quantity</span><span class="value">${escapeHtml(quantityText)}</span></div>
            </div>
          </div>
          <div class="cart-item-section cart-item-money">
            <div class="cart-item-money-row"><span>Subtotal</span><strong>${fmtNzd(item.itemsNzd)}</strong></div>
            <div class="cart-item-money-row"><span>${escapeHtml(shippingLabel)}</span><strong>${Number(item.shippingNzd) > 0 ? fmtNzd(item.shippingNzd) : 'Free'}</strong></div>
            ${Number(item.taxNzd) > 0 ? `<div class="cart-item-money-row"><span>Tax</span><strong>${fmtNzd(item.taxNzd)}</strong></div>` : ''}
            <div class="cart-item-money-row"><span>Group total</span><strong>${fmtNzd(item.totalNzd)}</strong></div>
          </div>
          <div class="cart-item-actions"><button class="remove-cart-item" type="button" data-remove-cart-item="${escapeHtml(item.id)}">Remove group</button></div>
        </section>`;
      }).join('');
    }

    const subtotalNzd  = sum(cart.items, 'itemsNzd');
    const shippingNzd  = sum(cart.items, 'shippingNzd');
    const taxNzd       = sum(cart.items, 'taxNzd');
    totalNzd           = sum(cart.items, 'totalNzd') || (subtotalNzd + shippingNzd + taxNzd);

    const unitRow = document.getElementById('priceUnitRow');
    if (unitRow) unitRow.style.display = 'none';

    document.getElementById('priceSubtotal').textContent = fmtNzd(subtotalNzd);

    document.getElementById('priceShippingLabel').textContent = 'Shipping';
    document.getElementById('priceShipping').textContent = shippingNzd > 0 ? fmtNzd(shippingNzd) : 'Free';

    const taxRow = document.getElementById('priceTaxRow');
    if (taxNzd > 0) {
      document.getElementById('priceTax').textContent = fmtNzd(taxNzd);
      taxRow.style.display = '';
    } else {
      taxRow.style.display = 'none';
    }

    const feeRow = document.getElementById('priceProcessingFeeRow');
    if (feeRow) {
      if (selectedPaymentMethod === 'card' && processingFeeCents > 0) {
        document.getElementById('priceProcessingFee').textContent = fmtNzd(processingFeeCents / 100);
        feeRow.style.display = '';
      } else {
        feeRow.style.display = 'none';
      }
    }

    document.getElementById('priceTotal').textContent = fmtNzd(totalNzd + (selectedPaymentMethod === 'card' ? processingFeeCents / 100 : 0));

    updatePayButton();
  }

  document.querySelectorAll('input[name="paymentMethodChoice"]').forEach(input => {
    input.addEventListener('change', e => {
      selectedPaymentMethod = e.target.value;
      renderPaymentOptions();
      renderCart();
    });
  });

  document.getElementById('cartItemsReview')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-remove-cart-item]');
    if (!btn) return;
    cart.items = cart.items.filter(item => String(item.id) !== String(btn.dataset.removeCartItem));
    persistCart();
    if (!cart.items.length) {
      try { localStorage.removeItem('cart'); } catch {}
      window.location.href = shopHref('quote.html');
      return;
    }
    renderCart();
    refreshCheckoutQuote().catch(err => {
      if (err.redirected) return;
      if (err.checkoutValidation) showReviewValidationError(err.message);
      document.getElementById('card-errors').textContent = err.message || 'Could not refresh checkout total.';
    });
  });
  document.getElementById('restrictedItemsCertification')?.addEventListener('change', () => {
    const errEl = document.getElementById('card-errors');
    if (restrictedItemsCertified() && errEl?.textContent === CERTIFICATION_ERROR_MESSAGE) errEl.textContent = '';
    updatePayButton();
  });

  if (hasData) {
    renderCart();
    refreshCheckoutQuote().catch(err => {
      if (err.redirected) return;
      if (err.checkoutValidation) showReviewValidationError(err.message);
      document.getElementById('card-errors').textContent = err.message || 'Could not refresh checkout total.';
      quoteValidated = false;
      updatePayButton('Review total unavailable');
    });
  }

  // Stripe init (publishable key fetched from backend)
  let stripe, elements, cardEl;
  (async () => {
    if (!hasData) return;
    try {
      await loadCheckoutSettings();
      if (selectedPaymentMethod === 'bank_transfer') {
        stripeReady = false;
        updatePayButton();
        return;
      }
      const r = await fetch('/api/stripe/public-key?shop=' + encodeURIComponent(shopSlug));
      const data = await r.json();
      if (!r.ok || !data.publishable_key) {
        showPaymentSetupError(data.error || 'Stripe card payments are not configured for this store yet.');
        return;
      }
      stripe = Stripe(data.publishable_key);
      elements = stripe.elements();
      cardEl = elements.create('card', {
        style: {
          base: { fontFamily: 'var(--font-ui)', fontSize: '14px', color: '#1A1A1A', '::placeholder': { color: '#9B9B9B' } },
          invalid: { color: '#C0392B' },
        },
        hidePostalCode: true,
      });
      cardEl.mount('#card-element');
      stripeReady = true;
      clearPaymentSetupError();
      updatePayButton();

      const wrapper = document.getElementById('card-element-wrapper');
      cardEl.on('focus', () => { wrapper.style.borderColor = '#7A9E7E'; wrapper.style.boxShadow = '0 0 0 3px rgba(122,158,126,0.15)'; });
      cardEl.on('blur',  () => { wrapper.style.borderColor = 'var(--border)'; wrapper.style.boxShadow = ''; });
      cardEl.on('change', e => {
        document.getElementById('card-errors').textContent = e.error ? e.error.message : '';
      });
    } catch (e) {
      showPaymentSetupError('Could not initialise Stripe card payment: ' + e.message);
    }
  })();

  // Pay handler
  document.getElementById('payBtn').addEventListener('click', async (e) => {
    if (!hasData) return;
    const btn = e.currentTarget;
    const errEl = document.getElementById('card-errors');
    errEl.textContent = '';

    const name  = document.getElementById('cardName').value.trim();
    const email = document.getElementById('customerEmail').value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errEl.textContent = 'Please enter a valid email address.';
      return;
    }
    if (!name) {
      errEl.textContent = 'Please enter the name on your card.';
      return;
    }
    if (!quoteValidated) {
      errEl.textContent = 'Checkout total is still being validated. Please try again in a moment.';
      return;
    }
    if (!restrictedItemsCertified()) {
      errEl.textContent = CERTIFICATION_ERROR_MESSAGE;
      updatePayButton();
      return;
    }
    if (!stripe || !cardEl || !stripeReady) {
      errEl.textContent = 'Card form is still loading - please try again in a moment.';
      return;
    }

    btn.disabled = true;
    const origLabel = btn.textContent;
    btn.textContent = 'Processing...';

    try {
      const { paymentMethod, error: pmErr } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardEl,
        billing_details: { name, email },
      });
      if (pmErr) throw new Error(pmErr.message);

      const res = await fetch('/api/stripe/create-payment-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentMethodId: paymentMethod.id,
          shopSlug,
          amount:          totalNzd + processingFeeCents / 100,
          currency:        'nzd',
          customerEmail:   email,
          customerName:    name,
          orderData: cart,
          restrictedItemsCertification: restrictedItemsCertificationPayload(),
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.code === 'PRICE_CHANGED' && data.quote) {
        if (data.quote.cart) cart = normaliseCart(data.quote.cart, shopSlug);
        else if (data.quote.selected && cart.items[0]) applyQuoteSnapshotToItem(cart.items[0], data.quote);
        persistCart();
        renderCart();
        throw new Error('The price changed. Please review the updated total, then click Pay again.');
      }
      if (!res.ok || data.error) throw new Error(data.error || 'Payment failed');

      if (data.status === 'requires_action' && data.clientSecret) {
        const { error: confErr } = await stripe.confirmCardPayment(data.clientSecret);
        if (confErr) throw new Error(confErr.message);
      }

      try { localStorage.removeItem('cart'); } catch {}
      const confirmation = new URL('confirmation.html', window.location.href);
      confirmation.searchParams.set('order', data.orderId);
      if (data.orderToken) confirmation.searchParams.set('token', data.orderToken);
      confirmation.searchParams.set('shop', shopSlug);
      window.location.href = confirmation.pathname + confirmation.search;
    } catch (err) {
      errEl.textContent = err.message || 'Payment failed. Please try again.';
      btn.disabled = false;
      btn.textContent = origLabel;
    }
  });

  document.getElementById('bankTransferBtn')?.addEventListener('click', async () => {
    if (!hasData) return;
    const errEl = document.getElementById('card-errors');
    if (errEl) errEl.textContent = '';
    const email = document.getElementById('bankCustomerEmail').value.trim();
    const name = document.getElementById('bankCustomerName').value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (errEl) errEl.textContent = 'Please enter a valid email address.';
      return;
    }
    if (!name) {
      if (errEl) errEl.textContent = 'Please enter your name.';
      return;
    }
    if (!quoteValidated) {
      if (errEl) errEl.textContent = 'Checkout total is still being validated. Please try again in a moment.';
      return;
    }
    if (!restrictedItemsCertified()) {
      if (errEl) errEl.textContent = CERTIFICATION_ERROR_MESSAGE;
      updatePayButton();
      return;
    }

    const btn = document.getElementById('bankTransferBtn');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Placing order...';
    try {
      const res = await fetch('/api/stripe/create-bank-transfer-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopSlug,
          customerEmail: email,
          customerName: name,
          orderData: cart,
          restrictedItemsCertification: restrictedItemsCertificationPayload(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || 'Could not place bank transfer order.');
      try { localStorage.removeItem('cart'); } catch {}
      const confirmation = new URL('confirmation.html', window.location.href);
      confirmation.searchParams.set('order', data.orderId);
      if (data.orderToken) confirmation.searchParams.set('token', data.orderToken);
      confirmation.searchParams.set('shop', shopSlug);
      window.location.href = confirmation.pathname + confirmation.search;
    } catch (err) {
      if (errEl) errEl.textContent = err.message || 'Could not place bank transfer order.';
      btn.disabled = false;
      btn.textContent = original;
    }
  });

})();

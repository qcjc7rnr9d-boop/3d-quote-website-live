// Checkout page behavior. Kept in a local file so the page can keep a strict CSP.
(function () {
  'use strict';

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

  // Only hide the grid when there's literally nothing to show.
  const hasData = !!(cart && (cart.materialId || cart.file || cart.itemsNzd != null));
  const SIZE_WARNING_KEY = 'material_size_warning';
  let savedSelection = null;
  try { savedSelection = JSON.parse(localStorage.getItem('form_selection') || 'null'); } catch {}
  const urlShop = new URLSearchParams(window.location.search).get('shop');
  const shopSlug = cart?.shopSlug || urlShop || savedSelection?.shopSlug || 'mahi3d';

  function shopHref(path) {
    return `${path}?shop=${encodeURIComponent(shopSlug)}`;
  }

  function redirectToMaterialSelection(message) {
    try {
      localStorage.setItem(SIZE_WARNING_KEY, JSON.stringify({
        shopSlug,
        materialId: cart?.materialId || savedSelection?.materialId || null,
        message: message || 'This model is too large for the selected material.',
      }));
    } catch {}
    const grid = document.getElementById('checkoutGrid');
    if (grid) grid.style.display = 'none';
    window.location.href = shopHref('materials.html');
  }

  document.querySelectorAll('a[href="quote.html"]').forEach(link => { link.href = shopHref('quote.html'); });
  document.querySelectorAll('a[href="materials.html"]').forEach(link => { link.href = shopHref('materials.html'); });

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

  function normaliseDimensions(source) {
    const d = source || {};
    const xMm = Number(d.xMm ?? d.x_mm ?? d.x);
    const yMm = Number(d.yMm ?? d.y_mm ?? d.y);
    const zMm = Number(d.zMm ?? d.z_mm ?? d.z ?? d.heightMm ?? d.height);
    if (![xMm, yMm, zMm].every(Number.isFinite)) return null;
    return { xMm, yMm, zMm };
  }

  function cartDimensions() {
    return normaliseDimensions(
      cart?.file?.dimensions
      || cart?.dimensions
      || cart?.quoteSnapshot?.selected?.dimensions
      || null
    );
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

  // All payments charge in NZD (the platform's home currency).
  // The currency picker on the quote page is for display only.
  const fmtNzd = n => '$' + (Number(n) || 0).toFixed(2);

  let totalNzd = 0;
  let quoteValidated = false;
  let stripeReady = false;

  function updatePayButton(message) {
    const payBtn = document.getElementById('payBtn');
    if (!payBtn) return;
    if (totalNzd > 0) {
      payBtn.textContent = message || 'Pay ' + fmtNzd(totalNzd);
      payBtn.disabled = !(quoteValidated && stripeReady);
      payBtn.style.opacity = payBtn.disabled ? '0.7' : '';
      payBtn.style.cursor = payBtn.disabled ? 'not-allowed' : '';
    } else {
      payBtn.textContent = 'No price set - contact the shop';
      payBtn.disabled = true;
      payBtn.style.opacity = '0.6';
      payBtn.style.cursor = 'not-allowed';
    }
  }

  function applyQuoteSnapshot(quote) {
    if (!quote?.lineItems || !quote?.selected) return;
    const selected = quote.selected;
    const lines = quote.lineItems;
    cart.shopSlug = shopSlug;
    cart.materialId = selected.material?.id || cart.materialId;
    cart.materialName = selected.material?.name || cart.materialName;
    cart.colorId = selected.colour?.id || cart.colorId || null;
    cart.colorName = selected.colour?.name || cart.colorName || '—';
    cart.colorHex = selected.colour?.hex || cart.colorHex || null;
    cart.finish = selected.finish?.id || cart.finish || null;
    cart.finishId = selected.finish?.id || cart.finishId || cart.finish || null;
    cart.finishLabel = selected.finish?.name || cart.finishLabel || '—';
    cart.finishLayerHeight = selected.finish?.layerHeight || cart.finishLayerHeight || '';
    cart.finishDescription = selected.finish?.description || cart.finishDescription || '';
    cart.dimensions = selected.dimensions || cart.dimensions || cart.file?.dimensions || null;
    if (cart.file && selected.dimensions && !cart.file.dimensions) cart.file.dimensions = selected.dimensions;
    cart.infillTierId = selected.infill?.id || cart.infillTierId || null;
    cart.infillLabel = selected.infill?.label || cart.infillLabel || null;
    cart.quantity = selected.quantity || cart.quantity || 1;
    cart.unitNzd = Number(lines.unit) || 0;
    cart.itemsNzd = Number(lines.itemSubtotal) || 0;
    cart.shippingNzd = Number(lines.shipping) || 0;
    cart.taxNzd = Number(lines.tax) || 0;
    cart.totalNzd = Number(lines.total) || 0;
    cart.totalCents = quote.totalCents;
    cart.quoteSnapshot = quote;
    if (selected.shipping) {
      cart.shipping = {
        id: selected.shipping.id,
        label: selected.shipping.label || 'Shipping',
        price: Number(selected.shipping.finalPrice ?? selected.shipping.price) || 0,
      };
    }
    try { localStorage.setItem('cart', JSON.stringify(cart)); } catch {}
  }

  function quotePayload() {
    const file = cart.file || {};
    return {
      shopSlug,
      materialId: cart.materialId,
      volumeCm3: file.volumeCm3 ?? cart.volumeCm3 ?? cart.quoteSnapshot?.selected?.volumeCm3,
      dimensions: file.dimensions ?? cart.dimensions ?? cart.quoteSnapshot?.selected?.dimensions ?? null,
      colourId: cart.colorId || null,
      colour: cart.colorName || null,
      finishId: cart.finishId || null,
      finish: cart.finishLabel || cart.finish || null,
      infillTierId: cart.infillTierId || null,
      quantity: cart.quantity,
      shippingId: cart.shipping?.id || null,
    };
  }

  async function refreshCheckoutQuote() {
    quoteValidated = false;
    updatePayButton('Validating price...');
    const res = await fetch('/api/customer/quote-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(quotePayload()),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      if (data.code === 'MODEL_TOO_LARGE' || data.code === 'MODEL_DIMENSIONS_REQUIRED') {
        redirectToMaterialSelection(data.error || 'This model is too large for the selected material.');
        const err = new Error(data.error || 'This model is too large for the selected material.');
        err.redirected = true;
        throw err;
      }
      throw new Error(data.error || 'Could not refresh checkout total.');
    }
    applyQuoteSnapshot(data);
    quoteValidated = true;
    renderCart();
    return data;
  }

  function renderCart() {
    document.getElementById('reviewFileName').textContent = cart.file?.name || 'model.stl';
    document.getElementById('reviewFileSize').textContent = formatBytes(cart.file?.size);
    const dims = cartDimensions();
    const dimsEl = document.getElementById('reviewFileDimensions');
    if (dimsEl) {
      dimsEl.textContent = formatDimensions(dims);
      dimsEl.style.display = dims ? '' : 'none';
    }
    document.getElementById('reviewMaterial').textContent = cart.materialName || '-';

    const swatch = document.getElementById('reviewColorSwatch');
    if (cart.colorHex && cart.colorHex !== '-') {
      swatch.style.background = cart.colorHex;
      swatch.style.display = '';
    } else {
      swatch.style.display = 'none';
    }
    document.getElementById('reviewColorName').textContent =
      (cart.colorName && cart.colorName !== '') ? cart.colorName : 'No colour selected';

    const finishLabel = cart.finishLabel || cart.finish || 'Standard';
    const finishDetails = [
      finishLayerText(cart.finishLayerHeight),
      cart.finishDescription || '',
    ].filter(Boolean).join(' · ');
    const finishEl = document.getElementById('reviewFinish');
    finishEl.classList.add('stack');
    finishEl.textContent = '';
    const finishPrimary = document.createElement('span');
    finishPrimary.className = 'finish-primary';
    finishPrimary.textContent = finishLabel;
    finishEl.appendChild(finishPrimary);
    if (finishDetails) {
      const finishSecondary = document.createElement('span');
      finishSecondary.className = 'finish-secondary';
      finishSecondary.textContent = finishDetails;
      finishEl.appendChild(finishSecondary);
    }

    if (cart.infillLabel) {
      document.getElementById('reviewInfill').textContent = cart.infillLabel;
      document.getElementById('reviewInfillRow').style.display = '';
    }

    const qty = Math.max(1, parseInt(cart.quantity, 10) || 1);
    document.getElementById('reviewQty').textContent = 'x ' + qty;

    const unitPriceNzd = Number(cart.unitNzd) || 0;
    const subtotalNzd  = Number(cart.itemsNzd) || (unitPriceNzd * qty);
    const shippingNzd  = Number(cart.shippingNzd) || 0;
    const taxNzd       = Number(cart.taxNzd) || 0;
    totalNzd           = Number(cart.totalNzd) || (subtotalNzd + shippingNzd + taxNzd);

    const unitRow = document.getElementById('priceUnitRow');
    if (qty > 1 && unitPriceNzd > 0) {
      document.getElementById('priceUnitLabel').textContent = `Unit price - x ${qty}`;
      document.getElementById('priceUnit').textContent      = fmtNzd(unitPriceNzd);
      unitRow.style.display = '';
    } else {
      unitRow.style.display = 'none';
    }

    document.getElementById('priceSubtotal').textContent = fmtNzd(subtotalNzd);

    const shipLbl = cart.shipping?.label;
    document.getElementById('priceShippingLabel').textContent =
      (shippingNzd > 0 && shipLbl) ? `Shipping - ${shipLbl}` : 'Shipping';
    document.getElementById('priceShipping').textContent = shippingNzd > 0 ? fmtNzd(shippingNzd) : 'Free';

    const taxRow = document.getElementById('priceTaxRow');
    if (taxNzd > 0) {
      document.getElementById('priceTax').textContent = fmtNzd(taxNzd);
      taxRow.style.display = '';
    } else {
      taxRow.style.display = 'none';
    }

    document.getElementById('priceTotal').textContent = fmtNzd(totalNzd);

    updatePayButton();
  }
  if (hasData) {
    renderCart();
    refreshCheckoutQuote().catch(err => {
      if (err.redirected) return;
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
      const r = await fetch('/api/stripe/public-key?shop=' + encodeURIComponent(shopSlug));
      const data = await r.json();
      if (!r.ok || !data.publishable_key) {
        document.getElementById('card-errors').textContent =
          data.error || 'Card payments are not configured on this server yet.';
        document.getElementById('payBtn').disabled = true;
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
      updatePayButton();

      const wrapper = document.getElementById('card-element-wrapper');
      cardEl.on('focus', () => { wrapper.style.borderColor = '#7A9E7E'; wrapper.style.boxShadow = '0 0 0 3px rgba(122,158,126,0.15)'; });
      cardEl.on('blur',  () => { wrapper.style.borderColor = 'var(--border)'; wrapper.style.boxShadow = ''; });
      cardEl.on('change', e => {
        document.getElementById('card-errors').textContent = e.error ? e.error.message : '';
      });
    } catch (e) {
      stripeReady = false;
      document.getElementById('card-errors').textContent = 'Could not initialise card form: ' + e.message;
      document.getElementById('payBtn').disabled = true;
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
          amount:          totalNzd,
          currency:        'nzd',
          customerEmail:   email,
          customerName:    name,
          orderData: {
            fileName:   cart.file?.name,
            volumeCm3:  cart.file?.volumeCm3 ?? cart.volumeCm3 ?? cart.quoteSnapshot?.selected?.volumeCm3,
            dimensions: cart.file?.dimensions ?? cart.dimensions ?? cart.quoteSnapshot?.selected?.dimensions ?? null,
            materialId: cart.materialId,
            colour:     cart.colorName,
            colourId:   cart.colorId,
            finish:     cart.finishLabel || cart.finish,
            finishId:   cart.finishId || null,
            infillTierId: cart.infillTierId,
            quantity:   cart.quantity,
            subtotal:   cart.itemsNzd,
            shipping:   cart.shippingNzd,
            shippingId: cart.shipping?.id || null,
            tax:        0,
          },
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.code === 'PRICE_CHANGED' && data.quote) {
        applyQuoteSnapshot(data.quote);
        renderCart();
        throw new Error('The price changed. Please review the updated total, then click Pay again.');
      }
      if (!res.ok || data.error) throw new Error(data.error || 'Payment failed');

      if (data.status === 'requires_action' && data.clientSecret) {
        const { error: confErr } = await stripe.confirmCardPayment(data.clientSecret);
        if (confErr) throw new Error(confErr.message);
      }

      try { localStorage.removeItem('cart'); } catch {}
      window.location.href = 'confirmation.html?order=' + encodeURIComponent(data.orderId);
    } catch (err) {
      errEl.textContent = err.message || 'Payment failed. Please try again.';
      btn.disabled = false;
      btn.textContent = origLabel;
    }
  });

  // Shop Pay
  document.getElementById('shopPayBtn').addEventListener('click', async () => {
    if (typeof ShopifyBuy === 'undefined') {
      alert('Shop Pay is loading, please try again.');
      return;
    }
    try {
      const client = ShopifyBuy.buildClient({
        domain: 'REPLACE.myshopify.com',
        storefrontAccessToken: 'REPLACE_TOKEN'
      });
      const checkout = await client.checkout.create();
      window.location.href = checkout.webUrl;
    } catch (e) {
      alert('Shop Pay is not configured yet. Please use card payment.');
    }
  });

  // Payment method toggle
  const toggleCard    = document.getElementById('toggleCard');
  const toggleShopPay = document.getElementById('toggleShopPay');
  const cardPanel     = document.getElementById('cardPanel');
  const shopPayPanel  = document.getElementById('shopPayPanel');

  function showPanel(which) {
    if (which === 'card') {
      cardPanel.style.display    = '';
      shopPayPanel.style.display = 'none';
      toggleCard.classList.add('active');
      toggleCard.setAttribute('aria-pressed', 'true');
      toggleShopPay.classList.remove('active');
      toggleShopPay.setAttribute('aria-pressed', 'false');
    } else {
      cardPanel.style.display    = 'none';
      shopPayPanel.style.display = '';
      toggleShopPay.classList.add('active');
      toggleShopPay.setAttribute('aria-pressed', 'true');
      toggleCard.classList.remove('active');
      toggleCard.setAttribute('aria-pressed', 'false');
    }
  }

  toggleCard.addEventListener('click',    () => showPanel('card'));
  toggleShopPay.addEventListener('click', () => showPanel('shoppay'));
})();

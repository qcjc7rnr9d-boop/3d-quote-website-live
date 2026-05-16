const DEFAULT_SHOPIFY_API_VERSION = '2026-04';

export const draftOrderCreateMutation = `#graphql
mutation DraftOrderCreate($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) {
    draftOrder {
      id
      name
      status
      invoiceUrl
      totalPriceSet {
        shopMoney {
          amount
          currencyCode
        }
      }
    }
    userErrors {
      field
      message
    }
  }
}`;

export function normaliseShopifyDomain(input = '') {
  let value = String(input || '').trim().toLowerCase();
  value = value.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (value && !value.endsWith('.myshopify.com') && /^[a-z0-9][a-z0-9-]*$/i.test(value)) {
    value = `${value}.myshopify.com`;
  }
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(value)) {
    throw new Error('Invalid Shopify shop domain');
  }
  return value;
}

function asMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round((n + Number.EPSILON) * 100) / 100) : 0;
}

function moneyInput(value, currencyCode = 'NZD') {
  return {
    amount: asMoney(value).toFixed(2),
    currencyCode: String(currencyCode || 'NZD').toUpperCase(),
  };
}

function asInt(value, fallback = 1) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function attr(key, value, max = 500) {
  if (value === undefined || value === null || value === '') return null;
  return { key, value: String(value).slice(0, max) };
}

function attributes(values = []) {
  return values.filter(Boolean);
}

function modelSummary(item = {}) {
  const models = Array.isArray(item.models) && item.models.length
    ? item.models
    : (Array.isArray(item.file?.models) ? item.file.models : []);
  return models.map(model => {
    const qty = asInt(model.quantity, 1);
    const bits = [model.name || 'Model'];
    if (model.volumeCm3 != null) bits.push(`${asMoney(model.volumeCm3)} cm3`);
    if (qty > 1) bits.push(`qty ${qty}`);
    return bits.join(' - ');
  }).join('; ');
}

function fileLinks(files = []) {
  return (Array.isArray(files) ? files : [])
    .map(file => [file.name, file.url].filter(Boolean).join(': '))
    .filter(Boolean)
    .join('\n');
}

function lineItemForCartItem(item = {}, index = 0, currencyCode = 'NZD') {
  const quantity = asInt(item.quantity, 1);
  const subtotal = asMoney(item.itemsNzd ?? item.quoteSnapshot?.lineItems?.itemSubtotal ?? item.totalNzd);
  const unit = subtotal / quantity;
  const material = item.materialName || item.quoteSnapshot?.selected?.material?.name || 'Custom material';
  const finishDetail = [item.finishLayerHeight, item.finishDescription].filter(Boolean).join(' - ');

  return {
    title: `3D print - ${material}`,
    quantity,
    originalUnitPriceWithCurrency: moneyInput(unit, currencyCode),
    requiresShipping: true,
    taxable: true,
    sku: '3D-QUOTE',
    customAttributes: attributes([
      attr('quote_item_id', item.id || `item-${index + 1}`),
      attr('material', material),
      attr('colour', item.colorName || item.colour || null),
      attr('finish', item.finishLabel || item.finish || null),
      attr('finish_detail', finishDetail),
      attr('infill', item.infillLabel || null),
      attr('files', modelSummary(item), 1000),
    ]),
  };
}

export function buildShopifyDraftOrderInput({
  cart = {},
  customer = {},
  shop = {},
  quoteSession = {},
} = {}) {
  const currencyCode = String(cart.currency || 'NZD').toUpperCase();
  const items = Array.isArray(cart.items) ? cart.items : [];
  const shipping = items.reduce((sum, item) => sum + asMoney(item.shippingNzd ?? item.quoteSnapshot?.lineItems?.shipping), 0);
  const uploadedFiles = fileLinks(quoteSession.files || []);
  const customerName = String(customer.name || '').trim();

  const input = {
    email: String(customer.email || '').trim().toLowerCase() || undefined,
    note: [
      `3D quote from ${shop.name || shop.slug || 'Trennen'}.`,
      quoteSession.token ? `Quote session: ${quoteSession.token}` : null,
      uploadedFiles ? `Uploaded files:\n${uploadedFiles}` : null,
    ].filter(Boolean).join('\n\n'),
    tags: ['trennen-3d-quote', shop.slug || 'shopify'].filter(Boolean),
    taxExempt: false,
    lineItems: items.map((item, index) => lineItemForCartItem(item, index, currencyCode)),
    customAttributes: attributes([
      attr('source', 'trennen-3d-quote'),
      attr('shop_slug', shop.slug || null),
      attr('customer_name', customerName || null),
      attr('trennen_quote_session', quoteSession.token || null),
      attr('uploaded_files', uploadedFiles, 1000),
    ]),
  };

  if (shipping > 0) {
    input.shippingLine = {
      title: 'Quoted shipping',
      priceWithCurrency: moneyInput(shipping, currencyCode),
    };
  }

  return input;
}

export async function shopifyAdminGraphql({ shopDomain, accessToken, query, variables, apiVersion = process.env.SHOPIFY_API_VERSION || DEFAULT_SHOPIFY_API_VERSION }) {
  const domain = normaliseShopifyDomain(shopDomain);
  if (!accessToken) throw new Error('Missing Shopify access token');
  const res = await fetch(`https://${domain}/admin/api/${apiVersion}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.errors?.[0]?.message || `Shopify GraphQL request failed with ${res.status}`);
  }
  if (Array.isArray(data.errors) && data.errors.length) {
    throw new Error(data.errors.map(error => error.message).join('; '));
  }
  return data;
}

export function parseDraftOrderCreateResponse(data = {}) {
  const payload = data?.data?.draftOrderCreate || data?.draftOrderCreate || {};
  const userErrors = payload.userErrors || [];
  if (userErrors.length) {
    throw new Error(userErrors.map(error => error.message).join('; '));
  }
  if (!payload.draftOrder?.id) throw new Error('Shopify did not return a draft order');
  return payload.draftOrder;
}

export async function createShopifyDraftOrder({ shopDomain, accessToken, input }) {
  const data = await shopifyAdminGraphql({
    shopDomain,
    accessToken,
    query: draftOrderCreateMutation,
    variables: { input },
  });
  return parseDraftOrderCreateResponse(data);
}

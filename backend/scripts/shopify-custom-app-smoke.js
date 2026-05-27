import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildShopifyDraftOrderInput,
  draftOrderCreateMutation,
  normaliseShopifyDomain,
} from '../lib/shopify-draft-order.js';
import {
  signShopifyAppProxyParams,
  verifyShopifyAppProxySignature,
  verifyShopifyWebhookHmac,
} from '../lib/shopify-auth.js';
import { ensureShopifyTables } from '../lib/shopify-installation.js';
import { db } from '../middleware/auth.js';
import shopifyRouter, {
  shopifyEmbeddedAdminPage,
  shopifyProxyRouter,
  shopifyWebhookHandler,
} from '../routes/shopify.js';

const secret = 'shpss_test_secret';

{
  const params = {
    shop: 'demo-printer.myshopify.com',
    path_prefix: '/apps/3d-quote',
    timestamp: '1710000000',
    logged_in_customer_id: '123',
  };
  const signature = signShopifyAppProxyParams(params, secret);

  assert.equal(
    verifyShopifyAppProxySignature({ ...params, signature }, secret),
    true,
    'valid app proxy signature should verify',
  );
  assert.equal(
    verifyShopifyAppProxySignature({ ...params, signature: 'bad' }, secret),
    false,
    'invalid app proxy signature should be rejected',
  );
  assert.equal(
    verifyShopifyAppProxySignature({ timestamp: params.timestamp, shop: params.shop, path_prefix: params.path_prefix, logged_in_customer_id: params.logged_in_customer_id, signature }, secret),
    true,
    'proxy signature verification should ignore query parameter order',
  );
}

{
  const body = Buffer.from(JSON.stringify({ id: 123, topic: 'orders/paid' }));
  const hmac = createHmac('sha256', secret).update(body).digest('base64');
  assert.equal(verifyShopifyWebhookHmac(body, hmac, secret), true, 'valid webhook HMAC should verify');
  assert.equal(verifyShopifyWebhookHmac(body, 'bad', secret), false, 'invalid webhook HMAC should be rejected');
}

{
  const cart = {
    shopSlug: 'trennen',
    currency: 'NZD',
    items: [
      {
        id: 'group-a',
        materialName: 'PETG',
        colorName: 'Black',
        finishLabel: 'Fine',
        finishLayerHeight: '0.12 mm',
        infillLabel: 'Strong 40%',
        quantity: 2,
        itemsNzd: 24.5,
        shippingNzd: 8,
        taxNzd: 4.88,
        totalNzd: 37.38,
        file: {
          name: 'Bracket group',
          models: [
            { name: 'Bracket.stl', size: 2048, volumeCm3: 6.25, quantity: 2, dimensions: { xMm: 30, yMm: 20, zMm: 10 } },
          ],
        },
        models: [
          { name: 'Bracket.stl', size: 2048, volumeCm3: 6.25, quantity: 2, dimensions: { xMm: 30, yMm: 20, zMm: 10 } },
        ],
        quoteSnapshot: {
          lineItems: { itemSubtotal: 24.5, shipping: 8, tax: 4.88, total: 37.38 },
          selected: { material: { name: 'PETG' } },
        },
      },
    ],
  };

  const input = buildShopifyDraftOrderInput({
    cart,
    customer: { email: 'customer@example.test', name: 'Ada Lovelace' },
    shop: { name: 'Trennen', slug: 'trennen' },
    quoteSession: { token: 'quote_session_token', files: [{ name: 'Bracket.stl', url: 'https://files.example.test/bracket.stl' }] },
  });

  assert.equal(input.email, 'customer@example.test');
  assert.equal(input.lineItems.length, 1, 'one material group should become one custom Shopify line item');
  assert.equal(input.lineItems[0].title, '3D print - PETG');
  assert.deepEqual(input.lineItems[0].originalUnitPriceWithCurrency, { amount: '12.25', currencyCode: 'NZD' });
  assert.equal(input.lineItems[0].quantity, 2);
  assert.equal(input.lineItems[0].requiresShipping, true);
  assert.equal(input.shippingLine.title, 'Quoted shipping');
  assert.deepEqual(input.shippingLine.priceWithCurrency, { amount: '8.00', currencyCode: 'NZD' });
  assert.ok(input.customAttributes.some(attr => attr.key === 'trennen_quote_session' && attr.value === 'quote_session_token'));
  assert.ok(input.lineItems[0].customAttributes.some(attr => attr.key === 'files' && attr.value.includes('Bracket.stl')));
  assert.ok(draftOrderCreateMutation.includes('draftOrderCreate'), 'GraphQL mutation should create a draft order');
  assert.ok(draftOrderCreateMutation.includes('invoiceUrl'), 'GraphQL mutation should request the checkout invoice URL');
}

{
  assert.equal(normaliseShopifyDomain('HTTPS://Demo-Printer.MyShopify.com/admin'), 'demo-printer.myshopify.com');
  assert.equal(normaliseShopifyDomain('demo-printer'), 'demo-printer.myshopify.com');
  assert.throws(() => normaliseShopifyDomain('not shopify.example.com'), /Invalid Shopify shop domain/);
}

{
  assert.equal(typeof shopifyRouter, 'function', 'Shopify API router should be exported');
  assert.equal(typeof shopifyProxyRouter, 'function', 'Shopify app-proxy router should be exported');
  assert.equal(typeof shopifyEmbeddedAdminPage, 'function', 'embedded Shopify admin page handler should be exported');
  assert.equal(typeof shopifyWebhookHandler, 'function', 'Shopify webhook handler should be exported');
}

{
  const server = readFileSync(resolve('server.js'), 'utf8');
  assert.ok(server.includes('/api/shopify/webhooks'), 'server should mount the raw Shopify webhook endpoint before JSON parsing');
  assert.ok(server.includes('/api/shopify'), 'server should mount Shopify API routes');
  assert.ok(server.includes('/apps/3d-quote'), 'server should mount the Shopify app proxy route');
  assert.ok(server.includes('shopifyEmbeddedAdminPage'), 'server should mount the embedded Shopify admin page');
}

{
  const checkoutJs = readFileSync(resolve('..', 'assets', 'checkout.js'), 'utf8');
  assert.ok(checkoutJs.includes('/api/shopify/draft-order'), 'checkout should create Shopify draft orders in Shopify mode');
  assert.ok(checkoutJs.includes('checkoutProvider'), 'checkout should detect the selected checkout provider');
  const quoteHtml = readFileSync(resolve('..', 'quote.html'), 'utf8');
  assert.ok(quoteHtml.includes('CHECKOUT_PROVIDER') && quoteHtml.includes("checkoutUrl.searchParams.set('checkout', 'shopify')"), 'quote flow should preserve Shopify checkout mode');
}

{
  const appConfig = readFileSync(resolve('..', 'shopify.app.toml'), 'utf8');
  assert.ok(appConfig.includes('write_draft_orders'), 'Shopify app config should request draft order write scope');
  assert.ok(appConfig.includes('write_app_proxy'), 'Shopify app config should request app proxy scope');
  assert.ok(appConfig.includes('subpath = "3d-quote"'), 'Shopify app config should configure /apps/3d-quote proxy');
  const block = readFileSync(resolve('..', 'extensions', 'instant-3d-quote', 'blocks', 'instant-3d-quote.liquid'), 'utf8');
  assert.ok(block.includes('/apps/3d-quote'), 'theme app block should point at the app proxy route');
}

{
  ensureShopifyTables(db);
  const shopColumns = db.prepare('PRAGMA table_info(shops)').all().map(row => row.name);
  for (const column of ['shopify_shop_domain', 'shopify_installed_at', 'shopify_uninstalled_at']) {
    assert.ok(shopColumns.includes(column), `shops table should include ${column}`);
  }
  const quoteColumns = db.prepare('PRAGMA table_info(shopify_quote_sessions)').all().map(row => row.name);
  for (const column of ['token', 'shop_id', 'shopify_shop_domain', 'cart_snapshot', 'shopify_draft_order_id', 'shopify_invoice_url']) {
    assert.ok(quoteColumns.includes(column), `shopify_quote_sessions table should include ${column}`);
  }
}

console.log('Shopify custom app smoke checks passed.');

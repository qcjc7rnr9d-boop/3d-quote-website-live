import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const checkoutHtml = readFileSync(resolve(root, 'checkout.html'), 'utf8');
const checkoutJs = readFileSync(resolve(root, 'assets/checkout.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const combinedCheckout = `${checkoutHtml}\n${checkoutJs}`;
const forbidden = [
  'Shop Pay',
  'shopPay',
  'toggleShopPay',
  'sdks.shopifycdn.com',
  'checkout.shopify.com',
  '/api/shopify',
  "checkoutProvider === 'shopify'",
  'Shopify checkout',
  'buy-button-storefront',
];

for (const term of forbidden) {
  assert(!combinedCheckout.includes(term), `Checkout still references ${term}`);
}

assert(
  checkoutHtml.includes('id="paymentSetupError"'),
  'Checkout is missing the prominent Stripe setup error container'
);
assert(
  checkoutJs.includes('paymentSetupError'),
  'Checkout script does not control the Stripe setup error container'
);
assert(
  checkoutJs.includes('/api/stripe/public-key?shop='),
  'Checkout script must fetch Stripe readiness from the backend'
);
assert(
  checkoutJs.includes('/api/stripe/create-payment-intent'),
  'Checkout script must process payments through Stripe PaymentIntents'
);
assert(
  !checkoutJs.includes('shopify_shop') && !checkoutJs.includes('shopifyShopDomain'),
  'Checkout script should not preserve Shopify checkout state in the lean release'
);
assert(
  checkoutHtml.includes('cart-item-options') && checkoutHtml.includes('cart-item-money'),
  'Checkout is missing the richer grouped order-review styles'
);
assert(
  checkoutHtml.includes('id="reviewValidationError"'),
  'Checkout is missing the order-review validation error container'
);
assert(
  checkoutJs.includes('Material group') && checkoutJs.includes('Group total') && checkoutJs.includes('modelVolumeText'),
  'Checkout script must render full material groups with file and total detail'
);
assert(
  checkoutJs.includes('showReviewValidationError'),
  'Checkout script must surface quote validation failures in the order review'
);

console.log('Stripe checkout fallback smoke checks passed.');

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const checkoutHtml = readFileSync(resolve(root, 'checkout.html'), 'utf8');
const checkoutJs = readFileSync(resolve(root, 'assets/checkout.js'), 'utf8');
const quoteHtml = readFileSync(resolve(root, 'quote.html'), 'utf8');
const adminPaymentsHtml = readFileSync(resolve(root, 'admin/payments.html'), 'utf8');
const stripeRoutes = readFileSync(resolve(root, 'backend/routes/stripe.js'), 'utf8');

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
  'buy-button-storefront',
  'checkoutProvider',
  'continueWithShopifyCheckout',
  '/api/shopify/draft-order',
  'Shopify checkout',
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
  !quoteHtml.includes("checkoutUrl.searchParams.set('checkout', 'shopify')"),
  'Quote flow must not preserve or offer a non-Stripe checkout provider'
);
assert(
  stripeRoutes.includes("router.put('/keys'") && stripeRoutes.includes('403') && stripeRoutes.includes('Stripe keys are managed'),
  'Shop-admin Stripe key compatibility route must keep rejecting key updates'
);
assert(
  !/master Stripe keys|publishable key|secret key|API key/i.test(adminPaymentsHtml),
  'Shop payments page must not ask store owners for Stripe API key details'
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

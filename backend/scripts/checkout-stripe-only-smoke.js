import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const checkoutHtml = readFileSync(resolve(root, 'checkout.html'), 'utf8');
const checkoutJs = readFileSync(resolve(root, 'assets/checkout.js'), 'utf8');
const stripeRoute = readFileSync(resolve(root, 'backend/routes/stripe.js'), 'utf8');
const schemaSql = readFileSync(resolve(root, 'backend/db/schema.sql'), 'utf8');

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
  'Bank transfer',
  'bankTransferBtn',
  'bankTransferPanel',
  'paymentMethodChoice',
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
  checkoutHtml.includes('Payment processing fee'),
  'Checkout must clearly show the payment processing fee row'
);
assert(
  checkoutJs.includes('/api/billing/public-checkout-settings') && !checkoutJs.includes('/api/stripe/create-bank-transfer-order'),
  'Checkout script must load payment fee mode without creating offline checkout orders'
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
  checkoutHtml.includes('Review your order') && checkoutHtml.includes('Open a material group to review files and item pricing.'),
  'Checkout review copy must guide customers through the compact final page'
);
assert(
  checkoutHtml.includes('checkout-payment-card') && checkoutHtml.includes('mobileCheckoutBar'),
  'Checkout must keep payment actions reachable with sticky desktop/mobile summary surfaces'
);
assert(
  checkoutHtml.includes('legal-certification-summary') && checkoutHtml.includes('<details') && checkoutHtml.includes('prohibited upload details'),
  'Checkout certification must use compact checkbox copy with a disclosure for the full legal wording'
);
assert(
  checkoutHtml.includes('id="checkoutShippingBlock"') && checkoutHtml.includes('id="checkoutShippingOptions"'),
  'Checkout is missing the cart-level shipping selector'
);
assert(
  checkoutHtml.includes('id="reviewValidationError"'),
  'Checkout is missing the order-review validation error container'
);
assert(
  checkoutHtml.includes('id="restrictedItemsCertification"'),
  'Checkout is missing the restricted-items certification checkbox'
);
assert(
  checkoutHtml.includes('I certify this order does not include restricted or unlawful items') && checkoutHtml.includes('I certify that the files, notes, and order I submit do not include'),
  'Checkout is missing the compact and full restricted-items certification wording'
);
assert(
  checkoutJs.includes('Material group') && checkoutJs.includes('Group total') && checkoutJs.includes('modelVolumeText'),
  'Checkout script must render full material groups with file and total detail'
);
assert(
  checkoutJs.includes('cart-item-toggle') && checkoutJs.includes('aria-expanded') && checkoutJs.includes('hidden') && checkoutJs.includes('data-cart-item-panel'),
  'Checkout script must render material groups as accessible accordion sections'
);
assert(
  checkoutJs.includes('index === 0') && checkoutJs.includes('fileCountText'),
  'Checkout accordion must open the first group by default and summarize file counts'
);
assert(
  checkoutJs.includes('/api/customer/cart-preview') && checkoutJs.includes('cart.shippingOptions'),
  'Checkout script must price the full cart and render one order-level shipping selector'
);
assert(
  checkoutJs.includes('showReviewValidationError'),
  'Checkout script must surface quote validation failures in the order review'
);
assert(
  checkoutJs.includes('RESTRICTED_ITEMS_CERTIFICATION_VERSION') && checkoutJs.includes('restricted-items-v1-2026-05-24'),
  'Checkout script must use a versioned restricted-items certification'
);
assert(
  checkoutJs.includes('restrictedItemsCertification') && checkoutJs.includes('Please certify that your order does not include restricted or unlawful items.'),
  'Checkout script must block payment and send the restricted-items certification payload'
);

assert(
  stripeRoute.includes('/create-bank-transfer-order') && stripeRoute.includes('BANK_TRANSFER_DISABLED'),
  'Legacy bank-transfer route must remain as a rejecting compatibility endpoint'
);
assert(
  stripeRoute.includes('RESTRICTED_ITEMS_CERTIFICATION_VERSION') && stripeRoute.includes('RESTRICTED_ITEMS_CERTIFICATION_REQUIRED'),
  'Stripe payment route must reject missing restricted-items certification'
);
assert(
  stripeRoute.includes('restrictedItemsCertification') && stripeRoute.includes('restricted_items_certification_version'),
  'Stripe payment route must persist the restricted-items certification'
);
assert(
  schemaSql.includes('restricted_items_certification_version') && schemaSql.includes('restricted_items_certified_at'),
  'Orders schema must store restricted-items certification evidence'
);

console.log('Stripe checkout fallback smoke checks passed.');

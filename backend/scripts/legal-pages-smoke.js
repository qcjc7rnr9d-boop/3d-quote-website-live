import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

const termsPath = resolve(root, 'terms.html');
const privacyPath = resolve(root, 'privacy.html');

assert(existsSync(termsPath), 'terms.html must exist at the public root');
assert(existsSync(privacyPath), 'privacy.html must exist at the public root');

const termsHtml = read('terms.html');
const privacyHtml = read('privacy.html');
const catalogHtml = read('catalog.html');
const checkoutHtml = read('checkout.html');
const indexHtml = read('index.html');
const pricingHtml = read('pricing.html');
const quoteHtml = read('quote.html');
const customerDashboardHtml = read('customer/dashboard.html');
const adminAccountHtml = read('admin/account.html');
const serverJs = read('backend/server.js');
const processorsPath = resolve(root, 'backend/lib/compliance/processors.json');

for (const [name, html] of [['terms.html', termsHtml], ['privacy.html', privacyHtml]]) {
  assert(html.includes('assets/brand.js'), `${name} must load the shared brand applier`);
  assert(html.includes('data-brand="name"') || html.includes('footer-wordmark'), `${name} must support dynamic shop branding`);
  assert(!html.includes('Draft placeholder'), `${name} must not publish draft placeholder legal copy`);
  assert(!html.includes('starter copy for demos'), `${name} must not publish demo placeholder legal copy`);
  assert(html.includes('catalog.html?shop='), `${name} must link back to Materials with the shop slug`);
  assert(html.includes('index.html?shop=') && html.includes('#uploadZone'), `${name} must link back to the upload-first quote start with the shop slug`);
  assert(html.includes('customer/dashboard.html?shop='), `${name} must link to customer portal tabs with the shop slug`);
}

assert(serverJs.includes("'/terms.html'"), 'server public root pages must include /terms.html');
assert(serverJs.includes("'/privacy.html'"), 'server public root pages must include /privacy.html');
assert(
  termsHtml.includes('Prohibited uploads and customer responsibility'),
  'Terms must include prohibited uploads and customer responsibility wording'
);
assert(
  termsHtml.includes('Trennen is the software platform provider') && termsHtml.includes('participating store'),
  'Terms must explain Trennen/store responsibility split'
);
assert(
  termsHtml.includes('customer-facing products, pricing, fulfilment') &&
    termsHtml.includes('software platform provider'),
  'Terms must explain store fulfilment responsibility and Trennen platform responsibility'
);
assert(
  termsHtml.includes('review, remove, refuse, suspend, cancel') &&
    termsHtml.includes('law-enforcement'),
  'Terms must include review, refusal, takedown, evidence, and authority disclosure wording'
);
assert(
  termsHtml.includes('Consumer Guarantees Act 1993') &&
    termsHtml.includes('Fair Trading Act 1986') &&
    termsHtml.includes('non-excludable rights under New Zealand law'),
  'Terms must include NZ consumer-law saving language'
);
assert(
  termsHtml.includes('indemnify Trennen') &&
    termsHtml.includes('false certification') &&
    termsHtml.includes('unlawful upload'),
  'Terms must include indemnity and non-excludable NZ rights language'
);
assert(
  termsHtml.includes('backup or archived systems') &&
    termsHtml.includes('Privacy Policy'),
  'Terms must explain retention, deletion, backups, and the privacy policy'
);
assert(
  termsHtml.includes('3D printed items ordered through this site are custom-made from customer-supplied files') &&
    termsHtml.includes('does not have to provide a refund or exchange because a customer changes their mind') &&
    termsHtml.includes('repair, reprint, replacement, refund, partial refund, or compensation') &&
    termsHtml.includes('Nothing in this refund policy excludes'),
  'Terms must include the fuller custom-order cancellation and refund policy'
);
assert(
  privacyHtml.includes('Who is involved') &&
    privacyHtml.includes('Trennen provides and supports the software platform'),
  'Privacy page must explain the store and Trennen roles'
);
assert(
  privacyHtml.includes('Service providers and overseas processing') &&
    privacyHtml.includes('comparable safeguards') &&
    privacyHtml.includes('Stripe') &&
    privacyHtml.includes('email-delivery'),
  'Privacy page must name key processors and offshore/comparable safeguards wording'
);
assert(
  privacyHtml.includes('Cookies, sessions, and local browser storage') &&
    privacyHtml.includes('localStorage') &&
    privacyHtml.includes('IndexedDB'),
  'Privacy page must disclose sessions, localStorage, and IndexedDB browser storage'
);
assert(
  privacyHtml.includes('Privacy breaches') &&
    privacyHtml.includes('Office of the Privacy Commissioner'),
  'Privacy page must describe NZ privacy breach handling'
);
assert(
  privacyHtml.includes('access to, correction of, export of, or deletion') &&
    privacyHtml.includes('privacy@trennen.co.nz'),
  'Privacy page must publish access/correction/export/deletion rights and Trennen privacy contact'
);
assert(
  checkoutHtml.includes('terms.html?shop=') && checkoutHtml.includes('restrictedItemsCertification'),
  'Checkout must link the restricted-items certification to the terms page'
);
assert(
  checkoutHtml.includes('Cart and quote details may be stored in your browser') &&
    checkoutHtml.includes('privacy.html?shop='),
  'Checkout must include a browser storage privacy notice'
);
assert(
  pricingHtml.includes('terms.html?shop=mahi3d#cancellations') &&
    pricingHtml.includes('terms.html?shop=mahi3d#prohibited-uploads') &&
    pricingHtml.includes('terms.html?shop=mahi3d') &&
    pricingHtml.includes('privacy.html?shop=mahi3d'),
  'Pricing page must link to refund policy, prohibited uploads, terms, and privacy policy'
);
assert(
  indexHtml.includes('terms.html?shop=mahi3d#cancellations') &&
    indexHtml.includes('Refund policy') &&
    indexHtml.includes('data-pv-refund'),
  'Index footer must include a dynamic refund policy link'
);
assert(
  quoteHtml.includes('By uploading a file, you confirm you have the right to use it') &&
    quoteHtml.includes('restricted content'),
  'Quote/upload page must include upload rights and restricted-content notice'
);
assert(
  customerDashboardHtml.includes('Export my data') &&
    customerDashboardHtml.includes('Delete my account') &&
    customerDashboardHtml.includes('Clear saved browser data'),
  'Customer dashboard must expose privacy export, deletion, and browser data controls'
);
assert(
  adminAccountHtml.includes('Merchant legal agreement') &&
    adminAccountHtml.includes('/api/auth/legal/accept'),
  'Admin account page must expose merchant legal agreement acceptance'
);
assert(existsSync(processorsPath), 'Processor register JSON must exist');
const processors = JSON.parse(readFileSync(processorsPath, 'utf8'));
for (const id of ['stripe', 'email_delivery', 'aws_lightsail', 'shopify_optional']) {
  assert(processors.processors.some(processor => processor.id === id), `Processor register must include ${id}`);
}

for (const [name, html] of [['catalog.html', catalogHtml]]) {
  assert(html.includes('terms.html?shop='), `${name} footer must link to terms.html with shop slug`);
  assert(html.includes('privacy.html?shop='), `${name} footer must link to privacy.html with shop slug`);
  assert(!html.includes('customer/dashboard.html?shop=trennen#help" data-pv-tab="help">Terms'), `${name} must not route Terms to the Help tab`);
  assert(!html.includes('customer/dashboard.html?shop=trennen#help" data-pv-tab="help">Privacy'), `${name} must not route Privacy to the Help tab`);
  assert(!html.includes('customer/dashboard.html?shop=trennen#help">Terms'), `${name} must not route Terms to the Help tab`);
  assert(!html.includes('customer/dashboard.html?shop=trennen#help">Privacy'), `${name} must not route Privacy to the Help tab`);
}

console.log('Legal page smoke checks passed.');

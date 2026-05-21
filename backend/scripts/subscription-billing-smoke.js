import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

process.env.STRIPE_BILLING_STARTER_PRICE_ID = 'price_starter_smoke';
process.env.STRIPE_BILLING_GROWTH_PRICE_ID = 'price_growth_smoke';
process.env.STRIPE_BILLING_SCALE_PRICE_ID = 'price_scale_smoke';

const {
  billingStatusIsActive,
  createBillingPortalSession,
  createBusinessBillingSession,
  getSubscriptionSummary,
  reconcileShopBilling,
  updateShopBillingFromCheckoutSession,
  updateShopBillingFromSubscription,
} = await import('../lib/billing.js');
const { seedBillingPlans } = await import('../lib/billing-service.js');

function isoDaysFromNow(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function unix(iso) {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function insertShop(db, overrides = {}) {
  const slug = overrides.slug || `sub-smoke-${Math.random().toString(36).slice(2, 10)}`;
  const result = db.prepare(`
    INSERT INTO shops (
      name, slug, email, password_hash, plan, is_temp_password,
      billing_status, billing_current_period_end
    )
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    overrides.name || 'Subscription Smoke',
    slug,
    overrides.email || `${slug}@example.test`,
    'not-a-real-hash',
    overrides.plan || 'starter',
    overrides.billing_status || 'trialing',
    overrides.billing_current_period_end || isoDaysFromNow(7),
  );
  db.prepare(`
    INSERT INTO merchant_subscriptions (
      shop_id, plan_id, status, trial_start, trial_end,
      current_period_start, current_period_end, stripe_subscription_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    result.lastInsertRowid,
    overrides.plan || 'starter',
    overrides.billing_status || 'trialing',
    overrides.trial_start || isoDaysFromNow(-7),
    overrides.trial_end || isoDaysFromNow(7),
    overrides.current_period_start || isoDaysFromNow(-7),
    overrides.current_period_end || isoDaysFromNow(7),
    overrides.billing_subscription_id || null,
  );
  return db.prepare('SELECT * FROM shops WHERE id = ?').get(result.lastInsertRowid);
}

const schema = readFileSync('db/schema.sql', 'utf8');
assert.match(schema, /billing_cancel_at_period_end/, 'shops schema should store cancellation-at-period-end');
assert.match(schema, /billing_cancel_at\b/, 'shops schema should store cancellation timestamp');
assert.match(schema, /cancel_at_period_end/, 'merchant subscriptions should store cancellation-at-period-end');
assert.match(schema, /\bcancel_at\b/, 'merchant subscriptions should store cancellation timestamp');

const envExample = readFileSync('.env.example', 'utf8');
assert.ok(envExample.includes('STRIPE_BILLING_STARTER_PRICE_ID'), '.env.example should document Starter Stripe Billing price');
assert.ok(envExample.includes('STRIPE_BILLING_GROWTH_PRICE_ID'), '.env.example should document Growth Stripe Billing price');
assert.ok(envExample.includes('STRIPE_BILLING_SCALE_PRICE_ID'), '.env.example should document Scale Stripe Billing price');

const setupHtml = readFileSync('../admin/setup.html', 'utf8');
assert.ok(setupHtml.includes('Activate Trennen subscription'), 'Setup should show subscription activation near the top');
assert.ok(setupHtml.includes('/api/billing/subscription'), 'Setup should load owner subscription status');
assert.ok(setupHtml.includes('/api/billing/subscription-checkout'), 'Setup should start Stripe-hosted subscription checkout');

const paymentsHtml = readFileSync('../admin/payments.html', 'utf8');
assert.ok(paymentsHtml.includes('Trennen subscription'), 'Payments page should include a Trennen subscription card');
assert.ok(paymentsHtml.includes('/api/billing/subscription-checkout'), 'Payments page should start Stripe-hosted subscription checkout');
assert.ok(paymentsHtml.includes('/api/billing/customer-portal'), 'Payments page should open Stripe Billing Portal');
assert.ok(/Stripe hosts|Stripe-hosted/i.test(paymentsHtml), 'Payments page should say billing is hosted by Stripe');
assert.ok(!/<input[^>]+(?:card|payment)/i.test(paymentsHtml), 'Admin payments page should not collect card details');

const db = new DatabaseSync(':memory:');
db.exec(schema);
seedBillingPlans(db, { overwriteExisting: true });

const tableInfo = table => db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
assert.ok(tableInfo('shops').includes('billing_cancel_at_period_end'), 'shops table should include billing_cancel_at_period_end');
assert.ok(tableInfo('shops').includes('billing_cancel_at'), 'shops table should include billing_cancel_at');
assert.ok(tableInfo('merchant_subscriptions').includes('cancel_at_period_end'), 'merchant_subscriptions table should include cancel_at_period_end');
assert.ok(tableInfo('merchant_subscriptions').includes('cancel_at'), 'merchant_subscriptions table should include cancel_at');

const trialShop = insertShop(db);
let summary = getSubscriptionSummary(db, trialShop.id);
assert.equal(summary.plan_id, 'starter', 'Subscription summary should include the current plan');
assert.equal(summary.billing_status, 'trialing', 'Paid self-serve signup should begin as trialing');
assert.equal(summary.billing_activation_required, false, 'Active no-card trial should not require billing activation yet');
assert.equal(summary.can_start_checkout, true, 'Paid plans should be able to start Stripe subscription checkout');
assert.equal(summary.can_manage_subscription, false, 'Shop without Stripe customer cannot manage a subscription yet');

let checkoutPayload = null;
const checkoutStripe = {
  checkout: {
    sessions: {
      create: async payload => {
        checkoutPayload = payload;
        return { id: 'cs_sub_smoke', status: 'open', url: 'https://checkout.stripe.com/c/sub_smoke' };
      },
    },
  },
};
const checkoutResult = await createBusinessBillingSession({
  db,
  stripe: checkoutStripe,
  shop: trialShop,
  baseUrl: 'https://app.trennen.co.nz',
});
assert.equal(checkoutResult.billing_checkout_url, 'https://checkout.stripe.com/c/sub_smoke');
assert.equal(checkoutPayload.mode, 'subscription');
assert.equal(checkoutPayload.payment_method_collection, 'always', 'Stripe Checkout should collect payment details securely on Stripe');
assert.equal(checkoutPayload.line_items[0].price, 'price_starter_smoke');
assert.equal(checkoutPayload.metadata.shopId, String(trialShop.id));
assert.equal(checkoutPayload.subscription_data.metadata.shopSlug, trialShop.slug);
assert.equal(checkoutPayload.subscription_data.trial_end, unix(summary.trial_end), 'Checkout should preserve remaining no-card trial time');
assert.match(checkoutPayload.success_url, /\/admin\/payments\.html\?billing=success/, 'Owner checkout success should return to admin payments');
assert.match(checkoutPayload.cancel_url, /\/admin\/payments\.html\?billing=cancelled/, 'Owner checkout cancellation should return to admin payments');

const completedSession = {
  id: 'cs_sub_smoke',
  status: 'complete',
  customer: 'cus_sub_smoke',
  subscription: 'sub_smoke',
  client_reference_id: String(trialShop.id),
  metadata: { shopId: String(trialShop.id), shopSlug: trialShop.slug, plan: 'starter' },
};
assert.equal(updateShopBillingFromCheckoutSession(db, completedSession), true, 'Checkout session webhook should link customer and subscription');
let linked = db.prepare('SELECT * FROM shops WHERE id = ?').get(trialShop.id);
assert.equal(linked.billing_customer_id, 'cus_sub_smoke');
assert.equal(linked.billing_subscription_id, 'sub_smoke');

const currentPeriodEnd = isoDaysFromNow(30);
assert.equal(updateShopBillingFromSubscription(db, {
  id: 'sub_smoke',
  customer: 'cus_sub_smoke',
  status: 'active',
  current_period_start: unix(isoDaysFromNow(0)),
  current_period_end: unix(currentPeriodEnd),
  cancel_at_period_end: true,
  cancel_at: unix(currentPeriodEnd),
  metadata: { shopId: String(trialShop.id), plan: 'starter' },
  items: { data: [{ price: { id: 'price_starter_smoke' } }] },
}), true, 'Subscription webhook should update billing state');
linked = db.prepare('SELECT * FROM shops WHERE id = ?').get(trialShop.id);
assert.equal(linked.billing_status, 'active');
assert.equal(linked.billing_cancel_at_period_end, 1);
assert.equal(linked.billing_cancel_at, new Date(unix(currentPeriodEnd) * 1000).toISOString());
assert.equal(billingStatusIsActive(linked.billing_status, linked.plan), true, 'Cancellation at period end should remain active until Stripe ends it');

const portalMissingShop = insertShop(db, { slug: 'portal-missing-customer' });
await assert.rejects(
  () => createBillingPortalSession({
    db,
    stripe: { billingPortal: { sessions: { create: async () => ({}) } } },
    shop: portalMissingShop,
    baseUrl: 'https://app.trennen.co.nz',
  }),
  err => err.code === 'BILLING_CUSTOMER_REQUIRED',
  'Billing Portal should require an existing Stripe customer',
);

let portalPayload = null;
const portalStripe = {
  billingPortal: {
    sessions: {
      create: async payload => {
        portalPayload = payload;
        return { url: 'https://billing.stripe.com/p/session_smoke' };
      },
    },
  },
};
const portalResult = await createBillingPortalSession({
  db,
  stripe: portalStripe,
  shop: linked,
  baseUrl: 'https://app.trennen.co.nz',
});
assert.equal(portalResult.billing_portal_url, 'https://billing.stripe.com/p/session_smoke');
assert.equal(portalPayload.customer, 'cus_sub_smoke');
assert.match(portalPayload.return_url, /\/admin\/payments\.html\?billing=portal_return/);

const brokenPortalStripe = {
  billingPortal: {
    sessions: {
      create: async () => {
        const err = new Error('No configuration provided');
        err.code = 'billing_portal_no_default_configuration';
        throw err;
      },
    },
  },
};
await assert.rejects(
  () => createBillingPortalSession({ db, stripe: brokenPortalStripe, shop: linked, baseUrl: 'https://app.trennen.co.nz' }),
  err => err.code === 'BILLING_PORTAL_NOT_CONFIGURED',
  'Billing Portal setup errors should be friendly and actionable',
);

const expiredShop = insertShop(db, {
  slug: 'expired-trial-smoke',
  billing_status: 'trialing',
  trial_start: isoDaysFromNow(-20),
  trial_end: isoDaysFromNow(-1),
  current_period_start: isoDaysFromNow(-20),
  current_period_end: isoDaysFromNow(-1),
  billing_current_period_end: isoDaysFromNow(-1),
});
reconcileShopBilling(db, expiredShop.id, new Date());
const expiredSummary = getSubscriptionSummary(db, expiredShop.id);
assert.equal(expiredSummary.billing_status, 'pending_subscription', 'Expired no-card trial should become pending_subscription');
assert.equal(expiredSummary.billing_activation_required, true, 'Expired no-card trial should require billing activation');
assert.equal(expiredSummary.billing_active, false, 'Expired no-card trial should not remain active');

assert.equal(updateShopBillingFromSubscription(db, {
  id: 'sub_smoke',
  customer: 'cus_sub_smoke',
  status: 'canceled',
  current_period_start: unix(isoDaysFromNow(-30)),
  current_period_end: unix(isoDaysFromNow(0)),
  cancel_at_period_end: false,
  canceled_at: unix(isoDaysFromNow(0)),
  metadata: { shopId: String(trialShop.id), plan: 'starter' },
  items: { data: [{ price: { id: 'price_starter_smoke' } }] },
}), true, 'Canceled subscription webhook should be accepted');
linked = db.prepare('SELECT * FROM shops WHERE id = ?').get(trialShop.id);
assert.equal(linked.billing_status, 'canceled');
assert.equal(billingStatusIsActive(linked.billing_status, linked.plan), false);

console.log('Subscription billing smoke checks passed.');

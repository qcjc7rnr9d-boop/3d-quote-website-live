import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

process.env.STRIPE_BILLING_STARTER_PRICE_ID = process.env.STRIPE_BILLING_STARTER_PRICE_ID || 'price_starter_smoke';
process.env.STRIPE_BILLING_PRO_PRICE_ID = process.env.STRIPE_BILLING_PRO_PRICE_ID || 'price_pro_smoke';

const {
  BILLING_ACTIVE_STATUSES,
  createBusinessBillingSession,
  getBillingPriceIdForPlan,
  liveOrderReadiness,
  normaliseBillingStatus,
} = await import('../lib/billing.js');

const db = new DatabaseSync('data/rfdewi.db');
const slug = `billing-smoke-${randomUUID().slice(0, 8)}`;
let shopId = null;
let capturedCheckoutPayload = null;

try {
  const shopColumns = db.prepare('PRAGMA table_info(shops)').all().map(row => row.name);
  for (const column of [
    'billing_customer_id',
    'billing_subscription_id',
    'billing_price_id',
    'billing_status',
    'billing_current_period_end',
    'billing_checkout_session_id',
    'billing_checkout_status',
    'billing_updated_at',
  ]) {
    assert.ok(shopColumns.includes(column), `shops table should include ${column}`);
  }

  assert.equal(getBillingPriceIdForPlan('starter'), 'price_starter_smoke');
  assert.equal(getBillingPriceIdForPlan('pro'), 'price_pro_smoke');
  assert.equal(normaliseBillingStatus('does-not-exist'), 'pending_subscription');
  assert.equal(BILLING_ACTIVE_STATUSES.has('active'), true);
  assert.equal(BILLING_ACTIVE_STATUSES.has('trialing'), true);
  assert.equal(BILLING_ACTIVE_STATUSES.has('past_due'), false);

  const insert = db.prepare(`
    INSERT INTO shops (name, slug, email, password_hash, plan, is_temp_password, billing_status)
    VALUES (?, ?, ?, ?, ?, 1, 'pending_subscription')
  `).run('Billing Smoke Print', slug, `${slug}@example.test`, 'not-a-real-hash', 'starter');
  shopId = insert.lastInsertRowid;
  db.prepare('INSERT INTO pricing_config (shop_id) VALUES (?)').run(shopId);
  db.prepare('INSERT INTO store_settings (shop_id) VALUES (?)').run(shopId);

  const fakeStripe = {
    customers: {
      create: async payload => {
        assert.equal(payload.email, `${slug}@example.test`);
        assert.equal(payload.metadata.shopSlug, slug);
        return { id: 'cus_billing_smoke' };
      },
    },
    checkout: {
      sessions: {
        create: async payload => {
          capturedCheckoutPayload = payload;
          return { id: 'cs_billing_smoke', url: 'https://checkout.stripe.test/session' };
        },
      },
    },
  };

  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId);
  const session = await createBusinessBillingSession({
    db,
    stripe: fakeStripe,
    shop,
    baseUrl: 'https://app.example.test',
  });
  assert.equal(session.url, 'https://checkout.stripe.test/session');
  assert.equal(session.id, 'cs_billing_smoke');
  assert.equal(capturedCheckoutPayload.mode, 'subscription');
  assert.equal(capturedCheckoutPayload.customer, 'cus_billing_smoke');
  assert.equal(capturedCheckoutPayload.line_items[0].price, 'price_starter_smoke');
  assert.match(capturedCheckoutPayload.success_url, /\/admin\/payments\.html\?billing=success/);
  assert.match(capturedCheckoutPayload.cancel_url, /\/admin\/payments\.html\?billing=cancelled/);
  assert.equal(capturedCheckoutPayload.metadata.shopId, String(shopId));
  assert.equal(capturedCheckoutPayload.subscription_data.metadata.shopSlug, slug);

  const updated = db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId);
  assert.equal(updated.billing_customer_id, 'cus_billing_smoke');
  assert.equal(updated.billing_checkout_session_id, 'cs_billing_smoke');
  assert.equal(updated.billing_checkout_status, 'created');
  assert.equal(updated.billing_price_id, 'price_starter_smoke');

  const inactive = liveOrderReadiness({
    ...updated,
    stripe_account_id: 'acct_smoke',
    stripe_charges_enabled: 1,
    stripe_payouts_enabled: 1,
    stripe_details_submitted: 1,
  }, { publishableKey: 'pk_test_smoke', secretKey: 'sk_test_smoke' });
  assert.equal(inactive.can_accept_live_orders, false);
  assert.equal(inactive.code, 'SUBSCRIPTION_INACTIVE');

  const active = liveOrderReadiness({
    ...updated,
    billing_status: 'active',
    stripe_account_id: 'acct_smoke',
    stripe_charges_enabled: 1,
    stripe_payouts_enabled: 1,
    stripe_details_submitted: 1,
  }, { publishableKey: 'pk_test_smoke', secretKey: 'sk_test_smoke' });
  assert.equal(active.can_accept_live_orders, true);
  assert.equal(active.code, null);

  const stripeRoutes = readFileSync('routes/stripe.js', 'utf8');
  for (const code of [
    'PLATFORM_STRIPE_NOT_CONFIGURED',
    'SUBSCRIPTION_INACTIVE',
    'NO_CONNECTED_ACCOUNT',
    'ONBOARDING_INCOMPLETE',
  ]) {
    assert.ok(stripeRoutes.includes(code), `routes/stripe.js should expose ${code}`);
  }

  const platformRoutes = readFileSync('routes/platform.js', 'utf8');
  assert.ok(platformRoutes.includes("router.post('/shops/:id/billing-session'"), 'platform route should expose billing session resend endpoint');
  assert.ok(platformRoutes.includes('billing_checkout_url'), 'platform shop creation should return a billing checkout URL/status');
  assert.ok(!platformRoutes.includes('res.status(201).json(shop)'), 'platform shop creation must not return raw shop rows');

  console.log('Business billing smoke checks passed.');
} finally {
  if (shopId) db.prepare('DELETE FROM shops WHERE id = ?').run(shopId);
  db.close();
}

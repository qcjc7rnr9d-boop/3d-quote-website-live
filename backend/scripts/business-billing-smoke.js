import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { calculateQuoteForShopSlug } from '../lib/pricing-engine.js';
import { parseInfillTiers } from '../lib/infill-tiers.js';
import { normalisePlanId } from '../lib/billing-plans.js';

delete process.env.STRIPE_BILLING_STARTER_PRICE_ID;
delete process.env.STRIPE_BILLING_PRO_PRICE_ID;
delete process.env.STRIPE_BILLING_GROWTH_PRICE_ID;
delete process.env.STRIPE_BILLING_SCALE_PRICE_ID;

const {
  BILLING_ACTIVE_STATUSES,
  billingStatusIsActive,
  createBusinessBillingSession,
  getBillingPriceIdForPlan,
  getBillingPriceSetupStatus,
  isFreeBillingPlan,
  isPaidBillingPlan,
  liveOrderReadiness,
  normaliseBillingStatus,
} = await import('../lib/billing.js');

const db = new DatabaseSync('data/rfdewi.db');
const slug = `billing-smoke-${randomUUID().slice(0, 8)}`;
let shopId = null;
let previousPlatformFee = null;

function parseJson(value, fallback = null) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function includedFeeFromCustomerTotal(totalCents, percent) {
  return Math.max(0, totalCents - Math.floor(totalCents * (1 - percent / 100)));
}

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

  assert.equal(normalisePlanId('community'), 'community');
  assert.equal(normalisePlanId('starter'), 'community', 'legacy paid plan ids should collapse to the free pilot plan');
  assert.equal(normalisePlanId('growth'), 'community');
  assert.equal(normalisePlanId('scale'), 'community');
  assert.equal(isFreeBillingPlan('community'), true);
  assert.equal(isFreeBillingPlan('starter'), true);
  assert.equal(isPaidBillingPlan('starter'), false);
  assert.equal(isPaidBillingPlan('growth'), false);
  assert.equal(isPaidBillingPlan('scale'), false);
  assert.equal(getBillingPriceIdForPlan('starter'), '');
  assert.equal(getBillingPriceIdForPlan('growth'), '');
  assert.equal(getBillingPriceIdForPlan('scale'), '');
  assert.deepEqual(getBillingPriceSetupStatus(), { community: true });
  assert.equal(normaliseBillingStatus('does-not-exist'), 'pending_subscription');
  assert.equal(BILLING_ACTIVE_STATUSES.has('active'), true);
  assert.equal(BILLING_ACTIVE_STATUSES.has('trialing'), true);
  assert.equal(BILLING_ACTIVE_STATUSES.has('past_due'), false);
  assert.equal(billingStatusIsActive('active', 'suspended'), false);

  const insert = db.prepare(`
    INSERT INTO shops (name, slug, email, password_hash, plan, is_temp_password, billing_status)
    VALUES (?, ?, ?, ?, ?, 1, 'pending_subscription')
  `).run('Billing Smoke Print', slug, `${slug}@example.test`, 'not-a-real-hash', 'starter');
  shopId = insert.lastInsertRowid;
  db.prepare('INSERT INTO pricing_config (shop_id) VALUES (?)').run(shopId);
  db.prepare('INSERT INTO store_settings (shop_id) VALUES (?)').run(shopId);

  const legacyStarterReady = liveOrderReadiness({
    id: shopId,
    plan: 'starter',
    billing_status: 'pending_subscription',
    stripe_account_id: 'acct_starter_smoke',
    stripe_charges_enabled: 1,
    stripe_payouts_enabled: 1,
    stripe_details_submitted: 1,
  }, { publishableKey: 'pk_test_smoke', secretKey: 'sk_test_smoke' });
  assert.equal(legacyStarterReady.billing_active, true);
  assert.equal(legacyStarterReady.can_accept_live_orders, true);
  assert.equal(legacyStarterReady.code, null);

  await assert.rejects(
    () => createBusinessBillingSession({
      db,
      stripe: {},
      shop: db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId),
      baseUrl: 'https://app.example.test',
    }),
    err => err.code === 'FREE_PLAN_NO_BILLING_REQUIRED',
    'free pilot mode must never create a Stripe Billing checkout session',
  );

  const noPlatformKeys = liveOrderReadiness({
    id: shopId,
    plan: 'community',
    billing_status: 'pending_subscription',
    stripe_account_id: 'acct_smoke',
    stripe_charges_enabled: 1,
    stripe_payouts_enabled: 1,
    stripe_details_submitted: 1,
  }, {});
  assert.equal(noPlatformKeys.can_accept_live_orders, false);
  assert.equal(noPlatformKeys.code, 'PLATFORM_STRIPE_NOT_CONFIGURED');

  const noConnect = liveOrderReadiness({
    id: shopId,
    plan: 'community',
    billing_status: 'pending_subscription',
  }, { publishableKey: 'pk_test_smoke', secretKey: 'sk_test_smoke' });
  assert.equal(noConnect.can_accept_live_orders, false);
  assert.equal(noConnect.code, 'NO_CONNECTED_ACCOUNT');

  const incompleteConnect = liveOrderReadiness({
    id: shopId,
    plan: 'community',
    billing_status: 'pending_subscription',
    stripe_account_id: 'acct_smoke',
    stripe_charges_enabled: 1,
    stripe_payouts_enabled: 0,
    stripe_details_submitted: 1,
  }, { publishableKey: 'pk_test_smoke', secretKey: 'sk_test_smoke' });
  assert.equal(incompleteConnect.can_accept_live_orders, false);
  assert.equal(incompleteConnect.code, 'ONBOARDING_INCOMPLETE');

  previousPlatformFee = db.prepare('SELECT platform_fee_percent FROM platform_settings WHERE id = 1').get()?.platform_fee_percent ?? null;
  db.prepare('INSERT OR IGNORE INTO platform_settings (id) VALUES (1)').run();
  db.prepare("UPDATE platform_settings SET platform_fee_percent = 5, updated_at = datetime('now') WHERE id = 1").run();

  const demoShop = db.prepare("SELECT id FROM shops WHERE slug = 'mahi3d'").get();
  assert.ok(demoShop, 'Mahi3D shop is missing; run npm run demo:seed:mahi3d first');
  const material = db.prepare(`
    SELECT id, colours, finishes
    FROM materials
    WHERE shop_id = ? AND active = 1 AND name = 'PETG'
  `).get(demoShop.id);
  assert.ok(material, 'PETG material is missing from Mahi3D');
  const colour = (parseJson(material.colours, []) || []).find(c => c.enabled !== false);
  const finish = (parseJson(material.finishes, []) || []).find(f => f.enabled !== false);
  const pricingRows = db.prepare('SELECT infill_tiers FROM pricing_config WHERE shop_id = ?').get(demoShop.id) || {};
  const infill = parseInfillTiers(pricingRows.infill_tiers).find(t => t.active !== false);
  const shippingRows = db.prepare('SELECT shipping_zones FROM store_settings WHERE shop_id = ?').get(demoShop.id) || {};
  const shipping = (parseJson(shippingRows.shipping_zones, []) || []).find(s => s.active !== false);
  const quote = calculateQuoteForShopSlug(db, 'mahi3d', {
    materialId: material.id,
    volumeCm3: 12,
    dimensions: { xMm: 20, yMm: 20, zMm: 12 },
    colourId: colour?.id,
    finishId: finish?.id,
    infillTierId: infill?.id,
    quantity: 1,
    shippingId: shipping?.id,
  });
  assert.equal(quote.lineItems.platformFeePercent, 5);
  assert.equal(
    quote.lineItems.platformFeeIncludedCents,
    includedFeeFromCustomerTotal(quote.totalCents, 5),
    'included Trennen fee should be exactly the 5% application fee collected from customer total',
  );
  assert.equal(
    quote.totalCents,
    quote.lineItems.sellerNetTotalCents + quote.lineItems.platformFeeIncludedCents,
    'customer total should gross up the seller net by the included Trennen fee',
  );
  assert.equal(quote.lineItems.total, quote.totalCents / 100);

  const stripeRoutes = readFileSync('routes/stripe.js', 'utf8');
  for (const code of [
    'PLATFORM_STRIPE_NOT_CONFIGURED',
    'NO_CONNECTED_ACCOUNT',
    'ONBOARDING_INCOMPLETE',
  ]) {
    assert.ok(stripeRoutes.includes(code), `routes/stripe.js should expose ${code}`);
  }
  assert.ok(stripeRoutes.includes('stripeErrorSummary(err)'), 'Stripe routes should log sanitized Stripe errors');

  const platformPayments = readFileSync('lib/platform-payments.js', 'utf8');
  assert.ok(platformPayments.includes("billing_mode: 'free_pilot'"), 'platform payment config should declare free pilot billing mode');
  assert.ok(platformPayments.includes('can_create_billing_sessions: false'), 'platform payment config must not advertise Billing sessions during the pilot');
  assert.ok(!platformPayments.includes('billingPrices.starter'), 'platform payment config must not depend on old Starter Billing price IDs');

  const platformRoutes = readFileSync('routes/platform.js', 'utf8');
  assert.ok(platformRoutes.includes("req.body?.plan || 'community'"), 'platform shop creation should default to the free pilot plan');
  assert.ok(platformRoutes.includes("billing_setup_status: 'free_plan'"), 'platform shop creation should return free_plan for pilot shops');
  assert.ok(platformRoutes.includes("router.post('/shops/:id/billing-session'"), 'platform route should expose billing session endpoint');
  assert.ok(platformRoutes.includes('FREE_PLAN_NO_BILLING_REQUIRED'), 'billing-session endpoint should report that no billing is required');
  assert.ok(!platformRoutes.includes("req.body?.plan || 'starter'"), 'platform shop creation must not default to Starter');
  assert.ok(!platformRoutes.includes(" : 'starter'"), 'platform restore flow must not restore shops to Starter');
  assert.ok(!platformRoutes.includes('res.status(201).json(shop)'), 'platform shop creation must not return raw shop rows');

  const envExample = readFileSync('.env.example', 'utf8');
  assert.ok(!envExample.includes('STRIPE_BILLING_STARTER_PRICE_ID='), '.env.example should not configure paid Billing for pilot');
  assert.ok(!envExample.includes('STRIPE_BILLING_GROWTH_PRICE_ID='), '.env.example should not configure paid Billing for pilot');
  assert.ok(!envExample.includes('STRIPE_BILLING_SCALE_PRICE_ID='), '.env.example should not configure paid Billing for pilot');
  assert.ok(envExample.includes('Free pilot mode'), '.env.example should document free pilot mode');

  const platformAdmin = readFileSync('../platform/admin.html', 'utf8');
  assert.ok(platformAdmin.includes('<option value="community" selected>Free pilot</option>'), 'platform admin should default new shops to the Free pilot plan');
  assert.ok(!platformAdmin.includes('<option value="starter"'), 'platform admin should not expose Starter during free pilot');
  assert.ok(!platformAdmin.includes('<option value="growth"'), 'platform admin should not expose Growth during free pilot');
  assert.ok(!platformAdmin.includes('<option value="scale"'), 'platform admin should not expose Scale during free pilot');
  assert.ok(platformAdmin.includes('data-tab="plans"'), 'platform admin should expose plan editor tab');

  console.log('Business billing smoke checks passed.');
} finally {
  if (previousPlatformFee == null) {
    db.prepare('UPDATE platform_settings SET platform_fee_percent = 5 WHERE id = 1').run();
  } else {
    db.prepare('UPDATE platform_settings SET platform_fee_percent = ? WHERE id = 1').run(previousPlatformFee);
  }
  if (shopId) db.prepare('DELETE FROM shops WHERE id = ?').run(shopId);
  db.close();
}

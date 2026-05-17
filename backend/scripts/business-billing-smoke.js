import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { calculateQuoteForShopSlug, toCents } from '../lib/pricing-engine.js';
import { parseInfillTiers } from '../lib/infill-tiers.js';

delete process.env.STRIPE_BILLING_STARTER_PRICE_ID;
delete process.env.STRIPE_BILLING_PRO_PRICE_ID;

const {
  BILLING_ACTIVE_STATUSES,
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

  assert.equal(isFreeBillingPlan('starter'), true);
  assert.equal(isFreeBillingPlan('pro'), true, 'legacy Pro rows should be treated as free while Pro is hidden');
  assert.equal(isPaidBillingPlan('pro'), false);
  assert.equal(getBillingPriceIdForPlan('starter'), '');
  assert.equal(getBillingPriceIdForPlan('pro'), '');
  assert.deepEqual(getBillingPriceSetupStatus(), { starter: true });
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

  const starterReady = liveOrderReadiness({
    id: shopId,
    plan: 'starter',
    billing_status: 'pending_subscription',
    stripe_account_id: 'acct_starter_smoke',
    stripe_charges_enabled: 1,
    stripe_payouts_enabled: 1,
    stripe_details_submitted: 1,
  }, { publishableKey: 'pk_test_smoke', secretKey: 'sk_test_smoke' });
  assert.equal(starterReady.billing_active, true);
  assert.equal(starterReady.can_accept_live_orders, true);
  assert.equal(starterReady.code, null);

  await assert.rejects(
    () => createBusinessBillingSession({
      db,
      stripe: {},
      shop: db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId),
      baseUrl: 'https://app.example.test',
    }),
    err => err.code === 'FREE_PLAN_NO_BILLING_REQUIRED',
    'starter plan must not create a Stripe Billing checkout session',
  );

  const legacyProReady = liveOrderReadiness({
    id: shopId,
    plan: 'pro',
    billing_status: 'pending_subscription',
    stripe_account_id: 'acct_smoke',
    stripe_charges_enabled: 1,
    stripe_payouts_enabled: 1,
    stripe_details_submitted: 1,
  }, { publishableKey: 'pk_test_smoke', secretKey: 'sk_test_smoke' });
  assert.equal(legacyProReady.billing_active, true);
  assert.equal(legacyProReady.can_accept_live_orders, true);
  assert.equal(legacyProReady.code, null);

  await assert.rejects(
    () => createBusinessBillingSession({
      db,
      stripe: {},
      shop: { ...db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId), plan: 'pro' },
      baseUrl: 'https://app.example.test',
    }),
    err => err.code === 'FREE_PLAN_NO_BILLING_REQUIRED',
    'legacy Pro rows must not create a Stripe Billing checkout session while Pro is removed',
  );

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
  assert.ok(quote.lineItems.sellerNetTotal > 0, 'quote should expose the shop net total before platform fee');
  assert.ok(quote.lineItems.platformFeeIncluded > 0, 'quote should include a hidden platform fee amount');
  assert.equal(
    quote.totalCents,
    Math.ceil(toCents(quote.lineItems.sellerNetTotal) / 0.95),
    'customer total should gross up the seller total by the 5% platform fee',
  );
  assert.equal(
    toCents(quote.lineItems.platformFeeIncluded),
    quote.totalCents - toCents(quote.lineItems.sellerNetTotal),
    'platform fee included should be the customer total minus seller net total',
  );

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
  assert.ok(platformRoutes.includes('FREE_PLAN_NO_BILLING_REQUIRED'), 'platform route should expose a free-plan billing-session code');
  assert.ok(platformRoutes.includes("billing_setup_status: 'free_plan'"), 'platform shop creation should return free_plan for the only membership');
  assert.ok(platformRoutes.includes("router.post('/shops/:id/billing-session'"), 'platform route should expose billing session resend endpoint');
  assert.ok(platformRoutes.includes('billing_checkout_url'), 'platform shop creation should return a billing checkout URL/status');
  assert.ok(!platformRoutes.includes('billing_link_created'), 'platform shop creation should not create paid billing links while Pro is removed');
  assert.ok(!platformRoutes.includes('BILLING_PRICE_NOT_CONFIGURED'), 'platform shop creation should not depend on paid billing price IDs while Pro is removed');
  assert.ok(!platformRoutes.includes('res.status(201).json(shop)'), 'platform shop creation must not return raw shop rows');

  const envExample = readFileSync('.env.example', 'utf8');
  assert.ok(!envExample.includes('STRIPE_BILLING_PRO_PRICE_ID'), '.env.example should not ask for a Pro Billing price ID while Pro is removed');
  assert.ok(!envExample.includes('$30') && !envExample.includes('Pro price'), '.env.example should not document paid Pro billing while Pro is removed');

  const platformAdmin = readFileSync('../platform/admin.html', 'utf8');
  assert.ok(!platformAdmin.includes('<option value="pro"'), 'platform admin should not expose a Pro plan option');
  assert.ok(!platformAdmin.includes('Pro ready'), 'platform admin should not show Pro billing status');
  assert.ok(!platformAdmin.includes('Needs Pro price ID'), 'platform admin should not require a Pro price ID');
  assert.ok(!platformAdmin.includes('$30/month Pro'), 'platform admin should not mention a Pro subscription');

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

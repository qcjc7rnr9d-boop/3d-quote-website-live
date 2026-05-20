import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  calculateCheckoutPlatformFee,
  ensureBillingSchema,
  ensureMerchantSubscription,
  estimatePaymentProcessingFee,
  getBillingUsageSummary,
  getPaymentFeeMode,
  listPlans,
  recordCheckoutFeeLedger,
  recordPaymentFeeRecord,
  recordQuoteUsageEvent,
  seedBillingPlans,
  updatePaymentFeeMode,
} from '../lib/billing-service.js';
import { DEFAULT_GST_BASIS_POINTS, TRENNEN_BILLING_PLANS, defaultPlanById, normalisePlanId } from '../lib/billing-plans.js';

const db = new DatabaseSync(':memory:');
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE shops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'community',
    billing_status TEXT NOT NULL DEFAULT 'active',
    billing_subscription_id TEXT,
    updated_at TEXT,
    created_at TEXT
  );
  CREATE TABLE store_settings (
    shop_id INTEGER PRIMARY KEY,
    updated_at TEXT,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
  );
  CREATE TABLE platform_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    stripe_publishable_key TEXT,
    stripe_secret_key TEXT,
    stripe_client_id TEXT,
    platform_fee_percent REAL NOT NULL DEFAULT 5,
    updated_at TEXT,
    created_at TEXT
  );
  INSERT INTO platform_settings (id) VALUES (1);
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id INTEGER NOT NULL,
    customer_email TEXT,
    customer_name TEXT,
    subtotal REAL DEFAULT 0,
    tax REAL DEFAULT 0,
    shipping REAL DEFAULT 0,
    total REAL DEFAULT 0,
    stripe_payment_id TEXT,
    public_token TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
  );
`);
ensureBillingSchema(db);
seedBillingPlans(db);

function makeShop(plan = 'community') {
  const result = db.prepare(`
    INSERT INTO shops (name, slug, email, password_hash, plan, billing_status)
    VALUES (?, ?, ?, 'hash', ?, 'active')
  `).run(`${plan} shop`, `${plan}-${Date.now()}-${Math.random()}`, `${plan}@example.com`, plan);
  db.prepare('INSERT INTO store_settings (shop_id) VALUES (?)').run(result.lastInsertRowid);
  ensureMerchantSubscription(db, result.lastInsertRowid);
  return result.lastInsertRowid;
}

const pricingDoc = readFileSync(resolve(import.meta.dirname, '../../docs/pricing/trennen-pricing-and-fees.md'), 'utf8');
const pricingPage = readFileSync(resolve(import.meta.dirname, '../../pricing.html'), 'utf8');
assert.equal(TRENNEN_BILLING_PLANS.length, 1);
assert.equal(DEFAULT_GST_BASIS_POINTS, 1500);
assert.equal(normalisePlanId('starter'), 'community');
assert.equal(normalisePlanId('growth'), 'community');
assert.equal(normalisePlanId('scale'), 'community');

const pilotPlan = defaultPlanById('community');
assert.equal(pilotPlan.id, 'community');
assert.equal(pilotPlan.name, 'Free Pilot');
assert.equal(pilotPlan.monthly_price_cents, 0);
assert.equal(pilotPlan.quote_allowance, null);
assert.equal(pilotPlan.allow_overages, true);
assert.equal(pilotPlan.checkout_enabled, true);
assert.equal(pilotPlan.checkout_fee_basis_points, 500);
assert.equal(pilotPlan.checkout_fee_monthly_cap_cents, 0);
assert.equal(pilotPlan.branding_required, false);

assert.ok(pricingDoc.includes('Free pilot only'));
assert.ok(pricingDoc.includes('5% Trennen platform fee is included in the customer-facing quote total'));
assert.ok(pricingDoc.includes('No Stripe Billing subscription is required during the pilot'));
assert.ok(pricingDoc.includes('Customer checkout is Stripe-only for launch'));
assert.ok(pricingPage.includes('Free pilot'));
assert.ok(pricingPage.includes('5% Trennen platform fee included in each customer quote'));
assert.ok(pricingPage.includes('Stripe Connect checkout'));
assert.ok(!pricingPage.includes('NZ$29/mo'), 'pricing page should not advertise paid plans during pilot');
assert.ok(!pricingPage.includes('NZ$129/mo'), 'pricing page should not advertise paid plans during pilot');

db.exec(`
  INSERT INTO plans (id, name, monthly_price_cents, currency, active)
  VALUES ('starter', 'Starter', 2900, 'NZD', 1),
         ('growth', 'Growth', 12900, 'NZD', 1)
`);
seedBillingPlans(db, { overwriteExisting: true });
const visiblePlans = listPlans(db);
assert.deepEqual(visiblePlans.map(plan => plan.id), ['community']);
assert.equal(db.prepare("SELECT active FROM plans WHERE id = 'starter'").get().active, 0);
assert.equal(db.prepare("SELECT active FROM plans WHERE id = 'growth'").get().active, 0);

const pilotShop = makeShop('community');
for (let i = 1; i <= 30; i += 1) recordQuoteUsageEvent(db, { shopId: pilotShop, quoteId: `p${i}` });
let summary = getBillingUsageSummary(db, pilotShop);
assert.equal(summary.plan_id, 'community');
assert.equal(summary.quote_allowance, null);
assert.equal(summary.remaining_included_quotes, null);
assert.equal(summary.allow_overages, true);
assert.equal(summary.estimated_overage_charges_cents, 0);
assert.equal(summary.checkout_fee_basis_points, 500);
assert.equal(summary.checkout_platform_fee_cap_cents, 0);
assert.equal(summary.checkout_enabled, true);

const legacyStarterShop = makeShop('starter');
summary = getBillingUsageSummary(db, legacyStarterShop);
assert.equal(summary.plan_id, 'community', 'legacy paid shops should use the pilot plan internally');

let calc = calculateCheckoutPlatformFee(db, { shopId: pilotShop, orderAmountCents: 10527 });
assert.equal(calc.raw_platform_fee_cents, 527);
assert.equal(calc.final_platform_fee_cents, 527);
assert.equal(calc.cap_remaining_before_cents, 0, 'zero cap means uncapped during pilot');
recordCheckoutFeeLedger(db, calc, { orderId: null, status: 'charged' });
calc = calculateCheckoutPlatformFee(db, { shopId: pilotShop, orderAmountCents: 50000 });
assert.equal(calc.final_platform_fee_cents, 2500, 'pilot fee should not stop after the first checkout');

calc = calculateCheckoutPlatformFee(db, {
  shopId: pilotShop,
  orderAmountCents: 250000,
  paymentMethod: 'bank_transfer',
});
assert.equal(calc.raw_platform_fee_cents, 0);
assert.equal(calc.final_platform_fee_cents, 0);

assert.equal(getPaymentFeeMode(db, pilotShop), 'merchant_absorbs');
updatePaymentFeeMode(db, pilotShop, 'pass_to_customer_at_cost');
assert.equal(estimatePaymentProcessingFee(db, { shopId: pilotShop, amountCents: 10000 }), 320);
assert.throws(() => updatePaymentFeeMode(db, pilotShop, 'bank_transfer_only'), /Invalid payment fee mode/);

const platformLedgerId = recordCheckoutFeeLedger(db, calculateCheckoutPlatformFee(db, { shopId: pilotShop, orderAmountCents: 10000 }), { status: 'charged' });
const paymentFeeId = recordPaymentFeeRecord(db, {
  shop_id: pilotShop,
  stripe_payment_intent_id: 'pi_test',
  stripe_charge_id: 'ch_test',
  stripe_balance_transaction_id: 'txn_test',
  stripe_fee_amount_cents: 320,
  stripe_net_amount_cents: 9680,
  payment_fee_mode: 'merchant_absorbs',
});
assert.notEqual(platformLedgerId, paymentFeeId);

console.log('Pricing billing smoke checks passed.');

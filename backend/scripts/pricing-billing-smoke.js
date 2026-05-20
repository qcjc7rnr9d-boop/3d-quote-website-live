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
  recordCheckoutFeeLedger,
  recordPaymentFeeRecord,
  recordQuoteUsageEvent,
  seedBillingPlans,
  updatePaymentFeeMode,
} from '../lib/billing-service.js';
import { DEFAULT_GST_BASIS_POINTS, TRENNEN_BILLING_PLANS, defaultPlanById } from '../lib/billing-plans.js';

const db = new DatabaseSync(':memory:');
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE shops (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'starter',
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

function makeShop(plan) {
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
assert.equal(TRENNEN_BILLING_PLANS.length, 5);
assert.equal(DEFAULT_GST_BASIS_POINTS, 1500);

const communityPlan = defaultPlanById('community');
assert.equal(communityPlan.monthly_price_cents, 0);
assert.equal(communityPlan.quote_allowance, 3);
assert.equal(communityPlan.allow_overages, false);
assert.equal(communityPlan.checkout_enabled, false);

const starterPlan = defaultPlanById('starter');
assert.equal(starterPlan.monthly_price_cents, 2900);
assert.equal(starterPlan.quote_allowance, 25);
assert.equal(starterPlan.quote_overage_price_cents, 100);
assert.equal(starterPlan.trial_days, 14);
assert.equal(starterPlan.checkout_fee_basis_points, 50);
assert.equal(starterPlan.checkout_fee_monthly_cap_cents, 2900);

const growthPlan = defaultPlanById('growth');
assert.equal(growthPlan.monthly_price_cents, 12900);
assert.equal(growthPlan.quote_allowance, 250);
assert.equal(growthPlan.quote_overage_price_cents, 50);
assert.equal(growthPlan.trial_days, 14);
assert.equal(growthPlan.checkout_fee_basis_points, 50);
assert.equal(growthPlan.checkout_fee_monthly_cap_cents, 7900);

const scalePlan = defaultPlanById('scale');
assert.equal(scalePlan.monthly_price_cents, 89900);
assert.equal(scalePlan.quote_allowance, 1000);
assert.equal(scalePlan.quote_overage_price_cents, 25);
assert.equal(scalePlan.checkout_fee_basis_points, 0);
assert.equal(scalePlan.checkout_fee_monthly_cap_cents, 0);

const enterprisePlan = defaultPlanById('enterprise');
assert.equal(enterprisePlan.monthly_price_cents, null);
assert.equal(enterprisePlan.quote_allowance, null);
assert.equal(enterprisePlan.checkout_fee_basis_points, 0);
assert.equal(enterprisePlan.active, true);

assert.ok(pricingDoc.includes('Future pricing work must update this document and `backend/lib/billing-plans.js` together'));
assert.ok(pricingDoc.includes('| Starter | NZ$29 + GST | 25 | NZ$1 per extra quote | 0.5%, capped at NZ$29/month |'));
assert.ok(pricingDoc.includes('| Growth | NZ$129 + GST | 250 | NZ$0.50 per extra quote | 0.5%, capped at NZ$79/month |'));
assert.ok(pricingDoc.includes('| Scale | NZ$899 + GST | 1,000 | NZ$0.25 per extra quote | Included or custom capped |'));
assert.ok(pricingDoc.includes('| Enterprise | Talk to us | Custom | Custom capped terms | Custom capped terms |'));
assert.ok(pricingDoc.includes('Customer checkout is Stripe-only for launch'));
assert.ok(pricingPage.includes('All prices exclude GST.'));
assert.ok(pricingPage.includes('Optional card checkout fee: 0.5%, capped at NZ$29/month'));
assert.ok(pricingPage.includes('Optional card checkout fee: 0.5%, capped at NZ$79/month'));
assert.ok(pricingPage.includes('No default card checkout fee unless configured'));
assert.ok(pricingPage.includes('Stripe Connect checkout'));

db.prepare("UPDATE plans SET monthly_price_cents = 7900, checkout_fee_basis_points = 100 WHERE id = 'growth'").run();
seedBillingPlans(db, { overwriteExisting: true });
const growthRow = db.prepare("SELECT monthly_price_cents, checkout_fee_basis_points FROM plans WHERE id = 'growth'").get();
assert.equal(growthRow.monthly_price_cents, 12900);
assert.equal(growthRow.checkout_fee_basis_points, 50);

const community = makeShop('community');
recordQuoteUsageEvent(db, { shopId: community, quoteId: 'c1' });
recordQuoteUsageEvent(db, { shopId: community, quoteId: 'c2' });
recordQuoteUsageEvent(db, { shopId: community, quoteId: 'c3' });
let summary = getBillingUsageSummary(db, community);
assert.equal(summary.quotes_used_this_month, 3);
assert.equal(summary.remaining_included_quotes, 0);
assert.equal(summary.allow_overages, false);

const starter = makeShop('starter');
for (let i = 1; i <= 26; i += 1) recordQuoteUsageEvent(db, { shopId: starter, quoteId: `s${i}` });
summary = getBillingUsageSummary(db, starter);
assert.equal(summary.quote_allowance, 25);
assert.equal(summary.estimated_overage_charges_cents, 100);

const growth = makeShop('growth');
for (let i = 1; i <= 251; i += 1) recordQuoteUsageEvent(db, { shopId: growth, quoteId: `g${i}` });
summary = getBillingUsageSummary(db, growth);
assert.equal(summary.estimated_overage_charges_cents, 50);

let calc = calculateCheckoutPlatformFee(db, { shopId: starter, orderAmountCents: 1000000 });
assert.equal(calc.final_platform_fee_cents, 2900);
recordCheckoutFeeLedger(db, calc, { orderId: null, status: 'charged' });
calc = calculateCheckoutPlatformFee(db, { shopId: starter, orderAmountCents: 1000000 });
assert.equal(calc.final_platform_fee_cents, 0);

calc = calculateCheckoutPlatformFee(db, { shopId: growth, orderAmountCents: 5000000 });
assert.equal(calc.final_platform_fee_cents, 7900);

const scale = makeShop('scale');
calc = calculateCheckoutPlatformFee(db, { shopId: scale, orderAmountCents: 5000000 });
assert.equal(calc.final_platform_fee_cents, 0);

const bankTransferShop = makeShop('starter');
recordQuoteUsageEvent(db, {
  shopId: bankTransferShop,
  quoteId: 'bank-transfer-order:1',
  eventType: 'bank_transfer_order_created',
});
calc = calculateCheckoutPlatformFee(db, {
  shopId: bankTransferShop,
  orderAmountCents: 250000,
  paymentMethod: 'bank_transfer',
});
assert.equal(calc.raw_platform_fee_cents, 0);
assert.equal(calc.final_platform_fee_cents, 0);
assert.equal(
  db.prepare('SELECT COUNT(*) AS c FROM checkout_fee_ledger WHERE shop_id = ?').get(bankTransferShop).c,
  0,
  'bank transfer order usage must not create Trennen platform-fee revenue',
);

assert.equal(getPaymentFeeMode(db, starter), 'merchant_absorbs');
updatePaymentFeeMode(db, starter, 'pass_to_customer_at_cost');
assert.equal(estimatePaymentProcessingFee(db, { shopId: starter, amountCents: 10000 }), 320);
assert.throws(() => updatePaymentFeeMode(db, starter, 'bank_transfer_only'), /Invalid payment fee mode/);

const platformLedgerId = recordCheckoutFeeLedger(db, calculateCheckoutPlatformFee(db, { shopId: growth, orderAmountCents: 10000 }), { status: 'charged' });
const paymentFeeId = recordPaymentFeeRecord(db, {
  shop_id: growth,
  stripe_payment_intent_id: 'pi_test',
  stripe_charge_id: 'ch_test',
  stripe_balance_transaction_id: 'txn_test',
  stripe_fee_amount_cents: 320,
  stripe_net_amount_cents: 9680,
  payment_fee_mode: 'merchant_absorbs',
});
assert.notEqual(platformLedgerId, paymentFeeId);

console.log('Pricing billing smoke checks passed.');

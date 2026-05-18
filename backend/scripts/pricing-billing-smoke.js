import assert from 'node:assert/strict';
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
import { defaultPlanById } from '../lib/billing-plans.js';

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

assert.equal(defaultPlanById('starter').monthly_price_cents, 2900);
assert.equal(defaultPlanById('growth').checkout_fee_monthly_cap_cents, 7900);

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

assert.equal(getPaymentFeeMode(db, starter), 'merchant_absorbs');
updatePaymentFeeMode(db, starter, 'pass_to_customer_at_cost');
assert.equal(estimatePaymentProcessingFee(db, { shopId: starter, amountCents: 10000 }), 320);
updatePaymentFeeMode(db, starter, 'bank_transfer_only');
assert.equal(getPaymentFeeMode(db, starter), 'bank_transfer_only');

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

import {
  DEFAULT_GST_BASIS_POINTS,
  PAYMENT_FEE_MODES,
  TRENNEN_BILLING_PLANS,
  defaultPlanById,
  normalisePlanId,
  planRowFromDefault,
  publicPlan,
} from './billing-plans.js';

const DEFAULT_CARD_FEE_BPS = 290;
const DEFAULT_CARD_FEE_FIXED_CENTS = 30;

function int(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function cents(value, fallback = 0) {
  return Math.max(0, int(value, fallback));
}

function nullableCents(value, fallback = null) {
  if (value === undefined) return fallback;
  if (value === null || value === '') return null;
  return cents(value, fallback || 0);
}

function boolInt(value) {
  return value ? 1 : 0;
}

function sqlDate(date = new Date()) {
  return date.toISOString();
}

function currentMonthPeriod(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0));
  return { start: sqlDate(start), end: sqlDate(end) };
}

function addColumnIfMissing(db, table, name, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function normaliseMode(mode) {
  const value = String(mode || '').trim();
  return PAYMENT_FEE_MODES.includes(value) ? value : 'merchant_absorbs';
}

function rowToPlan(row) {
  if (!row) return null;
  return publicPlan({
    ...row,
    checkout_enabled: !!row.checkout_enabled,
    allow_overages: !!row.allow_overages,
    branding_required: !!row.branding_required,
    active: !!row.active,
  });
}

export function ensureBillingSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      monthly_price_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'NZD',
      gst_rate_basis_points INTEGER NOT NULL DEFAULT 1500,
      quote_allowance INTEGER,
      quote_overage_price_cents INTEGER,
      trial_days INTEGER NOT NULL DEFAULT 0,
      setup_fee_cents INTEGER NOT NULL DEFAULT 0,
      checkout_enabled INTEGER NOT NULL DEFAULT 0,
      checkout_fee_basis_points INTEGER NOT NULL DEFAULT 0,
      checkout_fee_monthly_cap_cents INTEGER NOT NULL DEFAULT 0,
      allow_overages INTEGER NOT NULL DEFAULT 0,
      branding_required INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS merchant_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL UNIQUE,
      plan_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending_subscription',
      trial_start TEXT,
      trial_end TEXT,
      current_period_start TEXT NOT NULL,
      current_period_end TEXT NOT NULL,
      stripe_subscription_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
      FOREIGN KEY (plan_id) REFERENCES plans(id)
    );

    CREATE TABLE IF NOT EXISTS quote_usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL,
      quote_id TEXT,
      event_type TEXT NOT NULL,
      billing_period_start TEXT NOT NULL,
      billing_period_end TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS checkout_fee_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL,
      order_id INTEGER,
      billing_period_start TEXT NOT NULL,
      billing_period_end TEXT NOT NULL,
      order_amount_cents INTEGER NOT NULL DEFAULT 0,
      raw_platform_fee_cents INTEGER NOT NULL DEFAULT 0,
      final_platform_fee_cents INTEGER NOT NULL DEFAULT 0,
      cap_remaining_before_cents INTEGER NOT NULL DEFAULT 0,
      cap_remaining_after_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS payment_fee_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL,
      order_id INTEGER,
      stripe_payment_intent_id TEXT,
      stripe_charge_id TEXT,
      stripe_balance_transaction_id TEXT,
      stripe_fee_amount_cents INTEGER NOT NULL DEFAULT 0,
      stripe_net_amount_cents INTEGER NOT NULL DEFAULT 0,
      stripe_fee_details_json TEXT NOT NULL DEFAULT '[]',
      payment_fee_mode TEXT NOT NULL DEFAULT 'merchant_absorbs',
      passed_to_customer_amount_cents INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS billing_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL,
      adjustment_type TEXT NOT NULL,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      billing_period_start TEXT,
      billing_period_end TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_quote_usage_shop_period
      ON quote_usage_events(shop_id, billing_period_start, billing_period_end);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_usage_once
      ON quote_usage_events(shop_id, quote_id, event_type)
      WHERE quote_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_checkout_fee_shop_period
      ON checkout_fee_ledger(shop_id, billing_period_start, billing_period_end);
    CREATE INDEX IF NOT EXISTS idx_payment_fee_order
      ON payment_fee_records(order_id);
  `);

  addColumnIfMissing(db, 'store_settings', 'payment_fee_mode', "TEXT NOT NULL DEFAULT 'merchant_absorbs'");
  addColumnIfMissing(db, 'platform_settings', 'estimated_card_fee_basis_points', `INTEGER NOT NULL DEFAULT ${DEFAULT_CARD_FEE_BPS}`);
  addColumnIfMissing(db, 'platform_settings', 'estimated_card_fee_fixed_cents', `INTEGER NOT NULL DEFAULT ${DEFAULT_CARD_FEE_FIXED_CENTS}`);
  addColumnIfMissing(db, 'orders', 'payment_processing_fee_cents', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'orders', 'checkout_platform_fee_cents', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'orders', 'customer_total_cents', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'billing_adjustments', 'adjustment_type', "TEXT NOT NULL DEFAULT 'credit'");
  addColumnIfMissing(db, 'billing_adjustments', 'amount_cents', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'billing_adjustments', 'reason', 'TEXT');
  addColumnIfMissing(db, 'billing_adjustments', 'billing_period_start', 'TEXT');
  addColumnIfMissing(db, 'billing_adjustments', 'billing_period_end', 'TEXT');
  addColumnIfMissing(db, 'billing_adjustments', 'created_at', "TEXT NOT NULL DEFAULT (datetime('now'))");
}

export function seedBillingPlans(db, { overwriteExisting = false } = {}) {
  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO plans (
      id, name, monthly_price_cents, currency, gst_rate_basis_points,
      quote_allowance, quote_overage_price_cents, trial_days, setup_fee_cents,
      checkout_enabled, checkout_fee_basis_points, checkout_fee_monthly_cap_cents,
      allow_overages, branding_required, active
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStmt = db.prepare(`
    UPDATE plans
    SET name = ?,
        monthly_price_cents = ?,
        currency = ?,
        gst_rate_basis_points = ?,
        quote_allowance = ?,
        quote_overage_price_cents = ?,
        trial_days = ?,
        setup_fee_cents = ?,
        checkout_enabled = ?,
        checkout_fee_basis_points = ?,
        checkout_fee_monthly_cap_cents = ?,
        allow_overages = ?,
        branding_required = ?,
        active = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `);
  const activePlanIds = TRENNEN_BILLING_PLANS.map(plan => plan.id);
  for (const plan of TRENNEN_BILLING_PLANS) {
    const row = planRowFromDefault(plan);
    insertStmt.run(
      row.id,
      row.name,
      row.monthly_price_cents,
      row.currency,
      row.gst_rate_basis_points,
      row.quote_allowance,
      row.quote_overage_price_cents,
      row.trial_days,
      row.setup_fee_cents,
      row.checkout_enabled,
      row.checkout_fee_basis_points,
      row.checkout_fee_monthly_cap_cents,
      row.allow_overages,
      row.branding_required,
      row.active,
    );
    updateStmt.run(
      row.name,
      row.monthly_price_cents,
      row.currency,
      row.gst_rate_basis_points,
      row.quote_allowance,
      row.quote_overage_price_cents,
      row.trial_days,
      row.setup_fee_cents,
      row.checkout_enabled,
      row.checkout_fee_basis_points,
      row.checkout_fee_monthly_cap_cents,
      row.allow_overages,
      row.branding_required,
      row.active,
      row.id,
    );
  }
  if (activePlanIds.length) {
    const placeholders = activePlanIds.map(() => '?').join(',');
    db.prepare(`UPDATE plans SET active = 0, updated_at = datetime('now') WHERE id NOT IN (${placeholders})`)
      .run(...activePlanIds);
  }
}

export function ensureBillingReady(db) {
  ensureBillingSchema(db);
  seedBillingPlans(db);
}

export function listPlans(db) {
  ensureBillingReady(db);
  return db.prepare("SELECT * FROM plans WHERE active = 1 ORDER BY CASE id WHEN 'community' THEN 1 ELSE 99 END").all().map(rowToPlan);
}

export function getPlanById(db, planId) {
  ensureBillingReady(db);
  return rowToPlan(db.prepare('SELECT * FROM plans WHERE id = ?').get(normalisePlanId(planId)))
    || publicPlan(planRowFromDefault(defaultPlanById(planId)));
}

export function updatePlan(db, planId, input = {}) {
  ensureBillingReady(db);
  const id = normalisePlanId(planId);
  const current = db.prepare('SELECT * FROM plans WHERE id = ?').get(id);
  if (!current) return null;
  const next = {
    name: input.name ?? current.name,
    monthly_price_cents: nullableCents(input.monthly_price_cents, current.monthly_price_cents),
    gst_rate_basis_points: cents(input.gst_rate_basis_points, current.gst_rate_basis_points ?? DEFAULT_GST_BASIS_POINTS),
    quote_allowance: nullableCents(input.quote_allowance, current.quote_allowance),
    quote_overage_price_cents: nullableCents(input.quote_overage_price_cents, current.quote_overage_price_cents),
    trial_days: cents(input.trial_days, current.trial_days),
    setup_fee_cents: cents(input.setup_fee_cents, current.setup_fee_cents),
    checkout_enabled: boolInt(input.checkout_enabled ?? current.checkout_enabled),
    checkout_fee_basis_points: cents(input.checkout_fee_basis_points, current.checkout_fee_basis_points),
    checkout_fee_monthly_cap_cents: cents(input.checkout_fee_monthly_cap_cents, current.checkout_fee_monthly_cap_cents),
    allow_overages: boolInt(input.allow_overages ?? current.allow_overages),
    branding_required: boolInt(input.branding_required ?? current.branding_required),
    active: boolInt(input.active ?? current.active),
  };
  db.prepare(`
    UPDATE plans
    SET name = ?,
        monthly_price_cents = ?,
        gst_rate_basis_points = ?,
        quote_allowance = ?,
        quote_overage_price_cents = ?,
        trial_days = ?,
        setup_fee_cents = ?,
        checkout_enabled = ?,
        checkout_fee_basis_points = ?,
        checkout_fee_monthly_cap_cents = ?,
        allow_overages = ?,
        branding_required = ?,
        active = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    next.name,
    next.monthly_price_cents,
    next.gst_rate_basis_points,
    next.quote_allowance,
    next.quote_overage_price_cents,
    next.trial_days,
    next.setup_fee_cents,
    next.checkout_enabled,
    next.checkout_fee_basis_points,
    next.checkout_fee_monthly_cap_cents,
    next.allow_overages,
    next.branding_required,
    next.active,
    id,
  );
  return getPlanById(db, id);
}

export function billingPeriodForSubscription(subscription = null) {
  if (subscription?.current_period_start && subscription?.current_period_end) {
    return { start: subscription.current_period_start, end: subscription.current_period_end };
  }
  return currentMonthPeriod();
}

export function ensureMerchantSubscription(db, shopId) {
  ensureBillingReady(db);
  const shop = db.prepare('SELECT id, plan, billing_status, billing_subscription_id FROM shops WHERE id = ?').get(shopId);
  if (!shop) return null;
  const period = currentMonthPeriod();
  const suspended = shop.plan === 'suspended' || shop.billing_status === 'suspended';
  const planId = suspended ? 'community' : normalisePlanId(shop.plan);
  const status = suspended ? 'suspended' : 'active';
  const existing = db.prepare('SELECT * FROM merchant_subscriptions WHERE shop_id = ?').get(shop.id);
  if (!existing) {
    db.prepare(`
      INSERT INTO merchant_subscriptions (
        shop_id, plan_id, status, current_period_start, current_period_end, stripe_subscription_id
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      shop.id,
      planId,
      status,
      period.start,
      period.end,
      shop.billing_subscription_id || null,
    );
  } else if (existing.plan_id !== planId || existing.status !== status || existing.stripe_subscription_id !== shop.billing_subscription_id) {
    db.prepare(`
      UPDATE merchant_subscriptions
      SET plan_id = ?,
          status = ?,
          stripe_subscription_id = ?,
          updated_at = datetime('now')
      WHERE shop_id = ?
    `).run(planId, status, shop.billing_subscription_id || existing.stripe_subscription_id, shop.id);
  }
  const current = db.prepare('SELECT * FROM merchant_subscriptions WHERE shop_id = ?').get(shop.id);
  if (current?.current_period_end && new Date(current.current_period_end).getTime() <= Date.now()) {
    db.prepare(`
      UPDATE merchant_subscriptions
      SET current_period_start = ?,
          current_period_end = ?,
          updated_at = datetime('now')
      WHERE shop_id = ?
    `).run(period.start, period.end, shop.id);
  }
  return db.prepare('SELECT * FROM merchant_subscriptions WHERE shop_id = ?').get(shop.id);
}

export function getMerchantPlan(db, shopId) {
  const subscription = ensureMerchantSubscription(db, shopId);
  if (!subscription) return null;
  const plan = getPlanById(db, subscription.plan_id);
  return { plan, subscription, period: billingPeriodForSubscription(subscription) };
}

export function getPaymentFeeMode(db, shopId) {
  ensureBillingReady(db);
  db.prepare('INSERT OR IGNORE INTO store_settings (shop_id) VALUES (?)').run(shopId);
  const row = db.prepare('SELECT payment_fee_mode FROM store_settings WHERE shop_id = ?').get(shopId) || {};
  return normaliseMode(row.payment_fee_mode);
}

export function updatePaymentFeeMode(db, shopId, mode) {
  const value = normaliseMode(mode);
  if (value !== mode) throw new Error('Invalid payment fee mode');
  ensureBillingReady(db);
  db.prepare('INSERT OR IGNORE INTO store_settings (shop_id) VALUES (?)').run(shopId);
  db.prepare('UPDATE store_settings SET payment_fee_mode = ? WHERE shop_id = ?').run(value, shopId);
  return value;
}

export function quoteUsageCount(db, shopId, period) {
  return int(db.prepare(`
    SELECT COUNT(*) as c
    FROM quote_usage_events
    WHERE shop_id = ?
      AND billing_period_start = ?
      AND billing_period_end = ?
  `).get(shopId, period.start, period.end)?.c);
}

export function recordQuoteUsageEvent(db, { shopId, quoteId = null, eventType = 'quote_sent' } = {}) {
  if (!shopId) throw new Error('shopId is required');
  const merchant = getMerchantPlan(db, shopId);
  if (!merchant) throw new Error('Shop billing plan not found');
  const { period } = merchant;
  db.prepare(`
    INSERT OR IGNORE INTO quote_usage_events (
      shop_id, quote_id, event_type, billing_period_start, billing_period_end
    )
    VALUES (?, ?, ?, ?, ?)
  `).run(shopId, quoteId == null ? null : String(quoteId), eventType, period.start, period.end);
  return getBillingUsageSummary(db, shopId);
}

export function previewQuoteUsage(db, shopId, additionalQuotes = 1) {
  const usage = getBillingUsageSummary(db, shopId);
  const nextUsed = usage.quotes_used_this_month + Math.max(1, int(additionalQuotes, 1));
  const allowance = usage.quote_allowance;
  const overAllowance = allowance != null && nextUsed > allowance;
  const extraQuotes = overAllowance ? nextUsed - allowance : 0;
  const estimatedOverageCents = usage.allow_overages ? extraQuotes * usage.quote_overage_price_cents : 0;
  return {
    ...usage,
    next_quotes_used: nextUsed,
    over_allowance: overAllowance,
    limit_reached: overAllowance && !usage.allow_overages,
    estimated_new_overage_cents: estimatedOverageCents,
    overage_warning: overAllowance && usage.allow_overages
      ? `You have used your included quotes for this billing period. Extra quotes are NZ$${(usage.quote_overage_price_cents / 100).toFixed(usage.quote_overage_price_cents % 100 ? 2 : 0)} each on ${usage.plan_name}.`
      : null,
  };
}

export function getBillingUsageSummary(db, shopId) {
  const merchant = getMerchantPlan(db, shopId);
  if (!merchant) throw new Error('Shop billing plan not found');
  const { plan, period } = merchant;
  const used = quoteUsageCount(db, shopId, period);
  const allowance = plan.quote_allowance == null ? null : int(plan.quote_allowance);
  const includedRemaining = allowance == null ? null : Math.max(0, allowance - used);
  const overageQuotes = allowance == null ? 0 : Math.max(0, used - allowance);
  const overagePrice = plan.quote_overage_price_cents == null ? 0 : int(plan.quote_overage_price_cents);
  const estimatedOverage = plan.allow_overages ? overageQuotes * overagePrice : 0;
  const checkout = db.prepare(`
    SELECT
      COALESCE(SUM(order_amount_cents), 0) as volume_cents,
      COALESCE(SUM(final_platform_fee_cents), 0) as fees_cents
    FROM checkout_fee_ledger
    WHERE shop_id = ?
      AND billing_period_start = ?
      AND billing_period_end = ?
      AND status != 'failed'
  `).get(shopId, period.start, period.end) || {};
  const adjustments = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) as cents
    FROM billing_adjustments
    WHERE shop_id = ?
      AND (billing_period_start IS NULL OR billing_period_start = ?)
      AND adjustment_type IN ('credit', 'waive_overage')
  `).get(shopId, period.start) || {};
  return {
    plan_id: plan.id,
    plan_name: plan.name,
    quote_allowance: allowance,
    quotes_used_this_month: used,
    remaining_included_quotes: includedRemaining,
    allow_overages: !!plan.allow_overages,
    quote_overage_price_cents: overagePrice,
    estimated_overage_charges_cents: Math.max(0, estimatedOverage - int(adjustments.cents)),
    checkout_volume_this_month_cents: int(checkout.volume_cents),
    checkout_platform_fee_used_cents: int(checkout.fees_cents),
    checkout_platform_fee_cap_cents: int(plan.checkout_fee_monthly_cap_cents),
    checkout_fee_basis_points: int(plan.checkout_fee_basis_points),
    checkout_enabled: !!plan.checkout_enabled,
    payment_fee_mode: getPaymentFeeMode(db, shopId),
    billing_period_start: period.start,
    billing_period_end: period.end,
  };
}

export function calculateCheckoutPlatformFee(db, { shopId, orderAmountCents, paymentMethod = 'card' }) {
  const merchant = getMerchantPlan(db, shopId);
  if (!merchant) throw new Error('Shop billing plan not found');
  const { plan, period } = merchant;
  const orderCents = cents(orderAmountCents);
  const isCardCheckout = paymentMethod === 'card';
  const used = int(db.prepare(`
    SELECT COALESCE(SUM(final_platform_fee_cents), 0) as cents
    FROM checkout_fee_ledger
    WHERE shop_id = ?
      AND billing_period_start = ?
      AND billing_period_end = ?
      AND status != 'failed'
  `).get(shopId, period.start, period.end)?.cents);
  const cap = cents(plan.checkout_fee_monthly_cap_cents);
  const basisPoints = cents(plan.checkout_fee_basis_points);
  const shouldChargeFee = isCardCheckout && plan.checkout_enabled;
  const raw = shouldChargeFee
    ? Math.max(0, orderCents - Math.floor(orderCents * Math.max(0, 10000 - basisPoints) / 10000))
    : 0;
  const capBefore = cap > 0 ? Math.max(0, cap - used) : 0;
  const finalFee = shouldChargeFee ? (cap > 0 ? Math.min(raw, capBefore) : raw) : 0;
  return {
    shop_id: shopId,
    billing_period_start: period.start,
    billing_period_end: period.end,
    order_amount_cents: orderCents,
    raw_platform_fee_cents: raw,
    final_platform_fee_cents: finalFee,
    cap_remaining_before_cents: capBefore,
    cap_remaining_after_cents: Math.max(0, capBefore - finalFee),
    checkout_enabled: !!plan.checkout_enabled,
    payment_method: paymentMethod,
    plan_id: plan.id,
  };
}

export function recordCheckoutFeeLedger(db, calculation, { orderId = null, status = 'pending' } = {}) {
  const result = db.prepare(`
    INSERT INTO checkout_fee_ledger (
      shop_id, order_id, billing_period_start, billing_period_end, order_amount_cents,
      raw_platform_fee_cents, final_platform_fee_cents, cap_remaining_before_cents,
      cap_remaining_after_cents, status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    calculation.shop_id,
    orderId,
    calculation.billing_period_start,
    calculation.billing_period_end,
    calculation.order_amount_cents,
    calculation.raw_platform_fee_cents,
    calculation.final_platform_fee_cents,
    calculation.cap_remaining_before_cents,
    calculation.cap_remaining_after_cents,
    status,
  );
  return result.lastInsertRowid;
}

export function markCheckoutLedgerStatus(db, orderId, status) {
  db.prepare(`
    UPDATE checkout_fee_ledger
    SET status = ?
    WHERE order_id = ?
  `).run(status, orderId);
}

export function estimatePaymentProcessingFee(db, { shopId, amountCents, paymentFeeMode = null }) {
  const mode = normaliseMode(paymentFeeMode || getPaymentFeeMode(db, shopId));
  if (mode !== 'pass_to_customer_at_cost') return 0;
  const settings = db.prepare('SELECT estimated_card_fee_basis_points, estimated_card_fee_fixed_cents FROM platform_settings WHERE id = 1').get() || {};
  const bps = cents(settings.estimated_card_fee_basis_points, DEFAULT_CARD_FEE_BPS);
  const fixed = cents(settings.estimated_card_fee_fixed_cents, DEFAULT_CARD_FEE_FIXED_CENTS);
  return Math.ceil(cents(amountCents) * bps / 10000) + fixed;
}

export function recordPaymentFeeRecord(db, input = {}) {
  const mode = normaliseMode(input.payment_fee_mode);
  const result = db.prepare(`
    INSERT INTO payment_fee_records (
      shop_id, order_id, stripe_payment_intent_id, stripe_charge_id,
      stripe_balance_transaction_id, stripe_fee_amount_cents, stripe_net_amount_cents,
      stripe_fee_details_json, payment_fee_mode, passed_to_customer_amount_cents
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.shop_id,
    input.order_id || null,
    input.stripe_payment_intent_id || null,
    input.stripe_charge_id || null,
    input.stripe_balance_transaction_id || null,
    cents(input.stripe_fee_amount_cents),
    cents(input.stripe_net_amount_cents),
    JSON.stringify(input.stripe_fee_details || input.stripe_fee_details_json || []),
    mode,
    cents(input.passed_to_customer_amount_cents),
  );
  return result.lastInsertRowid;
}

export async function recordStripePaymentFeeFromIntent(db, stripe, paymentIntentId) {
  if (!stripe || !paymentIntentId) return null;
  const order = db.prepare('SELECT * FROM orders WHERE stripe_payment_id = ?').get(paymentIntentId);
  if (!order) return null;
  const existing = db.prepare('SELECT id FROM payment_fee_records WHERE order_id = ? AND stripe_payment_intent_id = ?').get(order.id, paymentIntentId);
  if (existing) return existing.id;

  let intent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['latest_charge.balance_transaction'] });
  let charge = intent.latest_charge;
  if (typeof charge === 'string') {
    charge = await stripe.charges.retrieve(charge, { expand: ['balance_transaction'] });
  }
  const balance = charge?.balance_transaction;
  if (!balance || typeof balance === 'string') return null;
  return recordPaymentFeeRecord(db, {
    shop_id: order.shop_id,
    order_id: order.id,
    stripe_payment_intent_id: intent.id,
    stripe_charge_id: charge?.id || null,
    stripe_balance_transaction_id: balance.id || null,
    stripe_fee_amount_cents: balance.fee || 0,
    stripe_net_amount_cents: balance.net || 0,
    stripe_fee_details: balance.fee_details || [],
    payment_fee_mode: getPaymentFeeMode(db, order.shop_id),
    passed_to_customer_amount_cents: order.payment_processing_fee_cents || 0,
  });
}

export function createBillingAdjustment(db, { shopId, adjustmentType = 'credit', amountCents = 0, reason = '' } = {}) {
  const merchant = getMerchantPlan(db, shopId);
  if (!merchant) throw new Error('Shop billing plan not found');
  const result = db.prepare(`
    INSERT INTO billing_adjustments (
      shop_id, adjustment_type, amount_cents, reason, billing_period_start, billing_period_end
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(shopId, adjustmentType, cents(amountCents), reason || null, merchant.period.start, merchant.period.end);
  return { id: result.lastInsertRowid };
}

export function listCheckoutFeeLedger(db, { shopId = null, limit = 100 } = {}) {
  ensureBillingReady(db);
  const where = shopId ? 'WHERE l.shop_id = ?' : '';
  const params = shopId ? [shopId, limit] : [limit];
  return db.prepare(`
    SELECT l.*, s.name AS shop_name, s.slug AS shop_slug
    FROM checkout_fee_ledger l
    LEFT JOIN shops s ON s.id = l.shop_id
    ${where}
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT ?
  `).all(...params);
}

export function listPaymentFeeRecords(db, { shopId = null, limit = 100 } = {}) {
  ensureBillingReady(db);
  const where = shopId ? 'WHERE r.shop_id = ?' : '';
  const params = shopId ? [shopId, limit] : [limit];
  return db.prepare(`
    SELECT r.*, s.name AS shop_name, s.slug AS shop_slug
    FROM payment_fee_records r
    LEFT JOIN shops s ON s.id = r.shop_id
    ${where}
    ORDER BY r.created_at DESC, r.id DESC
    LIMIT ?
  `).all(...params);
}

export function checkoutSettingsForShop(db, shopSlugOrId, amountCents = 0) {
  ensureBillingReady(db);
  const shop = typeof shopSlugOrId === 'number'
    ? db.prepare("SELECT * FROM shops WHERE id = ? AND plan != 'suspended'").get(shopSlugOrId)
    : db.prepare("SELECT * FROM shops WHERE slug = ? AND plan != 'suspended'").get(shopSlugOrId);
  if (!shop) return null;
  const merchant = getMerchantPlan(db, shop.id);
  const mode = getPaymentFeeMode(db, shop.id);
  const processingFee = estimatePaymentProcessingFee(db, {
    shopId: shop.id,
    amountCents,
    paymentFeeMode: mode,
  });
  return {
    shop_id: shop.id,
    plan_id: merchant.plan.id,
    checkout_enabled: !!merchant.plan.checkout_enabled,
    payment_fee_mode: mode,
    bank_transfer_enabled: false,
    card_enabled: !!merchant.plan.checkout_enabled,
    estimated_payment_processing_fee_cents: processingFee,
    processing_fee_label: mode === 'pass_to_customer_at_cost'
      ? 'Card - processing fee applies at cost'
      : 'Card - no added card fee',
  };
}

export function assertCheckoutAllowed(db, shopId, { method = 'card' } = {}) {
  const merchant = getMerchantPlan(db, shopId);
  if (!merchant) {
    const err = new Error('Shop billing plan not found');
    err.status = 404;
    throw err;
  }
  const mode = getPaymentFeeMode(db, shopId);
  if (method === 'card' && !merchant.plan.checkout_enabled) {
    const err = new Error('Card checkout is not enabled on this plan.');
    err.status = 402;
    err.code = 'CHECKOUT_DISABLED';
    throw err;
  }
  return { plan: merchant.plan, payment_fee_mode: mode };
}

import { defaultPlanById, normalisePlanId } from './billing-plans.js';
import { ensureMerchantSubscription } from './billing-service.js';

export const BILLING_STATUSES = new Set([
  'pending_subscription',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'suspended',
]);

export const BILLING_ACTIVE_STATUSES = new Set(['active', 'trialing']);

export const FREE_BILLING_PLANS = new Set(['community']);
export const PAID_BILLING_PLANS = new Set(['starter', 'growth', 'scale']);

export const BILLING_STATUS_LABELS = {
  pending_subscription: 'Pending subscription',
  trialing: 'Trialing',
  active: 'Active',
  past_due: 'Past due',
  canceled: 'Canceled',
  suspended: 'Suspended',
};

function timestampToIso(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

function platformStripeReady(config = {}) {
  const hasPublishable = !!(config.publishableKey || config.publishable_key || config.has_publishable_key);
  const hasSecret = !!(config.secretKey || config.secret_key || config.has_secret_key || config.can_accept_cards);
  return hasPublishable && hasSecret;
}

export function normaliseBillingStatus(status) {
  const value = String(status || '').trim().toLowerCase();
  if (BILLING_STATUSES.has(value)) return value;
  if (value === 'unpaid') return 'past_due';
  if (value === 'incomplete') return 'pending_subscription';
  if (value === 'incomplete_expired') return 'canceled';
  if (value === 'paused') return 'suspended';
  return 'pending_subscription';
}

export function isFreeBillingPlan(plan) {
  return FREE_BILLING_PLANS.has(String(plan || 'starter').trim().toLowerCase());
}

export function isPaidBillingPlan(plan) {
  return PAID_BILLING_PLANS.has(String(plan || '').trim().toLowerCase());
}

export function billingStatusIsActive(status, plan = null) {
  if (normaliseBillingStatus(status) === 'suspended') return false;
  if (plan && isFreeBillingPlan(plan)) return true;
  return BILLING_ACTIVE_STATUSES.has(normaliseBillingStatus(status));
}

export function getBillingPriceIdForPlan(plan, env = process.env) {
  const planId = normalisePlanId(plan);
  return {
    starter: env.STRIPE_BILLING_STARTER_PRICE_ID || env.STRIPE_BILLING_PRICE_ID || '',
    growth: env.STRIPE_BILLING_GROWTH_PRICE_ID || '',
    scale: env.STRIPE_BILLING_SCALE_PRICE_ID || '',
  }[planId] || '';
}

export function getBillingPriceSetupStatus(env = process.env) {
  return {
    community: true,
    starter: !!getBillingPriceIdForPlan('starter', env),
    growth: !!getBillingPriceIdForPlan('growth', env),
    scale: !!getBillingPriceIdForPlan('scale', env),
  };
}

export function liveOrderReadiness(shop = {}, platformConfig = {}) {
  const billingStatus = normaliseBillingStatus(shop.billing_status);
  const billingActive = billingStatusIsActive(billingStatus, shop.plan);
  const connectedAccountId = shop.stripe_account_id || null;
  const chargesEnabled = !!shop.stripe_charges_enabled;
  const payoutsEnabled = !!shop.stripe_payouts_enabled;
  const detailsSubmitted = !!shop.stripe_details_submitted;
  const onboardingComplete = !!(connectedAccountId && chargesEnabled && payoutsEnabled && detailsSubmitted);

  let code = null;
  let error = null;
  if (!platformStripeReady(platformConfig)) {
    code = 'PLATFORM_STRIPE_NOT_CONFIGURED';
    error = 'Stripe is not configured on the platform yet.';
  } else if (!billingActive) {
    code = 'SUBSCRIPTION_INACTIVE';
    error = 'This store subscription is not active yet.';
  } else if (!connectedAccountId) {
    code = 'NO_CONNECTED_ACCOUNT';
    error = 'This store has not connected Stripe yet.';
  } else if (!onboardingComplete) {
    code = 'ONBOARDING_INCOMPLETE';
    error = 'This store still needs to finish Stripe onboarding before it can accept live payments.';
  }

  return {
    billing_status: billingStatus,
    billing_active: billingActive,
    connected_account_id: connectedAccountId,
    charges_enabled: chargesEnabled,
    payouts_enabled: payoutsEnabled,
    details_submitted: detailsSubmitted,
    onboarding_complete: onboardingComplete,
    can_accept_live_orders: !code,
    code,
    error,
  };
}

export async function createBusinessBillingSession({
  db,
  stripe,
  shop,
  baseUrl,
  priceId = getBillingPriceIdForPlan(shop?.plan),
}) {
  if (!db) throw new Error('Database is required');
  if (!shop?.id) throw new Error('Shop is required');
  if (!baseUrl) throw new Error('Base URL is required');
  const planId = normalisePlanId(shop.plan);
  if (isFreeBillingPlan(planId)) {
    const err = new Error('Community is free; no monthly billing checkout is required.');
    err.code = 'FREE_PLAN_NO_BILLING_REQUIRED';
    throw err;
  }
  if (!stripe) {
    const err = new Error('Stripe Billing is not configured.');
    err.code = 'BILLING_STRIPE_NOT_CONFIGURED';
    throw err;
  }
  if (!priceId) {
    const err = new Error(`Stripe Billing price is not configured for ${defaultPlanById(planId).name}.`);
    err.code = 'BILLING_PRICE_NOT_CONFIGURED';
    throw err;
  }

  const subscription = ensureMerchantSubscription(db, shop.id);
  const plan = defaultPlanById(planId);
  const hasUsedTrial = !!subscription?.trial_start;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    customer_email: shop.email,
    client_reference_id: String(shop.id),
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${baseUrl}/platform/admin.html?billing=success&shop=${shop.id}`,
    cancel_url: `${baseUrl}/platform/admin.html?billing=cancelled&shop=${shop.id}`,
    subscription_data: {
      metadata: {
        shopId: String(shop.id),
        shopSlug: shop.slug || '',
        plan: planId,
      },
      ...(plan.trial_days && !hasUsedTrial ? { trial_period_days: plan.trial_days } : {}),
    },
    metadata: {
      shopId: String(shop.id),
      shopSlug: shop.slug || '',
      plan: planId,
    },
  });

  db.prepare(`
    UPDATE shops
    SET billing_checkout_session_id = ?,
        billing_checkout_status = ?,
        billing_price_id = ?,
        billing_status = CASE
          WHEN billing_status = 'suspended' THEN 'suspended'
          ELSE 'pending_subscription'
        END,
        billing_updated_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(session.id, session.status || 'open', priceId, shop.id);

  return {
    billing_checkout_url: session.url,
    billing_setup_status: 'checkout_created',
    billing_setup_error: null,
  };
}

export function updateShopBillingFromCheckoutSession(db, session = {}) {
  const shopId = Number(session.metadata?.shopId || session.client_reference_id);
  if (!shopId) return false;
  const planId = normalisePlanId(session.metadata?.plan);
  db.prepare(`
    UPDATE shops
    SET billing_customer_id = COALESCE(?, billing_customer_id),
        billing_subscription_id = COALESCE(?, billing_subscription_id),
        billing_checkout_session_id = COALESCE(?, billing_checkout_session_id),
        billing_checkout_status = COALESCE(?, billing_checkout_status),
        billing_status = CASE
          WHEN ? = 'complete' THEN 'active'
          ELSE billing_status
        END,
        billing_updated_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    typeof session.customer === 'string' ? session.customer : session.customer?.id || null,
    typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || null,
    session.id || null,
    session.status || null,
    session.status || null,
    shopId,
  );
  const subscription = ensureMerchantSubscription(db, shopId);
  db.prepare(`
    UPDATE merchant_subscriptions
    SET plan_id = ?,
        status = CASE WHEN ? = 'complete' THEN 'active' ELSE status END,
        stripe_subscription_id = COALESCE(?, stripe_subscription_id),
        trial_start = COALESCE(trial_start, CASE WHEN ? = 'complete' THEN datetime('now') ELSE trial_start END),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    planId || subscription.plan_id,
    session.status || null,
    typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || null,
    session.status || null,
    subscription.id,
  );
  return true;
}

export function updateShopBillingFromSubscription(db, subscription = {}) {
  const shopId = Number(subscription.metadata?.shopId);
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id || null;
  const subscriptionId = subscription.id || null;
  const status = normaliseBillingStatus(subscription.status);
  const currentPeriodStart = timestampToIso(subscription.current_period_start);
  const currentPeriodEnd = timestampToIso(subscription.current_period_end);
  const priceId = subscription.items?.data?.[0]?.price?.id || null;

  if (shopId) {
    db.prepare(`
      UPDATE shops
      SET billing_customer_id = COALESCE(?, billing_customer_id),
          billing_subscription_id = COALESCE(?, billing_subscription_id),
          billing_price_id = COALESCE(?, billing_price_id),
          billing_status = ?,
          billing_current_period_end = COALESCE(?, billing_current_period_end),
          billing_updated_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(customerId, subscriptionId, priceId, status, currentPeriodEnd, shopId);
    const merchant = ensureMerchantSubscription(db, shopId);
    db.prepare(`
      UPDATE merchant_subscriptions
      SET plan_id = ?,
          status = ?,
          trial_start = COALESCE(trial_start, ?),
          trial_end = COALESCE(?, trial_end),
          current_period_start = COALESCE(?, current_period_start),
          current_period_end = COALESCE(?, current_period_end),
          stripe_subscription_id = COALESCE(?, stripe_subscription_id),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      normalisePlanId(subscription.metadata?.plan || merchant.plan_id),
      status,
      timestampToIso(subscription.trial_start),
      timestampToIso(subscription.trial_end),
      currentPeriodStart,
      currentPeriodEnd,
      subscriptionId,
      merchant.id,
    );
    return true;
  }

  if (subscriptionId || customerId) {
    db.prepare(`
      UPDATE shops
      SET billing_subscription_id = COALESCE(?, billing_subscription_id),
          billing_price_id = COALESCE(?, billing_price_id),
          billing_status = ?,
          billing_current_period_end = COALESCE(?, billing_current_period_end),
          billing_updated_at = datetime('now'),
          updated_at = datetime('now')
      WHERE (? IS NOT NULL AND billing_subscription_id = ?)
         OR (? IS NOT NULL AND billing_customer_id = ?)
    `).run(subscriptionId, priceId, status, currentPeriodEnd, subscriptionId, subscriptionId, customerId, customerId);
    return true;
  }
  return false;
}

export function markShopBillingPastDue(db, invoice = {}) {
  const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id || null;
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || null;
  if (!subscriptionId && !customerId) return false;

  db.prepare(`
    UPDATE shops
    SET billing_status = 'past_due',
        billing_updated_at = datetime('now'),
        updated_at = datetime('now')
    WHERE (? IS NOT NULL AND billing_subscription_id = ?)
       OR (? IS NOT NULL AND billing_customer_id = ?)
  `).run(subscriptionId, subscriptionId, customerId, customerId);
  return true;
}

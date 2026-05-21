import { defaultPlanById, normalisePlanId } from './billing-plans.js';
import { ensureBillingReady, ensureMerchantSubscription } from './billing-service.js';

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

function isoToTimestamp(value) {
  const ms = new Date(value || '').getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.floor(ms / 1000);
}

function futureIso(value, now = new Date()) {
  const ms = new Date(value || '').getTime();
  return Number.isFinite(ms) && ms > now.getTime();
}

function billingReturnUrl(baseUrl, state) {
  return `${baseUrl}/admin/payments.html?billing=${encodeURIComponent(state)}`;
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

export function reconcileShopBilling(db, shopOrId, now = new Date()) {
  if (!db) throw new Error('Database is required');
  ensureBillingReady(db);
  const shop = typeof shopOrId === 'object' && shopOrId?.id
    ? db.prepare('SELECT * FROM shops WHERE id = ?').get(shopOrId.id)
    : db.prepare('SELECT * FROM shops WHERE id = ?').get(shopOrId);
  if (!shop) return null;
  let subscription = ensureMerchantSubscription(db, shop.id);
  const planId = normalisePlanId(subscription?.plan_id || shop.plan);
  const trialExpired = isPaidBillingPlan(planId)
    && subscription?.status === 'trialing'
    && !subscription?.stripe_subscription_id
    && subscription?.trial_end
    && new Date(subscription.trial_end).getTime() <= now.getTime();

  if (trialExpired) {
    db.prepare(`
      UPDATE shops
      SET billing_status = 'pending_subscription',
          billing_cancel_at_period_end = 0,
          billing_cancel_at = NULL,
          billing_updated_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(shop.id);
    db.prepare(`
      UPDATE merchant_subscriptions
      SET status = 'pending_subscription',
          cancel_at_period_end = 0,
          cancel_at = NULL,
          updated_at = datetime('now')
      WHERE shop_id = ?
    `).run(shop.id);
    subscription = db.prepare('SELECT * FROM merchant_subscriptions WHERE shop_id = ?').get(shop.id);
  }

  return {
    shop: db.prepare('SELECT * FROM shops WHERE id = ?').get(shop.id),
    subscription,
  };
}

export function getSubscriptionSummary(db, shopId, now = new Date()) {
  const reconciled = reconcileShopBilling(db, shopId, now);
  if (!reconciled?.shop || !reconciled?.subscription) return null;
  const { shop, subscription } = reconciled;
  const plan = defaultPlanById(subscription.plan_id || shop.plan);
  const status = normaliseBillingStatus(shop.billing_status || subscription.status);
  const isFreePlan = isFreeBillingPlan(plan.id);
  const isPaidPlan = isPaidBillingPlan(plan.id);
  const billingActive = billingStatusIsActive(status, plan.id);
  const hasStripeCustomer = !!shop.billing_customer_id;
  const hasStripeSubscription = !!(shop.billing_subscription_id || subscription.stripe_subscription_id);
  const canStartCheckout = isPaidPlan
    && !['suspended'].includes(status)
    && (!hasStripeSubscription || ['pending_subscription', 'past_due', 'canceled'].includes(status) || (status === 'trialing' && !hasStripeSubscription));

  return {
    plan_id: plan.id,
    plan_name: plan.name,
    monthly_price_cents: plan.monthly_price_cents,
    currency: plan.currency || 'NZD',
    trial_days: plan.trial_days || 0,
    billing_status: status,
    billing_active: billingActive,
    billing_activation_required: isPaidPlan && !billingActive,
    is_free_plan: isFreePlan,
    is_paid_plan: isPaidPlan,
    can_start_checkout: canStartCheckout,
    can_manage_subscription: hasStripeCustomer,
    has_stripe_customer: hasStripeCustomer,
    has_stripe_subscription: hasStripeSubscription,
    trial_start: subscription.trial_start || null,
    trial_end: subscription.trial_end || null,
    current_period_start: subscription.current_period_start || null,
    current_period_end: subscription.current_period_end || shop.billing_current_period_end || null,
    billing_current_period_end: shop.billing_current_period_end || subscription.current_period_end || null,
    billing_cancel_at_period_end: !!shop.billing_cancel_at_period_end || !!subscription.cancel_at_period_end,
    billing_cancel_at: shop.billing_cancel_at || subscription.cancel_at || null,
    stripe_billing_hosted: true,
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
  ensureBillingReady(db);
  const reconciled = reconcileShopBilling(db, shop.id);
  const freshShop = reconciled?.shop || shop;
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
  if (!stripe?.checkout?.sessions?.create) {
    const err = new Error('Stripe Billing is not configured.');
    err.code = 'BILLING_STRIPE_NOT_CONFIGURED';
    throw err;
  }

  const subscription = ensureMerchantSubscription(db, shop.id);
  const plan = defaultPlanById(planId);
  const remainingTrialEnd = subscription?.status === 'trialing'
    && !subscription?.stripe_subscription_id
    && futureIso(subscription.trial_end)
    ? isoToTimestamp(subscription.trial_end)
    : null;
  const hasUsedTrial = !!subscription?.trial_start;
  const trialPayload = remainingTrialEnd
    ? { trial_end: remainingTrialEnd }
    : (plan.trial_days && !hasUsedTrial ? { trial_period_days: plan.trial_days } : {});
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    payment_method_collection: 'always',
    ...(freshShop.billing_customer_id ? { customer: freshShop.billing_customer_id } : { customer_email: freshShop.email }),
    client_reference_id: String(freshShop.id),
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: billingReturnUrl(baseUrl, 'success'),
    cancel_url: billingReturnUrl(baseUrl, 'cancelled'),
    subscription_data: {
      metadata: {
        shopId: String(freshShop.id),
        shopSlug: freshShop.slug || '',
        plan: planId,
      },
      ...trialPayload,
    },
    metadata: {
      shopId: String(freshShop.id),
      shopSlug: freshShop.slug || '',
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
  `).run(session.id, session.status || 'open', priceId, freshShop.id);

  return {
    billing_checkout_url: session.url,
    billing_setup_status: 'checkout_created',
    billing_setup_error: null,
  };
}

export async function createBillingPortalSession({ db, stripe, shop, baseUrl }) {
  if (!db) throw new Error('Database is required');
  if (!shop?.id) throw new Error('Shop is required');
  if (!baseUrl) throw new Error('Base URL is required');
  if (!stripe?.billingPortal?.sessions?.create) {
    const err = new Error('Stripe Billing is not configured.');
    err.code = 'BILLING_STRIPE_NOT_CONFIGURED';
    throw err;
  }
  const freshShop = db.prepare('SELECT * FROM shops WHERE id = ?').get(shop.id) || shop;
  if (!freshShop.billing_customer_id) {
    const err = new Error('Activate your Trennen subscription before opening the Stripe Billing Portal.');
    err.code = 'BILLING_CUSTOMER_REQUIRED';
    throw err;
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: freshShop.billing_customer_id,
      return_url: billingReturnUrl(baseUrl, 'portal_return'),
    });
    return { billing_portal_url: session.url };
  } catch (err) {
    if (
      err?.code === 'billing_portal_no_default_configuration'
      || /billing portal|configuration/i.test(err?.message || '')
    ) {
      const friendly = new Error('Stripe Billing Portal is not configured yet. Enable cancellation and payment method updates in Stripe, then try again.');
      friendly.code = 'BILLING_PORTAL_NOT_CONFIGURED';
      throw friendly;
    }
    throw err;
  }
}

export function updateShopBillingFromCheckoutSession(db, session = {}) {
  ensureBillingReady(db);
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
  ensureBillingReady(db);
  const shopId = Number(subscription.metadata?.shopId);
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id || null;
  const subscriptionId = subscription.id || null;
  const status = normaliseBillingStatus(subscription.status);
  const currentPeriodStart = timestampToIso(subscription.current_period_start);
  const currentPeriodEnd = timestampToIso(subscription.current_period_end);
  const priceId = subscription.items?.data?.[0]?.price?.id || null;
  const cancelAtPeriodEnd = subscription.cancel_at_period_end ? 1 : 0;
  const cancelAt = timestampToIso(subscription.cancel_at)
    || (cancelAtPeriodEnd ? currentPeriodEnd : timestampToIso(subscription.canceled_at));

  if (shopId) {
    db.prepare(`
      UPDATE shops
      SET billing_customer_id = COALESCE(?, billing_customer_id),
          billing_subscription_id = COALESCE(?, billing_subscription_id),
          billing_price_id = COALESCE(?, billing_price_id),
          billing_status = ?,
          billing_current_period_end = COALESCE(?, billing_current_period_end),
          billing_cancel_at_period_end = ?,
          billing_cancel_at = ?,
          billing_updated_at = datetime('now'),
          updated_at = datetime('now')
      WHERE id = ?
    `).run(customerId, subscriptionId, priceId, status, currentPeriodEnd, cancelAtPeriodEnd, cancelAt, shopId);
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
          cancel_at_period_end = ?,
          cancel_at = ?,
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
      cancelAtPeriodEnd,
      cancelAt,
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
          billing_cancel_at_period_end = ?,
          billing_cancel_at = ?,
          billing_updated_at = datetime('now'),
          updated_at = datetime('now')
      WHERE (? IS NOT NULL AND billing_subscription_id = ?)
         OR (? IS NOT NULL AND billing_customer_id = ?)
    `).run(subscriptionId, priceId, status, currentPeriodEnd, cancelAtPeriodEnd, cancelAt, subscriptionId, subscriptionId, customerId, customerId);
    const shops = db.prepare(`
      SELECT id FROM shops
      WHERE (? IS NOT NULL AND billing_subscription_id = ?)
         OR (? IS NOT NULL AND billing_customer_id = ?)
    `).all(subscriptionId, subscriptionId, customerId, customerId);
    for (const row of shops) {
      const merchant = ensureMerchantSubscription(db, row.id);
      if (!merchant) continue;
      db.prepare(`
        UPDATE merchant_subscriptions
        SET status = ?,
            current_period_start = COALESCE(?, current_period_start),
            current_period_end = COALESCE(?, current_period_end),
            stripe_subscription_id = COALESCE(?, stripe_subscription_id),
            cancel_at_period_end = ?,
            cancel_at = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(status, currentPeriodStart, currentPeriodEnd, subscriptionId, cancelAtPeriodEnd, cancelAt, merchant.id);
    }
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

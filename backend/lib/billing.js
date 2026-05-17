export const BILLING_STATUSES = new Set([
  'pending_subscription',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'suspended',
]);

export const BILLING_ACTIVE_STATUSES = new Set(['active', 'trialing']);

export const BILLING_STATUS_LABELS = {
  pending_subscription: 'Pending subscription',
  trialing: 'Trialing',
  active: 'Active',
  past_due: 'Past due',
  canceled: 'Canceled',
  suspended: 'Suspended',
};

const PLAN_PRICE_ENV = {
  starter: 'STRIPE_BILLING_STARTER_PRICE_ID',
  pro: 'STRIPE_BILLING_PRO_PRICE_ID',
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

export function billingStatusIsActive(status) {
  return BILLING_ACTIVE_STATUSES.has(normaliseBillingStatus(status));
}

export function getBillingPriceIdForPlan(plan, env = process.env) {
  const key = PLAN_PRICE_ENV[String(plan || 'starter').toLowerCase()] || PLAN_PRICE_ENV.starter;
  return env[key] || '';
}

export function getBillingPriceSetupStatus(env = process.env) {
  return {
    starter: !!env.STRIPE_BILLING_STARTER_PRICE_ID,
    pro: !!env.STRIPE_BILLING_PRO_PRICE_ID,
  };
}

export function liveOrderReadiness(shop = {}, platformConfig = {}) {
  const billingStatus = normaliseBillingStatus(shop.billing_status);
  const billingActive = billingStatusIsActive(billingStatus);
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
  if (!stripe) throw new Error('Stripe client is required');
  if (!shop?.id) throw new Error('Shop is required');
  if (!baseUrl) throw new Error('Base URL is required');
  if (!priceId) {
    const err = new Error(`No Stripe Billing price ID is configured for the ${shop.plan || 'starter'} plan.`);
    err.code = 'BILLING_PRICE_NOT_CONFIGURED';
    throw err;
  }

  let customerId = shop.billing_customer_id || '';
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: shop.email,
      name: shop.name,
      metadata: {
        shopId: String(shop.id),
        shopSlug: shop.slug,
        plan: shop.plan || 'starter',
      },
    });
    customerId = customer.id;
  }

  const cleanBase = String(baseUrl).replace(/\/+$/, '');
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: String(shop.id),
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${cleanBase}/admin/payments.html?billing=success`,
    cancel_url: `${cleanBase}/admin/payments.html?billing=cancelled`,
    metadata: {
      shopId: String(shop.id),
      shopSlug: shop.slug,
      plan: shop.plan || 'starter',
    },
    subscription_data: {
      metadata: {
        shopId: String(shop.id),
        shopSlug: shop.slug,
        plan: shop.plan || 'starter',
      },
    },
  });

  db.prepare(`
    UPDATE shops
    SET billing_customer_id = ?,
        billing_price_id = ?,
        billing_checkout_session_id = ?,
        billing_checkout_status = 'created',
        billing_status = CASE
          WHEN billing_status IN ('active', 'trialing', 'past_due', 'suspended') THEN billing_status
          ELSE 'pending_subscription'
        END,
        billing_updated_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(customerId, priceId, session.id || null, shop.id);

  return session;
}

export function updateShopBillingFromCheckoutSession(db, session = {}) {
  const shopId = Number(session.metadata?.shopId || session.client_reference_id);
  if (!shopId) return false;
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
  return true;
}

export function updateShopBillingFromSubscription(db, subscription = {}) {
  const shopId = Number(subscription.metadata?.shopId);
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id || null;
  const subscriptionId = subscription.id || null;
  const status = normaliseBillingStatus(subscription.status);
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

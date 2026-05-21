import { Router } from 'express';
import Stripe from 'stripe';
import { randomBytes } from 'crypto';
import rateLimit from 'express-rate-limit';
import { db, requireShopAuth } from '../middleware/auth.js';
import {
  getEffectivePlatformStripeConfig,
  getMaskedPlatformStripeConfig,
  getPlatformStripeClient,
  updateShopStripeReadiness,
} from '../lib/platform-payments.js';
import {
  liveOrderReadiness,
  markShopBillingPastDue,
  updateShopBillingFromCheckoutSession,
  updateShopBillingFromSubscription,
} from '../lib/billing.js';
import {
  assertCheckoutAllowed,
  calculateCheckoutPlatformFee,
  estimatePaymentProcessingFee,
  getPaymentFeeMode,
  markCheckoutLedgerStatus,
  previewQuoteUsage,
  recordCheckoutFeeLedger,
  recordQuoteUsageEvent,
  recordStripePaymentFeeFromIntent,
} from '../lib/billing-service.js';
import {
  PricingError,
} from '../lib/pricing-engine.js';
import { normaliseCart, validateCartForShop } from '../lib/cart.js';
import { saveOrderItems } from '../lib/order-files.js';
import { sendMail } from '../lib/mailer.js';
import { renderTemplate } from '../lib/email-templates/index.js';

const router = Router();
const paymentIntentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { error: 'Too many payment attempts, please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const READINESS_ERROR_CODES = new Set([
  'PLATFORM_STRIPE_NOT_CONFIGURED',
  'SUBSCRIPTION_INACTIVE',
  'NO_CONNECTED_ACCOUNT',
  'ONBOARDING_INCOMPLETE',
]);

function getPlatformStripe() {
  return getPlatformStripeClient();
}

function ensurePlatformStripe() {
  const stripe = getPlatformStripe();
  if (!stripe) throw new Error('Stripe is not configured on this server.');
  return stripe;
}

function stripeErrorSummary(err) {
  return {
    type: err?.type || null,
    code: err?.code || null,
    message: err?.message || 'Stripe request failed.',
    requestId: err?.requestId || err?.raw?.requestId || null,
    statusCode: err?.statusCode || null,
  };
}

function isConnectPlatformRegistrationError(err) {
  const message = String(err?.message || err?.raw?.message || '');
  return message.includes("signed up for Connect");
}

async function syncShopStripeAccount(shop) {
  if (!shop?.stripe_account_id) return null;

  const stripe = getPlatformStripe();
  if (!stripe) return null;

  const account = await stripe.accounts.retrieve(shop.stripe_account_id);
  updateShopStripeReadiness(shop.id, account);
  return account;
}

function onboardingComplete(account) {
  return !!(account?.details_submitted && account?.charges_enabled && account?.payouts_enabled);
}

function shopReadinessPayload(shop, account = null) {
  const chargesEnabled = account ? !!account.charges_enabled : !!shop?.stripe_charges_enabled;
  const payoutsEnabled = account ? !!account.payouts_enabled : !!shop?.stripe_payouts_enabled;
  const detailsSubmitted = account ? !!account.details_submitted : !!shop?.stripe_details_submitted;
  const requirementsDue = account?.requirements?.currently_due || [];

  return {
    billing_status: shop?.billing_status || 'pending_subscription',
    connected_account_id: shop?.stripe_account_id || null,
    charges_enabled: chargesEnabled,
    payouts_enabled: payoutsEnabled,
    details_submitted: detailsSubmitted,
    onboarding_complete: chargesEnabled && payoutsEnabled && detailsSubmitted,
    requirements_due: requirementsDue,
  };
}

function readinessErrorPayload(readiness) {
  const code = READINESS_ERROR_CODES.has(readiness.code) ? readiness.code : 'ONBOARDING_INCOMPLETE';
  return {
    error: readiness.error || 'This store cannot accept live payments yet.',
    code,
    billing_status: readiness.billing_status,
    can_accept_live_orders: false,
  };
}

function logRouteError(label, err) {
  if (err instanceof PricingError) {
    console.error(label, {
      name: err.name,
      code: err.code,
      status: err.status,
      message: err.message,
    });
    return;
  }
  console.error(label, stripeErrorSummary(err));
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function ensureOrderPublicTokenColumn() {
  const cols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
  if (!cols.includes('public_token')) {
    db.exec('ALTER TABLE orders ADD COLUMN public_token TEXT');
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_public_token
      ON orders(public_token)
      WHERE public_token IS NOT NULL
  `);
}

function newPublicOrderToken() {
  return randomBytes(24).toString('base64url');
}

async function sendPaidOrderConfirmation(orderId) {
  const order = db.prepare(`
    SELECT o.*, m.name AS material_name
    FROM orders o
    LEFT JOIN materials m ON m.id = o.material_id
    WHERE o.id = ?
  `).get(orderId);
  if (!order?.customer_email) return;
  const shop = db.prepare('SELECT id, name, slug, email FROM shops WHERE id = ?').get(order.shop_id);
  if (!shop) return;
  const tpl = renderTemplate('order_status', { shop, order });
  try {
    await sendMail({
      shopId: shop.id,
      shopSlug: shop.slug,
      templateId: tpl.templateId,
      category: tpl.category,
      idempotencyKey: `order-paid-${order.id}`,
      to: order.customer_email,
      from: tpl.from,
      replyTo: tpl.replyTo,
      subject: tpl.subject,
      text: tpl.text,
      html: tpl.html,
    });
  } catch (err) {
    console.error('Paid order confirmation email failed:', err.message);
  }
}

export async function stripeWebhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  const { secretKey, webhookSecret } = getEffectivePlatformStripeConfig();
  let event;

  try {
    const platformStripe = new Stripe(secretKey || '');
    event = platformStripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  try {
    if (event.type === 'payment_intent.succeeded') {
      db.prepare("UPDATE orders SET payment_status = 'paid' WHERE stripe_payment_id = ?")
        .run(event.data.object.id);
      const order = db.prepare('SELECT id FROM orders WHERE stripe_payment_id = ?').get(event.data.object.id);
      if (order) {
        markCheckoutLedgerStatus(db, order.id, 'charged');
        await recordStripePaymentFeeFromIntent(db, getPlatformStripe(), event.data.object.id);
        await sendPaidOrderConfirmation(order.id);
      }
    }

    if (event.type === 'payment_intent.payment_failed') {
      db.prepare("UPDATE orders SET payment_status = 'failed' WHERE stripe_payment_id = ?")
        .run(event.data.object.id);
      const order = db.prepare('SELECT id FROM orders WHERE stripe_payment_id = ?').get(event.data.object.id);
      if (order) markCheckoutLedgerStatus(db, order.id, 'failed');
    }

    if (event.type === 'account.updated') {
      const account = event.data.object;
      const shop = db.prepare('SELECT id FROM shops WHERE stripe_account_id = ?').get(account.id);
      if (shop) updateShopStripeReadiness(shop.id, account);
    }

    if (event.type === 'checkout.session.completed') {
      updateShopBillingFromCheckoutSession(db, event.data.object);
    }

    if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      updateShopBillingFromSubscription(db, event.data.object);
    }

    if (event.type === 'invoice.payment_failed') {
      markShopBillingPastDue(db, event.data.object);
    }
  } catch (err) {
    logRouteError('Webhook processing error:', err);
  }

  res.json({ received: true });
}

router.get('/keys-status', requireShopAuth, async (req, res) => {
  try {
    const platform = getMaskedPlatformStripeConfig();
    const effectivePlatform = getEffectivePlatformStripeConfig();
    const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.shop.id);
    const account = await syncShopStripeAccount(shop);
    const refreshedShop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.shop.id);
    const baseReadiness = {
      ...liveOrderReadiness(refreshedShop, effectivePlatform),
      requirements_due: account?.requirements?.currently_due || [],
    };

    res.json({
      ...platform,
      ...shopReadinessPayload(refreshedShop, account),
      ...baseReadiness,
    });
  } catch (err) {
    logRouteError('Stripe status error:', err);
    res.status(500).json({ error: 'Failed to load Stripe status' });
  }
});

router.put('/keys', requireShopAuth, (req, res) => {
  res.status(403).json({ error: 'Stripe keys are managed from the platform portal.' });
});

router.get('/public-key', (req, res) => {
  const slug = req.query.shop;
  if (!slug) return res.status(400).json({ error: 'shop required' });

  const shop = db.prepare(
    `SELECT *
     FROM shops WHERE slug = ? AND plan != 'suspended'`
  ).get(slug);

  if (!shop) return res.status(404).json({ error: 'Shop not found' });

  try {
    assertCheckoutAllowed(db, shop.id, { method: 'card' });
  } catch (err) {
    return res.status(err.status || 409).json({
      error: err.message,
      code: err.code || 'CHECKOUT_UNAVAILABLE',
      can_accept_live_orders: false,
    });
  }

  const platform = getEffectivePlatformStripeConfig();
  const readiness = liveOrderReadiness(shop, platform);
  if (!readiness.can_accept_live_orders) {
    return res.status(503).json(readinessErrorPayload(readiness));
  }

  res.json({
    publishable_key: platform.publishableKey,
    has_connect: true,
    billing_status: readiness.billing_status,
    can_accept_live_orders: true,
  });
});

router.post('/create-payment-intent', paymentIntentLimiter, async (req, res) => {
  try {
    const { paymentMethodId, shopSlug, amount, customerEmail, customerName, orderData } = req.body;

    if (!paymentMethodId || !shopSlug || !amount || !customerEmail || !orderData) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!validateEmail(customerEmail)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }

    const shop = db.prepare("SELECT * FROM shops WHERE slug = ? AND plan != 'suspended'").get(shopSlug);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });

    const platform = getEffectivePlatformStripeConfig();
    const readiness = liveOrderReadiness(shop, platform);
    if (!readiness.can_accept_live_orders) {
      return res.status(503).json(readinessErrorPayload(readiness));
    }
    assertCheckoutAllowed(db, shop.id, { method: 'card' });

    const stripe = ensurePlatformStripe();
    const cart = validateCartForShop(db, shop, normaliseCart({
      ...(orderData || {}),
      shopSlug,
      items: Array.isArray(orderData?.items) && orderData.items.length ? orderData.items : null,
    }, shopSlug));
    const usagePreview = previewQuoteUsage(db, shop.id);
    if (usagePreview.limit_reached) {
      return res.status(402).json({
        error: 'You have used your included quotes for this billing period. Upgrade to keep sending quotes.',
        code: 'QUOTE_LIMIT_REACHED',
        usage: usagePreview,
      });
    }
    const paymentFeeMode = getPaymentFeeMode(db, shop.id);
    const paymentProcessingFeeCents = estimatePaymentProcessingFee(db, {
      shopId: shop.id,
      amountCents: cart.totalCents,
      paymentFeeMode,
    });
    const customerPayCents = cart.totalCents + paymentProcessingFeeCents;
    const claimedCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(claimedCents) || claimedCents !== customerPayCents) {
      const err = new PricingError(
        'Checkout total changed. Please review the updated price and try again.',
        409,
        'PRICE_CHANGED',
        { ok: true, cart, payment_processing_fee_cents: paymentProcessingFeeCents, customer_total_cents: customerPayCents }
      );
      throw err;
    }
    const firstItem = cart.items[0];
    const amountCents = cart.totalCents;
    const platformFee = calculateCheckoutPlatformFee(db, {
      shopId: shop.id,
      orderAmountCents: amountCents,
      paymentMethod: 'card',
    });
    const feeCents = platformFee.final_platform_fee_cents;

    const paymentIntentPayload = {
      amount: customerPayCents,
      currency: 'nzd',
      payment_method: paymentMethodId,
      confirm: true,
      return_url: `${process.env.BASE_URL || 'http://localhost:3000'}/confirmation.html`,
      transfer_data: { destination: shop.stripe_account_id },
      on_behalf_of: shop.stripe_account_id,
      metadata: {
        shopId: String(shop.id),
        shopSlug: shop.slug,
        customerEmail: customerEmail || '',
        customerName: customerName || '',
        materialId: String(firstItem?.materialId || ''),
        pricingVersion: 'pricing-v1-per-volume-cart',
        cartItems: String(cart.items.length),
        paymentFeeMode,
      },
    };
    // Stripe/card fees for print orders are pass-through costs. Trennen's
    // separate revenue is only the capped application fee calculated above.
    if (feeCents > 0) paymentIntentPayload.application_fee_amount = feeCents;
    const intent = await stripe.paymentIntents.create({
      ...paymentIntentPayload,
    });

    db.prepare(`
      INSERT INTO customers (shop_id, email, name) VALUES (?, ?, ?)
      ON CONFLICT(shop_id, email) DO UPDATE SET name = excluded.name
    `).run(shop.id, (customerEmail || '').toLowerCase(), customerName || null);

    ensureOrderPublicTokenColumn();
    const publicToken = newPublicOrderToken();
    const order = db.prepare(`
      INSERT INTO orders
        (shop_id, customer_email, customer_name, file_name, material_id,
         colour, finish, quantity, subtotal, tax, shipping, total, stripe_payment_id, public_token,
         payment_processing_fee_cents, checkout_platform_fee_cents, customer_total_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      shop.id, (customerEmail || '').toLowerCase(), customerName || '',
      cart.items.length > 1 ? `${cart.items.length} material groups` : firstItem?.file?.name || null,
      firstItem?.materialId || null,
      cart.items.length > 1 ? 'Multiple' : firstItem?.colorName || null,
      cart.items.length > 1 ? 'Multiple' : firstItem?.finishLabel || null,
      cart.items.length > 1 ? 1 : firstItem?.quantity || 1,
      cart.itemsNzd ?? cart.items.reduce((sum, item) => sum + Number(item.itemsNzd || 0), 0),
      cart.taxNzd ?? cart.items.reduce((sum, item) => sum + Number(item.taxNzd || 0), 0),
      cart.shippingNzd ?? 0,
      cart.totalNzd, intent.id, publicToken,
      paymentProcessingFeeCents, feeCents, customerPayCents,
    );
    saveOrderItems(db, order.lastInsertRowid, cart.items);
    recordQuoteUsageEvent(db, {
      shopId: shop.id,
      quoteId: `order:${order.lastInsertRowid}`,
      eventType: 'checkout_order_created',
    });
    recordCheckoutFeeLedger(db, platformFee, {
      orderId: order.lastInsertRowid,
      status: intent.status === 'succeeded' ? 'charged' : 'pending',
    });
    if (intent.status === 'succeeded') {
      await recordStripePaymentFeeFromIntent(db, stripe, intent.id);
      await sendPaidOrderConfirmation(order.lastInsertRowid);
    }

    res.json({
      clientSecret: intent.client_secret,
      orderId: order.lastInsertRowid,
      orderToken: publicToken,
      status: intent.status,
      payment_fee_mode: paymentFeeMode,
      payment_processing_fee_cents: paymentProcessingFeeCents,
      checkout_platform_fee_cents: feeCents,
      customer_total_cents: customerPayCents,
      checkout_fee: platformFee,
      usage: usagePreview,
    });
  } catch (err) {
    logRouteError('Create payment intent error:', err);
    if (err instanceof PricingError) {
      return res.status(err.status).json({
        error: err.message || 'Payment failed',
        code: err.code,
        quote: err.quote || null,
      });
    }
    res.status(err.status || 500).json({ error: err.message || 'Payment failed' });
  }
});

router.post('/create-bank-transfer-order', paymentIntentLimiter, (req, res) => {
  res.status(410).json({
    error: 'Offline checkout is no longer available. Please use Stripe card checkout.',
    code: 'BANK_TRANSFER_DISABLED',
  });
});

router.get('/dashboard-link', requireShopAuth, async (req, res) => {
  try {
    const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.shop.id);
    if (!shop?.stripe_account_id) {
      return res.status(400).json({ error: 'No Stripe account connected' });
    }

    const stripe = ensurePlatformStripe();
    const loginLink = await stripe.accounts.createLoginLink(shop.stripe_account_id);
    res.json({ url: loginLink.url });
  } catch (err) {
    console.error('Stripe dashboard-link error:', stripeErrorSummary(err));
    res.status(500).json({
      error: 'Stripe is connected. Dashboard access is temporarily unavailable.',
      code: 'DASHBOARD_LINK_UNAVAILABLE',
    });
  }
});

router.get('/connect-url', requireShopAuth, async (req, res) => {
  try {
    const stripe = ensurePlatformStripe();
    const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.shop.id);
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

    let accountId = shop.stripe_account_id;
    let account = null;

    if (accountId) {
      account = await stripe.accounts.retrieve(accountId);
      updateShopStripeReadiness(shop.id, account);
    } else {
      account = await stripe.accounts.create({
        type: 'express',
        country: 'NZ',
        email: shop.email,
        metadata: {
          shopId: String(shop.id),
          shopSlug: shop.slug,
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_profile: {
          name: shop.name,
        },
      });
      accountId = account.id;
      db.prepare('UPDATE shops SET stripe_account_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
        .run(accountId, shop.id);
      updateShopStripeReadiness(shop.id, account);
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${baseUrl}/stripe-callback.html?refresh=1`,
      return_url: `${baseUrl}/stripe-callback.html`,
      type: 'account_onboarding',
    });

    res.json({ url: accountLink.url });
  } catch (err) {
    const summary = stripeErrorSummary(err);
    console.error('Stripe connect-url error:', summary);

    if (isConnectPlatformRegistrationError(err)) {
      return res.status(409).json({
        error: 'Stripe Connect is not activated for this platform account yet. Finish Connect setup in the same Stripe dashboard/sandbox as the server API key, then run npm run stripe-connect:smoke on Lightsail.',
        code: 'CONNECT_PLATFORM_NOT_REGISTERED',
      });
    }

    res.status(500).json({ error: err.message || 'Failed to start Stripe onboarding' });
  }
});

router.post('/connect', requireShopAuth, async (req, res) => {
  try {
    const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.shop.id);
    if (!shop?.stripe_account_id) {
      return res.status(400).json({ error: 'No Stripe account exists for this shop yet.' });
    }

    const account = await syncShopStripeAccount(shop);
    const payload = shopReadinessPayload(shop, account);

    res.json({ success: true, ...payload });
  } catch (err) {
    logRouteError('Stripe connect completion error:', err);
    res.status(500).json({ error: err.message || 'Failed to complete Stripe connection' });
  }
});

router.post('/disconnect', requireShopAuth, (req, res) => {
  try {
    if (!req.shop.stripe_account_id) {
      return res.status(400).json({ error: 'No Stripe account connected' });
    }

    db.prepare(`
      UPDATE shops
      SET stripe_account_id = NULL,
          stripe_charges_enabled = 0,
          stripe_payouts_enabled = 0,
          stripe_details_submitted = 0,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(req.shop.id);

    res.json({ ok: true });
  } catch (err) {
    logRouteError('Stripe disconnect error:', err);
    res.status(500).json({ error: err.message || 'Failed to disconnect Stripe' });
  }
});

router.get('/payouts', requireShopAuth, async (req, res) => {
  try {
    if (!req.shop.stripe_account_id) return res.json({ payouts: [] });

    const stripe = ensurePlatformStripe();
    const list = await stripe.payouts.list({ limit: 20 }, { stripeAccount: req.shop.stripe_account_id });

    const payouts = list.data.map(p => ({
      id: p.id,
      amount: p.amount / 100,
      currency: p.currency.toUpperCase(),
      status: p.status,
      arrival_date: new Date(p.arrival_date * 1000).toISOString().split('T')[0],
      created: new Date(p.created * 1000).toISOString().split('T')[0],
    }));

    res.json({ payouts });
  } catch (err) {
    logRouteError('Payouts error:', err);
    res.status(500).json({ error: 'Failed to fetch payouts' });
  }
});

export default router;

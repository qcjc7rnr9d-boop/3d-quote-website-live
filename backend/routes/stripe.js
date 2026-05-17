import { Router } from 'express';
import Stripe from 'stripe';
import { randomBytes } from 'crypto';
import rateLimit from 'express-rate-limit';
import { db, requireShopAuth } from '../middleware/auth.js';
import {
  getEffectivePlatformStripeConfig,
  getMaskedPlatformStripeConfig,
  updateShopStripeReadiness,
} from '../lib/platform-payments.js';
import {
  PricingError,
} from '../lib/pricing-engine.js';
import { normaliseCart, validateCartForShop } from '../lib/cart.js';
import { saveOrderItems } from '../lib/order-files.js';

const router = Router();
const paymentIntentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { error: 'Too many payment attempts, please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
});

function getPlatformStripe() {
  const { secretKey } = getEffectivePlatformStripeConfig();
  return secretKey ? new Stripe(secretKey) : null;
}

function ensurePlatformStripe() {
  const stripe = getPlatformStripe();
  if (!stripe) throw new Error('Stripe is not configured on this server.');
  return stripe;
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
    connected_account_id: shop?.stripe_account_id || null,
    charges_enabled: chargesEnabled,
    payouts_enabled: payoutsEnabled,
    details_submitted: detailsSubmitted,
    onboarding_complete: chargesEnabled && payoutsEnabled && detailsSubmitted,
    requirements_due: requirementsDue,
  };
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

export function stripeWebhookHandler(req, res) {
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
    }

    if (event.type === 'payment_intent.payment_failed') {
      db.prepare("UPDATE orders SET payment_status = 'failed' WHERE stripe_payment_id = ?")
        .run(event.data.object.id);
    }

    if (event.type === 'account.updated') {
      const account = event.data.object;
      const shop = db.prepare('SELECT id FROM shops WHERE stripe_account_id = ?').get(account.id);
      if (shop) updateShopStripeReadiness(shop.id, account);
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
  }

  res.json({ received: true });
}

router.get('/keys-status', requireShopAuth, async (req, res) => {
  try {
    const platform = getMaskedPlatformStripeConfig();
    const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.shop.id);
    const account = await syncShopStripeAccount(shop);

    res.json({
      ...platform,
      ...shopReadinessPayload(shop, account),
    });
  } catch (err) {
    console.error('Stripe status error:', err);
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
    `SELECT id, stripe_account_id, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted
     FROM shops WHERE slug = ? AND plan != 'suspended'`
  ).get(slug);

  if (!shop) return res.status(404).json({ error: 'Shop not found' });

  const { publishableKey, secretKey } = getEffectivePlatformStripeConfig();
  if (!publishableKey) {
    return res.status(503).json({
      error: 'Stripe platform setup is incomplete.',
      code: 'NO_PUBLIC_KEY',
    });
  }
  if (!secretKey) {
    return res.status(503).json({
      error: 'Stripe platform setup is incomplete.',
      code: 'NO_SECRET_KEY',
    });
  }
  if (!shop.stripe_account_id) {
    return res.status(503).json({
      error: 'This store has not connected Stripe yet.',
      code: 'NO_CONNECTED_ACCOUNT',
    });
  }
  if (!shop.stripe_charges_enabled || !shop.stripe_payouts_enabled || !shop.stripe_details_submitted) {
    return res.status(503).json({
      error: 'This store still needs to finish Stripe onboarding before it can accept live payments.',
      code: 'ONBOARDING_INCOMPLETE',
    });
  }

  res.json({ publishable_key: publishableKey, has_connect: true });
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
    if (!shop.stripe_account_id) {
      return res.status(503).json({ error: 'This store has not connected Stripe yet.' });
    }
    if (!shop.stripe_charges_enabled || !shop.stripe_payouts_enabled || !shop.stripe_details_submitted) {
      return res.status(503).json({ error: 'This store is not ready to accept Stripe payments yet.' });
    }

    const stripe = ensurePlatformStripe();
    const { feePercent } = getEffectivePlatformStripeConfig();
    const cart = validateCartForShop(db, shop, normaliseCart({
      ...(orderData || {}),
      shopSlug,
      items: Array.isArray(orderData?.items) && orderData.items.length ? orderData.items : null,
    }, shopSlug));
    const claimedCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(claimedCents) || claimedCents !== cart.totalCents) {
      const err = new PricingError(
        'Checkout total changed. Please review the updated price and try again.',
        409,
        'PRICE_CHANGED',
        { ok: true, cart }
      );
      throw err;
    }
    const firstItem = cart.items[0];
    const amountCents = cart.totalCents;
    const feeCents = Math.round(amountCents * feePercent / 100);

    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'nzd',
      payment_method: paymentMethodId,
      confirm: true,
      return_url: `${process.env.BASE_URL || 'http://localhost:3000'}/confirmation.html`,
      application_fee_amount: feeCents,
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
      },
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
         colour, finish, quantity, subtotal, tax, shipping, total, stripe_payment_id, public_token)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      shop.id, (customerEmail || '').toLowerCase(), customerName || '',
      cart.items.length > 1 ? `${cart.items.length} material groups` : firstItem?.file?.name || null,
      firstItem?.materialId || null,
      cart.items.length > 1 ? 'Multiple' : firstItem?.colorName || null,
      cart.items.length > 1 ? 'Multiple' : firstItem?.finishLabel || null,
      cart.items.length > 1 ? 1 : firstItem?.quantity || 1,
      cart.items.reduce((sum, item) => sum + Number(item.itemsNzd || 0), 0),
      cart.items.reduce((sum, item) => sum + Number(item.taxNzd || 0), 0),
      cart.items.reduce((sum, item) => sum + Number(item.shippingNzd || 0), 0),
      cart.totalNzd, intent.id, publicToken,
    );
    saveOrderItems(db, order.lastInsertRowid, cart.items);

    res.json({
      clientSecret: intent.client_secret,
      orderId: order.lastInsertRowid,
      orderToken: publicToken,
      status: intent.status,
    });
  } catch (err) {
    console.error('Create payment intent error:', err);
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
    console.error('Stripe connect-url error:', err);
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
    console.error('Stripe connect completion error:', err);
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
    console.error('Stripe disconnect error:', err);
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
    console.error('Payouts error:', err);
    res.status(500).json({ error: 'Failed to fetch payouts' });
  }
});

export default router;

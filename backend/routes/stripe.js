import { Router } from 'express';
import Stripe from 'stripe';
import rateLimit from 'express-rate-limit';
import { db, requireShopAuth } from '../middleware/auth.js';
import {
  getEffectivePlatformStripeConfig,
  getMaskedPlatformStripeConfig,
  updateShopStripeReadiness,
} from '../lib/platform-payments.js';
import { parseInfillTiers } from '../lib/infill-tiers.js';
import { parseMaterialRow, safeJson } from '../lib/material-config.js';

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

function getValidatedOrderQuote(shop, orderData = {}, claimedAmount) {
  const material = parseMaterialRow(db.prepare(`
    SELECT *
    FROM materials
    WHERE id = ? AND shop_id = ? AND active = 1
  `).get(orderData.materialId, shop.id), { stableIds: true, publicOnly: true });
  if (!material) {
    const err = new Error('Selected material is not available.');
    err.status = 400;
    throw err;
  }

  const qty = Math.max(1, Math.min(999, parseInt(orderData.quantity, 10) || 1));
  const volumeCm3 = Number(orderData.volumeCm3);
  if (!Number.isFinite(volumeCm3) || volumeCm3 <= 0) {
    const err = new Error('Model volume is missing or invalid.');
    err.status = 400;
    throw err;
  }

  const colour = material.colours.find(c => String(c.id) === String(orderData.colourId))
    || material.colours.find(c => c.name === orderData.colour)
    || material.colours[0]
    || null;
  if (material.colours.length && !colour) {
    const err = new Error('Selected colour is not available.');
    err.status = 400;
    throw err;
  }

  const finish = material.finishes.find(f => String(f.id) === String(orderData.finishId || orderData.finish))
    || material.finishes.find(f => f.name === orderData.finish)
    || material.finishes.find(f => f.default)
    || material.finishes[0]
    || null;
  if (material.finishes.length && !finish) {
    const err = new Error('Selected finish is not available.');
    err.status = 400;
    throw err;
  }

  const pricing = db.prepare('SELECT infill_tiers FROM pricing_config WHERE shop_id = ?').get(shop.id) || {};
  const infillTiers = parseInfillTiers(pricing.infill_tiers);
  const activeInfill = infillTiers.filter(t => t.active !== false);
  const infill = activeInfill.find(t => t.id === orderData.infillTierId)
    || activeInfill.find(t => t.is_default)
    || activeInfill[0]
    || null;

  const rate = Number(material.base_price) || 0;
  const minCharge = Number(material.min_charge) || 0;
  const finishMultiplier = Number(finish?.priceMultiplier) || 1;
  const infillMultiplier = Number(infill?.multiplier) || 1;
  const unit = Math.max(volumeCm3 * rate * finishMultiplier * infillMultiplier, minCharge);
  const subtotal = unit * qty;

  let shipping = 0;
  let shippingLabel = null;
  if (orderData.shippingId) {
    const settings = db.prepare('SELECT shipping_zones FROM store_settings WHERE shop_id = ?').get(shop.id) || {};
    const zones = safeJson(settings.shipping_zones, []).filter(z => z.active !== false);
    const zone = zones.find(z => String(z.id || `${z.courier || z.name}-${z.service || ''}`) === String(orderData.shippingId));
    if (!zone) {
      const err = new Error('Selected shipping option is not available.');
      err.status = 400;
      throw err;
    }
    shipping = Number(zone.price ?? zone.rate ?? 0) || 0;
    shippingLabel = [zone.courier || zone.name, zone.service].filter(Boolean).join(' · ') || 'Shipping';
  } else if (Number(orderData.shipping || 0) > 0) {
    const err = new Error('Shipping option must be selected from this store.');
    err.status = 400;
    throw err;
  }

  const tax = 0;
  const total = subtotal + shipping + tax;
  const claimed = Number(claimedAmount);
  if (!Number.isFinite(claimed) || Math.abs(claimed - total) > 0.01) {
    const err = new Error('Checkout total changed. Please refresh your quote and try again.');
    err.status = 409;
    throw err;
  }

  return {
    material,
    colour,
    finish,
    qty,
    unit,
    subtotal,
    shipping,
    shippingLabel,
    tax,
    total,
    infill,
  };
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
      error: 'Stripe is not configured - add a publishable key in the platform portal.',
      code: 'NO_PUBLIC_KEY',
    });
  }
  if (!secretKey) {
    return res.status(503).json({
      error: 'Stripe is not configured - add a secret key in the platform portal.',
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
    const quote = getValidatedOrderQuote(shop, orderData, amount);
    const amountCents = Math.round(quote.total * 100);
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
        materialId: String(quote.material.id),
      },
    });

    db.prepare(`
      INSERT INTO customers (shop_id, email, name) VALUES (?, ?, ?)
      ON CONFLICT(shop_id, email) DO UPDATE SET name = excluded.name
    `).run(shop.id, (customerEmail || '').toLowerCase(), customerName || null);

    const order = db.prepare(`
      INSERT INTO orders
        (shop_id, customer_email, customer_name, file_name, material_id,
         colour, finish, quantity, subtotal, tax, shipping, total, stripe_payment_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      shop.id, (customerEmail || '').toLowerCase(), customerName || '',
      orderData?.fileName || null, quote.material.id,
      quote.colour?.name || null, quote.finish?.name || null,
      quote.qty,
      quote.subtotal, quote.tax, quote.shipping,
      quote.total, intent.id,
    );

    res.json({ clientSecret: intent.client_secret, orderId: order.lastInsertRowid, status: intent.status });
  } catch (err) {
    console.error('Create payment intent error:', err);
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

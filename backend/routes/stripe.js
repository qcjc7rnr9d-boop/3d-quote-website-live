import { Router } from 'express';
import Stripe from 'stripe';
import { db, requireShopAuth } from '../middleware/auth.js';
import { PLATFORM_FEE_PERCENT } from '../config.js';

const router = Router();

// ── Helper: get Stripe instance for a shop (DB keys → env fallback) ──
function getStripe(shop) {
  const key = (shop && shop.stripe_secret_key) || process.env.STRIPE_SECRET_KEY || '';
  return new Stripe(key);
}

// Helper: get client_id for a shop
function getClientId(shop) {
  return (shop && shop.stripe_client_id) || process.env.STRIPE_CLIENT_ID || null;
}

// Helper: mask a key — shows prefix + last 4 chars, rest as *
function maskKey(key) {
  if (!key) return null;
  // e.g. sk_live_AbcDef1234 → sk_live_****1234
  const prefix = key.startsWith('sk_live_') ? 'sk_live_' : key.startsWith('sk_test_') ? 'sk_test_' : key.slice(0, 3) + '_';
  const last4  = key.slice(-4);
  return `${prefix}${'*'.repeat(8)}${last4}`;
}
function maskClientId(id) {
  if (!id) return null;
  const last4 = id.slice(-4);
  return `ca_${'*'.repeat(8)}${last4}`;
}

// ── Webhook handler (exported — uses env var key for signature verification) ──
export function stripeWebhookHandler(req, res) {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    // Use platform env key for webhook verification
    const platformStripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
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
  } catch (err) {
    console.error('Webhook processing error:', err);
  }

  res.json({ received: true });
}

// ── GET /api/stripe/keys-status (requireShopAuth) ──────────────────────────
router.get('/keys-status', requireShopAuth, (req, res) => {
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.shop.id);
  const secretKey  = shop.stripe_secret_key  || process.env.STRIPE_SECRET_KEY  || null;
  const clientId   = shop.stripe_client_id   || process.env.STRIPE_CLIENT_ID   || null;
  res.json({
    has_secret_key: !!secretKey,
    has_client_id:  !!clientId,
    secret_key_masked: maskKey(secretKey),
    client_id_masked:  maskClientId(clientId),
    // True if keys come from DB (can be updated via UI), false if env-only
    from_db: !!(shop.stripe_secret_key || shop.stripe_client_id),
  });
});

// ── PUT /api/stripe/keys (requireShopAuth) ─────────────────────────────────
router.put('/keys', requireShopAuth, (req, res) => {
  try {
    const { secret_key, client_id } = req.body;

    if (secret_key !== undefined) {
      if (secret_key && !secret_key.startsWith('sk_')) {
        return res.status(400).json({ error: 'Secret key must start with sk_live_ or sk_test_' });
      }
      db.prepare('UPDATE shops SET stripe_secret_key = ? WHERE id = ?')
        .run(secret_key || null, req.shop.id);
    }

    if (client_id !== undefined) {
      if (client_id && !client_id.startsWith('ca_')) {
        return res.status(400).json({ error: 'Client ID must start with ca_' });
      }
      db.prepare('UPDATE shops SET stripe_client_id = ? WHERE id = ?')
        .run(client_id || null, req.shop.id);
    }

    const updated = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.shop.id);
    const secretKey = updated.stripe_secret_key || process.env.STRIPE_SECRET_KEY || null;
    const clientIdVal = updated.stripe_client_id || process.env.STRIPE_CLIENT_ID || null;

    res.json({
      ok: true,
      has_secret_key: !!secretKey,
      has_client_id:  !!clientIdVal,
      secret_key_masked: maskKey(secretKey),
      client_id_masked:  maskClientId(clientIdVal),
    });
  } catch (err) {
    console.error('Save Stripe keys error:', err);
    res.status(500).json({ error: 'Failed to save keys' });
  }
});

// ── GET /api/stripe/public-key?shop=slug  (public — used by checkout.html) ────
// Returns the publishable key the front-end should initialise Stripe.js with.
// Publishable keys are safe to expose (they only let you tokenise card details,
// not move money). Falls back to the platform's pk if the shop hasn't set one.
router.get('/public-key', (req, res) => {
  const slug = req.query.shop;
  if (!slug) return res.status(400).json({ error: 'shop required' });
  const shop = db.prepare(
    "SELECT id, stripe_account_id FROM shops WHERE slug = ? AND plan != 'suspended'"
  ).get(slug);
  if (!shop) return res.status(404).json({ error: 'Shop not found' });
  const pk = process.env.STRIPE_PUBLISHABLE_KEY || '';
  if (!pk) {
    return res.status(503).json({
      error: 'Stripe is not configured — set STRIPE_PUBLISHABLE_KEY in .env',
      code:  'NO_PUBLIC_KEY',
    });
  }
  res.json({ publishable_key: pk, has_connect: !!shop.stripe_account_id });
});

// ── POST /api/stripe/create-payment-intent (public — customer checkout) ──────
router.post('/create-payment-intent', async (req, res) => {
  try {
    const { paymentMethodId, shopSlug, amount, currency, customerEmail, customerName, orderData } = req.body;

    if (!paymentMethodId || !shopSlug || !amount || !customerEmail) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const shop = db.prepare('SELECT * FROM shops WHERE slug = ?').get(shopSlug);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });

    const stripe = getStripe(shop);
    if (!stripe?.apiKey) {
      return res.status(503).json({ error: 'Stripe is not configured on this server.' });
    }

    const amountCents = Math.round(amount * 100);
    // If the shop has connected its own Stripe → split with application fee.
    // Otherwise (dev mode) → take payment straight to the platform account,
    // no transfer / no app fee. The shop owner can connect Stripe later
    // via admin/payments.html to switch into Connect mode automatically.
    const useConnect = !!shop.stripe_account_id;
    const feeCents   = useConnect ? Math.round(amountCents * PLATFORM_FEE_PERCENT / 100) : 0;

    const intentConfig = {
      amount: amountCents,
      currency: (currency || 'nzd').toLowerCase(),
      payment_method: paymentMethodId,
      confirm: true,
      return_url: `${process.env.BASE_URL || 'http://localhost:3000'}/confirmation.html`,
      metadata: {
        shopId: String(shop.id),
        customerEmail: customerEmail || '',
        customerName:  customerName  || '',
      },
    };
    if (useConnect) {
      intentConfig.application_fee_amount = feeCents;
      intentConfig.transfer_data = { destination: shop.stripe_account_id };
    }
    const intent = await stripe.paymentIntents.create(intentConfig);

    // Upsert customer
    db.prepare(`
      INSERT INTO customers (shop_id, email, name) VALUES (?, ?, ?)
      ON CONFLICT(shop_id, email) DO UPDATE SET name = excluded.name
    `).run(shop.id, (customerEmail || '').toLowerCase(), customerName || null);

    // Create order record
    const order = db.prepare(`
      INSERT INTO orders
        (shop_id, customer_email, customer_name, file_name, material_id,
         colour, finish, quantity, subtotal, tax, shipping, total, stripe_payment_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      shop.id, (customerEmail || '').toLowerCase(), customerName || '',
      orderData?.fileName || null, orderData?.materialId || null,
      orderData?.colour || null, orderData?.finish || null,
      orderData?.quantity || 1,
      orderData?.subtotal || 0, orderData?.tax || 0, orderData?.shipping || 0,
      amount, intent.id,
    );

    res.json({ clientSecret: intent.client_secret, orderId: order.lastInsertRowid, status: intent.status });
  } catch (err) {
    console.error('Create payment intent error:', err);
    res.status(500).json({ error: err.message || 'Payment failed' });
  }
});

// ── GET /api/stripe/connect-url (requireShopAuth) ──────────────────────────
router.get('/connect-url', requireShopAuth, (req, res) => {
  const shop     = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.shop.id);
  const clientId = getClientId(shop);
  const secretKey = (shop && shop.stripe_secret_key) || process.env.STRIPE_SECRET_KEY || null;

  if (!secretKey || !clientId) {
    return res.status(503).json({
      error: 'Stripe keys not configured.',
      setup_required: true,
      missing: { secret_key: !secretKey, client_id: !clientId },
    });
  }
  const baseUrl     = process.env.BASE_URL || 'http://localhost:3000';
  const redirectUri = encodeURIComponent(`${baseUrl}/stripe-callback.html`);
  const url = `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=${clientId}&scope=read_write&redirect_uri=${redirectUri}`;
  res.json({ url });
});

// ── POST /api/stripe/connect (requireShopAuth) ─────────────────────────────
router.post('/connect', requireShopAuth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Authorization code required' });

    const shop   = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.shop.id);
    const stripe = getStripe(shop);
    const response = await stripe.oauth.token({ grant_type: 'authorization_code', code });

    db.prepare('UPDATE shops SET stripe_account_id = ? WHERE id = ?')
      .run(response.stripe_user_id, req.shop.id);

    res.json({ ok: true, stripe_user_id: response.stripe_user_id });
  } catch (err) {
    console.error('Stripe connect error:', err);
    res.status(500).json({ error: err.message || 'Failed to connect Stripe' });
  }
});

// ── POST /api/stripe/disconnect (requireShopAuth) ──────────────────────────
router.post('/disconnect', requireShopAuth, async (req, res) => {
  try {
    if (!req.shop.stripe_account_id) return res.status(400).json({ error: 'No Stripe account connected' });

    const shop     = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.shop.id);
    const stripe   = getStripe(shop);
    const clientId = getClientId(shop);

    await stripe.oauth.deauthorize({ client_id: clientId, stripe_user_id: req.shop.stripe_account_id });
    db.prepare('UPDATE shops SET stripe_account_id = NULL WHERE id = ?').run(req.shop.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Stripe disconnect error:', err);
    res.status(500).json({ error: err.message || 'Failed to disconnect Stripe' });
  }
});

// ── GET /api/stripe/payouts (requireShopAuth) ──────────────────────────────
router.get('/payouts', requireShopAuth, async (req, res) => {
  try {
    if (!req.shop.stripe_account_id) return res.json({ payouts: [] });

    const shop   = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.shop.id);
    const stripe = getStripe(shop);
    const list   = await stripe.payouts.list({ limit: 20 }, { stripeAccount: req.shop.stripe_account_id });

    const payouts = list.data.map(p => ({
      id:           p.id,
      amount:       p.amount / 100,
      currency:     p.currency.toUpperCase(),
      status:       p.status,
      arrival_date: new Date(p.arrival_date * 1000).toISOString().split('T')[0],
      created:      new Date(p.created * 1000).toISOString().split('T')[0],
    }));

    res.json({ payouts });
  } catch (err) {
    console.error('Payouts error:', err);
    res.status(500).json({ error: 'Failed to fetch payouts' });
  }
});

export default router;

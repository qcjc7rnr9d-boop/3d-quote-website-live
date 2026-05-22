import { Router } from 'express';
import { db, requireShopAuth } from '../middleware/auth.js';
import {
  createBillingPortalSession,
  createBusinessBillingSession,
  getSubscriptionSummary,
} from '../lib/billing.js';
import {
  checkoutSettingsForShop,
  getBillingUsageSummary,
  updatePaymentFeeMode,
} from '../lib/billing-service.js';
import { getPlatformStripeClient } from '../lib/platform-payments.js';

const router = Router();

router.get('/usage', requireShopAuth, (req, res) => {
  try {
    res.json(getBillingUsageSummary(db, req.shop.id));
  } catch (err) {
    console.error('Billing usage error:', err);
    res.status(500).json({ error: 'Failed to load billing usage' });
  }
});

router.get('/subscription', requireShopAuth, (req, res) => {
  try {
    const summary = getSubscriptionSummary(db, req.shop.id);
    if (!summary) return res.status(404).json({ error: 'Shop not found' });
    res.json(summary);
  } catch (err) {
    console.error('Billing subscription status error:', err);
    res.status(500).json({ error: 'Failed to load subscription status' });
  }
});

router.post('/subscription-checkout', requireShopAuth, async (req, res) => {
  try {
    const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.shop.id);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });
    const billing = await createBusinessBillingSession({
      db,
      stripe: getPlatformStripeClient(),
      shop,
      baseUrl: process.env.BASE_URL || `${req.protocol}://${req.get('host')}`,
    });
    res.json({ ok: true, ...billing });
  } catch (err) {
    const status = err.code === 'FREE_PLAN_NO_BILLING_REQUIRED' ? 400
      : err.code === 'BILLING_PRICE_NOT_CONFIGURED' ? 503
        : err.code === 'BILLING_STRIPE_NOT_CONFIGURED' ? 503
          : 500;
    res.status(status).json({
      ok: false,
      code: err.code || 'BILLING_CHECKOUT_FAILED',
      error: err.message || 'Could not start Stripe subscription checkout.',
    });
  }
});

router.post('/customer-portal', requireShopAuth, async (req, res) => {
  try {
    const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.shop.id);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });
    const portal = await createBillingPortalSession({
      db,
      stripe: getPlatformStripeClient(),
      shop,
      baseUrl: process.env.BASE_URL || `${req.protocol}://${req.get('host')}`,
    });
    res.json({ ok: true, ...portal });
  } catch (err) {
    const status = ['BILLING_CUSTOMER_REQUIRED', 'BILLING_PORTAL_NOT_CONFIGURED'].includes(err.code) ? 409
      : err.code === 'BILLING_STRIPE_NOT_CONFIGURED' ? 503
        : 500;
    res.status(status).json({
      ok: false,
      code: err.code || 'BILLING_PORTAL_FAILED',
      error: err.message || 'Could not open Stripe Billing Portal.',
    });
  }
});

router.patch('/payment-fee-mode', requireShopAuth, (req, res) => {
  try {
    const mode = updatePaymentFeeMode(db, req.shop.id, req.body?.payment_fee_mode);
    res.json({ ok: true, payment_fee_mode: mode });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Invalid payment fee mode' });
  }
});

router.get('/public-checkout-settings', (req, res) => {
  try {
    const slug = String(req.query.shop || '').trim();
    if (!slug) return res.status(400).json({ error: 'shop required' });
    const amountCents = Math.max(0, Math.round(Number(req.query.amount_cents || 0)));
    const settings = checkoutSettingsForShop(db, slug, amountCents);
    if (!settings) return res.status(404).json({ error: 'Shop not found' });
    res.json(settings);
  } catch (err) {
    console.error('Public checkout settings error:', err);
    res.status(500).json({ error: 'Failed to load checkout settings' });
  }
});

export default router;

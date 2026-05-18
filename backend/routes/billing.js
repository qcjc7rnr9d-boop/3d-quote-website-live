import { Router } from 'express';
import { db, requireShopAuth } from '../middleware/auth.js';
import {
  checkoutSettingsForShop,
  getBillingUsageSummary,
  updatePaymentFeeMode,
} from '../lib/billing-service.js';

const router = Router();

router.get('/usage', requireShopAuth, (req, res) => {
  try {
    res.json(getBillingUsageSummary(db, req.shop.id));
  } catch (err) {
    console.error('Billing usage error:', err);
    res.status(500).json({ error: 'Failed to load billing usage' });
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

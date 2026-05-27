import { Router } from 'express';
import { db } from '../middleware/auth.js';
import { normaliseShippingZones } from '../lib/pricing-engine.js';
import { getShopBySlug } from '../lib/shop-lookup.js';

const router = Router();

/**
 * Manual shipping options.
 *
 * Storage: store_settings.shipping_zones (JSON column) holds an array of:
 *   { id, courier, service, price, days_min, days_max, recommended, active, bands? }
 *
 * The admin "Shipping options" UI writes this format; the quote page reads it.
 * Sorted server-side so the recommended option comes first.
 */

// ── POST /api/shipping/rates  (public — called from quote page) ─
router.post('/rates', (req, res) => {
  try {
    const { shopSlug, package: packageMetrics } = req.body;
    if (!shopSlug) {
      return res.status(400).json({ error: 'shopSlug is required' });
    }

    const shop = getShopBySlug(db, shopSlug);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });

    const s = db.prepare('SELECT shipping_zones FROM store_settings WHERE shop_id = ?').get(shop.id) || {};
    const raw = JSON.parse(s.shipping_zones || '[]');
    const rates = normaliseShippingZones(raw, packageMetrics || null).map(o => ({
      id:           o.id,
      methodId:     o.methodId || o.id,
      bandId:       o.bandId || null,
      bandLabel:    o.bandLabel || null,
      carrier:      o.carrier,
      service:      o.service,
      price:        o.price,
      currency:     'NZD',
      est_days_min: o.est_days_min,
      est_days_max: o.est_days_max,
      is_express:   Number(o.est_days_max) <= 1,
      recommended:  o.recommended,
      available:    true,
      source:       'manual',
    }));

    res.json({ rates, note: null });
  } catch (err) {
    console.error('[shipping] rates error:', err);
    res.status(500).json({ error: 'Could not load shipping options' });
  }
});

export default router;

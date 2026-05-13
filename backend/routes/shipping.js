import { Router } from 'express';
import { db } from '../middleware/auth.js';

const router = Router();

/**
 * Manual shipping options.
 *
 * Storage: store_settings.shipping_zones (JSON column) holds an array of:
 *   { id, courier, service, price, days_min, days_max, recommended, active }
 *
 * The admin "Shipping options" UI writes this format; the quote page reads it.
 * Sorted server-side so the recommended option comes first.
 */

// ── POST /api/shipping/rates  (public — called from quote page) ─
router.post('/rates', (req, res) => {
  try {
    const { shopSlug } = req.body;
    if (!shopSlug) {
      return res.status(400).json({ error: 'shopSlug is required' });
    }

    const shop = db.prepare(
      "SELECT id FROM shops WHERE slug = ? AND plan != 'suspended'"
    ).get(shopSlug);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });

    const s = db.prepare('SELECT shipping_zones FROM store_settings WHERE shop_id = ?').get(shop.id) || {};
    const raw = JSON.parse(s.shipping_zones || '[]');

    const rates = raw
      .filter(o => o.active !== false)
      .map(o => {
        const minDays = Number(o.days_min ?? o.est_days_min ?? 1) || 1;
        const maxDays = Number(o.days_max ?? o.est_days_max ?? minDays) || minDays;
        return {
          id:           o.id || `${o.courier || o.name}-${o.service || ''}`,
          carrier:      o.courier || o.name || 'Courier',
          service:      o.service || 'Standard',
          price:        Number(o.price ?? o.rate ?? 0) || 0,
          currency:     'NZD',
          est_days_min: minDays,
          est_days_max: maxDays,
          is_express:   maxDays <= 1,
          recommended:  !!o.recommended,
          available:    true,
          source:       'manual',
        };
      });

    // Sort: recommended first, then by price ascending, then by speed
    rates.sort((a, b) => {
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      if (a.price !== b.price)             return a.price - b.price;
      return a.est_days_max - b.est_days_max;
    });

    res.json({ rates, note: null });
  } catch (err) {
    console.error('[shipping] rates error:', err);
    res.status(500).json({ error: 'Could not load shipping options' });
  }
});

export default router;

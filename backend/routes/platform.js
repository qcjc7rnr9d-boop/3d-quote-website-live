import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db, requirePlatformAuth } from '../middleware/auth.js';
import { BCRYPT_ROUNDS, PLATFORM_FEE_PERCENT } from '../config.js';
import {
  getMaskedPlatformStripeConfig,
  getEffectivePlatformStripeConfig,
  updatePlatformStripeConfig,
} from '../lib/platform-payments.js';

const router = Router();

// ── POST /api/platform/login ──────────────────────────────────
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (!password || password !== process.env.PLATFORM_ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  req.session.platformAdmin = true;
  res.json({ ok: true });
});

// ── POST /api/platform/logout ─────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.platformAdmin = false;
  res.json({ ok: true });
});

// ── GET /api/platform/me ──────────────────────────────────────
router.get('/me', requirePlatformAuth, (req, res) => {
  res.json({ ok: true, role: 'platform' });
});

// ── GET /api/platform/stats ───────────────────────────────────
router.get('/stats', requirePlatformAuth, (req, res) => {
  try {
    const shopCount = db.prepare('SELECT COUNT(*) as c FROM shops').get().c;
    const orderCount = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
    const monthRevenue = db.prepare(
      "SELECT COALESCE(SUM(total),0) as s FROM orders WHERE payment_status='paid' AND created_at >= datetime('now','start of month')"
    ).get().s;
    const feePercent = getEffectivePlatformStripeConfig().feePercent || PLATFORM_FEE_PERCENT;
    const monthFees = monthRevenue * feePercent / 100;

    res.json({ shopCount, orderCount, monthRevenue, monthFees, feePercent });
  } catch (err) {
    console.error('Platform stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/platform/shops ───────────────────────────────────
router.get('/shops', requirePlatformAuth, (req, res) => {
  try {
    const shops = db.prepare(`
      SELECT
        s.id, s.name, s.slug, s.email, s.plan,
        s.stripe_account_id, s.stripe_charges_enabled, s.stripe_payouts_enabled,
        s.stripe_details_submitted, s.created_at,
        (SELECT COUNT(*) FROM orders o WHERE o.shop_id = s.id) as order_count,
        (SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.shop_id = s.id AND payment_status='paid') as revenue
      FROM shops s
      ORDER BY s.created_at DESC
    `).all();
    res.json(shops);
  } catch (err) {
    console.error('Platform shops error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/payments', requirePlatformAuth, (req, res) => {
  try {
    res.json(getMaskedPlatformStripeConfig());
  } catch (err) {
    console.error('Platform payments config error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/payments', requirePlatformAuth, (req, res) => {
  try {
    const { publishable_key, secret_key, client_id, platform_fee_percent } = req.body;

    if (publishable_key !== undefined && publishable_key && !publishable_key.startsWith('pk_')) {
      return res.status(400).json({ error: 'Publishable key must start with pk_live_ or pk_test_' });
    }
    if (secret_key !== undefined && secret_key && !secret_key.startsWith('sk_')) {
      return res.status(400).json({ error: 'Secret key must start with sk_live_ or sk_test_' });
    }
    if (client_id !== undefined && client_id && !client_id.startsWith('ca_')) {
      return res.status(400).json({ error: 'Client ID must start with ca_' });
    }
    if (platform_fee_percent !== undefined && platform_fee_percent !== '' && (Number(platform_fee_percent) < 0 || Number(platform_fee_percent) > 100)) {
      return res.status(400).json({ error: 'Platform fee percent must be between 0 and 100' });
    }

    const result = updatePlatformStripeConfig({
      publishableKey: publishable_key,
      secretKey: secret_key,
      clientId: client_id,
      platformFeePercent: platform_fee_percent,
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('Save platform payments config error:', err);
    res.status(500).json({ error: 'Failed to save payments config' });
  }
});

// ── POST /api/platform/shops ──────────────────────────────────
router.post('/shops', requirePlatformAuth, async (req, res) => {
  try {
    const { name, slug, email, password, plan } = req.body;
    if (!name || !slug || !email || !password) {
      return res.status(400).json({ error: 'Name, slug, email and password are required' });
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const result = db.prepare(`
      INSERT INTO shops (name, slug, email, password_hash, plan, is_temp_password)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(name, slug.toLowerCase(), email.toLowerCase(), hash, plan || 'starter');

    const shopId = result.lastInsertRowid;

    // Create default pricing config and store settings
    db.prepare('INSERT OR IGNORE INTO pricing_config (shop_id) VALUES (?)').run(shopId);
    db.prepare('INSERT OR IGNORE INTO store_settings (shop_id) VALUES (?)').run(shopId);

    const shop = db.prepare(
      'SELECT id, name, slug, email, plan, is_temp_password, created_at FROM shops WHERE id = ?'
    ).get(shopId);

    res.status(201).json(shop);
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'A shop with that email or slug already exists' });
    }
    console.error('Create shop error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH /api/platform/shops/:id ────────────────────────────
router.patch('/shops/:id', requirePlatformAuth, (req, res) => {
  try {
    const { suspended, plan } = req.body;
    const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(req.params.id);
    if (!shop) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    let newPlan = plan || shop.plan;
    if (suspended !== undefined) {
      newPlan = suspended ? 'suspended' : 'starter';
    }

    db.prepare('UPDATE shops SET plan = ? WHERE id = ?').run(newPlan, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Update shop error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/platform/impersonate ───────────────────────────
router.post('/impersonate', requirePlatformAuth, (req, res) => {
  const { shopId } = req.body;
  if (!shopId) {
    return res.status(400).json({ error: 'shopId required' });
  }

  const shop = db.prepare('SELECT id FROM shops WHERE id = ?').get(shopId);
  if (!shop) {
    return res.status(404).json({ error: 'Shop not found' });
  }

  req.session.shopId = shop.id;
  res.json({ ok: true });
});

export default router;

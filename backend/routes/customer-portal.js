import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../middleware/auth.js';
import { BCRYPT_ROUNDS } from '../config.js';
import { parseInfillTiers } from '../lib/infill-tiers.js';
import { parseMaterialRow, safeJson } from '../lib/material-config.js';

const router = Router();

// ── Auth middleware for customer portal ───────────────────────
function requireCustomerAuth(req, res, next) {
  const id = req.session && req.session.customerId;
  if (!id) return res.status(401).json({ error: 'Not authenticated' });

  const account = db.prepare('SELECT * FROM customer_accounts WHERE id = ?').get(id);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });

  req.customerAccount = account;
  next();
}

// ── GET /api/customer/shop-info?slug=X  (public) ─────────────
router.get('/shop-info', (req, res) => {
  // Accept ?slug=mahi3d  OR  ?shop=mahi3d (both used across customer pages)
  const slug = req.query.slug || req.query.shop;
  if (!slug) return res.status(400).json({ error: 'slug required' });
  const shop = db.prepare(
    "SELECT id, name, slug FROM shops WHERE slug = ? AND plan != 'suspended'"
  ).get(slug);
  if (!shop) return res.status(404).json({ error: 'Shop not found' });

  // Pull branding fields from the shop's store_settings row (all optional)
  const s = db.prepare(
    'SELECT tagline, about, phone, address, logo_url FROM store_settings WHERE shop_id = ?'
  ).get(shop.id) || {};

  res.json({
    name:     shop.name,
    slug:     shop.slug,
    tagline:  s.tagline  || null,
    about:    s.about    || null,
    logo_url: s.logo_url || null,
    phone:    s.phone    || null,
    address:  s.address  || null,
  });
});

// ── GET /api/customer/pricing?shop=X  (public pricing) ───────
router.get('/pricing', (req, res) => {
  const { shop: slug } = req.query;
  if (!slug) return res.status(400).json({ error: 'shop required' });
  const shop = db.prepare(
    "SELECT id FROM shops WHERE slug = ? AND plan != 'suspended'"
  ).get(slug);
  if (!shop) return res.status(404).json({ error: 'Shop not found' });

  // Get pricing config (with sensible defaults if none set yet)
  const cfg = db.prepare('SELECT * FROM pricing_config WHERE shop_id = ?').get(shop.id) || {};

  // Get active materials with pricing fields
  const materials = db.prepare(`
    SELECT id, name, base_price, min_charge, pricing_model, volume_tiers
    FROM materials
    WHERE shop_id = ? AND active = 1
    ORDER BY sort_order, name
  `).all(shop.id).map(m => ({
    ...m,
    volume_tiers: JSON.parse(m.volume_tiers || '[]'),
  }));

  res.json({
    currency:            cfg.currency            || 'NZD',
    tax_rate:            cfg.tax_rate            ?? 0,
    tax_inclusive:       cfg.tax_inclusive        ? true : false,
    min_order_value:     cfg.min_order_value      ?? 0,
    free_shipping_above: cfg.free_shipping_above  ?? 50,
    quote_rounding:      parseFloat(cfg.quote_rounding) || 0,
    show_breakdown:      cfg.show_breakdown        ? true : false,
    pricing_mode:        cfg.pricing_mode          || 'material',
    time_rate_per_hour:  cfg.time_rate_per_hour    ?? 0,
    time_rate_per_gram:  cfg.time_rate_per_gram    ?? 0,
    infill_tiers:        parseInfillTiers(cfg.infill_tiers),
    materials,
  });
});

// ── GET /api/customer/catalog?shop=X  (public materials) ─────
router.get('/catalog', (req, res) => {
  const { shop: slug } = req.query;
  if (!slug) return res.status(400).json({ error: 'shop required' });
  const shop = db.prepare(
    "SELECT id FROM shops WHERE slug = ? AND plan != 'suspended'"
  ).get(slug);
  if (!shop) return res.status(404).json({ error: 'Shop not found' });
  const settingsRow = db.prepare(
    'SELECT material_page_settings FROM store_settings WHERE shop_id = ?'
  ).get(shop.id) || {};
  const rows = db.prepare(
    `SELECT id, name, category, description_short, description_long,
            image_url, image_alt, price_unit, recommended, tags, best_for, specs,
            colours, finishes, stock_status, sort_order, properties,
            production_days_min, production_days_max,
            min_x_mm, min_y_mm, min_z_mm,
            max_x_mm, max_y_mm, max_z_mm
     FROM materials
     WHERE shop_id = ? AND active = 1
     ORDER BY sort_order, name`
  ).all(shop.id);
  const materials = rows.map(r => parseMaterialRow(r, { stableIds: true, publicOnly: true }));
  const filters = [...new Set(materials.flatMap(m => m.tags || []))];
  res.json({
    settings: {
      heading: 'Choose your material',
      subtitle: 'Pick based on how your part will be used. You can view detailed specs if needed.',
      helperTitle: 'Not sure what to choose?',
      helperText: 'Start with the recommended material, or filter by what matters most.',
      continueLabel: 'Continue to Quote',
      emptyState: 'No materials are available right now.',
      ...(safeJson(settingsRow.material_page_settings, {}) || {}),
    },
    filters,
    materials,
  });
});

// ── POST /api/customer/register ───────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { shopSlug, name, email, password } = req.body;
    if (!shopSlug || !name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const shop = db.prepare('SELECT id FROM shops WHERE slug = ?').get(shopSlug);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    try {
      const result = db.prepare(`
        INSERT INTO customer_accounts (shop_id, email, name, password_hash)
        VALUES (?, ?, ?, ?)
      `).run(shop.id, email.trim().toLowerCase(), name.trim(), hash);

      req.session.customerId  = result.lastInsertRowid;
      req.session.customerShopId = shop.id;
      res.status(201).json({ ok: true });
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE')) {
        return res.status(400).json({ error: 'An account with this email already exists' });
      }
      throw err;
    }
  } catch (err) {
    console.error('Customer register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/customer/login ──────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { shopSlug, email, password } = req.body;
    if (!shopSlug || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const shop = db.prepare('SELECT id FROM shops WHERE slug = ?').get(shopSlug);
    if (!shop) return res.status(401).json({ error: 'Incorrect email or password' });

    const account = db.prepare(
      'SELECT * FROM customer_accounts WHERE shop_id = ? AND email = ?'
    ).get(shop.id, email.trim().toLowerCase());

    if (!account) return res.status(401).json({ error: 'Incorrect email or password' });

    const valid = await bcrypt.compare(password, account.password_hash);
    if (!valid) return res.status(401).json({ error: 'Incorrect email or password' });

    req.session.customerId = account.id;
    req.session.customerShopId = shop.id;
    res.json({ ok: true });
  } catch (err) {
    console.error('Customer login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/customer/logout ─────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.customerId = null;
  req.session.customerShopId = null;
  res.json({ ok: true });
});

// ── GET /api/customer/me ──────────────────────────────────────
router.get('/me', requireCustomerAuth, (req, res) => {
  const { id, name, email, created_at, shop_id } = req.customerAccount;

  // Get shop info
  const shop = db.prepare('SELECT name, slug FROM shops WHERE id = ?').get(shop_id);

  // Stats
  const stats = db.prepare(`
    SELECT
      COUNT(*) as order_count,
      COALESCE(SUM(total), 0) as total_spent
    FROM orders
    WHERE shop_id = ? AND LOWER(customer_email) = LOWER(?) AND payment_status = 'paid'
  `).get(shop_id, email);

  res.json({ id, name, email, created_at, shop, ...stats });
});

// ── GET /api/customer/orders ──────────────────────────────────
router.get('/orders', requireCustomerAuth, (req, res) => {
  try {
    const { email, shop_id } = req.customerAccount;

    const orders = db.prepare(`
      SELECT
        o.id, o.created_at, o.fulfilment_status, o.payment_status,
        o.subtotal, o.shipping, o.tax, o.total,
        o.quantity, o.colour, o.finish, o.file_name,
        o.tracking_number, o.tracking_url,
        -- Only reveal customer_message when shipped/complete
        CASE WHEN o.fulfilment_status IN ('shipped','complete')
          THEN o.customer_message ELSE NULL END as customer_message,
        m.name as material_name
      FROM orders o
      LEFT JOIN materials m ON m.id = o.material_id
      WHERE o.shop_id = ? AND LOWER(o.customer_email) = LOWER(?)
      ORDER BY o.created_at DESC
    `).all(shop_id, email);

    res.json(orders);
  } catch (err) {
    console.error('Customer orders error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/customer/orders/:id ──────────────────────────────
router.get('/orders/:id', requireCustomerAuth, (req, res) => {
  try {
    const { email, shop_id } = req.customerAccount;

    const order = db.prepare(`
      SELECT
        o.id, o.created_at, o.fulfilment_status, o.payment_status,
        o.subtotal, o.shipping, o.tax, o.total,
        o.quantity, o.colour, o.finish, o.file_name,
        o.tracking_number, o.tracking_url,
        CASE WHEN o.fulfilment_status IN ('shipped','complete')
          THEN o.customer_message ELSE NULL END as customer_message,
        m.name as material_name, m.category as material_category
      FROM orders o
      LEFT JOIN materials m ON m.id = o.material_id
      WHERE o.id = ? AND o.shop_id = ? AND LOWER(o.customer_email) = LOWER(?)
    `).get(req.params.id, shop_id, email);

    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    console.error('Customer order detail error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { requireCustomerAuth };
export default router;

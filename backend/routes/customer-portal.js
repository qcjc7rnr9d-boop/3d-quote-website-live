import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { db } from '../middleware/auth.js';
import { BCRYPT_ROUNDS, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MINUTES } from '../config.js';
import { parseInfillTiers } from '../lib/infill-tiers.js';
import { parseMaterialRow, safeJson } from '../lib/material-config.js';
import { calculateQuoteForShopSlug, PricingError } from '../lib/pricing-engine.js';

const router = Router();
const customerLoginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MINUTES * 60 * 1000,
  max: LOGIN_MAX_ATTEMPTS,
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
const customerRegisterLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many account attempts, please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const customerPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: { error: 'Too many password attempts, please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
});

function ensureSupportEmailColumns() {
  const cols = db.prepare('PRAGMA table_info(store_settings)').all().map(c => c.name);
  if (!cols.includes('support_email_mode')) {
    db.exec("ALTER TABLE store_settings ADD COLUMN support_email_mode TEXT NOT NULL DEFAULT 'signup'");
  }
  if (!cols.includes('support_email')) {
    db.exec('ALTER TABLE store_settings ADD COLUMN support_email TEXT');
  }
}

class CustomerPortalError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function money(value) {
  return Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;
}

function statusLabel(status) {
  return {
    pending: 'Received',
    processing: 'Confirmed',
    in_production: 'In Production',
    shipped: 'Shipped',
    complete: 'Delivered',
    cancelled: 'Cancelled',
  }[status] || status || 'Received';
}

function paymentLabel(status) {
  return {
    pending: 'Pending',
    paid: 'Paid',
    failed: 'Failed',
    refunded: 'Refunded',
  }[status] || status || 'Pending';
}

function getCustomerShop(req) {
  const shop = db.prepare(
    "SELECT id, name, slug FROM shops WHERE id = ? AND plan != 'suspended'"
  ).get(req.customerAccount.shop_id);
  if (!shop) throw new CustomerPortalError('Not authenticated', 401);

  const requestedSlug = String(req.query.shop || req.query.slug || '').trim();
  if (requestedSlug && requestedSlug !== shop.slug) {
    throw new CustomerPortalError('This customer session belongs to another shop.', 403);
  }
  return shop;
}

function buildCustomerStats(shopId, email) {
  const cfg = db.prepare('SELECT currency FROM pricing_config WHERE shop_id = ?').get(shopId) || {};
  const row = db.prepare(`
    SELECT
      COUNT(*) as total_orders,
      COALESCE(SUM(total), 0) as total_spent,
      SUM(CASE WHEN fulfilment_status NOT IN ('complete','cancelled') THEN 1 ELSE 0 END) as active_orders,
      SUM(CASE WHEN fulfilment_status = 'complete' THEN 1 ELSE 0 END) as delivered_orders
    FROM orders
    WHERE shop_id = ? AND LOWER(customer_email) = LOWER(?) AND payment_status = 'paid'
  `).get(shopId, email) || {};

  const recent = db.prepare(`
    SELECT COUNT(*) as c FROM (
      SELECT id
      FROM orders
      WHERE shop_id = ? AND LOWER(customer_email) = LOWER(?) AND payment_status = 'paid'
      ORDER BY created_at DESC, id DESC
      LIMIT 3
    )
  `).get(shopId, email) || {};

  return {
    total_orders: row.total_orders || 0,
    active_orders: row.active_orders || 0,
    delivered_orders: row.delivered_orders || 0,
    total_spent: money(row.total_spent),
    recent_order_count: recent.c || 0,
    currency: String(cfg.currency || 'NZD').toUpperCase(),
  };
}

function normaliseCustomerOrder(row) {
  if (!row) return null;
  const status = row.fulfilment_status || 'pending';
  const paymentStatus = row.payment_status || 'pending';
  const revealTracking = ['shipped', 'complete'].includes(status);
  return {
    id: row.id,
    created_at: row.created_at,
    fulfilment_status: status,
    fulfilment_status_label: statusLabel(status),
    payment_status: paymentStatus,
    payment_status_label: paymentLabel(paymentStatus),
    subtotal: money(row.subtotal),
    shipping: money(row.shipping),
    tax: money(row.tax),
    total: money(row.total),
    quantity: parseInt(row.quantity, 10) || 1,
    colour: row.colour || null,
    finish: row.finish || null,
    file_name: row.file_name || null,
    tracking_number: revealTracking ? (row.tracking_number || null) : null,
    tracking_url: revealTracking ? (row.tracking_url || null) : null,
    customer_message: revealTracking ? (row.customer_message || null) : null,
    material_name: row.material_name || null,
    material_category: row.material_category || null,
  };
}

function sendCustomerPortalError(res, err) {
  if (err instanceof CustomerPortalError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('Customer portal error:', err);
  return res.status(500).json({ error: 'Internal server error' });
}

// ── Auth middleware for customer portal ───────────────────────
function requireCustomerAuth(req, res, next) {
  const id = req.session && req.session.customerId;
  if (!id) return res.status(401).json({ error: 'Not authenticated' });

  const account = db.prepare('SELECT * FROM customer_accounts WHERE id = ?').get(id);
  if (!account) return res.status(401).json({ error: 'Not authenticated' });
  if (req.session.customerShopId && Number(req.session.customerShopId) !== Number(account.shop_id)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  req.customerAccount = account;
  next();
}

// ── GET /api/customer/shop-info?slug=X  (public) ─────────────
router.get('/shop-info', (req, res) => {
  ensureSupportEmailColumns();
  // Accept ?slug=mahi3d  OR  ?shop=mahi3d (both used across customer pages)
  const slug = req.query.slug || req.query.shop;
  if (!slug) return res.status(400).json({ error: 'slug required' });
  const shop = db.prepare(
    "SELECT id, name, slug, email FROM shops WHERE slug = ? AND plan != 'suspended'"
  ).get(slug);
  if (!shop) return res.status(404).json({ error: 'Shop not found' });

  // Pull branding fields from the shop's store_settings row (all optional)
  const s = db.prepare(
    'SELECT tagline, about, phone, address, support_email_mode, support_email, logo_url FROM store_settings WHERE shop_id = ?'
  ).get(shop.id) || {};
  const supportMode = s.support_email_mode === 'custom' ? 'custom' : 'signup';
  const supportEmail = supportMode === 'custom' && s.support_email ? s.support_email : shop.email;

  res.json({
    name:     shop.name,
    slug:     shop.slug,
    tagline:  s.tagline  || null,
    about:    s.about    || null,
    logo_url: s.logo_url || null,
    phone:    s.phone    || null,
    address:  s.address  || null,
    support_email: supportEmail || null,
    support_email_mode: supportMode,
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
  const filters = [...new Set(materials.flatMap(m => [m.category, ...(m.tags || [])])
    .map(v => String(v || '').trim())
    .filter(Boolean))];
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

// ── POST /api/customer/quote-preview  (public pricing source) ──
router.post('/quote-preview', (req, res) => {
  try {
    const { shopSlug, shop, ...input } = req.body || {};
    const slug = shopSlug || shop;
    const quote = calculateQuoteForShopSlug(db, slug, { ...input, shopSlug: slug });
    res.json(quote);
  } catch (err) {
    if (err instanceof PricingError) {
      return res.status(err.status).json({
        ok: false,
        code: err.code,
        error: err.message,
        quote: err.quote || null,
      });
    }
    console.error('Quote preview error:', err);
    res.status(500).json({ ok: false, error: 'Could not calculate quote.' });
  }
});

// ── POST /api/customer/register ───────────────────────────────
router.post('/register', customerRegisterLimiter, async (req, res) => {
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
router.post('/login', customerLoginLimiter, async (req, res) => {
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
  try {
    const { id, name, email, created_at, shop_id } = req.customerAccount;
    const shop = getCustomerShop(req);
    const stats = buildCustomerStats(shop_id, email);
    res.json({
      id,
      name,
      email,
      created_at,
      shop: { name: shop.name, slug: shop.slug },
      stats,
      order_count: stats.total_orders,
      total_spent: stats.total_spent,
    });
  } catch (err) {
    sendCustomerPortalError(res, err);
  }
});

// ── PATCH /api/customer/me ────────────────────────────────────
router.patch('/me', requireCustomerAuth, (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name || name.length < 2) {
      return res.status(400).json({ error: 'Enter your name.' });
    }
    if (name.length > 120) {
      return res.status(400).json({ error: 'Name is too long.' });
    }

    db.prepare(`
      UPDATE customer_accounts
      SET name = ?
      WHERE id = ?
    `).run(name, req.customerAccount.id);

    res.json({ ok: true, name });
  } catch (err) {
    console.error('Customer profile update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/customer/change-password ────────────────────────
router.post('/change-password', customerPasswordLimiter, requireCustomerAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    }

    const valid = await bcrypt.compare(currentPassword, req.customerAccount.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect.' });
    }

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    db.prepare(`
      UPDATE customer_accounts
      SET password_hash = ?
      WHERE id = ?
    `).run(hash, req.customerAccount.id);

    res.json({ ok: true });
  } catch (err) {
    console.error('Customer password change error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/customer/orders ──────────────────────────────────
router.get('/orders', requireCustomerAuth, (req, res) => {
  try {
    const { email, shop_id } = req.customerAccount;
    getCustomerShop(req);

    const orders = db.prepare(`
      SELECT
        o.id, o.created_at, o.fulfilment_status, o.payment_status,
        o.subtotal, o.shipping, o.tax, o.total,
        o.quantity, o.colour, o.finish, o.file_name,
        o.tracking_number, o.tracking_url, o.customer_message,
        m.name as material_name, m.category as material_category
      FROM orders o
      LEFT JOIN materials m ON m.id = o.material_id
      WHERE o.shop_id = ? AND LOWER(o.customer_email) = LOWER(?)
      ORDER BY o.created_at DESC
    `).all(shop_id, email).map(normaliseCustomerOrder);

    res.json(orders);
  } catch (err) {
    sendCustomerPortalError(res, err);
  }
});

// ── GET /api/customer/orders/:id ──────────────────────────────
router.get('/orders/:id', requireCustomerAuth, (req, res) => {
  try {
    const { email, shop_id } = req.customerAccount;
    getCustomerShop(req);

    const order = normaliseCustomerOrder(db.prepare(`
      SELECT
        o.id, o.created_at, o.fulfilment_status, o.payment_status,
        o.subtotal, o.shipping, o.tax, o.total,
        o.quantity, o.colour, o.finish, o.file_name,
        o.tracking_number, o.tracking_url, o.customer_message,
        m.name as material_name, m.category as material_category
      FROM orders o
      LEFT JOIN materials m ON m.id = o.material_id
      WHERE o.id = ? AND o.shop_id = ? AND LOWER(o.customer_email) = LOWER(?)
    `).get(req.params.id, shop_id, email));

    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    sendCustomerPortalError(res, err);
  }
});

export { requireCustomerAuth };
export default router;

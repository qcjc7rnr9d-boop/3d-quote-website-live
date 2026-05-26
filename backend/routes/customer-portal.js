import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import rateLimit from 'express-rate-limit';
import { db } from '../middleware/auth.js';
import { sendMail } from '../lib/mailer.js';
import { renderTemplate } from '../lib/email-templates/index.js';
import { buildEmailIdempotencyKey } from '../lib/email-delivery.js';
import { BCRYPT_ROUNDS, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MINUTES, MIN_PASSWORD_LENGTH } from '../config.js';
import { parseInfillTiers } from '../lib/infill-tiers.js';
import { VISIBLE_MATERIAL_CATEGORY, parseMaterialRow, safeJson } from '../lib/material-config.js';
import { calculateQuoteForShopSlug, normaliseModelDisplayMetadata, PricingError } from '../lib/pricing-engine.js';
import { normaliseCart, previewCartForShop } from '../lib/cart.js';
import { attachOrderFiles, attachOrderFilesList } from '../lib/order-files.js';
import { getExchangeRates, normaliseQuoteCurrencies } from '../lib/exchange-rates.js';
import { previewQuoteUsage, recordQuoteUsageEvent } from '../lib/billing-service.js';
import {
  deleteCustomerPrivacyData,
  exportCustomerPrivacyData,
} from '../lib/customer-privacy.js';
import { resetTokenDigest, resetTokenLookupValues } from '../lib/reset-tokens.js';
import {
  clearSessionCookie,
  destroySession,
  regenerateSession,
  revokeCustomerAccountSessions,
} from '../lib/session-security.js';

const router = Router();
const smokeRateLimitSkip = req => process.env.NODE_ENV !== 'production' && req.get('x-smoke-test') === '1';
const customerLoginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MINUTES * 60 * 1000,
  max: LOGIN_MAX_ATTEMPTS,
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: smokeRateLimitSkip,
});
const customerRegisterLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many account attempts, please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: smokeRateLimitSkip,
});
const customerPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: { error: 'Too many password attempts, please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: smokeRateLimitSkip,
});
const customerResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { ok: true, message: "If that email is registered, you'll receive a reset link shortly." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: smokeRateLimitSkip,
});
const customerResetVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { valid: false, error: 'Too many reset link checks, please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: smokeRateLimitSkip,
});
const customerQuoteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many quote requests, please try again shortly.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: smokeRateLimitSkip,
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

function ensureCustomerResetTokensTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL,
      customer_account_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
      FOREIGN KEY (customer_account_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_customer_reset_token
      ON customer_reset_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_customer_reset_account
      ON customer_reset_tokens(customer_account_id, used, expires_at);
  `);
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

function normaliseCustomerEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidCustomerEmail(value) {
  const email = normaliseCustomerEmail(value);
  if (!email || email.length > 254) return false;
  if (email.includes('..')) return false;
  const [local, domain, ...extra] = email.split('@');
  if (!local || !domain || extra.length) return false;
  if (local.length > 64 || domain.length > 253) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return false;
  if (domain.split('.').some(part => !part || part.startsWith('-') || part.endsWith('-'))) return false;
  return true;
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

function getCustomerShop(req, requestedSlugOverride = null) {
  const shop = db.prepare(
    "SELECT id, name, slug FROM shops WHERE id = ? AND plan != 'suspended'"
  ).get(req.customerAccount.shop_id);
  if (!shop) throw new CustomerPortalError('Not authenticated', 401);

  const requestedSlug = String(requestedSlugOverride || req.query.shop || req.query.slug || '').trim();
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
    files: Array.isArray(row.files) ? row.files : [],
    items: Array.isArray(row.items) ? row.items : [],
  };
}

function sqlDatetime(date = new Date()) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function parseSqlDatetime(value) {
  if (!value) return null;
  const date = new Date(String(value).replace(' ', 'T') + 'Z');
  return Number.isFinite(date.getTime()) ? date : null;
}

function quoteValidityHours(shopId) {
  const row = db.prepare('SELECT quote_valid_hours FROM pricing_config WHERE shop_id = ?').get(shopId) || {};
  const hours = parseInt(row.quote_valid_hours, 10);
  if (!Number.isFinite(hours) || hours <= 0) return 24;
  return Math.min(hours, 24 * 30);
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normaliseSavedQuoteRequest(input = {}, slug) {
  const source = safeObject(input);
  const file = safeObject(source.file);
  const shipping = safeObject(source.shipping);
  return {
    shopSlug: slug,
    materialId: source.materialId ?? safeObject(source.material).id ?? null,
    models: Array.isArray(source.models) ? source.models : (Array.isArray(file.models) ? file.models : null),
    volumeCm3: source.volumeCm3 ?? file.volumeCm3 ?? null,
    colourId: source.colourId ?? source.colorId ?? safeObject(source.colour).id ?? safeObject(source.color).id ?? null,
    colour: source.colour ?? source.colorName ?? source.colourName ?? safeObject(source.colour).name ?? safeObject(source.color).name ?? null,
    finishId: source.finishId ?? safeObject(source.finish).id ?? null,
    finish: source.finishName ?? source.finishLabel ?? (typeof source.finish === 'string' ? source.finish : safeObject(source.finish).name) ?? null,
    infillTierId: source.infillTierId ?? safeObject(source.infill).id ?? null,
    quantity: source.quantity,
    shippingId: source.shippingId ?? shipping.id ?? null,
    previewWithoutShipping: source.previewWithoutShipping ?? !(source.shippingId ?? shipping.id),
    dimensions: source.dimensions ?? file.dimensions ?? null,
  };
}

function normaliseFileMeta(input = {}, quote = {}) {
  const file = safeObject(input.fileMeta || input.file);
  const selected = safeObject(quote.selected);
  const models = Array.isArray(selected.models) && selected.models.length
    ? selected.models
    : (Array.isArray(file.models) ? file.models.map((model, index) => normaliseModelDisplayMetadata(model, index, { strict: false })) : []);
  const firstModelName = models.length === 1 ? models[0]?.name : null;
  const fileMeta = normaliseModelDisplayMetadata({
    name: file.name || file.fileName || firstModelName || 'Uploaded file',
    size: file.size ?? file.fileSize,
    ext: file.fileExt || file.type,
    dimensions: file.dimensions,
  }, 0, { strict: false });
  return {
    name: fileMeta.name,
    size: fileMeta.size,
    sizeLabel: file.sizeLabel || file.file_size || null,
    type: file.type || file.fileType || null,
    volumeCm3: file.volumeCm3 ?? selected.volumeCm3 ?? null,
    dimensions: selected.dimensions || fileMeta.dimensions || null,
    models,
  };
}

function buildSavedQuoteSelection(quote = {}) {
  const selected = safeObject(quote.selected);
  return {
    materialId: selected.material?.id ?? null,
    materialName: selected.material?.name || null,
    colourId: selected.colour?.id ?? null,
    colourName: selected.colour?.name || null,
    colourHex: selected.colour?.hex || null,
    finishId: selected.finish?.id ?? null,
    finishName: selected.finish?.name || null,
    finishLayerHeight: selected.finish?.layerHeight || '',
    finishDescription: selected.finish?.description || '',
    finishPriceMultiplier: selected.finish?.priceMultiplier ?? 1,
    infillTierId: selected.infill?.id ?? null,
    infillLabel: selected.infill?.label || null,
    quantity: selected.quantity || 1,
    shippingId: selected.shipping?.id ?? null,
    shippingLabel: selected.shipping?.label || null,
    shippingPrice: selected.shipping?.finalPrice ?? selected.shipping?.price ?? null,
  };
}

function normaliseSavedQuote(row) {
  if (!row) return null;
  const quoteSnapshot = safeJson(row.quote_snapshot, {}) || {};
  const file = safeJson(row.file_meta, {}) || {};
  const selection = safeJson(row.selection, {}) || {};
  const quoteRequest = safeJson(row.quote_request, {}) || {};
  const selected = safeObject(quoteSnapshot.selected);
  const material = safeObject(selected.material);
  const colour = safeObject(selected.colour);
  const finish = safeObject(selected.finish);
  const expiresAt = parseSqlDatetime(row.expires_at);
  const expired = row.status === 'active' && expiresAt && expiresAt.getTime() <= Date.now();
  const status = expired ? 'expired' : (row.status || 'active');
  const dimensions = file.dimensions || selected.dimensions || quoteRequest.dimensions || null;
  return {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
    status,
    currency: String(row.currency || quoteSnapshot.currency || 'NZD').toUpperCase(),
    totalCents: parseInt(row.total_cents, 10) || 0,
    total: money((parseInt(row.total_cents, 10) || 0) / 100),
    file,
    file_name: file.name || null,
    selection,
    quoteRequest,
    quoteSnapshot,
    material_name: material.name || selection.materialName || null,
    colour_name: colour.name || selection.colourName || null,
    colour_hex: colour.hex || selection.colourHex || null,
    finish_name: finish.name || selection.finishName || null,
    finish_layer_height: finish.layerHeight || selection.finishLayerHeight || '',
    dimensions,
  };
}

function sendCustomerPortalError(res, err) {
  if (err instanceof CustomerPortalError) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error('Customer portal error:', err);
  return res.status(500).json({ error: 'Internal server error' });
}

function customerResetMessage() {
  return "If that email is registered, you'll receive a reset link shortly.";
}

function validateCustomerPassword(password) {
  if (!password || String(password).length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one digit.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character.';
  return null;
}

// ── Auth middleware for customer portal ───────────────────────
function requireCustomerAuth(req, res, next) {
  const id = req.session && req.session.customerId;
  if (!id) return res.status(401).json({ error: 'Not authenticated' });

  const account = db.prepare(`
    SELECT ca.*
    FROM customer_accounts ca
    JOIN shops s ON s.id = ca.shop_id
    WHERE ca.id = ? AND s.plan != 'suspended'
  `).get(id);
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
    WHERE shop_id = ? AND active = 1 AND category = ?
    ORDER BY sort_order, name
  `).all(shop.id, VISIBLE_MATERIAL_CATEGORY).map(m => ({
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
    max_model_quantity:  cfg.max_model_quantity ?? null,
    show_breakdown:      cfg.show_breakdown        ? true : false,
    pricing_mode:        cfg.pricing_mode          || 'material',
    time_rate_per_hour:  cfg.time_rate_per_hour    ?? 0,
    time_rate_per_gram:  cfg.time_rate_per_gram    ?? 0,
    infill_tiers:        parseInfillTiers(cfg.infill_tiers),
    materials,
  });
});

// ── GET /api/customer/exchange-rates?base=NZD&quotes=AUD,USD ──
router.get('/exchange-rates', async (req, res) => {
  try {
    const base = String(req.query.base || 'NZD').toUpperCase();
    const quotes = normaliseQuoteCurrencies(req.query.quotes);
    const payload = await getExchangeRates(db, { base, quotes });
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json(payload);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('Exchange rate error:', err);
    res.status(status).json({
      error: err.message || 'Could not load exchange rates.',
    });
  }
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
     WHERE shop_id = ? AND active = 1 AND category = ?
     ORDER BY sort_order, name`
  ).all(shop.id, VISIBLE_MATERIAL_CATEGORY);
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
router.post('/quote-preview', customerQuoteLimiter, (req, res) => {
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

// ── POST /api/customer/cart-preview  (checkout cart pricing source) ──
router.post('/cart-preview', customerQuoteLimiter, (req, res) => {
  try {
    const { shopSlug, shop, items, shippingId, shipping } = req.body || {};
    const slug = shopSlug || shop;
    const shopRow = db.prepare("SELECT * FROM shops WHERE slug = ? AND plan != 'suspended'").get(slug);
    if (!shopRow) return res.status(404).json({ ok: false, code: 'SHOP_NOT_FOUND', error: 'Shop not found.' });
    const cart = previewCartForShop(db, shopRow, normaliseCart({
      shopSlug: slug,
      items: Array.isArray(items) ? items : [],
      shipping: shipping || (shippingId ? { id: shippingId } : null),
    }, slug), { requireShipping: false });
    res.json({ ok: true, cart });
  } catch (err) {
    if (err instanceof PricingError) {
      return res.status(err.status).json({
        ok: false,
        code: err.code,
        error: err.message,
        quote: err.quote || null,
      });
    }
    console.error('Cart preview error:', err);
    res.status(500).json({ ok: false, error: 'Could not calculate checkout cart.' });
  }
});

// ── POST /api/customer/register ───────────────────────────────
router.post('/register', customerRegisterLimiter, async (req, res) => {
  try {
    const { shopSlug, name, email, password } = req.body;
    if (!shopSlug || !name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    const trimmedName = String(name || '').trim();
    if (trimmedName.length < 2) {
      return res.status(400).json({ error: 'Enter your name.' });
    }
    if (trimmedName.length > 120) {
      return res.status(400).json({ error: 'Name is too long.' });
    }
    const normalisedEmail = normaliseCustomerEmail(email);
    if (!isValidCustomerEmail(normalisedEmail)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }
    const strengthError = validateCustomerPassword(password);
    if (strengthError) {
      return res.status(400).json({ error: strengthError });
    }

    const shop = db.prepare("SELECT id FROM shops WHERE slug = ? AND plan != 'suspended'").get(shopSlug);
    if (!shop) return res.status(404).json({ error: 'Shop not found' });

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    try {
      db.exec('BEGIN IMMEDIATE');
      const result = db.prepare(`
        INSERT INTO customer_accounts (shop_id, email, name, password_hash)
        VALUES (?, ?, ?, ?)
      `).run(shop.id, normalisedEmail, trimmedName, hash);

      db.prepare(`
        INSERT INTO customers (shop_id, email, name)
        VALUES (?, ?, ?)
        ON CONFLICT(shop_id, email) DO UPDATE SET
          name = excluded.name
      `).run(shop.id, normalisedEmail, trimmedName);
      db.exec('COMMIT');

      await regenerateSession(req);
      req.session.customerId  = result.lastInsertRowid;
      req.session.customerShopId = shop.id;
      res.status(201).json({ ok: true });
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch {}
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
    const normalisedEmail = normaliseCustomerEmail(email);
    if (!isValidCustomerEmail(normalisedEmail)) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }

    const shop = db.prepare("SELECT id FROM shops WHERE slug = ? AND plan != 'suspended'").get(shopSlug);
    if (!shop) return res.status(401).json({ error: 'Incorrect email or password' });

    const account = db.prepare(
      'SELECT * FROM customer_accounts WHERE shop_id = ? AND email = ?'
    ).get(shop.id, normalisedEmail);

    if (!account) return res.status(401).json({ error: 'Incorrect email or password' });

    const valid = await bcrypt.compare(password, account.password_hash);
    if (!valid) return res.status(401).json({ error: 'Incorrect email or password' });

    await regenerateSession(req);
    req.session.customerId = account.id;
    req.session.customerShopId = shop.id;
    res.json({ ok: true });
  } catch (err) {
    console.error('Customer login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/customer/forgot-password ───────────────────────
router.post('/forgot-password', customerResetLimiter, async (req, res) => {
  const message = customerResetMessage();
  try {
    ensureCustomerResetTokensTable();
    const shopSlug = String(req.body?.shopSlug || req.body?.shop || '').trim();
    const email = normaliseCustomerEmail(req.body?.email);
    if (!shopSlug || !email || !isValidCustomerEmail(email)) {
      return res.json({ ok: true, message });
    }

    const shop = db.prepare(
      "SELECT id, name, slug, email FROM shops WHERE slug = ? AND plan != 'suspended'"
    ).get(shopSlug);
    if (!shop) return res.json({ ok: true, message });

    const account = db.prepare(
      'SELECT id, shop_id, email, name FROM customer_accounts WHERE shop_id = ? AND email = ?'
    ).get(shop.id, email);
    if (!account) return res.json({ ok: true, message });

    const token = jwt.sign(
      { customerAccountId: account.id, shopId: shop.id, jti: uuidv4() },
      process.env.JWT_SECRET || 'dev-jwt-secret',
      { expiresIn: '1h' }
    );
    db.prepare(`
      INSERT INTO customer_reset_tokens (shop_id, customer_account_id, token, expires_at)
      VALUES (?, ?, ?, datetime('now', '+1 hour'))
    `).run(shop.id, account.id, resetTokenDigest(token));

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const resetLink = `${baseUrl}/customer/reset-password.html?shop=${encodeURIComponent(shop.slug)}&token=${encodeURIComponent(token)}`;
    const tpl = renderTemplate('customer_password_reset', {
      shop,
      customerName: account.name,
      resetLink,
    });
    await sendMail({
      shopId: shop.id,
      shopSlug: shop.slug,
      templateId: tpl.templateId,
      category: tpl.category,
      idempotencyKey: buildEmailIdempotencyKey('customer-reset', account.id, token),
      to: account.email,
      from: tpl.from,
      replyTo: tpl.replyTo,
      subject: tpl.subject,
      text: tpl.text,
      html: tpl.html,
    });

    res.json({ ok: true, message });
  } catch (err) {
    console.error('Customer forgot password error:', err);
    res.json({ ok: true, message });
  }
});

// ── GET /api/customer/reset-password/verify ──────────────────
router.get('/reset-password/verify', customerResetVerifyLimiter, (req, res) => {
  try {
    ensureCustomerResetTokensTable();
    const token = String(req.query?.token || '');
    if (!token) {
      return res.status(400).json({ valid: false, error: 'Token expired or invalid' });
    }

    const lookup = resetTokenLookupValues(token);
    const row = db.prepare(`
      SELECT crt.*, ca.email, ca.name, s.slug, s.name AS shop_name
      FROM customer_reset_tokens crt
      JOIN customer_accounts ca ON ca.id = crt.customer_account_id AND ca.shop_id = crt.shop_id
      JOIN shops s ON s.id = crt.shop_id
      WHERE crt.token IN (?, ?)
        AND crt.used = 0
        AND crt.expires_at > datetime('now')
        AND s.plan != 'suspended'
    `).get(...lookup);
    if (!row) {
      return res.status(400).json({ valid: false, error: 'Token expired or invalid' });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-jwt-secret');
    if (Number(payload.customerAccountId) !== Number(row.customer_account_id) || Number(payload.shopId) !== Number(row.shop_id)) {
      return res.status(400).json({ valid: false, error: 'Token expired or invalid' });
    }

    res.json({
      valid: true,
      shop: { slug: row.slug, name: row.shop_name },
      email: row.email,
      name: row.name,
    });
  } catch (err) {
    res.status(400).json({ valid: false, error: 'Token expired or invalid' });
  }
});

// ── POST /api/customer/reset-password ────────────────────────
router.post('/reset-password', customerPasswordLimiter, async (req, res) => {
  try {
    ensureCustomerResetTokensTable();
    const token = String(req.body?.token || '');
    const newPassword = String(req.body?.newPassword || req.body?.password || '');
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required.' });
    }

    const strengthError = validateCustomerPassword(newPassword);
    if (strengthError) {
      return res.status(400).json({ error: strengthError });
    }

    const lookup = resetTokenLookupValues(token);
    const row = db.prepare(`
      SELECT crt.*
      FROM customer_reset_tokens crt
      JOIN shops s ON s.id = crt.shop_id
      WHERE crt.token IN (?, ?)
        AND crt.used = 0
        AND crt.expires_at > datetime('now')
        AND s.plan != 'suspended'
    `).get(...lookup);
    if (!row) {
      return res.status(400).json({ error: 'Token expired or invalid' });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET || 'dev-jwt-secret');
    } catch {
      return res.status(400).json({ error: 'Token expired or invalid' });
    }
    if (Number(payload.customerAccountId) !== Number(row.customer_account_id) || Number(payload.shopId) !== Number(row.shop_id)) {
      return res.status(400).json({ error: 'Token expired or invalid' });
    }

    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const claimed = db.prepare(`
      UPDATE customer_reset_tokens
      SET used = 1
      WHERE token IN (?, ?)
        AND used = 0
        AND expires_at > datetime('now')
    `).run(...lookup);
    if (claimed.changes !== 1) {
      return res.status(400).json({ error: 'Token expired or invalid' });
    }
    db.prepare(`
      UPDATE customer_accounts
      SET password_hash = ?
      WHERE id = ? AND shop_id = ?
    `).run(hash, row.customer_account_id, row.shop_id);
    revokeCustomerAccountSessions(db, row.customer_account_id);

    if (req.session && Number(req.session.customerId) === Number(row.customer_account_id)) {
      await destroySession(req);
      db.prepare('DELETE FROM app_sessions WHERE sid = ?').run(req.sessionID);
      clearSessionCookie(res);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Customer reset password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/customer/logout ─────────────────────────────────
router.post('/logout', async (req, res) => {
  const sessionToken = req.sessionID;
  try {
    await destroySession(req);
    db.prepare('DELETE FROM app_sessions WHERE sid = ?').run(sessionToken);
    clearSessionCookie(res);
    res.json({ ok: true });
  } catch (err) {
    console.error('Customer logout error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
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
    db.prepare(`
      UPDATE customers
      SET name = ?
      WHERE shop_id = ? AND LOWER(email) = LOWER(?)
    `).run(name, req.customerAccount.shop_id, req.customerAccount.email);

    res.json({ ok: true, name });
  } catch (err) {
    console.error('Customer profile update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/customer/privacy/export ─────────────────────────
router.get('/privacy/export', requireCustomerAuth, (req, res) => {
  try {
    getCustomerShop(req);
    res.json(exportCustomerPrivacyData(db, {
      customerAccountId: req.customerAccount.id,
      shopId: req.customerAccount.shop_id,
    }));
  } catch (err) {
    sendCustomerPortalError(res, err);
  }
});

// ── POST /api/customer/privacy/delete-account ────────────────
router.post('/privacy/delete-account', customerPasswordLimiter, requireCustomerAuth, async (req, res) => {
  try {
    getCustomerShop(req);
    const password = String(req.body?.password || req.body?.currentPassword || '');
    if (!password) return res.status(400).json({ error: 'Current password is required.' });
    const valid = await bcrypt.compare(password, req.customerAccount.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

    const sessionToken = req.sessionID;
    const result = deleteCustomerPrivacyData(db, {
      customerAccountId: req.customerAccount.id,
      shopId: req.customerAccount.shop_id,
      reason: req.body?.reason || 'customer_request',
      requestedBy: 'customer',
      metadata: { source: 'customer_portal' },
    });

    req.session.destroy(() => {
      db.prepare('DELETE FROM app_sessions WHERE sid = ?').run(sessionToken);
      res.json(result);
    });
  } catch (err) {
    sendCustomerPortalError(res, err);
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
    const strengthError = validateCustomerPassword(newPassword);
    if (strengthError) {
      return res.status(400).json({ error: strengthError });
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
    revokeCustomerAccountSessions(db, req.customerAccount.id, { exceptSid: req.sessionID });

    res.json({ ok: true });
  } catch (err) {
    console.error('Customer password change error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/customer/quotes ────────────────────────────────
router.get('/quotes', requireCustomerAuth, (req, res) => {
  try {
    const shop = getCustomerShop(req);
    const rows = db.prepare(`
      SELECT *
      FROM customer_saved_quotes
      WHERE shop_id = ?
        AND customer_account_id = ?
        AND status != 'deleted'
      ORDER BY created_at DESC, id DESC
    `).all(shop.id, req.customerAccount.id);

    res.json(rows.map(normaliseSavedQuote));
  } catch (err) {
    sendCustomerPortalError(res, err);
  }
});

// ── POST /api/customer/quotes ───────────────────────────────
router.post('/quotes', customerQuoteLimiter, requireCustomerAuth, (req, res) => {
  try {
    const body = safeObject(req.body);
    const rawQuoteRequest = safeObject(body.quoteRequest || body.request || body);
    const requestedSlug = body.shopSlug || body.shop || rawQuoteRequest.shopSlug || rawQuoteRequest.shop;
    const shop = getCustomerShop(req, requestedSlug);
    const quoteRequest = normaliseSavedQuoteRequest(rawQuoteRequest, shop.slug);
    const usagePreview = previewQuoteUsage(db, shop.id);
    if (usagePreview.limit_reached) {
      return res.status(402).json({
        ok: false,
        code: 'QUOTE_LIMIT_REACHED',
        error: 'You have used your included quotes for this billing period. Upgrade to keep sending quotes.',
        usage: usagePreview,
      });
    }
    const quote = calculateQuoteForShopSlug(db, shop.slug, quoteRequest);
    const fileMeta = normaliseFileMeta(body, quote);
    const selection = buildSavedQuoteSelection(quote);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + quoteValidityHours(shop.id) * 60 * 60 * 1000);

    const result = db.prepare(`
      INSERT INTO customer_saved_quotes (
        shop_id, customer_account_id, quote_request, quote_snapshot, file_meta,
        selection, total_cents, currency, status, expires_at, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      shop.id,
      req.customerAccount.id,
      JSON.stringify(quoteRequest),
      JSON.stringify(quote),
      JSON.stringify(fileMeta),
      JSON.stringify(selection),
      quote.totalCents,
      quote.currency,
      sqlDatetime(expiresAt),
      sqlDatetime(now),
      sqlDatetime(now)
    );

    const row = db.prepare(`
      SELECT * FROM customer_saved_quotes
      WHERE id = ? AND shop_id = ? AND customer_account_id = ?
    `).get(result.lastInsertRowid, shop.id, req.customerAccount.id);
    const usage = recordQuoteUsageEvent(db, {
      shopId: shop.id,
      quoteId: `saved:${result.lastInsertRowid}`,
      eventType: 'saved_quote_submitted',
    });
    res.status(201).json({
      ok: true,
      quote: normaliseSavedQuote(row),
      usage,
      overage_warning: usagePreview.overage_warning,
    });
  } catch (err) {
    if (err instanceof PricingError) {
      return res.status(err.status).json({
        ok: false,
        code: err.code,
        error: err.message,
        quote: err.quote || null,
      });
    }
    sendCustomerPortalError(res, err);
  }
});

// ── DELETE /api/customer/quotes/:id ─────────────────────────
router.delete('/quotes/:id', requireCustomerAuth, (req, res) => {
  try {
    const row = db.prepare(`
      SELECT q.*, s.slug AS shop_slug
      FROM customer_saved_quotes q
      JOIN shops s ON s.id = q.shop_id
      WHERE q.id = ? AND q.customer_account_id = ? AND q.status != 'deleted'
    `).get(req.params.id, req.customerAccount.id);
    if (!row) return res.status(404).json({ error: 'Saved quote not found' });

    getCustomerShop(req, row.shop_slug);
    db.prepare(`
      UPDATE customer_saved_quotes
      SET status = 'deleted', updated_at = ?
      WHERE id = ? AND customer_account_id = ?
    `).run(sqlDatetime(), row.id, req.customerAccount.id);

    res.json({ ok: true });
  } catch (err) {
    sendCustomerPortalError(res, err);
  }
});

// ── GET /api/customer/orders ──────────────────────────────────
router.get('/orders', requireCustomerAuth, (req, res) => {
  try {
    const { email, shop_id } = req.customerAccount;
    getCustomerShop(req);

    const orders = attachOrderFilesList(db, db.prepare(`
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
    `).all(shop_id, email)).map(normaliseCustomerOrder);

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

    const rawOrder = db.prepare(`
      SELECT
        o.id, o.created_at, o.fulfilment_status, o.payment_status,
        o.subtotal, o.shipping, o.tax, o.total,
        o.quantity, o.colour, o.finish, o.file_name,
        o.tracking_number, o.tracking_url, o.customer_message,
        m.name as material_name, m.category as material_category
      FROM orders o
      LEFT JOIN materials m ON m.id = o.material_id
      WHERE o.id = ? AND o.shop_id = ? AND LOWER(o.customer_email) = LOWER(?)
    `).get(req.params.id, shop_id, email);
    const order = normaliseCustomerOrder(attachOrderFiles(db, rawOrder));

    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    sendCustomerPortalError(res, err);
  }
});

export { requireCustomerAuth };
export default router;

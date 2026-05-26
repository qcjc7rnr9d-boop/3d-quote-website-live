import { Router } from 'express';
import multer from 'multer';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { db, requireShopAuth } from '../middleware/auth.js';
import { sendMail } from '../lib/mailer.js';
import { renderTemplate, DEFAULTS as EMAIL_TEMPLATE_DEFAULTS } from '../lib/email-templates/index.js';
import {
  ensureEmbedSettingsColumns,
  normaliseEmbedAllowedOrigins,
  parseEmbedAllowedOrigins,
} from '../lib/embed.js';
import {
  ensureEmailDeliverySchema,
  getShopEmailSettings,
  normaliseEmailDomain,
  recentEmailEventsForShop,
  updateShopEmailDomainSettings,
} from '../lib/email-delivery.js';

const router = Router();
const __dirname = dirname(fileURLToPath(import.meta.url));

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedMime = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
    if (!allowedMime.has(file.mimetype || '')) {
      return cb(new Error('Only PNG, JPEG, WebP, or GIF logo uploads are supported.'));
    }
    cb(null, true);
  },
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

function ensureSettings(shopId) {
  ensureSupportEmailColumns();
  ensureEmbedSettingsColumns(db);
  ensureEmailDeliverySchema(db);
  db.prepare('INSERT OR IGNORE INTO store_settings (shop_id) VALUES (?)').run(shopId);
  return db.prepare('SELECT * FROM store_settings WHERE shop_id = ?').get(shopId);
}

function normaliseEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function verifiedImageExtension(file) {
  const buf = file?.buffer;
  const mime = file?.mimetype;
  if (!buf || buf.length < 12) return null;
  if (mime === 'image/png' && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (mime === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (mime === 'image/gif' && (buf.subarray(0, 6).toString('ascii') === 'GIF87a' || buf.subarray(0, 6).toString('ascii') === 'GIF89a')) return '.gif';
  if (mime === 'image/webp' && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  return null;
}

function handleLogoUpload(req, res, next) {
  logoUpload.single('logo')(req, res, err => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Logo file is too large. Upload an image under 2 MB.' });
    }
    return res.status(400).json({ error: err.message || 'Logo upload failed.' });
  });
}

function parseSettings(row) {
  const templates = parseJsonObjectSetting(row.email_templates, {});
  // Surface the optional "thank-you" sentence as a top-level field so the
  // admin notifications page can read/write it without touching the
  // per-template override structure.
  const thankYou = String(templates?._thank_you || '');
  return {
    ...row,
    notifications:   parseJsonObjectSetting(row.notifications, {}),
    email_templates: templates,
    email_thank_you: thankYou,
    shipping_zones:  parseJsonArraySetting(row.shipping_zones, []),
    embed_allowed_origins: parseEmbedAllowedOrigins(row.embed_allowed_origins),
    email_domain: {
      domain: row.email_sending_domain || '',
      status: row.email_sending_domain_status || 'not_configured',
      records: parseJsonArraySetting(row.email_sending_domain_records, []),
      verified_at: row.email_sending_domain_verified_at || null,
      last_checked_at: row.email_sending_domain_last_checked_at || null,
      use_platform_fallback: row.email_use_platform_fallback !== 0,
    },
  };
}

function parseJsonSetting(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

function parseJsonArraySetting(value, fallback = []) {
  const parsed = parseJsonSetting(value, fallback);
  return Array.isArray(parsed) ? parsed : fallback;
}

function parseJsonObjectSetting(value, fallback = {}) {
  const parsed = parseJsonSetting(value, fallback);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
}

function finiteNumber(value, fallback = null) {
  if (value === '' || value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function moneyValue(value, fallback = 0) {
  const n = finiteNumber(value, fallback);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function integerDays(value, fallback) {
  const n = finiteNumber(value, fallback);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function packageLimit(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n > 0 ? n : null;
}

function invalidShipping(message) {
  const err = new Error(message);
  err.code = 'INVALID_SHIPPING_CONFIG';
  return err;
}

function invalidLogoUrl(message) {
  const err = new Error(message);
  err.code = 'INVALID_LOGO_URL';
  return err;
}

function normaliseLogoUrlForShop(value, shopId) {
  if (value === undefined) return undefined;
  const url = String(value || '').trim();
  if (!url) return null;
  const safePrefix = `/uploads/logos/${shopId}/`;
  const imageName = '[A-Za-z0-9._-]+\\.(?:png|jpe?g|webp|gif)';
  const safePattern = new RegExp(`^${safePrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}${imageName}$`, 'i');
  if (!safePattern.test(url)) {
    throw invalidLogoUrl('Logo URL must be an uploaded image for this shop.');
  }
  return url;
}

function normaliseShippingBandForStorage(raw = {}, index = 0, fallbackPrice = 0) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw invalidShipping('Shipping bands must be valid package band objects.');
  }
  const label = String(raw.label || raw.name || (index === 0 ? 'Standard parcel' : `Band ${index + 1}`)).trim();
  const price = moneyValue(raw.price ?? raw.rate, fallbackPrice);
  const maxWeightKg = packageLimit(raw.maxWeightKg ?? raw.max_weight_kg ?? raw.weight_kg);
  const maxLongestMm = packageLimit(raw.maxLongestMm ?? raw.max_longest_mm ?? raw.longest_mm);
  const maxVolumeCm3 = packageLimit(raw.maxVolumeCm3 ?? raw.max_volume_cm3 ?? raw.volume_cm3);
  if (price === null || maxWeightKg === undefined || maxLongestMm === undefined || maxVolumeCm3 === undefined) {
    throw invalidShipping('Shipping band limits and prices must be zero or positive numbers.');
  }
  return {
    id: String(raw.id || `band_${index + 1}`).trim().slice(0, 80) || `band_${index + 1}`,
    label: label.slice(0, 80) || `Band ${index + 1}`,
    maxWeightKg,
    maxLongestMm,
    maxVolumeCm3,
    price,
    active: raw.active === false ? false : true,
  };
}

function normaliseShippingZonesForStorage(input, existingValue) {
  const source = input === undefined ? parseJsonArraySetting(existingValue, []) : input;
  if (!Array.isArray(source)) {
    throw invalidShipping('Shipping options must be an array.');
  }

  let recommendedSeen = false;
  return source.slice(0, 50).map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw invalidShipping('Shipping options must be valid objects.');
    }
    const active = raw.active === false ? false : true;
    const courier = String(raw.courier || raw.name || '').trim();
    const service = String(raw.service || '').trim();
    if (active && (!courier || !service)) {
      throw invalidShipping('Each active shipping option needs a courier and service.');
    }
    const price = moneyValue(raw.price ?? raw.rate, 0);
    if (price === null) {
      throw invalidShipping('Shipping prices must be zero or positive numbers.');
    }
    const daysMin = integerDays(raw.days_min ?? raw.est_days_min, 2);
    const daysMaxFallback = daysMin === null ? 5 : Math.max(daysMin, 5);
    const daysMax = integerDays(raw.days_max ?? raw.est_days_max, daysMaxFallback);
    if (daysMin === null || daysMax === null || daysMax < daysMin) {
      throw invalidShipping('Shipping delivery day ranges must be valid.');
    }
    if (raw.bands !== undefined && !Array.isArray(raw.bands)) {
      throw invalidShipping('Shipping bands must be an array.');
    }
    const bands = (Array.isArray(raw.bands) ? raw.bands : [])
      .slice(0, 40)
      .map((band, bandIndex) => normaliseShippingBandForStorage(band, bandIndex, price));
    const wantsRecommended = raw.recommended === true && !recommendedSeen;
    if (wantsRecommended) recommendedSeen = true;
    return {
      id: String(raw.id || `${courier || 'shipping'}-${service || index}`).trim().slice(0, 80) || `shipping_${index + 1}`,
      courier: courier.slice(0, 80) || 'Courier',
      service: service.slice(0, 80) || 'Standard',
      price,
      days_min: daysMin,
      days_max: daysMax,
      active,
      recommended: wantsRecommended,
      bands,
    };
  });
}

// GET /api/settings/
// Returns the row in store_settings PLUS the shop's display name (from
// the shops table) so the admin can edit both from one form.
router.get('/', requireShopAuth, (req, res) => {
  try {
    const settings = ensureSettings(req.shop.id);
    const shop = db.prepare('SELECT name FROM shops WHERE id = ?').get(req.shop.id) || {};
    res.json({ ...parseSettings(settings), name: shop.name || '' });
  } catch (err) {
    console.error('Get settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/settings/logo
// Uploads a shop logo into the public uploads folder. The returned URL is
// persisted by the normal PUT /api/settings save flow.
router.post('/logo', requireShopAuth, handleLogoUpload, (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Logo file is required.' });
    const ext = verifiedImageExtension(req.file);
    if (!ext) {
      return res.status(400).json({ error: 'Uploaded logo content did not match an allowed image type.' });
    }
    const dir = join(__dirname, '../../uploads/logos', String(req.shop.id));
    mkdirSync(dir, { recursive: true });
    const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    writeFileSync(join(dir, name), req.file.buffer);
    res.status(201).json({ url: `/uploads/logos/${req.shop.id}/${name}` });
  } catch (err) {
    console.error('Logo upload error:', err);
    res.status(500).json({ error: 'Logo upload failed.' });
  }
});

// PUT /api/settings/
// Updates BOTH the shop-level fields on the shops table (name) AND the
// per-shop branding in store_settings. Single endpoint, single Save click.
router.put('/', requireShopAuth, (req, res) => {
  let inTransaction = false;
  try {
    const existing = ensureSettings(req.shop.id);
    const {
      name,
      tagline, about, phone, address, support_email_mode, support_email, logo_url, gst_number,
      invoice_footer, invoice_logo, notifications, email_templates, shipping_zones,
      embed_allowed_origins,
      email_sending_domain,
      email_use_platform_fallback
    } = req.body;
    const supportMode = support_email_mode !== undefined
      ? (support_email_mode === 'custom' ? 'custom' : 'signup')
      : (existing.support_email_mode === 'custom' ? 'custom' : 'signup');
    const supportEmail = support_email !== undefined
      ? normaliseEmail(support_email)
      : normaliseEmail(existing.support_email);
    if (supportMode === 'custom' && !isValidEmail(supportEmail)) {
      return res.status(400).json({ error: 'Enter a valid support email, or use the signup email option.' });
    }
    const shouldUpdateEmailDomain = email_sending_domain !== undefined || email_use_platform_fallback !== undefined;
    let embedAllowedOrigins;
    let normalisedShippingZones;
    let normalisedLogoUrl;
    try {
      embedAllowedOrigins = embed_allowed_origins !== undefined
        ? normaliseEmbedAllowedOrigins(embed_allowed_origins)
        : parseEmbedAllowedOrigins(existing.embed_allowed_origins);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Enter valid embed website origins.' });
    }
    try {
      normalisedLogoUrl = logo_url !== undefined
        ? normaliseLogoUrlForShop(logo_url, req.shop.id)
        : normaliseLogoUrlForShop(existing.logo_url, req.shop.id);
    } catch (err) {
      if (err.code === 'INVALID_LOGO_URL') {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      throw err;
    }
    try {
      normalisedShippingZones = normaliseShippingZonesForStorage(shipping_zones, existing.shipping_zones);
    } catch (err) {
      if (err.code === 'INVALID_SHIPPING_CONFIG') {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      throw err;
    }

    // Update shop display name if supplied — slug stays stable for URLs
    if (shouldUpdateEmailDomain && email_sending_domain !== undefined) {
      try {
        normaliseEmailDomain(email_sending_domain);
      } catch (err) {
        if (err.code === 'INVALID_EMAIL_DOMAIN') {
          return res.status(400).json({ error: err.message });
        }
        throw err;
      }
    }

    db.exec('BEGIN IMMEDIATE');
    inTransaction = true;

    if (typeof name === 'string' && name.trim()) {
      db.prepare('UPDATE shops SET name = ? WHERE id = ?')
        .run(name.trim().slice(0, 80), req.shop.id);
    }

    db.prepare(`
      UPDATE store_settings SET
        tagline = ?,
        about = ?,
        phone = ?,
        address = ?,
        support_email_mode = ?,
        support_email = ?,
        logo_url = ?,
        gst_number = ?,
        invoice_footer = ?,
        invoice_logo = ?,
        notifications = ?,
        email_templates = ?,
        shipping_zones = ?,
        embed_allowed_origins = ?,
        updated_at = datetime('now')
      WHERE shop_id = ?
    `).run(
      tagline !== undefined ? tagline : existing.tagline,
      about !== undefined ? about : existing.about,
      phone !== undefined ? phone : existing.phone,
      address !== undefined ? address : existing.address,
      supportMode,
      supportMode === 'custom' ? supportEmail : null,
      normalisedLogoUrl,
      gst_number !== undefined ? gst_number : existing.gst_number,
      invoice_footer !== undefined ? invoice_footer : existing.invoice_footer,
      invoice_logo !== undefined ? (invoice_logo ? 1 : 0) : (existing.invoice_logo ?? 1),
      JSON.stringify(notifications !== undefined ? (notifications || {}) : parseJsonObjectSetting(existing.notifications, {})),
      JSON.stringify(email_templates !== undefined ? (email_templates || {}) : parseJsonObjectSetting(existing.email_templates, {})),
      JSON.stringify(normalisedShippingZones),
      JSON.stringify(embedAllowedOrigins),
      req.shop.id
    );
    if (shouldUpdateEmailDomain) {
      updateShopEmailDomainSettings(db, req.shop.id, {
        email_sending_domain,
        email_use_platform_fallback,
      });
    }

    db.exec('COMMIT');
    inTransaction = false;

    const updated = db.prepare('SELECT * FROM store_settings WHERE shop_id = ?').get(req.shop.id);
    const shop    = db.prepare('SELECT name FROM shops WHERE id = ?').get(req.shop.id) || {};
    res.json({ ...parseSettings(updated), name: shop.name || '' });
  } catch (err) {
    if (inTransaction) {
      try { db.exec('ROLLBACK'); } catch {}
    }
    if (err.code === 'INVALID_EMAIL_DOMAIN') {
      return res.status(400).json({ error: err.message });
    }
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/email-status', requireShopAuth, (req, res) => {
  try {
    ensureSettings(req.shop.id);
    res.json({
      provider: process.env.RESEND_API_KEY ? 'resend' : (process.env.SMTP_HOST ? 'smtp' : 'dev'),
      platform_domain: process.env.APP_EMAIL_DOMAIN || null,
      fallback_from: process.env.APP_EMAIL_FALLBACK || null,
      has_resend_key: !!process.env.RESEND_API_KEY,
      has_resend_webhook_secret: !!process.env.RESEND_WEBHOOK_SECRET,
      email_domain: getShopEmailSettings(db, req.shop.id),
      recent_events: recentEmailEventsForShop(db, req.shop.id, 12),
    });
  } catch (err) {
    console.error('Email status error:', err);
    res.status(500).json({ error: 'Failed to load email status' });
  }
});

// PATCH /api/settings/
// Merges into existing settings (used by the Notifications page so saving
// one template doesn't blow away the others). For email_templates, a null
// or empty value for a given key deletes that override → the template
// falls back to the recommended default.
router.patch('/', requireShopAuth, (req, res) => {
  try {
    ensureSettings(req.shop.id);
    const existing = db.prepare('SELECT * FROM store_settings WHERE shop_id = ?').get(req.shop.id);

    const updates = {};

    if (req.body.email_templates && typeof req.body.email_templates === 'object') {
      const cur = JSON.parse(existing.email_templates || '{}');
      for (const [key, val] of Object.entries(req.body.email_templates)) {
        if (val == null || (val.subject == null && val.body == null && val.message == null)) {
          delete cur[key];                       // revert to recommended
        } else {
          // Accept both {subject, body} (new) and {subject, message} (legacy)
          cur[key] = {
            subject: val.subject ?? null,
            body:    val.body ?? val.message ?? null,
          };
        }
      }
      updates.email_templates = JSON.stringify(cur);
    }

    // Dedicated path for the shop-wide "thank-you" sentence (the simple
    // one-field control on the notifications page). Stored under the
    // reserved key `_thank_you` inside the same email_templates JSON.
    if (typeof req.body.email_thank_you === 'string') {
      // If email_templates was also being patched above, build on that;
      // otherwise start from existing storage.
      const cur = updates.email_templates
        ? JSON.parse(updates.email_templates)
        : JSON.parse(existing.email_templates || '{}');
      const trimmed = req.body.email_thank_you.trim().slice(0, 240);
      if (trimmed) cur._thank_you = trimmed;
      else         delete cur._thank_you;
      updates.email_templates = JSON.stringify(cur);
    }

    if (req.body.notifications && typeof req.body.notifications === 'object') {
      const cur = JSON.parse(existing.notifications || '{}');
      updates.notifications = JSON.stringify({ ...cur, ...req.body.notifications });
    }

    if (req.body.embed_allowed_origins !== undefined) {
      try {
        updates.embed_allowed_origins = JSON.stringify(normaliseEmbedAllowedOrigins(req.body.embed_allowed_origins));
      } catch (err) {
        return res.status(400).json({ error: err.message || 'Enter valid embed website origins.' });
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.json(parseSettings(existing));
    }

    const setSql = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    db.prepare(
      `UPDATE store_settings SET ${setSql}, updated_at = datetime('now') WHERE shop_id = ?`
    ).run(...Object.values(updates), req.shop.id);

    const updated = db.prepare('SELECT * FROM store_settings WHERE shop_id = ?').get(req.shop.id);
    res.json(parseSettings(updated));
  } catch (err) {
    console.error('PATCH settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/settings/notifications/test
router.post('/notifications/test', requireShopAuth, async (req, res) => {
  try {
    // Prefer the address the admin typed in the Alert email field;
    // fall back to the shop owner's registered email if blank.
    const candidate = String(req.body?.email || '').trim();
    const valid     = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate);
    const to        = valid ? candidate : req.shop.email;

    const tpl = renderTemplate('test_notification', {
      shop:          { id: req.shop.id, name: req.shop.name, slug: req.shop.slug, email: req.shop.email },
      recipientName: req.shop.name,
    });
    const result = await sendMail({
      shopId: req.shop.id,
      shopSlug: req.shop.slug,
      templateId: tpl.templateId,
      category: tpl.category,
      idempotencyKey: `test-notification-${req.shop.id}-${Date.now()}`,
      to,
      from:    tpl.from,           // <slug>-alerts@<APP_EMAIL_DOMAIN>
      replyTo: tpl.replyTo,
      subject: tpl.subject,
      text:    tpl.text,
      html:    tpl.html,
    });
    if (result.previewUrl) console.log(`📬 Test email preview: ${result.previewUrl}`);
    res.json({ ok: true, sentTo: to, provider: result.provider, previewUrl: result.previewUrl });
  } catch (err) {
    console.error('Test notification error:', err);
    res.status(500).json({ error: `Failed to send test email: ${err.message}` });
  }
});

// GET /api/settings/email-templates/defaults
// Exposes the recommended subject/body/variable list for every notification
// template so the admin Notifications page can pre-fill its editor.
router.get('/email-templates/defaults', requireShopAuth, (req, res) => {
  const out = {};
  for (const [id, def] of Object.entries(EMAIL_TEMPLATE_DEFAULTS)) {
    out[id] = {
      id,
      label:       def.label,
      description: def.description,
      subject:     def.subject,
      body:        def.body,
      variables:   def.variables,
    };
  }
  res.json({ defaults: out });
});

export default router;

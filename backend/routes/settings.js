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
  const templates = JSON.parse(row.email_templates || '{}');
  // Surface the optional "thank-you" sentence as a top-level field so the
  // admin notifications page can read/write it without touching the
  // per-template override structure.
  const thankYou = String(templates?._thank_you || '');
  return {
    ...row,
    notifications:   JSON.parse(row.notifications || '{}'),
    email_templates: templates,
    email_thank_you: thankYou,
    shipping_zones:  JSON.parse(row.shipping_zones || '[]'),
    embed_allowed_origins: parseEmbedAllowedOrigins(row.embed_allowed_origins),
  };
}

function parseJsonSetting(value, fallback) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
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
  try {
    const existing = ensureSettings(req.shop.id);
    const {
      name,
      tagline, about, phone, address, support_email_mode, support_email, logo_url, gst_number,
      invoice_footer, invoice_logo, notifications, email_templates, shipping_zones,
      embed_allowed_origins
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
    let embedAllowedOrigins;
    try {
      embedAllowedOrigins = embed_allowed_origins !== undefined
        ? normaliseEmbedAllowedOrigins(embed_allowed_origins)
        : parseEmbedAllowedOrigins(existing.embed_allowed_origins);
    } catch (err) {
      return res.status(400).json({ error: err.message || 'Enter valid embed website origins.' });
    }

    // Update shop display name if supplied — slug stays stable for URLs
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
      logo_url !== undefined ? logo_url : existing.logo_url,
      gst_number !== undefined ? gst_number : existing.gst_number,
      invoice_footer !== undefined ? invoice_footer : existing.invoice_footer,
      invoice_logo !== undefined ? (invoice_logo ? 1 : 0) : (existing.invoice_logo ?? 1),
      JSON.stringify(notifications !== undefined ? (notifications || {}) : parseJsonSetting(existing.notifications, {})),
      JSON.stringify(email_templates !== undefined ? (email_templates || {}) : parseJsonSetting(existing.email_templates, {})),
      JSON.stringify(shipping_zones !== undefined ? (Array.isArray(shipping_zones) ? shipping_zones : []) : parseJsonSetting(existing.shipping_zones, [])),
      JSON.stringify(embedAllowedOrigins),
      req.shop.id
    );

    const updated = db.prepare('SELECT * FROM store_settings WHERE shop_id = ?').get(req.shop.id);
    const shop    = db.prepare('SELECT name FROM shops WHERE id = ?').get(req.shop.id) || {};
    res.json({ ...parseSettings(updated), name: shop.name || '' });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Internal server error' });
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

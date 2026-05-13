import { Router } from 'express';
import { db, requireShopAuth } from '../middleware/auth.js';
import { sendMail } from '../lib/mailer.js';
import { renderTemplate, DEFAULTS as EMAIL_TEMPLATE_DEFAULTS } from '../lib/email-templates/index.js';

const router = Router();

function ensureSettings(shopId) {
  db.prepare('INSERT OR IGNORE INTO store_settings (shop_id) VALUES (?)').run(shopId);
  return db.prepare('SELECT * FROM store_settings WHERE shop_id = ?').get(shopId);
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
  };
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

// PUT /api/settings/
// Updates BOTH the shop-level fields on the shops table (name) AND the
// per-shop branding in store_settings. Single endpoint, single Save click.
router.put('/', requireShopAuth, (req, res) => {
  try {
    ensureSettings(req.shop.id);
    const {
      name,
      tagline, about, phone, address, logo_url, gst_number,
      invoice_footer, invoice_logo, notifications, email_templates, shipping_zones
    } = req.body;

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
        logo_url = ?,
        gst_number = ?,
        invoice_footer = ?,
        invoice_logo = ?,
        notifications = ?,
        email_templates = ?,
        shipping_zones = ?,
        updated_at = datetime('now')
      WHERE shop_id = ?
    `).run(
      tagline ?? null,
      about ?? null,
      phone ?? null,
      address ?? null,
      logo_url ?? null,
      gst_number ?? null,
      invoice_footer ?? null,
      invoice_logo !== undefined ? (invoice_logo ? 1 : 0) : 1,
      JSON.stringify(notifications || {}),
      JSON.stringify(email_templates || {}),
      JSON.stringify(Array.isArray(shipping_zones) ? shipping_zones : []),
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

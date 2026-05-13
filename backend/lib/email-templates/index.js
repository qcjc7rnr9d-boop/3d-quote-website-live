/**
 * Recommended email templates.
 *
 * Every template is a function `(data) => { subject, text, html }`.
 * Per-shop overrides can be stored in `store_settings.email_templates`
 * as a JSON object keyed by template id — see `resolveTemplate()` below.
 *
 * Adding a new template:
 *   1. Write a function below that returns { subject, text, html }
 *   2. Register it in TEMPLATES
 *   3. Call `renderTemplate('your_template_id', data)` from a route
 */

import {
  renderEmail, btn, infoBox, detailTable, divider,
  paragraph, heading, eyebrow, esc, PALETTE, FONTS,
} from './base.js';
import { db } from '../../middleware/auth.js';
import { buildFromAddress, buildReplyTo } from '../email-from.js';

const fmtMoney = n => Number(n || 0).toLocaleString('en-NZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Friendly status copy keyed by order.fulfilment_status ─────
const STATUS_COPY = {
  pending: {
    eyebrow: 'Order received',
    heading: 'We have your order',
    intro: 'Thanks for choosing us. We\'ve received your order and our team is reviewing it now. You\'ll get another email when production starts.',
  },
  processing: {
    eyebrow: 'Order confirmed',
    heading: 'Your order is confirmed',
    intro: 'Payment received and your order is queued for production. We\'ll let you know the moment your print starts.',
  },
  in_production: {
    eyebrow: 'In production',
    heading: 'Your print has started',
    intro: 'Good news — your part is now being printed. We\'ll email tracking details as soon as it ships.',
  },
  shipped: {
    eyebrow: 'Shipped',
    heading: 'Your order is on its way',
    intro: 'Your part has left the workshop. Tracking details below — please allow a moment for the courier to scan it into their system.',
  },
  complete: {
    eyebrow: 'Delivered',
    heading: 'Your order is delivered',
    intro: 'Hope you love it. If anything\'s not quite right, just reply to this email and we\'ll make it right.',
  },
  cancelled: {
    eyebrow: 'Cancelled',
    heading: 'Your order has been cancelled',
    intro: 'Your order has been cancelled. If a payment was taken, any refund will appear on your statement within a few business days.',
  },
};

// ── 1. Order status update (covers all 6 statuses) ────────────
export function orderStatusEmail({ shop, order, customer_message, brand = {} }) {
  const status = order.fulfilment_status || 'pending';
  const copy   = STATUS_COPY[status] || STATUS_COPY.pending;
  const shopName = shop?.name || 'Mahi3d';

  // Optional shop owner note
  const noteSection = customer_message
    ? infoBox(`<div style="white-space:pre-line;">${esc(customer_message)}</div>`)
    : '';

  // Tracking section (only for "shipped")
  let trackingSection = '';
  if (status === 'shipped' && order.tracking_number) {
    const inner = order.tracking_url
      ? `<a href="${esc(order.tracking_url)}" style="color:${PALETTE.accent};font-weight:600;text-decoration:none;">${esc(order.tracking_number)}</a>`
      : esc(order.tracking_number);
    trackingSection = infoBox(`
      <div style="font-size:10.5px;font-weight:600;letter-spacing:0.10em;text-transform:uppercase;color:${PALETTE.muted};margin-bottom:6px;">Tracking number</div>
      <div style="font-size:16px;font-weight:600;color:${PALETTE.ink};font-variant-numeric:tabular-nums;">${inner}</div>
      ${order.tracking_url ? `<div style="margin-top:10px;">${btn('Track shipment', order.tracking_url, brand.accentColor || PALETTE.accent)}</div>` : ''}
    `, { tone: 'success' });
  }

  // Order summary table
  const summary = detailTable([
    ['File',     esc(order.file_name || '—')],
    ['Material', esc(order.material_name || '—')],
    ['Quantity', String(order.quantity || 1)],
    ['Total',    `$${fmtMoney(order.total)}`],
  ]);

  const content = `
    ${eyebrow(`Order #${order.id}`)}
    ${heading(copy.heading)}
    ${paragraph(copy.intro)}
    ${noteSection}
    ${trackingSection}
    ${divider()}
    <div style="font-size:11px;font-weight:600;letter-spacing:0.10em;text-transform:uppercase;color:${PALETTE.muted};margin-bottom:10px;">Order summary</div>
    ${summary}
    ${divider()}
    ${paragraph(`Reply to this email if you have any questions about your order.`)}`;

  const html = renderEmail({
    shopName,
    eyebrowText: copy.eyebrow,
    preheader:   `${copy.heading} · Order #${order.id} · ${shopName}`,
    content,
    brand,
  });

  // Plain-text fallback
  const text = [
    copy.heading,
    `Order #${order.id} · ${shopName}`,
    '',
    copy.intro,
    customer_message ? `\nNote from ${shopName}:\n${customer_message}` : '',
    status === 'shipped' && order.tracking_number
      ? `\nTracking: ${order.tracking_number}${order.tracking_url ? `\n${order.tracking_url}` : ''}`
      : '',
    `\n— Order summary —`,
    `File: ${order.file_name || '—'}`,
    `Material: ${order.material_name || '—'}`,
    `Quantity: ${order.quantity || 1}`,
    `Total: $${fmtMoney(order.total)}`,
    '',
    `Reply to this email if you have any questions.`,
    `\n${shopName}`,
  ].filter(Boolean).join('\n');

  return {
    subject: `${copy.eyebrow} — Order #${order.id} · ${shopName}`,
    text,
    html,
  };
}

// ── 2. Admin password reset ───────────────────────────────────
export function adminPasswordResetEmail({ shop, resetLink, brand = {} }) {
  const shopName = shop?.name || 'Mahi3d';
  const content = `
    ${eyebrow('Account security')}
    ${heading('Reset your password')}
    ${paragraph(`Hi ${esc(shop?.name || 'there')},`)}
    ${paragraph(`We received a request to reset the password on your <strong>${esc(shopName)}</strong> admin account. Click the button below to choose a new one. This link expires in 1&nbsp;hour.`)}
    <div style="margin:24px 0;">${btn('Reset password', resetLink, brand.accentColor)}</div>
    ${paragraph(`<span style="font-size:12px;color:${PALETTE.muted};">If the button doesn't work, paste this URL into your browser:<br><a href="${esc(resetLink)}" style="color:${PALETTE.accent};word-break:break-all;">${esc(resetLink)}</a></span>`)}
    ${divider()}
    ${paragraph(`<span style="font-size:12px;color:${PALETTE.muted};">If you didn't request this, you can safely ignore this email — your password won't change.</span>`)}`;

  return {
    subject: `Reset your ${shopName} password`,
    text: `Hi ${shop?.name || 'there'},\n\nWe received a request to reset the password on your ${shopName} admin account.\n\nReset link (expires in 1 hour):\n${resetLink}\n\nIf you didn't request this, ignore this email — your password won't change.\n\n${shopName}`,
    html: renderEmail({
      shopName, eyebrowText: 'Account security',
      preheader: 'Reset your admin password',
      content, brand,
    }),
  };
}

// ── 3. Customer password reset (separate from admin) ──────────
export function customerPasswordResetEmail({ shop, customerName, resetLink, brand = {} }) {
  const shopName = shop?.name || 'Mahi3d';
  const content = `
    ${eyebrow('Account security')}
    ${heading('Reset your password')}
    ${paragraph(`Hi ${esc(customerName || 'there')},`)}
    ${paragraph(`Tap the button below to choose a new password for your <strong>${esc(shopName)}</strong> account. The link expires in 1&nbsp;hour.`)}
    <div style="margin:24px 0;">${btn('Reset password', resetLink, brand.accentColor)}</div>
    ${paragraph(`<span style="font-size:12px;color:${PALETTE.muted};">If you didn't request this, you can safely ignore this email.</span>`)}`;

  return {
    subject: `Reset your ${shopName} password`,
    text: `Hi ${customerName || 'there'},\n\nReset your ${shopName} account password using this link (expires in 1 hour):\n${resetLink}\n\nIf you didn't request this, ignore this email.\n\n${shopName}`,
    html: renderEmail({
      shopName, eyebrowText: 'Account security',
      preheader: 'Reset your password',
      content, brand,
    }),
  };
}

// ── 4. Customer welcome ───────────────────────────────────────
export function customerWelcomeEmail({ shop, customerName, dashboardUrl, brand = {} }) {
  const shopName = shop?.name || 'Mahi3d';
  const content = `
    ${eyebrow('Welcome')}
    ${heading(`Welcome to ${shopName}`)}
    ${paragraph(`Hi ${esc(customerName || 'there')}, your account is ready. You can now upload models, get instant pricing, and track your orders in one place.`)}
    ${dashboardUrl ? `<div style="margin:22px 0;">${btn('Open your dashboard', dashboardUrl, brand.accentColor)}</div>` : ''}
    ${infoBox(`
      <strong style="color:${PALETTE.ink};">What you can do now</strong>
      <ul style="margin:8px 0 0;padding-left:18px;color:${PALETTE.inkSoft};font-size:13px;line-height:1.7;">
        <li>Upload an STL or OBJ for an instant quote</li>
        <li>Pick a material, colour, finish and infill</li>
        <li>Save quotes for later and reorder in one click</li>
      </ul>
    `)}
    ${divider()}
    ${paragraph(`Have a question? Just reply to this email — a real person will get back to you.`)}`;

  return {
    subject: `Welcome to ${shopName}`,
    text: `Hi ${customerName || 'there'},\n\nYour ${shopName} account is ready.\n\nUpload a model, get instant pricing, and track your orders all in one place.${dashboardUrl ? `\n\nOpen your dashboard: ${dashboardUrl}` : ''}\n\nHave a question? Just reply to this email.\n\n${shopName}`,
    html: renderEmail({
      shopName, eyebrowText: 'Welcome',
      preheader: `Welcome to ${shopName} — your account is ready`,
      content, brand,
    }),
  };
}

// ── 5. Quote saved (customer saved a quote) ───────────────────
export function quoteSavedEmail({ shop, customerName, quoteName, quoteUrl, totalDisplay, brand = {} }) {
  const shopName = shop?.name || 'Mahi3d';
  const content = `
    ${eyebrow('Quote saved')}
    ${heading('Your quote is saved')}
    ${paragraph(`Hi ${esc(customerName || 'there')}, we've saved your quote so you can come back to it whenever you're ready.`)}
    ${infoBox(`
      <div style="display:block;margin-bottom:4px;font-size:13px;color:${PALETTE.muted};">${esc(quoteName || 'Saved quote')}</div>
      <div style="font-size:22px;font-weight:600;color:${PALETTE.ink};letter-spacing:-0.01em;">${esc(totalDisplay || '')}</div>
    `)}
    ${quoteUrl ? `<div style="margin:22px 0;">${btn('Open your quote', quoteUrl, brand.accentColor)}</div>` : ''}
    ${paragraph(`<span style="font-size:12px;color:${PALETTE.muted};">Prices may update if material or pricing changes — your final price is confirmed at checkout.</span>`)}`;

  return {
    subject: `Your saved quote · ${shopName}`,
    text: `Hi ${customerName || 'there'},\n\nWe've saved your quote (${quoteName || 'Saved quote'}${totalDisplay ? ` · ${totalDisplay}` : ''}).${quoteUrl ? `\n\nOpen it any time: ${quoteUrl}` : ''}\n\nPrices may update if material or pricing changes — your final price is confirmed at checkout.\n\n${shopName}`,
    html: renderEmail({
      shopName, eyebrowText: 'Quote saved',
      preheader: 'Your quote is saved',
      content, brand,
    }),
  };
}

// ── 6. Test notification (admin → Notifications page) ────────
export function testNotificationEmail({ shop, recipientName, brand = {} }) {
  const shopName = shop?.name || 'Mahi3d';
  const content = `
    ${eyebrow('Notification test')}
    ${heading('Your email setup is working')}
    ${paragraph(`Hi ${esc(recipientName || shopName)}, this is a test from your <strong>${esc(shopName)}</strong> admin panel. If you're reading it, transactional emails (password resets, order updates, shipping notifications) are wired up and delivering.`)}
    ${infoBox(`
      <strong style="color:${PALETTE.ink};">All set</strong>
      <div style="margin-top:4px;font-size:13px;color:${PALETTE.inkSoft};">Your customers will receive emails styled like this one across the order lifecycle.</div>
    `, { tone: 'success' })}`;

  return {
    subject: `${shopName} — Test notification`,
    text: `Hi ${recipientName || shopName},\n\nThis is a test from your ${shopName} admin panel. If you're reading it, transactional emails are wired up and delivering correctly.\n\n${shopName}`,
    html: renderEmail({
      shopName, eyebrowText: 'Notification test',
      preheader: 'Your email setup is working',
      content, brand,
    }),
  };
}

// ── Recommended defaults (plain text — shown in the admin editor) ──
// These are what shop owners see pre-filled in the Notifications page.
// They support {{variable}} interpolation. The body is wrapped in the
// shared HTML layout when sent. Special "block" variables (e.g.
// {{tracking_box}}) expand into rich HTML elements when present.
export const DEFAULTS = {
  order_status: {
    label: 'Order status update',
    description: 'Sent when an order moves between statuses: received, confirmed, in production, shipped, delivered or cancelled.',
    eyebrow: '{{status_eyebrow}}',
    subject: '{{status_eyebrow}} — Order #{{order_id}} · {{shop_name}}',
    body:
`Hi {{customer_name}},

{{status_intro}}

{{tracking_box}}

{{order_summary}}

Reply to this email if you have any questions about your order.

— {{shop_name}}`,
    variables: [
      { name: 'customer_name',   label: "Customer's name",    desc: "Their first name (or 'there' if unknown)" },
      { name: 'shop_name',       label: 'Your shop name',     desc: 'Your store name' },
      { name: 'order_id',        label: 'Order number',       desc: 'The order ID, e.g. 1042' },
      { name: 'status_eyebrow',  label: 'Status word',        desc: 'Short status label, e.g. "Shipped"' },
      { name: 'status_intro',    label: 'Status sentence',    desc: 'Friendly one-line description for the current status' },
      { name: 'material_name',   label: 'Material',           desc: 'The material the order is being printed in' },
      { name: 'file_name',       label: 'File name',          desc: 'The uploaded file name' },
      { name: 'quantity',        label: 'Quantity',           desc: 'Number of units' },
      { name: 'total',           label: 'Order total',        desc: 'Formatted price, e.g. "$128.40"' },
      { name: 'tracking_number', label: 'Tracking number',    desc: 'Courier tracking number (shipped orders only)' },
      { name: 'tracking_url',    label: 'Tracking link',      desc: 'Link to the tracking page (shipped orders only)' },
      { name: 'tracking_box',    label: 'Tracking card',      desc: 'A nicely-formatted tracking box (auto-renders when shipped)', rich: true },
      { name: 'order_summary',   label: 'Order summary card', desc: 'A table showing file / material / quantity / total', rich: true },
    ],
  },
  admin_password_reset: {
    label: 'Admin password reset',
    description: 'Sent when a shop owner asks to reset their admin password.',
    eyebrow: 'Account security',
    subject: 'Reset your {{shop_name}} password',
    body:
`Hi {{recipient_name}},

We received a request to reset the password on your {{shop_name}} admin account. Click the button below to choose a new one — the link expires in 1 hour.

{{reset_button}}

If you didn't request this, you can safely ignore this email — your password won't change.

— {{shop_name}}`,
    variables: [
      { name: 'recipient_name', label: 'Recipient name',  desc: "The shop owner's name" },
      { name: 'shop_name',      label: 'Your shop name',  desc: 'Your store name' },
      { name: 'reset_link',     label: 'Reset link',      desc: 'Plain reset URL (use this for text links)' },
      { name: 'reset_button',   label: 'Reset button',    desc: 'A green Reset-password button', rich: true },
    ],
  },
  customer_password_reset: {
    label: 'Customer password reset',
    description: 'Sent when a customer asks to reset their account password.',
    eyebrow: 'Account security',
    subject: 'Reset your {{shop_name}} password',
    body:
`Hi {{customer_name}},

Tap the button below to choose a new password for your {{shop_name}} account. The link expires in 1 hour.

{{reset_button}}

If you didn't request this, you can safely ignore this email.

— {{shop_name}}`,
    variables: [
      { name: 'customer_name', label: "Customer's name",  desc: 'Their first name' },
      { name: 'shop_name',     label: 'Your shop name',   desc: 'Your store name' },
      { name: 'reset_link',    label: 'Reset link',       desc: 'Plain reset URL (for text links)' },
      { name: 'reset_button',  label: 'Reset button',     desc: 'A green Reset-password button', rich: true },
    ],
  },
  customer_welcome: {
    label: 'Customer welcome',
    description: 'Sent when a new customer creates an account.',
    eyebrow: 'Welcome',
    subject: 'Welcome to {{shop_name}}',
    body:
`Hi {{customer_name}},

Your {{shop_name}} account is ready. Upload a model, pick a material, and get instant pricing — all in one place.

{{dashboard_button}}

Have a question? Just reply to this email — a real person will get back to you.

— {{shop_name}}`,
    variables: [
      { name: 'customer_name',    label: "Customer's name", desc: 'Their first name' },
      { name: 'shop_name',        label: 'Your shop name',  desc: 'Your store name' },
      { name: 'dashboard_url',    label: 'Dashboard link',  desc: 'Link to their dashboard' },
      { name: 'dashboard_button', label: 'Dashboard button', desc: 'A green Open-your-dashboard button', rich: true },
    ],
  },
  quote_saved: {
    label: 'Saved quote confirmation',
    description: 'Sent when a customer saves a quote for later.',
    eyebrow: 'Quote saved',
    subject: 'Your saved quote · {{shop_name}}',
    body:
`Hi {{customer_name}},

We've saved your quote ({{quote_name}}, {{total_display}}) so you can come back to it any time.

{{quote_button}}

Prices may update if material or pricing changes — your final price is confirmed at checkout.

— {{shop_name}}`,
    variables: [
      { name: 'customer_name', label: "Customer's name", desc: 'Their first name' },
      { name: 'shop_name',     label: 'Your shop name',  desc: 'Your store name' },
      { name: 'quote_name',    label: 'Quote name',      desc: 'The name they gave their quote' },
      { name: 'total_display', label: 'Quote total',     desc: 'Formatted total, e.g. "NZD $42.80"' },
      { name: 'quote_url',     label: 'Quote link',      desc: 'Plain link to the saved quote' },
      { name: 'quote_button',  label: 'Open quote button', desc: 'A green Open-your-quote button', rich: true },
    ],
  },
  test_notification: {
    label: 'Test notification',
    description: 'Sent when you press "Send test email" on this page.',
    eyebrow: 'Notification test',
    subject: '{{shop_name}} — Test notification',
    body:
`Hi {{recipient_name}},

This is a test from your {{shop_name}} admin panel. If you're reading it, transactional emails (password resets, order updates, shipping notifications) are wired up and delivering correctly.

— {{shop_name}}`,
    variables: [
      { name: 'recipient_name', label: 'Recipient name', desc: 'The person receiving the test email' },
      { name: 'shop_name',      label: 'Your shop name', desc: 'Your store name' },
    ],
  },
};

// ── Template registry + resolver ─────────────────────────────
const TEMPLATES = {
  order_status:            orderStatusEmail,
  admin_password_reset:    adminPasswordResetEmail,
  customer_password_reset: customerPasswordResetEmail,
  customer_welcome:        customerWelcomeEmail,
  quote_saved:             quoteSavedEmail,
  test_notification:       testNotificationEmail,
};

// Maps each template id to the email "category" used for the dynamic From
// address. Adding a new template? Register its category here.
// Sub-statuses inside order_status get refined further at render time
// (shipped → "shipping", everything else → "orders").
export const EMAIL_CATEGORIES = {
  order_status:            'orders',
  admin_password_reset:    'account',
  customer_password_reset: 'account',
  customer_welcome:        'account',
  quote_saved:             'quotes',
  test_notification:       'alerts',
};

/**
 * Look up a per-shop override for a given template id. Overrides are stored
 * in `store_settings.email_templates` as a JSON object:
 *
 *   { order_status: { subject: '…', html: '…', text: '…' } }
 *
 * Any subset of {subject, html, text} can be overridden — missing fields
 * fall through to the recommended default.
 */
function getShopOverride(shopId, templateId) {
  if (!shopId) return null;
  try {
    const row = db.prepare('SELECT email_templates FROM store_settings WHERE shop_id = ?').get(shopId);
    if (!row?.email_templates) return null;
    const map = JSON.parse(row.email_templates);
    return map[templateId] || null;
  } catch { return null; }
}

// Lazy-check whether `store_settings.brand` column exists. If not, all brand
// lookups short-circuit to {} so existing schemas keep working. Adding the
// column later (migration) automatically opts a shop into custom branding.
let _brandColumnExists = null;
function brandColumnExists() {
  if (_brandColumnExists !== null) return _brandColumnExists;
  try {
    const cols = db.prepare('PRAGMA table_info(store_settings)').all();
    _brandColumnExists = cols.some(c => c.name === 'brand');
  } catch { _brandColumnExists = false; }
  return _brandColumnExists;
}

function getShopBrand(shopId) {
  if (!shopId || !brandColumnExists()) return {};
  try {
    const row = db.prepare('SELECT brand FROM store_settings WHERE shop_id = ?').get(shopId);
    if (!row?.brand) return {};
    return JSON.parse(row.brand) || {};
  } catch { return {}; }
}

/**
 * Read the shop's globally-set "thank-you" sentence (one optional line that
 * appears on every email). Stored under the reserved key `_thank_you` inside
 * the same email_templates JSON column, so no schema migration is needed.
 */
function getShopThankYou(shopId) {
  if (!shopId) return '';
  try {
    const row = db.prepare('SELECT email_templates FROM store_settings WHERE shop_id = ?').get(shopId);
    if (!row?.email_templates) return '';
    const map = JSON.parse(row.email_templates);
    return String(map?._thank_you || '').trim().slice(0, 240);
  } catch { return ''; }
}

// ── Variable substitution ────────────────────────────────────
/**
 * Substitute {{name}} placeholders in a plain string with values from `vars`.
 * Unknown placeholders are replaced with the empty string. Trailing blank
 * lines from removed variables are collapsed so the layout stays clean.
 */
function substituteVars(template, vars) {
  if (!template) return '';
  const out = String(template).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v == null ? '' : String(v);
  });
  // Collapse runs of 3+ blank lines (left over when a {{block}} was empty)
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Convert plain-text body (with line breaks) into HTML for the email layout.
 * Each paragraph (blank-line separated) wraps in <p>; single newlines become <br>.
 * Strings containing inline HTML (recognised via a leading "<" on a line)
 * pass through untouched — that's how rich {{tracking_box}} blocks render.
 */
function bodyToHtml(text) {
  const paragraphs = String(text).split(/\n{2,}/);
  return paragraphs.map(p => {
    p = p.trim();
    if (!p) return '';
    // If a paragraph is already an HTML block (table/div), pass through
    if (/^<(table|div|p|a|h\d|ul|ol)\b/i.test(p)) return p;
    const inner = esc(p).replace(/\n/g, '<br>');
    return `<p style="font-family:${FONTS};font-size:14px;line-height:1.65;color:${PALETTE.inkSoft};margin:0 0 14px;">${inner}</p>`;
  }).filter(Boolean).join('\n');
}

// ── Apply an admin override to the recommended template ──────
/**
 * When an admin saves a custom subject + body, we re-render the email so
 * that their plain-text body still ends up wrapped in our brand layout.
 * Rich "block" variables expand into the same HTML helpers as the default
 * templates, so a customised email still gets the tracking box, summary,
 * buttons, etc. without the admin having to write HTML.
 */
function renderFromOverride({ templateId, override, recommended, data, brand }) {
  const shopName = data.shop?.name || 'Mahi3d';

  // Build the variables map by gathering "context" from the data object.
  // Anything specific to the template lives below in each branch.
  const ctx = {
    shop_name:       shopName,
    customer_name:   data.customerName || data.order?.customer_name || 'there',
    recipient_name:  data.recipientName || shopName,
    reset_link:      data.resetLink || '',
    reset_button:    data.resetLink ? btn('Reset password', data.resetLink, brand.accentColor || PALETTE.accent) : '',
    dashboard_url:   data.dashboardUrl || '',
    dashboard_button: data.dashboardUrl ? btn('Open dashboard', data.dashboardUrl, brand.accentColor || PALETTE.accent) : '',
    quote_name:      data.quoteName || 'Saved quote',
    total_display:   data.totalDisplay || '',
    quote_url:       data.quoteUrl || '',
    quote_button:    data.quoteUrl ? btn('Open your quote', data.quoteUrl, brand.accentColor || PALETTE.accent) : '',
  };

  if (templateId === 'order_status' && data.order) {
    const status = data.order.fulfilment_status || 'pending';
    const copy   = STATUS_COPY[status] || STATUS_COPY.pending;
    ctx.order_id          = data.order.id || '';
    ctx.status_eyebrow    = copy.eyebrow;
    ctx.status_intro      = copy.intro;
    ctx.material_name     = data.order.material_name || '';
    ctx.file_name         = data.order.file_name || '';
    ctx.quantity          = data.order.quantity || 1;
    ctx.total             = `$${fmtMoney(data.order.total)}`;
    ctx.tracking_number   = data.order.tracking_number || '';
    ctx.tracking_url      = data.order.tracking_url || '';
    ctx.order_summary     = detailTable([
      ['File',     esc(ctx.file_name || '—')],
      ['Material', esc(ctx.material_name || '—')],
      ['Quantity', String(ctx.quantity)],
      ['Total',    ctx.total],
    ]);
    if (status === 'shipped' && ctx.tracking_number) {
      const inner = ctx.tracking_url
        ? `<a href="${esc(ctx.tracking_url)}" style="color:${PALETTE.accent};font-weight:600;text-decoration:none;">${esc(ctx.tracking_number)}</a>`
        : esc(ctx.tracking_number);
      ctx.tracking_box = infoBox(`
        <div style="font-size:10.5px;font-weight:600;letter-spacing:0.10em;text-transform:uppercase;color:${PALETTE.muted};margin-bottom:6px;">Tracking number</div>
        <div style="font-size:16px;font-weight:600;color:${PALETTE.ink};font-variant-numeric:tabular-nums;">${inner}</div>
        ${ctx.tracking_url ? `<div style="margin-top:10px;">${btn('Track shipment', ctx.tracking_url, brand.accentColor || PALETTE.accent)}</div>` : ''}
      `, { tone: 'success' });
    } else {
      ctx.tracking_box = '';
    }
  }

  const subject = substituteVars(override.subject || recommended.subject, ctx);
  const bodyTxt = substituteVars(override.body    || recommended.body,    ctx);

  // For HTML, the same body but with rich blocks substituted as HTML
  const richCtx = { ...ctx };
  // Plain-text bodies shouldn't get HTML buttons / tables — strip those
  const plainCtx = { ...ctx };
  for (const v of (recommended.variables || [])) {
    if (v.rich) {
      // Plain text version of rich content
      if (v.name === 'tracking_box' && ctx.tracking_number) {
        plainCtx[v.name] = `Tracking: ${ctx.tracking_number}${ctx.tracking_url ? `\n${ctx.tracking_url}` : ''}`;
      } else if (v.name === 'order_summary' && data.order) {
        plainCtx[v.name] = `File: ${ctx.file_name || '—'}\nMaterial: ${ctx.material_name || '—'}\nQuantity: ${ctx.quantity}\nTotal: ${ctx.total}`;
      } else if (v.name === 'reset_button')      plainCtx[v.name] = ctx.reset_link || '';
      else if (v.name === 'dashboard_button')    plainCtx[v.name] = ctx.dashboard_url || '';
      else if (v.name === 'quote_button')        plainCtx[v.name] = ctx.quote_url || '';
      else plainCtx[v.name] = '';
    }
  }

  const finalText = substituteVars(override.body || recommended.body, plainCtx);
  const finalHtmlBody = bodyToHtml(substituteVars(override.body || recommended.body, richCtx));

  return {
    subject,
    text: finalText,
    html: renderEmail({
      shopName,
      eyebrowText: substituteVars(recommended.eyebrow || '', ctx),
      preheader:   subject,
      content:     finalHtmlBody,
      brand,
    }),
  };
}

/**
 * Pick the right category for a template. Order emails refine to "shipping"
 * when the status is "shipped" so shipped emails come from
 * <slug>-shipping@... — a recognisable address customers can filter on.
 */
function resolveCategory(templateId, data) {
  const base = EMAIL_CATEGORIES[templateId] || 'support';
  if (templateId === 'order_status' && data?.order?.fulfilment_status === 'shipped') {
    return 'shipping';
  }
  return base;
}

/**
 * Render a template by id. Applies any shop-level override and brand
 * config, and computes the dynamic From / Reply-To headers based on the
 * shop + category.
 *
 * @param {string} templateId  e.g. "order_status"
 * @param {object} data        Data the template needs (shop, order, …)
 * @returns {{subject, text, html, category, from, replyTo}}
 */
export function renderTemplate(templateId, data = {}) {
  const fn = TEMPLATES[templateId];
  if (!fn) throw new Error(`Unknown email template: ${templateId}`);

  const shopId      = data.shop?.id;
  const thankYou    = getShopThankYou(shopId);
  // brand carries the optional thank-you sentence so renderEmail can drop it
  // into every layout consistently — same position on every email type.
  const brand       = { ...getShopBrand(shopId), thankYou, ...(data.brand || {}) };
  const override    = getShopOverride(shopId, templateId);
  const recommended = DEFAULTS[templateId];
  const category    = resolveCategory(templateId, data);

  // Dynamic From + Reply-To — works whether or not APP_EMAIL_DOMAIN is set
  const from    = buildFromAddress({
    shopName: data.shop?.name || 'Notifications',
    shopSlug: data.shop?.slug || 'shop',
    category,
  });
  const replyTo = buildReplyTo({ shop: data.shop });

  // No override → use the carefully-designed recommended template.
  let rendered;
  if (!override || (!override.subject && !override.body)) {
    rendered = fn({ ...data, brand });
  } else {
    // Admin saved a custom subject / body → render their copy through the
    // shared layout with variable substitution and rich-block expansion.
    rendered = renderFromOverride({ templateId, override, recommended, data, brand });
  }

  return { ...rendered, category, from, replyTo };
}

export { TEMPLATES };

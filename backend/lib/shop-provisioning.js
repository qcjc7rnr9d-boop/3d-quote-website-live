import { btn, detailTable, divider, esc, heading, infoBox, paragraph, renderEmail } from './email-templates/base.js';
import { normaliseEmbedAllowedOrigins, parseEmbedAllowedOrigins } from './embed.js';
import { sendMail } from './mailer.js';

function appBaseUrl(baseUrl = process.env.BASE_URL || 'https://app.trennen.co.nz') {
  return String(baseUrl || 'https://app.trennen.co.nz').replace(/\/+$/, '');
}

export function normaliseShopSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function normaliseProvisioningOrigins(input) {
  return normaliseEmbedAllowedOrigins(input || []);
}

function oneLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function codeBlock(value) {
  return `<pre style="white-space:pre-wrap;word-break:break-word;background:#f7f4ee;border:1px solid #e5e1da;border-radius:10px;padding:14px 16px;font-family:'SFMono-Regular',Consolas,monospace;font-size:12px;line-height:1.55;color:#1c1c1a;">${esc(value)}</pre>`;
}

export function saveShopEmbedOrigins(db, shopId, originsInput = []) {
  const origins = normaliseProvisioningOrigins(originsInput);
  db.prepare('INSERT OR IGNORE INTO store_settings (shop_id) VALUES (?)').run(shopId);
  db.prepare(`
    UPDATE store_settings
    SET embed_allowed_origins = ?,
        updated_at = datetime('now')
    WHERE shop_id = ?
  `).run(JSON.stringify(origins), shopId);
  return origins;
}

export function readShopEmbedOrigins(db, shopId) {
  const row = db.prepare('SELECT embed_allowed_origins FROM store_settings WHERE shop_id = ?').get(shopId);
  return parseEmbedAllowedOrigins(row?.embed_allowed_origins);
}

export function buildShopInstallPackage(shop, options = {}) {
  if (!shop?.slug) throw new Error('buildShopInstallPackage requires a shop with slug');
  const base = appBaseUrl(options.baseUrl);
  const slug = normaliseShopSlug(shop.slug);
  const title = `${shop.name || 'Trennen'} quote widget`;
  const allowedOrigins = normaliseEmbedAllowedOrigins(options.allowedOrigins || []);
  const quoteUrl = `${base}/index.html?shop=${encodeURIComponent(slug)}`;
  const embedUrl = `${base}/index.html?shop=${encodeURIComponent(slug)}&embed=1`;
  const script = `<script src="${base}/embed/v1/widget.js" data-shop="${esc(slug)}" data-title="${esc(title)}"></script>`;
  const iframe = `<iframe src="${embedUrl}" title="${esc(title)}" style="width:100%;border:0;min-height:760px;"></iframe>`;

  return {
    shop: {
      id: shop.id,
      name: shop.name,
      slug,
      owner_email: shop.email,
    },
    links: {
      quote: quoteUrl,
      embedded_quote: embedUrl,
      admin: `${base}/admin/login.html`,
      settings: `${base}/admin/settings.html`,
      payments: `${base}/admin/payments.html`,
      platform_shop: `${base}/platform/admin.html#stores`,
    },
    embed: {
      script,
      iframe,
      allowed_origins: allowedOrigins,
      notes: [
        'Use the script snippet as the recommended install method.',
        'Use the iframe fallback only when the website cannot load third-party scripts.',
        'Add the website origin in Admin > Settings before embedding on a public site.',
      ],
    },
  };
}

export function renderShopInstallEmail(shop, install) {
  const shopName = shop?.name || install?.shop?.name || 'your store';
  const origins = install.embed.allowed_origins.length
    ? install.embed.allowed_origins.join(', ')
    : 'No website origin approved yet. Add the customer website origin in Admin > Settings before the public embed goes live.';
  const subject = `Your Trennen quote widget for ${shopName}`;
  const text = [
    `Your Trennen quote widget is ready for ${shopName}.`,
    '',
    'Recommended install code:',
    install.embed.script,
    '',
    'Iframe fallback:',
    install.embed.iframe,
    '',
    `Quote page: ${install.links.quote}`,
    `Admin login: ${install.links.admin}`,
    `Settings: ${install.links.settings}`,
    `Payments: ${install.links.payments}`,
    '',
    `Approved website origins: ${origins}`,
    '',
    'Security notes:',
    '- This code does not contain Stripe keys, passwords, or customer data.',
    '- Trennen remains the pricing, checkout, order, reporting, and audit backend.',
    '- The store must connect Stripe before taking live card payments.',
  ].join('\n');

  const html = renderEmail({
    shopName: 'Trennen',
    eyebrowText: 'Store setup',
    preheader: `Install the quote widget for ${shopName}.`,
    content: [
      heading('Your quote widget is ready'),
      paragraph(`${esc(shopName)} now has its own Trennen quote flow. Install the script below on the store website, then connect Stripe before accepting live payments.`),
      btn('Open store admin', install.links.admin),
      divider(),
      infoBox(`
        <strong>Recommended install code</strong>
        ${codeBlock(install.embed.script)}
        <strong>Iframe fallback</strong>
        ${codeBlock(install.embed.iframe)}
      `),
      detailTable([
        ['Quote page', `<a href="${esc(install.links.quote)}" style="color:#4a7050;">${esc(install.links.quote)}</a>`],
        ['Settings', `<a href="${esc(install.links.settings)}" style="color:#4a7050;">Admin settings</a>`],
        ['Payments', `<a href="${esc(install.links.payments)}" style="color:#4a7050;">Stripe setup</a>`],
        ['Approved origins', esc(oneLine(origins))],
      ]),
      infoBox('This email intentionally does not include passwords, Stripe keys, or customer data. Trennen stays the central backend for pricing, checkout, sales reporting, and audit history.', { tone: 'success' }),
    ].join(''),
  });

  return {
    to: shop.email,
    subject,
    text,
    html,
    templateId: 'shop_install',
    category: 'shop_onboarding',
    shopSlug: install.shop.slug,
    idempotencyKey: `shop-install:${shop.id}:${shop.updated_at || shop.created_at || 'new'}`,
  };
}

export async function sendShopInstallEmail(shop, install) {
  return sendMail(renderShopInstallEmail(shop, install));
}

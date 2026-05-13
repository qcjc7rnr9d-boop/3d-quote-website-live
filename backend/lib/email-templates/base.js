/**
 * Shared email layout + small HTML helpers.
 *
 * Every template renders through `renderEmail(...)` so the visual identity
 * stays consistent. The markup is email-safe (table-based layout, inline
 * styles) and tested to look correct in Gmail / Apple Mail / Outlook /
 * dark-mode clients.
 *
 * Branding can be overridden per shop via `store_settings.brand`:
 *   { logoUrl, accentColor, footerNote, footerAddress }
 */

const PALETTE = {
  bg:        '#f7f4ee',
  card:      '#ffffff',
  border:    '#e5e1da',
  divider:   '#efebe3',
  stone:     '#f1ede5',
  ink:       '#1c1c1a',
  inkSoft:   '#3a3a36',
  muted:     '#7a7972',
  mutedSoft: '#a2a09a',
  accent:    '#4a7050',
  accentDark:'#3a5a40',
};

const FONTS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

// ── Helpers ──────────────────────────────────────────────────
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function btn(text, href, accent = PALETTE.accent) {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
    <td style="border-radius:10px;background:${accent};">
      <a href="${esc(href)}"
         style="display:inline-block;padding:13px 26px;font-family:${FONTS};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;letter-spacing:-0.005em;">${esc(text)}</a>
    </td>
  </tr></table>`;
}

export function infoBox(innerHtml, opts = {}) {
  const bg = opts.tone === 'warn' ? '#fff8eb'
           : opts.tone === 'success' ? '#eef2ec'
           : PALETTE.stone;
  const bd = opts.tone === 'warn' ? '#f0e3c1'
           : opts.tone === 'success' ? '#d6e0d8'
           : PALETTE.divider;
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0;">
    <tr><td style="background:${bg};border:1px solid ${bd};border-radius:10px;padding:16px 18px;font-family:${FONTS};font-size:13px;line-height:1.6;color:${PALETTE.ink};">
      ${innerHtml}
    </td></tr>
  </table>`;
}

export function detailTable(rows) {
  const trs = rows.map(([label, value]) => `
    <tr>
      <td style="padding:6px 0;color:${PALETTE.muted};font-size:13px;width:40%;">${esc(label)}</td>
      <td style="padding:6px 0;color:${PALETTE.ink};font-size:13px;text-align:right;font-weight:500;">${value}</td>
    </tr>`).join('');
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse;margin:18px 0;">${trs}</table>`;
}

export function divider() {
  return `<div style="height:1px;background:${PALETTE.divider};margin:24px 0;"></div>`;
}

export function paragraph(text) {
  return `<p style="font-family:${FONTS};font-size:14px;line-height:1.65;color:${PALETTE.inkSoft};margin:0 0 14px;">${text}</p>`;
}

export function heading(text) {
  return `<h1 style="font-family:${FONTS};font-size:22px;font-weight:600;letter-spacing:-0.015em;color:${PALETTE.ink};margin:0 0 8px;">${esc(text)}</h1>`;
}

export function eyebrow(text) {
  return `<div style="font-family:${FONTS};font-size:10.5px;font-weight:600;letter-spacing:0.10em;text-transform:uppercase;color:${PALETTE.muted};margin-bottom:14px;">${esc(text)}</div>`;
}

// ── Full email scaffold ──────────────────────────────────────
/**
 * Wrap inner HTML body with the shared layout.
 *
 * @param {object} opts
 * @param {string} opts.shopName     Shown in header (left)
 * @param {string} opts.eyebrowText  Small upper-right tag, e.g. "ORDER UPDATE"
 * @param {string} opts.preheader    Hidden inbox-preview snippet
 * @param {string} opts.content      Inner body HTML
 * @param {object} [opts.brand]      Optional per-shop branding overrides
 *                                    { accentColor, logoUrl, footerNote, footerAddress }
 */
export function renderEmail({
  shopName = 'Mahi3d',
  eyebrowText = '',
  preheader = '',
  content = '',
  brand = {},
}) {
  const accent       = brand.accentColor || PALETTE.accent;
  const logoUrl      = brand.logoUrl     || null;
  // Footer carries the platform's domain as a clickable wordmark — every
  // shop's emails identify the platform without overshadowing the shop.
  const platformName   = (process.env.PLATFORM_NAME   || 'Trennen').trim()      || 'Trennen';
  const platformDomain = (process.env.PLATFORM_DOMAIN || 'trennen.co.nz').trim() || 'trennen.co.nz';
  // Display "Trennen.co.nz" — capitalised proper-noun style, matches branding.
  const platformDisplay = platformDomain.charAt(0).toUpperCase() + platformDomain.slice(1);

  // Admin-supplied footerNote (if any) wins; otherwise render the platform
  // wordmark as a subtle link.
  const customFooter   = brand.footerNote;
  const footerHtml     = customFooter
    ? esc(customFooter)
    : `<a href="https://${esc(platformDomain)}" style="color:${PALETTE.muted};text-decoration:none;border-bottom:1px solid ${PALETTE.divider};">${esc(platformDisplay)}</a>`;
  const footerAddress  = brand.footerAddress || '';

  const headerLeft = logoUrl
    ? `<img src="${esc(logoUrl)}" alt="${esc(shopName)}" height="24" style="display:block;border:0;height:24px;width:auto;">`
    : `<span style="font-family:${FONTS};font-size:16px;font-weight:700;color:${PALETTE.ink};letter-spacing:-0.01em;">${esc(shopName)}</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>${esc(shopName)}</title>
  <style>
    @media (max-width:600px){
      .email-card { width:100% !important; border-radius:0 !important; border-left:0 !important; border-right:0 !important; }
      .email-pad  { padding:24px 22px !important; }
    }
    @media (prefers-color-scheme: dark) {
      /* Stay light — many transactional clients render dark inversely anyway */
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${PALETTE.bg};font-family:${FONTS};-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;">
  <div style="display:none !important;font-size:1px;color:${PALETTE.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${PALETTE.bg};">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" class="email-card" width="560" cellspacing="0" cellpadding="0" border="0"
               style="width:560px;max-width:560px;background:${PALETTE.card};border:1px solid ${PALETTE.border};border-radius:16px;">

          <!-- Header -->
          <tr>
            <td class="email-pad" style="padding:24px 32px;border-bottom:1px solid ${PALETTE.divider};">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="left">${headerLeft}</td>
                  ${eyebrowText
                    ? `<td align="right" style="font-family:${FONTS};font-size:10.5px;font-weight:600;letter-spacing:0.10em;text-transform:uppercase;color:${PALETTE.muted};">${esc(eyebrowText)}</td>`
                    : ''}
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="email-pad" style="padding:32px;">${content}</td>
          </tr>

          ${brand.thankYou ? `
          <!-- Personal thank-you line (set by the shop owner in admin/notifications.html).
               Shown on every email so the shop's voice carries through consistently. -->
          <tr>
            <td class="email-pad" style="padding:0 32px 28px;">
              <div style="padding:16px 18px;background:${PALETTE.stone};border-radius:10px;text-align:center;font-family:${FONTS};font-size:13px;line-height:1.55;color:${PALETTE.ink};font-style:italic;">
                ${esc(brand.thankYou)}
              </div>
            </td>
          </tr>
          ` : ''}

          <!-- Footer -->
          <tr>
            <td class="email-pad" style="padding:18px 32px 26px;border-top:1px solid ${PALETTE.divider};font-family:${FONTS};font-size:11px;color:${PALETTE.muted};line-height:1.6;text-align:center;">
              ${footerHtml}
              ${footerAddress ? `<br>${esc(footerAddress)}` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export { PALETTE, FONTS };

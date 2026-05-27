/**
 * Dynamic "From" address builder.
 *
 * Goal:  every email the platform sends comes from an address that
 * identifies BOTH the shop and the purpose, so the recipient (and the
 * recipient's mail client) can tell apart an order confirmation from
 * an invoice from a password-reset.
 *
 * Example outputs (with APP_EMAIL_DOMAIN=trennen-app.com, shop slug=trennen):
 *
 *   category      | local part                | display name
 *   --------------+---------------------------+--------------------------
 *   orders        | trennen-orders             | trennen · Orders
 *   invoices      | trennen-invoices           | trennen · Billing
 *   account       | trennen-account            | trennen · Account
 *   quotes        | trennen-quotes             | trennen · Quotes
 *   shipping      | trennen-shipping           | trennen · Shipping
 *   alerts        | trennen-alerts             | trennen · Alerts
 *   support       | trennen                    | trennen
 *
 * Configuration via .env:
 *   APP_EMAIL_DOMAIN     verified sending domain (e.g. trennen-app.com)
 *   APP_EMAIL_FALLBACK   used if APP_EMAIL_DOMAIN is not set yet
 *                        (default: onboarding@resend.dev — Resend sandbox)
 */

const CATEGORY_META = {
  orders:    { suffix: 'orders',    label: 'Orders' },
  invoices:  { suffix: 'invoices',  label: 'Billing' },
  account:   { suffix: 'account',   label: 'Account' },
  quotes:    { suffix: 'quotes',    label: 'Quotes' },
  shipping:  { suffix: 'shipping',  label: 'Shipping' },
  alerts:    { suffix: 'alerts',    label: 'Alerts' },
  support:   { suffix: null,        label: null      }, // bare slug + bare name
  notifications: { suffix: 'alerts',label: 'Alerts'  }, // alias
};

const SAFE = (s, fallback = '') =>
  String(s ?? fallback).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

const QUOTABLE_DISPLAY = name =>
  /[",<>@]/.test(name) ? `"${name.replace(/"/g, '\\"')}"` : name;

function emailAddressOnly(value) {
  const text = String(value || '').trim();
  const match = text.match(/<([^<>]+@[^<>]+)>$/);
  return (match ? match[1] : text).trim();
}

/**
 * Build a From header for a given shop + category.
 *
 * @param {object} opts
 * @param {string} opts.shopName   Display name of the shop (e.g. "Trennen")
 * @param {string} opts.shopSlug   URL slug (e.g. "trennen")
 * @param {string} opts.category   One of the keys in CATEGORY_META
 * @returns {string}               "Shop · Purpose <slug-purpose@domain>"
 */
export function buildFromAddress({
  shopName = 'Notifications',
  shopSlug = 'shop',
  category = 'support',
  emailDomain = {},
} = {}) {
  const meta   = CATEGORY_META[category] || CATEGORY_META.support;
  const slug   = SAFE(shopSlug, 'shop') || 'shop';
  const clientDomain = emailDomain.status === 'verified' && emailDomain.domain
    ? String(emailDomain.domain).trim().toLowerCase()
    : '';

  // Client domains are already business-specific subdomains, so keep the
  // local part clean: orders@quotes.client.com instead of shop-orders@...
  const local = clientDomain
    ? (meta.suffix || 'support')
    : (meta.suffix ? `${slug}-${meta.suffix}` : slug);

  // Display name: "<ShopName> · <Label>"  (or just shop name if no label)
  const niceShop = String(shopName || '').trim() || 'Notifications';
  const displayRaw = meta.label ? `${niceShop} · ${meta.label}` : niceShop;
  const display    = QUOTABLE_DISPLAY(displayRaw);

  const domain = clientDomain || (process.env.APP_EMAIL_DOMAIN || '').trim();

  if (domain) {
    return `${display} <${local}@${domain}>`;
  }

  const fallbackAddr = emailAddressOnly(process.env.APP_EMAIL_FALLBACK || 'onboarding@resend.dev');
  return `${display} <${fallbackAddr}>`;
}

/**
 * Build a Reply-To header pointing at the shop's customer-facing inbox.
 * Falls back to the shop owner's account email so customer replies don't
 * vanish into the platform's outbox.
 */
export function buildReplyTo({ shop } = {}) {
  if (!shop) return undefined;
  return shop.support_email || shop.email || undefined;
}

export { CATEGORY_META };

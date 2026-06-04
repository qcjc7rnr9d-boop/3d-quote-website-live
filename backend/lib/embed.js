import { randomBytes } from 'node:crypto';
import { getShopBySlug } from './shop-lookup.js';

export const EMBED_DNS_TARGET = 'quotes.trennen.co.nz';
export const EMBED_SCRIPT_HOST = 'https://embed.trennen.co.nz';

const QUOTE_DOMAIN_STATUSES = new Set(['not_configured', 'pending_dns', 'active', 'failed']);

export function ensureEmbedSettingsColumns(db) {
  const shopCols = db.prepare('PRAGMA table_info(shops)').all().map(c => c.name);
  if (!shopCols.includes('public_tenant_id')) {
    db.exec('ALTER TABLE shops ADD COLUMN public_tenant_id TEXT');
  }

  const settingsCols = db.prepare('PRAGMA table_info(store_settings)').all().map(c => c.name);
  if (!settingsCols.includes('embed_allowed_origins')) {
    db.exec("ALTER TABLE store_settings ADD COLUMN embed_allowed_origins TEXT NOT NULL DEFAULT '[]'");
  }
  if (!settingsCols.includes('quote_custom_domain')) {
    db.exec('ALTER TABLE store_settings ADD COLUMN quote_custom_domain TEXT');
  }
  if (!settingsCols.includes('quote_custom_domain_status')) {
    db.exec("ALTER TABLE store_settings ADD COLUMN quote_custom_domain_status TEXT NOT NULL DEFAULT 'not_configured'");
  }
  if (!settingsCols.includes('quote_custom_domain_last_checked_at')) {
    db.exec('ALTER TABLE store_settings ADD COLUMN quote_custom_domain_last_checked_at TEXT');
  }

  db.prepare("SELECT id FROM shops WHERE public_tenant_id IS NULL OR public_tenant_id = ''").all()
    .forEach(row => {
      db.prepare('UPDATE shops SET public_tenant_id = ? WHERE id = ?').run(generateTenantId(db), row.id);
    });
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_shops_public_tenant_id ON shops(public_tenant_id)');
}

export function generateTenantId(db) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const token = `ten_${randomBytes(15).toString('base64url')}`;
    if (!db.prepare('SELECT id FROM shops WHERE public_tenant_id = ?').get(token)) return token;
  }
  throw new Error('Could not generate unique tenant ID.');
}

export function ensureShopTenantId(db, shopId) {
  const row = db.prepare('SELECT public_tenant_id FROM shops WHERE id = ?').get(shopId);
  if (!row) return null;
  if (row.public_tenant_id) return row.public_tenant_id;
  const tenantId = generateTenantId(db);
  db.prepare('UPDATE shops SET public_tenant_id = ? WHERE id = ?').run(tenantId, shopId);
  return tenantId;
}

function valuesFromInput(input) {
  if (Array.isArray(input)) return input;
  if (typeof input === 'string') {
    return input
      .split(/[\n,]/)
      .map(value => value.trim())
      .filter(Boolean);
  }
  if (input == null) return [];
  throw new Error('Embed origins must be a list of website origins.');
}

function normaliseOrigin(raw) {
  const text = String(raw || '').trim();
  if (!text) return null;

  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`Invalid embed origin: ${text}`);
  }

  const isLocalHttp = url.protocol === 'http:'
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new Error(`Embed origin must use HTTPS: ${text}`);
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new Error(`Embed origin must be only a scheme, host, and optional port: ${text}`);
  }

  return url.origin;
}

export function normaliseEmbedAllowedOrigins(input) {
  const seen = new Set();
  const origins = [];
  for (const value of valuesFromInput(input)) {
    const origin = normaliseOrigin(value);
    if (origin && !seen.has(origin)) {
      seen.add(origin);
      origins.push(origin);
    }
  }
  return origins;
}

export function parseEmbedAllowedOrigins(value) {
  try {
    return normaliseEmbedAllowedOrigins(JSON.parse(value || '[]'));
  } catch {
    return [];
  }
}

export function frameAncestorsForOrigins(origins) {
  const allowed = normaliseEmbedAllowedOrigins(origins);
  return ["'self'", ...allowed].join(' ');
}

export function normaliseQuoteCustomDomain(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new Error('Enter a valid quote subdomain.');
    }
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
      throw new Error('Quote domain must be only a hostname.');
    }
    return normaliseQuoteCustomDomain(url.hostname);
  }
  const host = raw.replace(/\.+$/, '');
  if (host.length > 253 || !/^[a-z0-9.-]+$/.test(host) || !host.includes('.')) {
    throw new Error('Enter a valid quote subdomain, for example quote.example.com.');
  }
  if (host.split('.').some(part => !part || part.length > 63 || part.startsWith('-') || part.endsWith('-'))) {
    throw new Error('Enter a valid quote subdomain, for example quote.example.com.');
  }
  return host;
}

export function normaliseQuoteDomainStatus(status) {
  const value = String(status || 'not_configured').trim().toLowerCase();
  return QUOTE_DOMAIN_STATUSES.has(value) ? value : 'not_configured';
}

export function quoteDomainSettingsPayload(row = {}) {
  const domain = normaliseQuoteCustomDomain(row.quote_custom_domain || '');
  const status = domain
    ? normaliseQuoteDomainStatus(row.quote_custom_domain_status || 'pending_dns')
    : 'not_configured';
  return {
    domain,
    requested_domain: domain,
    dns_target: EMBED_DNS_TARGET,
    status,
    last_checked_at: row.quote_custom_domain_last_checked_at || null,
    active: !!domain && status === 'active',
  };
}

export function resolveShopForEmbed(db, { tenant, shop, host, includeSuspended = false } = {}) {
  const tenantId = String(tenant || '').trim();
  if (tenantId) {
    const sql = includeSuspended
      ? 'SELECT * FROM shops WHERE public_tenant_id = ?'
      : "SELECT * FROM shops WHERE public_tenant_id = ? AND plan != 'suspended'";
    return db.prepare(sql).get(tenantId) || null;
  }

  const shopSlug = String(shop || '').trim();
  if (shopSlug) {
    return getShopBySlug(db, shopSlug, { includeSuspended });
  }

  const customHost = normaliseRequestHost(host);
  if (customHost) {
    const sql = `
      SELECT shops.*
      FROM shops
      JOIN store_settings ON store_settings.shop_id = shops.id
      WHERE lower(store_settings.quote_custom_domain) = ?
        AND store_settings.quote_custom_domain_status = 'active'
        ${includeSuspended ? '' : "AND shops.plan != 'suspended'"}
      LIMIT 1
    `;
    return db.prepare(sql).get(customHost) || null;
  }

  return null;
}

export function getEmbedSettingsForShop(db, shopId) {
  return db.prepare(`
    SELECT embed_allowed_origins, quote_custom_domain, quote_custom_domain_status, quote_custom_domain_last_checked_at
    FROM store_settings
    WHERE shop_id = ?
  `).get(shopId) || {};
}

export function normaliseRequestHost(host) {
  const value = String(host || '').trim().toLowerCase();
  if (!value) return '';
  const withoutPort = value.startsWith('[')
    ? value
    : value.split(':')[0];
  try {
    return normaliseQuoteCustomDomain(withoutPort);
  } catch {
    return '';
  }
}

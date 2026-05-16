import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { BCRYPT_ROUNDS } from '../config.js';
import { normaliseShopifyDomain } from './shopify-draft-order.js';

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
}

function addColumnIfMissing(db, table, column, definition) {
  const columns = columnNames(db, table);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function ensureShopifyTables(db) {
  addColumnIfMissing(db, 'shops', 'shopify_shop_domain', 'TEXT');
  addColumnIfMissing(db, 'shops', 'shopify_installed_at', 'TEXT');
  addColumnIfMissing(db, 'shops', 'shopify_uninstalled_at', 'TEXT');

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_shops_shopify_domain
      ON shops(shopify_shop_domain)
      WHERE shopify_shop_domain IS NOT NULL;

    CREATE TABLE IF NOT EXISTS shopify_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL,
      shopify_shop_domain TEXT NOT NULL,
      access_token TEXT NOT NULL,
      scope TEXT,
      installed_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      uninstalled_at TEXT,
      UNIQUE(shopify_shop_domain),
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shopify_quote_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      shop_id INTEGER NOT NULL,
      shopify_shop_domain TEXT NOT NULL,
      customer_email TEXT,
      customer_name TEXT,
      file_metadata TEXT NOT NULL DEFAULT '[]',
      cart_snapshot TEXT NOT NULL DEFAULT '{}',
      quote_snapshot TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'created',
      shopify_draft_order_id TEXT,
      shopify_draft_order_name TEXT,
      shopify_invoice_url TEXT,
      shopify_order_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS shopify_webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shopify_shop_domain TEXT NOT NULL,
      topic TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      processed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_shopify_quote_sessions_shop
      ON shopify_quote_sessions(shop_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_shopify_quote_sessions_draft
      ON shopify_quote_sessions(shopify_draft_order_id);
    CREATE INDEX IF NOT EXISTS idx_shopify_webhook_events_shop
      ON shopify_webhook_events(shopify_shop_domain, processed_at);
  `);
}

export function slugFromShopifyDomain(shopDomain = '') {
  return normaliseShopifyDomain(shopDomain).replace(/\.myshopify\.com$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `shopify-${Date.now().toString(36)}`;
}

function shopEmailFromDomain(shopDomain) {
  return `shopify+${slugFromShopifyDomain(shopDomain)}@example.invalid`;
}

function randomPasswordHash() {
  return bcrypt.hashSync(randomBytes(24).toString('base64url'), BCRYPT_ROUNDS);
}

export function findShopForShopifyDomain(db, shopDomain) {
  ensureShopifyTables(db);
  const domain = normaliseShopifyDomain(shopDomain);
  return db.prepare(`
    SELECT *
    FROM shops
    WHERE shopify_shop_domain = ? AND plan != 'suspended'
  `).get(domain);
}

export function findShopifySession(db, shopDomain) {
  ensureShopifyTables(db);
  const domain = normaliseShopifyDomain(shopDomain);
  return db.prepare(`
    SELECT ss.*, s.slug, s.name, s.plan
    FROM shopify_sessions ss
    JOIN shops s ON s.id = ss.shop_id
    WHERE ss.shopify_shop_domain = ? AND ss.uninstalled_at IS NULL AND s.plan != 'suspended'
  `).get(domain);
}

export function upsertShopifyInstallation(db, { shopDomain, accessToken, scope = '' }) {
  ensureShopifyTables(db);
  const domain = normaliseShopifyDomain(shopDomain);
  let shop = findShopForShopifyDomain(db, domain);
  const slug = slugFromShopifyDomain(domain);

  if (!shop) {
    shop = db.prepare('SELECT * FROM shops WHERE slug = ?').get(slug);
  }

  if (!shop) {
    const result = db.prepare(`
      INSERT INTO shops (name, slug, email, password_hash, is_temp_password, plan, shopify_shop_domain, shopify_installed_at)
      VALUES (?, ?, ?, ?, 1, 'starter', ?, datetime('now'))
    `).run(slug, slug, shopEmailFromDomain(domain), randomPasswordHash(), domain);
    shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(result.lastInsertRowid);
  } else {
    db.prepare(`
      UPDATE shops
      SET shopify_shop_domain = ?, shopify_installed_at = COALESCE(shopify_installed_at, datetime('now')),
          shopify_uninstalled_at = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(domain, shop.id);
    shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(shop.id);
  }

  db.prepare(`
    INSERT INTO shopify_sessions (shop_id, shopify_shop_domain, access_token, scope, installed_at, updated_at, uninstalled_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), NULL)
    ON CONFLICT(shopify_shop_domain) DO UPDATE SET
      shop_id = excluded.shop_id,
      access_token = excluded.access_token,
      scope = excluded.scope,
      updated_at = datetime('now'),
      uninstalled_at = NULL
  `).run(shop.id, domain, accessToken, scope || '');

  return db.prepare('SELECT * FROM shops WHERE id = ?').get(shop.id);
}

export function markShopifyUninstalled(db, shopDomain) {
  ensureShopifyTables(db);
  const domain = normaliseShopifyDomain(shopDomain);
  db.prepare(`
    UPDATE shopify_sessions
    SET uninstalled_at = datetime('now'), updated_at = datetime('now')
    WHERE shopify_shop_domain = ?
  `).run(domain);
  db.prepare(`
    UPDATE shops
    SET shopify_uninstalled_at = datetime('now'), updated_at = datetime('now')
    WHERE shopify_shop_domain = ?
  `).run(domain);
}

export function recordShopifyWebhookEvent(db, { shopDomain, topic, payload }) {
  ensureShopifyTables(db);
  db.prepare(`
    INSERT INTO shopify_webhook_events (shopify_shop_domain, topic, payload)
    VALUES (?, ?, ?)
  `).run(normaliseShopifyDomain(shopDomain), String(topic || ''), JSON.stringify(payload || {}));
}

export function recordShopifyQuoteSession(db, {
  token,
  shop,
  shopDomain,
  customerEmail = null,
  customerName = null,
  files = [],
  cart = {},
  quote = {},
  status = 'created',
}) {
  ensureShopifyTables(db);
  const domain = normaliseShopifyDomain(shopDomain);
  db.prepare(`
    INSERT INTO shopify_quote_sessions
      (token, shop_id, shopify_shop_domain, customer_email, customer_name, file_metadata, cart_snapshot, quote_snapshot, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(token) DO UPDATE SET
      customer_email = COALESCE(excluded.customer_email, customer_email),
      customer_name = COALESCE(excluded.customer_name, customer_name),
      file_metadata = excluded.file_metadata,
      cart_snapshot = excluded.cart_snapshot,
      quote_snapshot = excluded.quote_snapshot,
      status = excluded.status,
      updated_at = datetime('now')
  `).run(
    token,
    shop.id,
    domain,
    customerEmail,
    customerName,
    JSON.stringify(files || []),
    JSON.stringify(cart || {}),
    JSON.stringify(quote || {}),
    status,
  );
  return db.prepare('SELECT * FROM shopify_quote_sessions WHERE token = ?').get(token);
}

export function updateQuoteSessionDraftOrder(db, token, draftOrder = {}) {
  ensureShopifyTables(db);
  db.prepare(`
    UPDATE shopify_quote_sessions
    SET shopify_draft_order_id = ?,
        shopify_draft_order_name = ?,
        shopify_invoice_url = ?,
        status = 'draft_order_created',
        updated_at = datetime('now')
    WHERE token = ?
  `).run(draftOrder.id || null, draftOrder.name || null, draftOrder.invoiceUrl || null, token);
}

export function updateQuoteSessionPaidOrder(db, { draftOrderId = null, orderId = null }) {
  ensureShopifyTables(db);
  if (!draftOrderId && !orderId) return;
  if (draftOrderId) {
    db.prepare(`
      UPDATE shopify_quote_sessions
      SET shopify_order_id = COALESCE(?, shopify_order_id),
          status = 'paid',
          updated_at = datetime('now')
      WHERE shopify_draft_order_id = ?
    `).run(orderId, draftOrderId);
  }
}

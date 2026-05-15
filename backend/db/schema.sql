-- RF DEWI — Database Schema
-- Run: node db/migrate.js

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ── Shops (one row per print-shop customer) ────────────────
CREATE TABLE IF NOT EXISTS shops (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    NOT NULL,
  slug             TEXT    UNIQUE NOT NULL,
  email            TEXT    UNIQUE NOT NULL COLLATE NOCASE,
  password_hash    TEXT    NOT NULL,
  is_temp_password INTEGER NOT NULL DEFAULT 1,
  plan             TEXT    NOT NULL DEFAULT 'starter',
  stripe_account_id  TEXT,
  stripe_publishable_key TEXT,
  stripe_secret_key  TEXT,
  stripe_client_id   TEXT,
  stripe_charges_enabled INTEGER NOT NULL DEFAULT 0,
  stripe_payouts_enabled INTEGER NOT NULL DEFAULT 0,
  stripe_details_submitted INTEGER NOT NULL DEFAULT 0,
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS platform_settings (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  stripe_publishable_key TEXT,
  stripe_secret_key    TEXT,
  stripe_client_id     TEXT,
  platform_fee_percent REAL    NOT NULL DEFAULT 5,
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS platform_admins (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  owner_email          TEXT UNIQUE COLLATE NOCASE,
  password_hash        TEXT,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS platform_reset_tokens (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id             INTEGER NOT NULL DEFAULT 1,
  token                TEXT UNIQUE NOT NULL,
  used                 INTEGER NOT NULL DEFAULT 0,
  expires_at           TEXT NOT NULL,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (admin_id) REFERENCES platform_admins(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS platform_audit_events (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  platform_admin_id    INTEGER,
  action               TEXT NOT NULL,
  target_type          TEXT,
  target_id            TEXT,
  shop_id              INTEGER,
  ip                   TEXT,
  user_agent           TEXT,
  metadata             TEXT NOT NULL DEFAULT '{}',
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE SET NULL
);

-- ── Materials ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS materials (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id          INTEGER NOT NULL,
  name             TEXT    NOT NULL,
  description_short TEXT,
  description_long  TEXT,
  category         TEXT    NOT NULL DEFAULT 'FDM',
  colours          TEXT    NOT NULL DEFAULT '[]',  -- JSON array of {hex, name}
  finishes         TEXT    NOT NULL DEFAULT '[]',  -- JSON array of {name, modifier}
  image_url        TEXT,
  image_alt        TEXT,
  price_unit       TEXT    NOT NULL DEFAULT 'per cm³',
  recommended      INTEGER NOT NULL DEFAULT 0,
  tags             TEXT    NOT NULL DEFAULT '[]',
  best_for         TEXT    NOT NULL DEFAULT '[]',
  specs            TEXT    NOT NULL DEFAULT '[]',
  pricing_model    TEXT    NOT NULL DEFAULT 'per_cm3',
  base_price       REAL    NOT NULL DEFAULT 0.18,
  min_charge       REAL    NOT NULL DEFAULT 4.50,
  volume_tiers     TEXT    NOT NULL DEFAULT '[]',  -- JSON: [{from, price}]
  properties       TEXT    NOT NULL DEFAULT '{}',  -- JSON: {strength, flexibility, heat, idealFor, notFor}
  active           INTEGER NOT NULL DEFAULT 1,
  stock_status     TEXT    NOT NULL DEFAULT 'in_stock',
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

-- ── Orders ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id             INTEGER NOT NULL,
  customer_email      TEXT    NOT NULL COLLATE NOCASE,
  customer_name       TEXT    NOT NULL,
  file_name           TEXT,
  material_id         INTEGER,
  colour              TEXT,
  finish              TEXT,
  quantity            INTEGER NOT NULL DEFAULT 1,
  subtotal            REAL    NOT NULL DEFAULT 0,
  tax                 REAL    NOT NULL DEFAULT 0,
  shipping            REAL    NOT NULL DEFAULT 0,
  total               REAL    NOT NULL DEFAULT 0,
  stripe_payment_id   TEXT,
  public_token        TEXT UNIQUE,
  fulfilment_status   TEXT    NOT NULL DEFAULT 'pending',
  payment_status      TEXT    NOT NULL DEFAULT 'pending',
  notes               TEXT,
  tracking_number     TEXT,
  tracking_url        TEXT,
  customer_message    TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id)    REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS order_files (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL,
  order_item_id INTEGER,
  file_name     TEXT    NOT NULL,
  file_size     INTEGER,
  file_ext      TEXT,
  volume_cm3    REAL,
  quantity      INTEGER NOT NULL DEFAULT 1,
  dimensions    TEXT    NOT NULL DEFAULT '{}',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        INTEGER NOT NULL,
  material_id     INTEGER,
  material_name   TEXT,
  colour          TEXT,
  finish          TEXT,
  finish_detail   TEXT,
  infill          TEXT,
  quantity        INTEGER NOT NULL DEFAULT 1,
  subtotal        REAL    NOT NULL DEFAULT 0,
  tax             REAL    NOT NULL DEFAULT 0,
  shipping        REAL    NOT NULL DEFAULT 0,
  total           REAL    NOT NULL DEFAULT 0,
  quote_snapshot  TEXT    NOT NULL DEFAULT '{}',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE SET NULL
);

-- ── Customers ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id    INTEGER NOT NULL,
  email      TEXT    NOT NULL COLLATE NOCASE,
  name       TEXT,
  notes      TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (shop_id, email),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id       INTEGER NOT NULL,
  email         TEXT    NOT NULL COLLATE NOCASE,
  name          TEXT    NOT NULL,
  password_hash TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (shop_id, email),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_reset_tokens (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id             INTEGER NOT NULL,
  customer_account_id INTEGER NOT NULL,
  token               TEXT    UNIQUE NOT NULL,
  used                INTEGER NOT NULL DEFAULT 0,
  expires_at          TEXT    NOT NULL,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_account_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_saved_quotes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id             INTEGER NOT NULL,
  customer_account_id INTEGER NOT NULL,
  quote_request       TEXT    NOT NULL DEFAULT '{}',
  quote_snapshot      TEXT    NOT NULL DEFAULT '{}',
  file_meta           TEXT    NOT NULL DEFAULT '{}',
  selection           TEXT    NOT NULL DEFAULT '{}',
  total_cents         INTEGER NOT NULL DEFAULT 0,
  currency            TEXT    NOT NULL DEFAULT 'NZD',
  status              TEXT    NOT NULL DEFAULT 'active',
  expires_at          TEXT    NOT NULL,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_account_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
);

-- ── Discount codes ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS discount_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id    INTEGER NOT NULL,
  code       TEXT    NOT NULL COLLATE NOCASE,
  type       TEXT    NOT NULL,             -- 'percent' | 'fixed' | 'free_shipping'
  value      REAL    NOT NULL DEFAULT 0,
  min_order  REAL    NOT NULL DEFAULT 0,
  one_time   INTEGER NOT NULL DEFAULT 0,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (shop_id, code),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

-- ── Pricing config (one row per shop) ──────────────────────
CREATE TABLE IF NOT EXISTS pricing_config (
  shop_id              INTEGER PRIMARY KEY,
  currency             TEXT    NOT NULL DEFAULT 'NZD',
  tax_rate             REAL    NOT NULL DEFAULT 0.15,
  tax_inclusive        INTEGER NOT NULL DEFAULT 0,
  min_order_value      REAL    NOT NULL DEFAULT 0,
  free_shipping_above  REAL    NOT NULL DEFAULT 50,
  quote_rounding       REAL    NOT NULL DEFAULT 0.10,
  quote_valid_hours    INTEGER NOT NULL DEFAULT 24,
  max_model_quantity   INTEGER,
  show_breakdown       INTEGER NOT NULL DEFAULT 1,
  surcharges           TEXT    NOT NULL DEFAULT '[]',
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

-- ── Store settings (one row per shop) ──────────────────────
CREATE TABLE IF NOT EXISTS store_settings (
  shop_id        INTEGER PRIMARY KEY,
  tagline        TEXT,
  about          TEXT,
  phone          TEXT,
  address        TEXT,
  support_email_mode TEXT NOT NULL DEFAULT 'signup',
  support_email  TEXT,
  logo_url       TEXT,
  gst_number     TEXT,
  invoice_footer TEXT,
  invoice_logo   INTEGER NOT NULL DEFAULT 1,
  notifications  TEXT    NOT NULL DEFAULT '{}',
  email_templates TEXT   NOT NULL DEFAULT '{}',
  shipping_zones  TEXT   NOT NULL DEFAULT '[]',
  material_page_settings TEXT NOT NULL DEFAULT '{}',
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

-- ── Sessions ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id    INTEGER NOT NULL,
  token      TEXT    UNIQUE NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT    NOT NULL,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

-- ── Password-reset tokens ───────────────────────────────────
CREATE TABLE IF NOT EXISTS reset_tokens (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id    INTEGER NOT NULL,
  token      TEXT    UNIQUE NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT    NOT NULL,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_shop     ON orders(shop_id);
CREATE INDEX IF NOT EXISTS idx_orders_email    ON orders(customer_email);
CREATE INDEX IF NOT EXISTS idx_order_files_order ON order_files(order_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_order_files_item ON order_files(order_item_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_materials_shop  ON materials(shop_id);
CREATE INDEX IF NOT EXISTS idx_customers_shop  ON customers(shop_id);
CREATE INDEX IF NOT EXISTS idx_customer_accounts_email ON customer_accounts(shop_id, email);
CREATE INDEX IF NOT EXISTS idx_customer_reset_token ON customer_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_customer_reset_account ON customer_reset_tokens(customer_account_id, used, expires_at);
CREATE INDEX IF NOT EXISTS idx_customer_saved_quotes_account ON customer_saved_quotes(customer_account_id, shop_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_customer_saved_quotes_shop ON customer_saved_quotes(shop_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token  ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_reset_token     ON reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_platform_reset_token ON platform_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_platform_audit_created ON platform_audit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_platform_audit_shop ON platform_audit_events(shop_id);
CREATE INDEX IF NOT EXISTS idx_platform_audit_action ON platform_audit_events(action);

CREATE TABLE IF NOT EXISTS app_sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

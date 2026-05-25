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
  billing_customer_id TEXT,
  billing_subscription_id TEXT,
  billing_price_id TEXT,
  billing_status TEXT NOT NULL DEFAULT 'pending_subscription',
  billing_current_period_end TEXT,
  billing_checkout_session_id TEXT,
  billing_checkout_status TEXT,
  billing_updated_at TEXT,
  shopify_shop_domain TEXT UNIQUE,
  shopify_installed_at TEXT,
  shopify_uninstalled_at TEXT,
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS platform_settings (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  stripe_publishable_key TEXT,
  stripe_secret_key    TEXT,
  stripe_client_id     TEXT,
  platform_fee_percent REAL    NOT NULL DEFAULT 5,
  estimated_card_fee_basis_points INTEGER NOT NULL DEFAULT 290,
  estimated_card_fee_fixed_cents INTEGER NOT NULL DEFAULT 30,
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
  restricted_items_certification_version TEXT,
  restricted_items_certified_at TEXT,
  payment_processing_fee_cents INTEGER NOT NULL DEFAULT 0,
  checkout_platform_fee_cents INTEGER NOT NULL DEFAULT 0,
  customer_total_cents INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS exchange_rate_cache (
  provider        TEXT NOT NULL,
  base_currency   TEXT NOT NULL,
  quote_currency  TEXT NOT NULL,
  rate            REAL NOT NULL,
  provider_date   TEXT,
  fetched_at      TEXT NOT NULL,
  PRIMARY KEY (provider, base_currency, quote_currency)
);

CREATE INDEX IF NOT EXISTS idx_exchange_rate_cache_fetched
  ON exchange_rate_cache(provider, base_currency, fetched_at);

-- ── Shopify custom app integration ─────────────────────────
CREATE TABLE IF NOT EXISTS shopify_sessions (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id             INTEGER NOT NULL,
  shopify_shop_domain TEXT NOT NULL,
  access_token        TEXT NOT NULL,
  scope               TEXT,
  installed_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  uninstalled_at      TEXT,
  UNIQUE(shopify_shop_domain),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shopify_quote_sessions (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  token                    TEXT UNIQUE NOT NULL,
  shop_id                  INTEGER NOT NULL,
  shopify_shop_domain      TEXT NOT NULL,
  customer_email           TEXT,
  customer_name            TEXT,
  file_metadata            TEXT NOT NULL DEFAULT '[]',
  cart_snapshot            TEXT NOT NULL DEFAULT '{}',
  quote_snapshot           TEXT NOT NULL DEFAULT '{}',
  status                   TEXT NOT NULL DEFAULT 'created',
  shopify_draft_order_id   TEXT,
  shopify_draft_order_name TEXT,
  shopify_invoice_url      TEXT,
  shopify_order_id         TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at               TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shopify_webhook_events (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  shopify_shop_domain TEXT NOT NULL,
  topic               TEXT NOT NULL,
  payload             TEXT NOT NULL DEFAULT '{}',
  processed_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_shops_shopify_domain
  ON shops(shopify_shop_domain)
  WHERE shopify_shop_domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shopify_quote_sessions_shop
  ON shopify_quote_sessions(shop_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_shopify_quote_sessions_draft
  ON shopify_quote_sessions(shopify_draft_order_id);
CREATE INDEX IF NOT EXISTS idx_shopify_webhook_events_shop
  ON shopify_webhook_events(shopify_shop_domain, processed_at);

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
  embed_allowed_origins TEXT NOT NULL DEFAULT '[]',
  payment_fee_mode TEXT NOT NULL DEFAULT 'merchant_absorbs',
  email_sending_domain TEXT,
  email_sending_domain_status TEXT NOT NULL DEFAULT 'not_configured',
  email_sending_domain_records TEXT NOT NULL DEFAULT '[]',
  email_sending_domain_verified_at TEXT,
  email_sending_domain_last_checked_at TEXT,
  email_use_platform_fallback INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_price_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'NZD',
  gst_rate_basis_points INTEGER NOT NULL DEFAULT 1500,
  quote_allowance INTEGER,
  quote_overage_price_cents INTEGER,
  trial_days INTEGER NOT NULL DEFAULT 0,
  setup_fee_cents INTEGER NOT NULL DEFAULT 0,
  checkout_enabled INTEGER NOT NULL DEFAULT 0,
  checkout_fee_basis_points INTEGER NOT NULL DEFAULT 0,
  checkout_fee_monthly_cap_cents INTEGER NOT NULL DEFAULT 0,
  allow_overages INTEGER NOT NULL DEFAULT 0,
  branding_required INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS merchant_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL UNIQUE,
  plan_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_subscription',
  trial_start TEXT,
  trial_end TEXT,
  current_period_start TEXT NOT NULL,
  current_period_end TEXT NOT NULL,
  stripe_subscription_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE TABLE IF NOT EXISTS quote_usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL,
  quote_id TEXT,
  event_type TEXT NOT NULL,
  billing_period_start TEXT NOT NULL,
  billing_period_end TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS checkout_fee_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL,
  order_id INTEGER,
  billing_period_start TEXT NOT NULL,
  billing_period_end TEXT NOT NULL,
  order_amount_cents INTEGER NOT NULL DEFAULT 0,
  raw_platform_fee_cents INTEGER NOT NULL DEFAULT 0,
  final_platform_fee_cents INTEGER NOT NULL DEFAULT 0,
  cap_remaining_before_cents INTEGER NOT NULL DEFAULT 0,
  cap_remaining_after_cents INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS payment_fee_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL,
  order_id INTEGER,
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  stripe_balance_transaction_id TEXT,
  stripe_fee_amount_cents INTEGER NOT NULL DEFAULT 0,
  stripe_net_amount_cents INTEGER NOT NULL DEFAULT 0,
  stripe_fee_details_json TEXT NOT NULL DEFAULT '[]',
  payment_fee_mode TEXT NOT NULL DEFAULT 'merchant_absorbs',
  passed_to_customer_amount_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS billing_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER NOT NULL,
  adjustment_type TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  billing_period_start TEXT,
  billing_period_end TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quote_usage_shop_period
  ON quote_usage_events(shop_id, billing_period_start, billing_period_end);
CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_usage_once
  ON quote_usage_events(shop_id, quote_id, event_type)
  WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_checkout_fee_shop_period
  ON checkout_fee_ledger(shop_id, billing_period_start, billing_period_end);
CREATE INDEX IF NOT EXISTS idx_payment_fee_order
  ON payment_fee_records(order_id);

CREATE TABLE IF NOT EXISTS email_delivery_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  provider_message_id TEXT,
  idempotency_key TEXT UNIQUE,
  shop_id INTEGER,
  shop_slug TEXT,
  template_id TEXT,
  category TEXT,
  recipient_email TEXT NOT NULL COLLATE NOCASE,
  recipient_domain TEXT,
  from_address TEXT,
  reply_to TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  event_type TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  delivered_at TEXT,
  delayed_at TEXT,
  bounced_at TEXT,
  complained_at TEXT,
  failed_at TEXT,
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS email_suppressions (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  reason TEXT NOT NULL,
  event_type TEXT,
  provider_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
CREATE INDEX IF NOT EXISTS idx_email_delivery_provider_message ON email_delivery_events(provider, provider_message_id);
CREATE INDEX IF NOT EXISTS idx_email_delivery_shop_created ON email_delivery_events(shop_id, created_at);
CREATE INDEX IF NOT EXISTS idx_email_delivery_recipient ON email_delivery_events(recipient_email);

CREATE TABLE IF NOT EXISTS app_sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS legal_acceptances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER,
  customer_account_id INTEGER,
  user_email TEXT COLLATE NOCASE,
  agreement_type TEXT NOT NULL,
  version TEXT NOT NULL,
  accepted_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip_address TEXT,
  user_agent TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
  FOREIGN KEY (customer_account_id) REFERENCES customer_accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_shop_type_version
  ON legal_acceptances(shop_id, agreement_type, version, accepted_at);

CREATE TABLE IF NOT EXISTS privacy_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shop_id INTEGER,
  customer_account_id INTEGER,
  requester_email TEXT COLLATE NOCASE,
  request_type TEXT NOT NULL,
  requested_by TEXT NOT NULL DEFAULT 'customer',
  status TEXT NOT NULL DEFAULT 'completed',
  reason TEXT,
  retained_order_count INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE SET NULL,
  FOREIGN KEY (customer_account_id) REFERENCES customer_accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_privacy_requests_email_created
  ON privacy_requests(requester_email, created_at);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_shop_created
  ON privacy_requests(shop_id, created_at);

CREATE TABLE IF NOT EXISTS retention_cleanup_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dry_run INTEGER NOT NULL DEFAULT 1,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

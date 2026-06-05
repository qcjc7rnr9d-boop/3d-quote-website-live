import { randomBytes } from 'node:crypto';

function addColumnIfMissing(db, table, name, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  if (!cols.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

export function ensureSecurityHardeningSchema(db) {
  addColumnIfMissing(db, 'shops', 'mfa_enabled', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'shops', 'mfa_secret', 'TEXT');
  addColumnIfMissing(db, 'shops', 'mfa_enabled_at', 'TEXT');
  addColumnIfMissing(db, 'platform_admins', 'mfa_enabled', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'platform_admins', 'mfa_secret', 'TEXT');
  addColumnIfMissing(db, 'platform_admins', 'mfa_enabled_at', 'TEXT');
  addColumnIfMissing(db, 'customer_accounts', 'email_verified', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'customer_accounts', 'email_verified_at', 'TEXT');
  addColumnIfMissing(db, 'orders', 'refunded_cents', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'checkout_fee_ledger', 'stripe_application_fee_id', 'TEXT');
  addColumnIfMissing(db, 'checkout_fee_ledger', 'stripe_application_fee_amount_cents', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing(db, 'checkout_fee_ledger', 'stripe_application_fee_refunded_cents', 'INTEGER NOT NULL DEFAULT 0');

  db.exec(`
    CREATE TABLE IF NOT EXISTS customer_email_verification_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL,
      customer_account_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
      FOREIGN KEY (customer_account_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_customer_email_verify_token
      ON customer_email_verification_tokens(token);
    CREATE INDEX IF NOT EXISTS idx_customer_email_verify_account
      ON customer_email_verification_tokens(customer_account_id, used, expires_at);

    CREATE TABLE IF NOT EXISTS customer_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL,
      customer_account_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
      FOREIGN KEY (customer_account_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_customer_sessions_token
      ON customer_sessions(token);
    CREATE INDEX IF NOT EXISTS idx_customer_sessions_account
      ON customer_sessions(customer_account_id, created_at);

    CREATE TABLE IF NOT EXISTS order_refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      stripe_refund_id TEXT UNIQUE,
      stripe_payment_intent_id TEXT,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      reason TEXT,
      raw_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_order_refunds_order
      ON order_refunds(order_id, created_at);
  `);

  db.prepare(`
    UPDATE customer_accounts
    SET email_verified = 1,
        email_verified_at = COALESCE(email_verified_at, created_at, datetime('now'))
    WHERE email_verified IS NULL OR email_verified NOT IN (0, 1)
  `).run();
}

export function newSecurityToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function issueCustomerEmailVerificationToken(db, { shopId, customerAccountId, hours = 24 }) {
  ensureSecurityHardeningSchema(db);
  const token = newSecurityToken();
  db.prepare(`
    INSERT INTO customer_email_verification_tokens (shop_id, customer_account_id, token, expires_at)
    VALUES (?, ?, ?, datetime('now', ?))
  `).run(shopId, customerAccountId, token, `+${hours} hour`);
  return token;
}

export function markCustomerEmailVerified(db, token) {
  ensureSecurityHardeningSchema(db);
  const row = db.prepare(`
    SELECT *
    FROM customer_email_verification_tokens
    WHERE token = ? AND used = 0 AND expires_at > datetime('now')
  `).get(token);
  if (!row) return null;
  db.prepare(`
    UPDATE customer_accounts
    SET email_verified = 1,
        email_verified_at = datetime('now')
    WHERE id = ? AND shop_id = ?
  `).run(row.customer_account_id, row.shop_id);
  db.prepare('UPDATE customer_email_verification_tokens SET used = 1 WHERE id = ?').run(row.id);
  return row;
}

export function recordCustomerSession(db, { accountId, shopId, token, ip, userAgent, expiresAt }) {
  ensureSecurityHardeningSchema(db);
  db.prepare(`
    INSERT OR REPLACE INTO customer_sessions (
      shop_id, customer_account_id, token, ip, user_agent, expires_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(shopId, accountId, token, ip || null, userAgent || null, expiresAt);
}

export function listCustomerSessions(db, accountId, currentToken) {
  ensureSecurityHardeningSchema(db);
  return db.prepare(`
    SELECT id, token, ip, user_agent, created_at, expires_at
    FROM customer_sessions
    WHERE customer_account_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(accountId).map(row => ({
    id: row.id,
    ip: row.ip,
    user_agent: row.user_agent,
    created_at: row.created_at,
    expires_at: row.expires_at,
    is_current: row.token === currentToken,
  }));
}

export function revokeCustomerSession(db, { accountId, sessionId }) {
  ensureSecurityHardeningSchema(db);
  const row = db.prepare(`
    SELECT *
    FROM customer_sessions
    WHERE id = ? AND customer_account_id = ?
  `).get(sessionId, accountId);
  if (!row) return false;
  db.prepare('DELETE FROM customer_sessions WHERE id = ?').run(row.id);
  db.prepare('DELETE FROM app_sessions WHERE sid = ?').run(row.token);
  return true;
}

export function revokeCustomerSessions(db, { accountId, exceptToken = null } = {}) {
  ensureSecurityHardeningSchema(db);
  const rows = db.prepare(`
    SELECT token
    FROM customer_sessions
    WHERE customer_account_id = ?
      AND (? IS NULL OR token != ?)
  `).all(accountId, exceptToken, exceptToken);
  const deleteApp = db.prepare('DELETE FROM app_sessions WHERE sid = ?');
  for (const row of rows) deleteApp.run(row.token);
  db.prepare(`
    DELETE FROM customer_sessions
    WHERE customer_account_id = ?
      AND (? IS NULL OR token != ?)
  `).run(accountId, exceptToken, exceptToken);
  return rows.length;
}

export function deleteCustomerSessionByToken(db, token) {
  ensureSecurityHardeningSchema(db);
  db.prepare('DELETE FROM customer_sessions WHERE token = ?').run(token);
}

export function updateOrderRefundState(db, { orderId, amountCents, refundedCents = null, status = null } = {}) {
  ensureSecurityHardeningSchema(db);
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  const nextRefunded = refundedCents == null
    ? Math.max(0, Number(order.refunded_cents || 0) + Math.max(0, Number(amountCents || 0)))
    : Math.max(0, Number(refundedCents || 0));
  const paidTotal = Number(order.customer_total_cents || 0) || Math.round(Number(order.total || 0) * 100);
  const paymentStatus = status
    || (nextRefunded >= paidTotal && paidTotal > 0 ? 'refunded' : 'partially_refunded');
  db.prepare(`
    UPDATE orders
    SET refunded_cents = ?,
        payment_status = ?
    WHERE id = ?
  `).run(nextRefunded, paymentStatus, orderId);
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
}

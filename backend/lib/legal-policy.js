export const LEGAL_POLICY_VERSIONS = Object.freeze({
  customerTerms: 'customer-terms-v1-2026-05-24',
  privacyPolicy: 'privacy-v1-2026-05-24',
  merchantAgreement: 'merchant-agreement-v1-2026-05-24',
  restrictedItems: 'restricted-items-v1-2026-05-24',
  processorRegister: 'processors-v1-2026-05-24',
});

export const MERCHANT_AGREEMENT_EFFECTIVE_AT = '2026-05-24 00:00:00';
export const MERCHANT_AGREEMENT_GRACE_DAYS = 7;

function sqlDatetime(date = new Date()) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function parseSqlDatetime(value) {
  if (!value) return null;
  const date = new Date(`${String(value).replace(' ', 'T')}Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function safeJsonString(value) {
  try {
    return JSON.stringify(value && typeof value === 'object' ? value : {});
  } catch {
    return '{}';
  }
}

export function ensureLegalComplianceSchema(db) {
  db.exec(`
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
  `);
}

export function getMerchantLegalStatus(db, shopId, now = new Date()) {
  ensureLegalComplianceSchema(db);
  const version = LEGAL_POLICY_VERSIONS.merchantAgreement;
  const acceptance = db.prepare(`
    SELECT *
    FROM legal_acceptances
    WHERE shop_id = ?
      AND agreement_type = 'merchant_agreement'
      AND version = ?
    ORDER BY accepted_at DESC, id DESC
    LIMIT 1
  `).get(shopId, version);

  if (acceptance) {
    return {
      required: false,
      accepted: true,
      version,
      accepted_at: acceptance.accepted_at,
      grace_deadline: null,
      grace_days_remaining: null,
      checkout_blocked: false,
    };
  }

  const effective = parseSqlDatetime(MERCHANT_AGREEMENT_EFFECTIVE_AT) || new Date('2026-05-24T00:00:00.000Z');
  const deadline = new Date(effective.getTime() + MERCHANT_AGREEMENT_GRACE_DAYS * 24 * 60 * 60 * 1000);
  const msRemaining = deadline.getTime() - now.getTime();
  const graceDaysRemaining = Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)));
  const checkoutBlocked = now.getTime() > deadline.getTime();

  return {
    required: true,
    accepted: false,
    version,
    accepted_at: null,
    grace_deadline: sqlDatetime(deadline),
    grace_days_remaining: graceDaysRemaining,
    checkout_blocked: checkoutBlocked,
  };
}

export function recordMerchantLegalAcceptance(db, {
  shopId,
  userEmail = null,
  ipAddress = null,
  userAgent = null,
  metadata = {},
} = {}) {
  if (!shopId) throw new Error('shopId is required');
  ensureLegalComplianceSchema(db);
  const version = LEGAL_POLICY_VERSIONS.merchantAgreement;
  const now = sqlDatetime();
  const existing = db.prepare(`
    SELECT id
    FROM legal_acceptances
    WHERE shop_id = ?
      AND agreement_type = 'merchant_agreement'
      AND version = ?
    ORDER BY accepted_at DESC, id DESC
    LIMIT 1
  `).get(shopId, version);

  if (existing) {
    return db.prepare('SELECT * FROM legal_acceptances WHERE id = ?').get(existing.id);
  }

  const result = db.prepare(`
    INSERT INTO legal_acceptances (
      shop_id, user_email, agreement_type, version,
      accepted_at, ip_address, user_agent, metadata_json
    )
    VALUES (?, ?, 'merchant_agreement', ?, ?, ?, ?, ?)
  `).run(
    shopId,
    userEmail ? String(userEmail).trim().toLowerCase() : null,
    version,
    now,
    ipAddress || null,
    userAgent || null,
    safeJsonString(metadata)
  );

  return db.prepare('SELECT * FROM legal_acceptances WHERE id = ?').get(result.lastInsertRowid);
}

export function assertMerchantCheckoutAllowed(db, shopId, now = new Date()) {
  const status = getMerchantLegalStatus(db, shopId, now);
  if (status.checkout_blocked) {
    const err = new Error('This store must accept the current Trennen merchant legal agreement before checkout can continue.');
    err.status = 423;
    err.code = 'MERCHANT_LEGAL_AGREEMENT_REQUIRED';
    err.legal = status;
    throw err;
  }
  return status;
}

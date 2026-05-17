import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const EMAIL_DOMAIN_STATUSES = new Set(['not_configured', 'pending', 'verified', 'failed']);
export const SUPPRESSING_EVENT_TYPES = new Set(['email.bounced', 'email.complained']);

const STORE_EMAIL_COLUMNS = [
  ['email_sending_domain', 'TEXT'],
  ['email_sending_domain_status', "TEXT NOT NULL DEFAULT 'not_configured'"],
  ['email_sending_domain_records', "TEXT NOT NULL DEFAULT '[]'"],
  ['email_sending_domain_verified_at', 'TEXT'],
  ['email_sending_domain_last_checked_at', 'TEXT'],
  ['email_use_platform_fallback', 'INTEGER NOT NULL DEFAULT 1'],
];

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
}

export function ensureEmailDeliverySchema(db) {
  const existingSettings = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'store_settings'").get();
  if (existingSettings) {
    for (const [name, definition] of STORE_EMAIL_COLUMNS) {
      if (!hasColumn(db, 'store_settings', name)) {
        db.exec(`ALTER TABLE store_settings ADD COLUMN ${name} ${definition}`);
      }
    }
  }

  db.exec(`
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

    CREATE INDEX IF NOT EXISTS idx_email_delivery_provider_message
      ON email_delivery_events(provider, provider_message_id);
    CREATE INDEX IF NOT EXISTS idx_email_delivery_shop_created
      ON email_delivery_events(shop_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_email_delivery_recipient
      ON email_delivery_events(recipient_email);

    CREATE TABLE IF NOT EXISTS email_suppressions (
      email TEXT PRIMARY KEY COLLATE NOCASE,
      reason TEXT NOT NULL,
      event_type TEXT,
      provider_message_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function normaliseEmailAddress(value) {
  const text = String(value || '').trim();
  const match = text.match(/<([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)>$/);
  const email = (match ? match[1] : text).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

export function normaliseEmailDomain(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
  if (!text) return '';
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(text)) {
    const err = new Error('Enter a valid email sending domain, such as quotes.example.com.');
    err.code = 'INVALID_EMAIL_DOMAIN';
    throw err;
  }
  return text;
}

export function normaliseDomainStatus(value) {
  const status = String(value || 'not_configured').trim().toLowerCase();
  return EMAIL_DOMAIN_STATUSES.has(status) ? status : 'not_configured';
}

export function buildEmailIdempotencyKey(scope, ...parts) {
  const safeScope = String(scope || 'email')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'email';
  const digest = createHash('sha256')
    .update(JSON.stringify(parts.map(part => String(part ?? ''))))
    .digest('hex')
    .slice(0, 32);
  return `${safeScope}-${digest}`;
}

export function parseDnsRecords(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getShopEmailSettings(db, shopId) {
  if (!shopId) return {};
  try {
    ensureEmailDeliverySchema(db);
    const row = db.prepare(`
      SELECT email_sending_domain,
             email_sending_domain_status,
             email_sending_domain_records,
             email_sending_domain_verified_at,
             email_sending_domain_last_checked_at,
             email_use_platform_fallback
      FROM store_settings
      WHERE shop_id = ?
    `).get(shopId) || {};
    return {
      domain: row.email_sending_domain || '',
      status: normaliseDomainStatus(row.email_sending_domain_status),
      records: parseDnsRecords(row.email_sending_domain_records),
      verified_at: row.email_sending_domain_verified_at || null,
      last_checked_at: row.email_sending_domain_last_checked_at || null,
      use_platform_fallback: row.email_use_platform_fallback !== 0,
    };
  } catch {
    return {};
  }
}

export function updateShopEmailDomainSettings(db, shopId, input = {}, { allowStatus = false } = {}) {
  ensureEmailDeliverySchema(db);
  const current = getShopEmailSettings(db, shopId);
  const domain = input.email_sending_domain !== undefined
    ? normaliseEmailDomain(input.email_sending_domain)
    : (current.domain || '');
  const domainChanged = domain !== (current.domain || '');
  const status = allowStatus && input.email_sending_domain_status !== undefined
    ? normaliseDomainStatus(input.email_sending_domain_status)
    : (domainChanged ? (domain ? 'pending' : 'not_configured') : current.status || 'not_configured');
  const records = allowStatus && input.email_sending_domain_records !== undefined
    ? (Array.isArray(input.email_sending_domain_records) ? input.email_sending_domain_records : parseDnsRecords(input.email_sending_domain_records))
    : (current.records || []);
  const verifiedAt = status === 'verified'
    ? (input.email_sending_domain_verified_at || current.verified_at || new Date().toISOString())
    : null;
  const fallback = input.email_use_platform_fallback !== undefined
    ? (input.email_use_platform_fallback ? 1 : 0)
    : (current.use_platform_fallback === false ? 0 : 1);

  db.prepare(`
    UPDATE store_settings
    SET email_sending_domain = ?,
        email_sending_domain_status = ?,
        email_sending_domain_records = ?,
        email_sending_domain_verified_at = ?,
        email_sending_domain_last_checked_at = CASE
          WHEN ? THEN datetime('now')
          ELSE email_sending_domain_last_checked_at
        END,
        email_use_platform_fallback = ?,
        updated_at = datetime('now')
    WHERE shop_id = ?
  `).run(domain || null, status, JSON.stringify(records), verifiedAt, allowStatus ? 1 : 0, fallback, shopId);

  return getShopEmailSettings(db, shopId);
}

export function isRecipientSuppressed(db, email) {
  ensureEmailDeliverySchema(db);
  const normalised = normaliseEmailAddress(email);
  if (!normalised) return false;
  return !!db.prepare('SELECT email FROM email_suppressions WHERE email = ?').get(normalised);
}

export function recordSuppression(db, { email, reason, eventType, providerMessageId } = {}) {
  ensureEmailDeliverySchema(db);
  const normalised = normaliseEmailAddress(email);
  if (!normalised) return false;
  db.prepare(`
    INSERT INTO email_suppressions (email, reason, event_type, provider_message_id)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      reason = excluded.reason,
      event_type = excluded.event_type,
      provider_message_id = COALESCE(excluded.provider_message_id, email_suppressions.provider_message_id),
      updated_at = datetime('now')
  `).run(normalised, reason || 'suppressed', eventType || null, providerMessageId || null);
  return true;
}

export function reserveEmailDelivery(db, details = {}) {
  ensureEmailDeliverySchema(db);
  const recipient = normaliseEmailAddress(Array.isArray(details.to) ? details.to[0] : details.to);
  if (!recipient) {
    const err = new Error('sendMail requires a valid recipient email');
    err.code = 'INVALID_EMAIL_RECIPIENT';
    throw err;
  }
  const idempotencyKey = details.idempotencyKey || randomUUID();
  const existing = db.prepare('SELECT * FROM email_delivery_events WHERE idempotency_key = ?').get(idempotencyKey);
  if (existing && ['sent', 'delivered'].includes(existing.status)) {
    return { idempotencyKey, deduped: true, row: existing };
  }
  if (!existing) {
    db.prepare(`
      INSERT INTO email_delivery_events (
        provider, idempotency_key, shop_id, shop_slug, template_id, category,
        recipient_email, recipient_domain, from_address, reply_to, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued')
    `).run(
      details.provider || 'unknown',
      idempotencyKey,
      details.shopId || null,
      details.shopSlug || null,
      details.templateId || null,
      details.category || null,
      recipient,
      recipient.split('@')[1] || null,
      details.from || null,
      Array.isArray(details.replyTo) ? details.replyTo.join(', ') : details.replyTo || null,
    );
  }
  return { idempotencyKey, deduped: false };
}

export function markEmailDelivery(db, idempotencyKey, details = {}) {
  ensureEmailDeliverySchema(db);
  const status = details.status || 'sent';
  const timestampColumn = {
    sent: 'sent_at',
    delivered: 'delivered_at',
    delayed: 'delayed_at',
    bounced: 'bounced_at',
    complained: 'complained_at',
    failed: 'failed_at',
  }[status] || 'updated_at';
  db.prepare(`
    UPDATE email_delivery_events
    SET provider = COALESCE(?, provider),
        provider_message_id = COALESCE(?, provider_message_id),
        status = ?,
        event_type = COALESCE(?, event_type),
        attempt_count = COALESCE(?, attempt_count),
        last_error_code = ?,
        last_error_message = ?,
        ${timestampColumn} = datetime('now'),
        updated_at = datetime('now')
    WHERE idempotency_key = ?
  `).run(
    details.provider || null,
    details.providerMessageId || null,
    status,
    details.eventType || null,
    Number.isFinite(details.attemptCount) ? details.attemptCount : null,
    details.errorCode || null,
    details.errorMessage ? String(details.errorMessage).slice(0, 500) : null,
    idempotencyKey,
  );
}

function headerValue(headers = {}, key) {
  const found = Object.keys(headers).find(name => name.toLowerCase() === key);
  return found ? headers[found] : undefined;
}

function svixSecretBytes(secret = '') {
  const raw = String(secret || '').startsWith('whsec_') ? String(secret).slice(6) : String(secret || '');
  return Buffer.from(raw, 'base64');
}

function safeCompareBase64(leftBase64, rightBase64) {
  try {
    const left = Buffer.from(leftBase64, 'base64');
    const right = Buffer.from(rightBase64, 'base64');
    return left.length === right.length && timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export function verifyResendWebhookPayload(rawBody, headers = {}, secret = process.env.RESEND_WEBHOOK_SECRET) {
  if (!secret) return false;
  const id = String(headerValue(headers, 'svix-id') || '');
  const timestamp = String(headerValue(headers, 'svix-timestamp') || '');
  const signatureHeader = String(headerValue(headers, 'svix-signature') || '');
  if (!id || !timestamp || !signatureHeader) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 5 * 60) return false;

  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
  const expected = createHmac('sha256', svixSecretBytes(secret))
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64');
  const signatures = signatureHeader
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const [version, value] = part.split(',');
      return version === 'v1' ? value : null;
    })
    .filter(Boolean);
  return signatures.some(signature => safeCompareBase64(signature, expected));
}

function statusFromResendType(type) {
  if (type === 'email.delivered') return 'delivered';
  if (type === 'email.delivery_delayed' || type === 'email.delayed') return 'delayed';
  if (type === 'email.bounced') return 'bounced';
  if (type === 'email.complained') return 'complained';
  if (type === 'email.failed') return 'failed';
  return 'sent';
}

function firstRecipientFromWebhookData(data = {}) {
  const candidates = [
    data.to,
    data.email?.to,
    data.recipient,
    data.email,
  ].flat().filter(Boolean);
  return normaliseEmailAddress(candidates[0]);
}

export function recordResendWebhookEvent(db, event = {}) {
  ensureEmailDeliverySchema(db);
  const data = event.data || {};
  const providerMessageId = data.email_id || data.emailId || data.id || null;
  const recipient = firstRecipientFromWebhookData(data);
  const status = statusFromResendType(event.type);

  if (providerMessageId) {
    const changed = db.prepare(`
      UPDATE email_delivery_events
      SET status = ?,
          event_type = ?,
          ${status === 'delivered' ? 'delivered_at' : status === 'delayed' ? 'delayed_at' : status === 'bounced' ? 'bounced_at' : status === 'complained' ? 'complained_at' : status === 'failed' ? 'failed_at' : 'updated_at'} = datetime('now'),
          updated_at = datetime('now')
      WHERE provider = 'resend' AND provider_message_id = ?
    `).run(status, event.type || null, providerMessageId);
    if (!changed.changes && recipient) {
      db.prepare(`
        INSERT INTO email_delivery_events (
          provider, provider_message_id, recipient_email, recipient_domain, status, event_type
        )
        VALUES ('resend', ?, ?, ?, ?, ?)
      `).run(providerMessageId, recipient, recipient.split('@')[1] || null, status, event.type || null);
    }
  }

  if (recipient && SUPPRESSING_EVENT_TYPES.has(event.type)) {
    recordSuppression(db, {
      email: recipient,
      reason: status,
      eventType: event.type,
      providerMessageId,
    });
  }

  return { providerMessageId, recipient, status };
}

export function recentEmailEventsForShop(db, shopId, limit = 10) {
  ensureEmailDeliverySchema(db);
  return db.prepare(`
    SELECT provider, provider_message_id, template_id, category, recipient_email,
           from_address, reply_to, status, event_type, last_error_code,
           last_error_message, created_at, updated_at, sent_at, delivered_at,
           bounced_at, complained_at, failed_at
    FROM email_delivery_events
    WHERE shop_id = ?
    ORDER BY datetime(created_at) DESC, id DESC
    LIMIT ?
  `).all(shopId, Math.max(1, Math.min(50, Number(limit) || 10)));
}

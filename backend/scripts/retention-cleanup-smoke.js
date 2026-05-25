import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureLegalComplianceSchema } from '../lib/legal-policy.js';
import { runRetentionCleanup } from '../lib/retention-policy.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const dir = mkdtempSync(join(tmpdir(), 'trennen-retention-cleanup-'));
const db = new DatabaseSync(join(dir, 'rfdewi.db'));

try {
  db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  ensureLegalComplianceSchema(db);
  const now = new Date('2026-05-26T00:00:00.000Z');

  const shopId = db.prepare(`
    INSERT INTO shops (name, slug, email, password_hash, is_temp_password, plan)
    VALUES ('Retention Smoke Shop', 'retention-smoke', 'retention-smoke@example.test', 'hash', 0, 'starter')
  `).run().lastInsertRowid;
  const accountId = db.prepare(`
    INSERT INTO customer_accounts (shop_id, email, name, password_hash)
    VALUES (?, 'retention@example.test', 'Retention Customer', 'hash')
  `).run(shopId).lastInsertRowid;
  db.prepare(`
    INSERT INTO customer_saved_quotes (
      shop_id, customer_account_id, quote_request, quote_snapshot, file_meta,
      selection, total_cents, currency, status, expires_at, updated_at
    )
    VALUES (?, ?, '{"sensitive":true}', '{"total":1}', '{"name":"old.stl"}',
      '{"materialName":"PLA"}', 100, 'NZD', 'deleted', '2026-04-01 00:00:00', '2026-04-01 00:00:00')
  `).run(shopId, accountId);
  db.prepare(`
    INSERT INTO customer_reset_tokens (shop_id, customer_account_id, token, used, expires_at, created_at)
    VALUES (?, ?, 'old-customer-reset', 1, '2026-04-01 00:00:00', '2026-04-01 00:00:00')
  `).run(shopId, accountId);
  db.prepare(`
    INSERT INTO reset_tokens (shop_id, token, used, expires_at)
    VALUES (?, 'old-shop-reset', 1, '2026-04-01 00:00:00')
  `).run(shopId);
  db.prepare(`
    INSERT INTO sessions (shop_id, token, ip, user_agent, expires_at, created_at)
    VALUES (?, 'old-session', '203.0.113.20', 'RetentionSmoke/1.0', '2026-04-01 00:00:00', '2026-04-01 00:00:00')
  `).run(shopId);
  db.prepare(`
    INSERT INTO email_delivery_events (provider, recipient_email, status, created_at, updated_at)
    VALUES ('resend', 'retention@example.test', 'delivered', '2025-01-01 00:00:00', '2025-01-01 00:00:00')
  `).run();

  const dryRun = runRetentionCleanup(db, { now, dryRun: true });
  assert(dryRun.dryRun === true, 'dry run result must be marked dryRun');
  assert(dryRun.counts.customer_reset_tokens === 1, 'dry run must count customer reset token cleanup');
  assert(dryRun.counts.shop_reset_tokens === 1, 'dry run must count shop reset token cleanup');
  assert(dryRun.counts.sessions === 1, 'dry run must count session cleanup');
  assert(dryRun.counts.saved_quotes_purged === 1, 'dry run must count saved quote purge');
  assert(dryRun.counts.email_delivery_events === 1, 'dry run must count email event cleanup');
  assert(db.prepare('SELECT token FROM customer_reset_tokens WHERE token = ?').get('old-customer-reset'), 'dry run must not delete customer reset tokens');

  const applied = runRetentionCleanup(db, { now, dryRun: false });
  assert(applied.dryRun === false, 'apply result must not be marked dryRun');
  assert(!db.prepare('SELECT token FROM customer_reset_tokens WHERE token = ?').get('old-customer-reset'), 'apply must delete old customer reset tokens');
  assert(!db.prepare('SELECT token FROM reset_tokens WHERE token = ?').get('old-shop-reset'), 'apply must delete old shop reset tokens');
  assert(!db.prepare('SELECT token FROM sessions WHERE token = ?').get('old-session'), 'apply must delete old sessions');
  const quote = db.prepare('SELECT status, quote_request, quote_snapshot, file_meta, selection FROM customer_saved_quotes').get();
  assert(quote.status === 'purged', 'apply must mark deleted/expired saved quotes as purged');
  assert(quote.quote_request === '{}' && quote.file_meta === '{}', 'apply must clear saved quote payloads');
  assert(!db.prepare('SELECT id FROM email_delivery_events').get(), 'apply must delete old routine email events');
  assert(db.prepare('SELECT id FROM retention_cleanup_runs').get(), 'apply must record cleanup run summary');

  console.log('Retention cleanup smoke checks passed.');
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

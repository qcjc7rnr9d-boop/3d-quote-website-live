import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportCustomerPrivacyData, deleteCustomerPrivacyData } from '../lib/customer-privacy.js';
import { ensureLegalComplianceSchema } from '../lib/legal-policy.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const dir = mkdtempSync(join(tmpdir(), 'trennen-privacy-controls-'));
const db = new DatabaseSync(join(dir, 'rfdewi.db'));

try {
  db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  ensureLegalComplianceSchema(db);

  const shopId = db.prepare(`
    INSERT INTO shops (name, slug, email, password_hash, is_temp_password, plan)
    VALUES ('Privacy Smoke Shop', 'privacy-smoke', 'privacy-smoke@example.test', 'hash', 0, 'starter')
  `).run().lastInsertRowid;
  const accountId = db.prepare(`
    INSERT INTO customer_accounts (shop_id, email, name, password_hash)
    VALUES (?, 'alex.privacy@example.test', 'Alex Privacy', 'hash')
  `).run(shopId).lastInsertRowid;
  const orderId = db.prepare(`
    INSERT INTO orders (
      shop_id, customer_email, customer_name, file_name, quantity,
      subtotal, tax, shipping, total, payment_status, fulfilment_status,
      restricted_items_certification_version, restricted_items_certified_at
    )
    VALUES (?, 'alex.privacy@example.test', 'Alex Privacy', 'privacy-part.stl', 1,
      10, 1.5, 2, 13.5, 'paid', 'pending', 'restricted-items-v1-2026-05-24', datetime('now'))
  `).run(shopId).lastInsertRowid;
  db.prepare(`
    INSERT INTO customer_saved_quotes (
      shop_id, customer_account_id, quote_request, quote_snapshot, file_meta,
      selection, total_cents, currency, status, expires_at
    )
    VALUES (?, ?, '{"shopSlug":"privacy-smoke"}', '{"total":13.5}', '{"name":"privacy-quote.stl"}',
      '{"materialName":"PETG"}', 1350, 'NZD', 'active', datetime('now', '+1 day'))
  `).run(shopId, accountId);
  db.prepare(`
    INSERT INTO customer_reset_tokens (shop_id, customer_account_id, token, used, expires_at)
    VALUES (?, ?, 'privacy-reset-token', 0, datetime('now', '+1 hour'))
  `).run(shopId, accountId);
  db.prepare(`
    INSERT INTO app_sessions (sid, sess, expires_at)
    VALUES ('privacy-session', ?, ?)
  `).run(JSON.stringify({ customerId: accountId, customerShopId: shopId, cookie: {} }), Date.now() + 10000);

  const exported = exportCustomerPrivacyData(db, { customerAccountId: accountId, shopId });
  assert(exported.customer.email === 'alex.privacy@example.test', 'privacy export must include customer profile');
  assert(exported.orders.length === 1 && exported.orders[0].id === orderId, 'privacy export must include matching orders');
  assert(exported.saved_quotes.length === 1, 'privacy export must include saved quotes');
  assert(exported.retention_notice.includes('Orders, payment identifiers'), 'privacy export must include retention notice');

  const deleted = deleteCustomerPrivacyData(db, {
    customerAccountId: accountId,
    shopId,
    reason: 'smoke',
    requestedBy: 'customer',
  });
  assert(deleted.ok === true, 'privacy deletion must return ok');
  assert(deleted.retained_orders === 1, 'privacy deletion must report retained orders');
  assert(!db.prepare('SELECT id FROM customer_accounts WHERE id = ?').get(accountId), 'customer account must be deleted');
  assert(!db.prepare('SELECT id FROM customer_reset_tokens WHERE customer_account_id = ?').get(accountId), 'customer reset tokens must be deleted');
  assert(!db.prepare('SELECT sid FROM app_sessions WHERE sid = ?').get('privacy-session'), 'customer app sessions must be deleted');
  assert(db.prepare('SELECT id FROM orders WHERE id = ?').get(orderId), 'orders must remain for lawful retention');
  assert(db.prepare('SELECT id FROM privacy_requests WHERE requester_email = ?').get('alex.privacy@example.test'), 'privacy deletion must log privacy request');

  console.log('Privacy controls smoke checks passed.');
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

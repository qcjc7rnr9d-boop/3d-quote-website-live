// Migration v29 - MFA, customer email verification/session tracking, and refunds.
// Usage: node db/migrate_v29.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ensureSecurityHardeningSchema } from '../lib/security-hardening.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

const beforeCustomerCols = db.prepare('PRAGMA table_info(customer_accounts)').all().map(row => row.name);
ensureSecurityHardeningSchema(db);

if (!beforeCustomerCols.includes('email_verified')) {
  db.prepare(`
    UPDATE customer_accounts
    SET email_verified = 1,
        email_verified_at = COALESCE(email_verified_at, created_at, datetime('now'))
  `).run();
}

console.log('Migration v29 complete - MFA, customer sessions, email verification, and refund records ready.');
db.close();

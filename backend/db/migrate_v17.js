// Migration v17 - customer portal password reset tokens
// Usage: node db/migrate_v17.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS customer_reset_tokens (
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
  CREATE INDEX IF NOT EXISTS idx_customer_reset_token
    ON customer_reset_tokens(token);
  CREATE INDEX IF NOT EXISTS idx_customer_reset_account
    ON customer_reset_tokens(customer_account_id, used, expires_at);
`);

console.log('Migration v17 complete - customer reset tokens ready.');
db.close();

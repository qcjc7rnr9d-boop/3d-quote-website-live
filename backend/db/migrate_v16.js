// Migration v16 - customer saved quotes
// Usage: node db/migrate_v16.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS customer_saved_quotes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id INTEGER NOT NULL,
    customer_account_id INTEGER NOT NULL,
    quote_request TEXT NOT NULL DEFAULT '{}',
    quote_snapshot TEXT NOT NULL DEFAULT '{}',
    file_meta TEXT NOT NULL DEFAULT '{}',
    selection TEXT NOT NULL DEFAULT '{}',
    total_cents INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'NZD',
    status TEXT NOT NULL DEFAULT 'active',
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    FOREIGN KEY (customer_account_id) REFERENCES customer_accounts(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_customer_saved_quotes_account
    ON customer_saved_quotes(customer_account_id, shop_id, status, created_at);
  CREATE INDEX IF NOT EXISTS idx_customer_saved_quotes_shop
    ON customer_saved_quotes(shop_id);
`);

console.log('Migration v16 complete - customer saved quotes ready.');
db.close();

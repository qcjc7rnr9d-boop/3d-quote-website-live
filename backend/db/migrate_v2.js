// Migration v2 — customer accounts + order tracking fields
// Usage: node db/migrate_v2.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '../data');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, 'rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

// ── Add tracking/messaging columns to orders ──────────────────
const orderCols = db.prepare("PRAGMA table_info(orders)").all().map(c => c.name);

if (!orderCols.includes('tracking_number')) {
  db.exec('ALTER TABLE orders ADD COLUMN tracking_number TEXT');
  console.log('✓ Added orders.tracking_number');
}
if (!orderCols.includes('tracking_url')) {
  db.exec('ALTER TABLE orders ADD COLUMN tracking_url TEXT');
  console.log('✓ Added orders.tracking_url');
}
if (!orderCols.includes('customer_message')) {
  db.exec('ALTER TABLE orders ADD COLUMN customer_message TEXT');
  console.log('✓ Added orders.customer_message');
}

// ── Customer accounts table (end-user logins) ─────────────────
db.exec(`
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
  CREATE INDEX IF NOT EXISTS idx_customer_accounts_email
    ON customer_accounts(shop_id, email);
`);
console.log('✓ customer_accounts table ready');

console.log('\n✓ Migration v2 complete');
db.close();

// Migration v30 - checkout idempotency keys for Stripe orders.
// Usage: node db/migrate_v30.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

const columns = db.prepare('PRAGMA table_info(orders)').all().map(row => row.name);
if (!columns.includes('checkout_idempotency_key')) {
  db.exec('ALTER TABLE orders ADD COLUMN checkout_idempotency_key TEXT');
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_checkout_idempotency
    ON orders(shop_id, checkout_idempotency_key)
    WHERE checkout_idempotency_key IS NOT NULL
`);

console.log('Migration v30 complete - checkout idempotency keys ready.');
db.close();

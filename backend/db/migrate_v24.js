// Migration v24 - SaaS billing state for multi-tenant business subscriptions
// Usage: node db/migrate_v24.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

const columns = db.prepare('PRAGMA table_info(shops)').all().map(row => row.name);
const addColumn = (name, definition) => {
  if (!columns.includes(name)) db.exec(`ALTER TABLE shops ADD COLUMN ${name} ${definition}`);
};

addColumn('billing_customer_id', 'TEXT');
addColumn('billing_subscription_id', 'TEXT');
addColumn('billing_price_id', 'TEXT');
addColumn('billing_status', "TEXT NOT NULL DEFAULT 'pending_subscription'");
addColumn('billing_current_period_end', 'TEXT');
addColumn('billing_checkout_session_id', 'TEXT');
addColumn('billing_checkout_status', 'TEXT');
addColumn('billing_updated_at', 'TEXT');

db.exec(`
  UPDATE shops
  SET billing_status = 'active',
      billing_updated_at = COALESCE(billing_updated_at, datetime('now'))
  WHERE COALESCE(billing_status, '') IN ('', 'pending_subscription')
    AND billing_customer_id IS NULL
    AND billing_subscription_id IS NULL
    AND billing_checkout_session_id IS NULL;

  CREATE INDEX IF NOT EXISTS idx_shops_billing_customer_id
    ON shops(billing_customer_id)
    WHERE billing_customer_id IS NOT NULL;

  CREATE INDEX IF NOT EXISTS idx_shops_billing_subscription_id
    ON shops(billing_subscription_id)
    WHERE billing_subscription_id IS NOT NULL;
`);

console.log('Migration v24 complete - shop billing state ready.');
db.close();

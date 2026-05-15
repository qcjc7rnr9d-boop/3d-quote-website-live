// Migration v20 - unguessable public order confirmation tokens
// Usage: node db/migrate_v20.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

const cols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
if (!cols.includes('public_token')) {
  db.exec('ALTER TABLE orders ADD COLUMN public_token TEXT');
  console.log('  + added orders.public_token');
} else {
  console.log('  ✓ orders.public_token already exists');
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_public_token
    ON orders(public_token)
    WHERE public_token IS NOT NULL;
`);

console.log('Migration v20 complete - order confirmation tokens ready.');
db.close();

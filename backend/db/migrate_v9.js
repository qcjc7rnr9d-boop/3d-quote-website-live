// Migration v9 - shop-level Stripe publishable key
// Usage: node db/migrate_v9.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

const existing = db.prepare('PRAGMA table_info(shops)').all().map(c => c.name);

let added = 0;
if (!existing.includes('stripe_publishable_key')) {
  db.exec('ALTER TABLE shops ADD COLUMN stripe_publishable_key TEXT');
  console.log('  + added shops.stripe_publishable_key');
  added++;
} else {
  console.log('  ✓ shops.stripe_publishable_key already exists');
}

console.log(`\nMigration v9 complete - ${added} column(s) added.`);
db.close();

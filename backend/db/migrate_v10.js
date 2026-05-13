// Migration v10 - platform Stripe settings + shop Stripe readiness
// Usage: node db/migrate_v10.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

const shopCols = db.prepare('PRAGMA table_info(shops)').all().map(c => c.name);
let added = 0;

const shopAdds = [
  ['stripe_charges_enabled', 'INTEGER NOT NULL DEFAULT 0'],
  ['stripe_payouts_enabled', 'INTEGER NOT NULL DEFAULT 0'],
  ['stripe_details_submitted', 'INTEGER NOT NULL DEFAULT 0'],
  ['updated_at', 'TEXT'],
];

for (const [name, def] of shopAdds) {
  if (!shopCols.includes(name)) {
    db.exec(`ALTER TABLE shops ADD COLUMN ${name} ${def}`);
    console.log(`  + added shops.${name}`);
    added++;
  } else {
    console.log(`  ✓ shops.${name} already exists`);
  }
}

if (db.prepare('PRAGMA table_info(shops)').all().some(c => c.name === 'updated_at')) {
  db.exec("UPDATE shops SET updated_at = COALESCE(updated_at, datetime('now'))");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS platform_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    stripe_publishable_key TEXT,
    stripe_secret_key TEXT,
    stripe_client_id TEXT,
    platform_fee_percent REAL NOT NULL DEFAULT 5,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
console.log('  ✓ platform_settings table ready');
db.prepare('INSERT OR IGNORE INTO platform_settings (id) VALUES (1)').run();

console.log(`\nMigration v10 complete - ${added} shop column(s) added.`);
db.close();

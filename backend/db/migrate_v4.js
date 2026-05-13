// Migration v4 — carrier API credentials + from_postcode on store_settings
// Usage: node db/migrate_v4.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir   = join(__dirname, '../data');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, 'rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

const existing = db.prepare('PRAGMA table_info(store_settings)').all().map(c => c.name);

const cols = [
  ['from_postcode',                'TEXT'],
  ['carrier_nzpost_client_id',     'TEXT'],
  ['carrier_nzpost_client_secret', 'TEXT'],
  ['carrier_aramex_api_key',       'TEXT'],
  ['packaging_overhead_grams',     'INTEGER NOT NULL DEFAULT 200'],
];

let added = 0;
for (const [col, type] of cols) {
  if (!existing.includes(col)) {
    db.exec(`ALTER TABLE store_settings ADD COLUMN ${col} ${type}`);
    console.log(`  + added store_settings.${col}`);
    added++;
  } else {
    console.log(`  ✓ store_settings.${col} already exists`);
  }
}

console.log(`\nMigration v4 complete — ${added} column(s) added.`);
db.close();

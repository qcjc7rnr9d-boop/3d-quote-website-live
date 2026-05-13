// Migration v5 — Starshipit API key on store_settings
// Usage: node db/migrate_v5.js
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
  ['carrier_starshipit_api_key', 'TEXT'],
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

console.log(`\nMigration v5 complete — ${added} column(s) added.`);
db.close();

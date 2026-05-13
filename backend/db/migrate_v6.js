// Migration v6 — per-material production time (min/max business days)
// Usage: node db/migrate_v6.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

const existing = db.prepare('PRAGMA table_info(materials)').all().map(c => c.name);

const cols = [
  ['production_days_min', 'INTEGER'],
  ['production_days_max', 'INTEGER'],
];

let added = 0;
for (const [col, type] of cols) {
  if (!existing.includes(col)) {
    db.exec(`ALTER TABLE materials ADD COLUMN ${col} ${type}`);
    console.log(`  + added materials.${col}`);
    added++;
  } else {
    console.log(`  ✓ materials.${col} already exists`);
  }
}

console.log(`\nMigration v6 complete — ${added} column(s) added.`);
db.close();

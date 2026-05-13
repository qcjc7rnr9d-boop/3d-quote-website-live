// Migration v7 — per-material size limits (min/max XYZ in mm)
// Usage: node db/migrate_v7.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

const existing = db.prepare('PRAGMA table_info(materials)').all().map(c => c.name);

const cols = [
  ['min_x_mm', 'REAL'],
  ['min_y_mm', 'REAL'],
  ['min_z_mm', 'REAL'],
  ['max_x_mm', 'REAL'],
  ['max_y_mm', 'REAL'],
  ['max_z_mm', 'REAL'],
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

console.log(`\nMigration v7 complete — ${added} column(s) added.`);
db.close();

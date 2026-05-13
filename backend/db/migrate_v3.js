/**
 * Migration v3 — Pricing scheme expansion
 * Adds calculation-method columns to pricing_config
 */
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));

function columnExists(table, col) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);
}

const newCols = [
  // Which scheme is active
  { col: 'pricing_mode',          def: "TEXT    NOT NULL DEFAULT 'material'" },
  // Scheme A – material volume/weight
  { col: 'mat_include_support',   def: 'INTEGER NOT NULL DEFAULT 1' },
  // Scheme B – print time + material
  { col: 'time_rate_per_hour',    def: 'REAL    NOT NULL DEFAULT 0' },
  { col: 'time_rate_per_gram',    def: 'REAL    NOT NULL DEFAULT 0' },
  { col: 'time_include_support',  def: 'INTEGER NOT NULL DEFAULT 1' },
];

let added = 0;
for (const { col, def } of newCols) {
  if (!columnExists('pricing_config', col)) {
    db.exec(`ALTER TABLE pricing_config ADD COLUMN ${col} ${def}`);
    console.log(`  + added pricing_config.${col}`);
    added++;
  } else {
    console.log(`  ✓ pricing_config.${col} already exists`);
  }
}

console.log(`\nMigration v3 complete — ${added} column(s) added.`);

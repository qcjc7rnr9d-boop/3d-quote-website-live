// Migration v8 — per-shop infill tier configuration on pricing_config
// Usage: node db/migrate_v8.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

const existing = db.prepare('PRAGMA table_info(pricing_config)').all().map(c => c.name);

let added = 0;
if (!existing.includes('infill_tiers')) {
  db.exec(`ALTER TABLE pricing_config ADD COLUMN infill_tiers TEXT`);
  console.log('  + added pricing_config.infill_tiers');
  added++;
} else {
  console.log('  ✓ pricing_config.infill_tiers already exists');
}

console.log(`\nMigration v8 complete — ${added} column(s) added.`);
db.close();

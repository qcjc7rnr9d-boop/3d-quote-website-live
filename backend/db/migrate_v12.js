// Migration v12 - configurable material selection data
// Usage: node db/migrate_v12.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

function addColumn(table, name, type) {
  const existing = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (existing.includes(name)) {
    console.log(`  ✓ ${table}.${name} already exists`);
    return 0;
  }
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  console.log(`  + added ${table}.${name}`);
  return 1;
}

let added = 0;
added += addColumn('materials', 'image_url', 'TEXT');
added += addColumn('materials', 'image_alt', 'TEXT');
added += addColumn('materials', 'price_unit', "TEXT NOT NULL DEFAULT 'per cm³'");
added += addColumn('materials', 'recommended', 'INTEGER NOT NULL DEFAULT 0');
added += addColumn('materials', 'tags', "TEXT NOT NULL DEFAULT '[]'");
added += addColumn('materials', 'best_for', "TEXT NOT NULL DEFAULT '[]'");
added += addColumn('materials', 'specs', "TEXT NOT NULL DEFAULT '[]'");
added += addColumn('store_settings', 'material_page_settings', "TEXT NOT NULL DEFAULT '{}'");

console.log(`\nMigration v12 complete - ${added} column(s) added.`);
db.close();

// Migration v14 - customer-facing support email settings
// Usage: node db/migrate_v14.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

const cols = db.prepare('PRAGMA table_info(store_settings)').all().map(c => c.name);
const adds = [
  ['support_email_mode', "TEXT NOT NULL DEFAULT 'signup'"],
  ['support_email', 'TEXT'],
];

for (const [name, def] of adds) {
  if (!cols.includes(name)) {
    db.exec(`ALTER TABLE store_settings ADD COLUMN ${name} ${def}`);
    console.log(`  + added store_settings.${name}`);
  } else {
    console.log(`  ✓ store_settings.${name} already exists`);
  }
}

db.exec(`
  UPDATE store_settings
  SET support_email_mode = 'signup'
  WHERE support_email_mode IS NULL OR support_email_mode NOT IN ('signup', 'custom')
`);

console.log('Migration v14 complete - support email settings ready.');
db.close();

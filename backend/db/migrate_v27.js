// Migration v27 - store restricted-items checkout certification evidence.
// Usage: node db/migrate_v27.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

const columns = db.prepare('PRAGMA table_info(orders)').all().map(row => row.name);
const addColumn = (name, definition) => {
  if (!columns.includes(name)) db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${definition}`);
};

addColumn('restricted_items_certification_version', 'TEXT');
addColumn('restricted_items_certified_at', 'TEXT');

console.log('Migration v27 complete - restricted-items certification columns ready.');
db.close();

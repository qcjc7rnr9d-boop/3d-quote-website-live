// Migration v18 - per-order uploaded model metadata
// Usage: node db/migrate_v18.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS order_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER,
    file_ext TEXT,
    volume_cm3 REAL,
    dimensions TEXT NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_order_files_order
    ON order_files(order_id, sort_order);
`);

console.log('Migration v18 complete - order file metadata ready.');
db.close();

// Migration v19 - order line items for multi-material cart checkouts
// Usage: node db/migrate_v19.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    material_id INTEGER,
    material_name TEXT,
    colour TEXT,
    finish TEXT,
    finish_detail TEXT,
    infill TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    subtotal REAL NOT NULL DEFAULT 0,
    tax REAL NOT NULL DEFAULT 0,
    shipping REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    quote_snapshot TEXT NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_order_items_order
    ON order_items(order_id, sort_order);
`);

const orderFileColumns = db.prepare('PRAGMA table_info(order_files)').all().map(row => row.name);
if (!orderFileColumns.includes('order_item_id')) {
  db.exec('ALTER TABLE order_files ADD COLUMN order_item_id INTEGER;');
}
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_order_files_item
    ON order_files(order_item_id, sort_order);
`);

console.log('Migration v19 complete - order line items ready.');
db.close();

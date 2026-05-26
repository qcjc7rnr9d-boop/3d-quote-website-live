// Migration v29 - data integrity indexes for launch-critical lookups.
// Usage: node db/migrate_v29.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

const duplicateGroups = db.prepare(`
  SELECT
    shop_id,
    lower(trim(category)) AS category_key,
    lower(trim(name)) AS name_key,
    COUNT(*) AS count
  FROM materials
  WHERE active = 1
  GROUP BY shop_id, lower(trim(category)), lower(trim(name))
  HAVING count > 1
`).all();

let deactivated = 0;
const rowsForGroup = db.prepare(`
  SELECT id
  FROM materials
  WHERE shop_id = ?
    AND active = 1
    AND lower(trim(category)) = ?
    AND lower(trim(name)) = ?
  ORDER BY id ASC
`);
const deactivate = db.prepare('UPDATE materials SET active = 0 WHERE id = ?');

for (const group of duplicateGroups) {
  const ids = rowsForGroup.all(group.shop_id, group.category_key, group.name_key).map(row => row.id);
  for (const id of ids.slice(1)) {
    deactivated += deactivate.run(id).changes;
  }
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_materials_active_name_unique
    ON materials(shop_id, lower(trim(category)), lower(trim(name)))
    WHERE active = 1;

  CREATE INDEX IF NOT EXISTS idx_materials_shop_category_active_name
    ON materials(shop_id, category, active, name);

  CREATE INDEX IF NOT EXISTS idx_orders_shop_email_created
    ON orders(shop_id, customer_email, created_at);

  CREATE INDEX IF NOT EXISTS idx_orders_shop_created
    ON orders(shop_id, created_at);

  CREATE INDEX IF NOT EXISTS idx_app_sessions_expires
    ON app_sessions(expires_at);
`);

console.log(`Migration v29 complete - data integrity indexes ready (${deactivated} duplicate active material row(s) deactivated).`);
db.close();

// Migration v15 - platform audit events
// Usage: node db/migrate_v15.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS platform_audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_admin_id INTEGER,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    shop_id INTEGER,
    ip TEXT,
    user_agent TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_platform_audit_created
    ON platform_audit_events(created_at);
  CREATE INDEX IF NOT EXISTS idx_platform_audit_shop
    ON platform_audit_events(shop_id);
  CREATE INDEX IF NOT EXISTS idx_platform_audit_action
    ON platform_audit_events(action);
`);

console.log('Migration v15 complete - platform audit events ready.');
db.close();

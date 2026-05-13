// Migration v11 - platform owner account + reset tokens
// Usage: node db/migrate_v11.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS platform_admins (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    owner_email TEXT UNIQUE COLLATE NOCASE,
    password_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
console.log('  ✓ platform_admins table ready');

db.exec(`
  CREATE TABLE IF NOT EXISTS platform_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL DEFAULT 1,
    token TEXT UNIQUE NOT NULL,
    used INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (admin_id) REFERENCES platform_admins(id) ON DELETE CASCADE
  )
`);
console.log('  ✓ platform_reset_tokens table ready');

db.prepare('INSERT OR IGNORE INTO platform_admins (id) VALUES (1)').run();
db.exec('CREATE INDEX IF NOT EXISTS idx_platform_reset_token ON platform_reset_tokens(token)');

console.log('\nMigration v11 complete.');
db.close();

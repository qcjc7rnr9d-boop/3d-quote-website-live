// Migration v23 - Shopify custom app install/session/quote linkage
// Usage: node db/migrate_v23.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ensureShopifyTables } from '../lib/shopify-installation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

ensureShopifyTables(db);

console.log('Migration v23 complete - Shopify custom app tables ready.');
db.close();

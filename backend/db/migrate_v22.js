// Migration v22 - exchange rate cache for display currency conversion
// Usage: node db/migrate_v22.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS exchange_rate_cache (
    provider TEXT NOT NULL,
    base_currency TEXT NOT NULL,
    quote_currency TEXT NOT NULL,
    rate REAL NOT NULL,
    provider_date TEXT,
    fetched_at TEXT NOT NULL,
    PRIMARY KEY (provider, base_currency, quote_currency)
  );
  CREATE INDEX IF NOT EXISTS idx_exchange_rate_cache_fetched
    ON exchange_rate_cache(provider, base_currency, fetched_at);
`);

console.log('Migration v22 complete - exchange rate cache ready.');
db.close();

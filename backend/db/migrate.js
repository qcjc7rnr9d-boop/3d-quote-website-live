// Reads schema.sql and runs it against the database.
// Usage: node db/migrate.js
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';
import { pathToFileURL } from 'url';
import { ensureEmbedSettingsColumns } from '../lib/embed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '../data');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, 'rfdewi.db'));

const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
db.exec(sql);
ensureEmbedSettingsColumns(db);
db.close();

const excludedLeanMigrations = new Set([
  'migrate_v23.js', // Shopify tables are kept dormant in the lean quote + Stripe release.
]);

const migrationFiles = readdirSync(__dirname)
  .filter(file => /^migrate_v\d+\.js$/.test(file))
  .filter(file => !excludedLeanMigrations.has(file))
  .sort((a, b) => {
    const av = Number(a.match(/^migrate_v(\d+)\.js$/)?.[1] || 0);
    const bv = Number(b.match(/^migrate_v(\d+)\.js$/)?.[1] || 0);
    return av - bv;
  });

for (const file of migrationFiles) {
  await import(pathToFileURL(join(__dirname, file)).href);
}

console.log(`✓ Database migrated (${migrationFiles.length} lean migration scripts applied)`);

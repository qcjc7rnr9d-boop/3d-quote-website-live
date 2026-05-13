// Reads schema.sql and runs it against the database.
// Usage: node db/migrate.js
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '../data');
mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(join(dataDir, 'rfdewi.db'));

const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
db.exec(sql);

console.log('✓ Database migrated');
db.close();

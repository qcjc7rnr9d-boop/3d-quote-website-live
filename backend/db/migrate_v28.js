// Migration v28 - legal acceptances, privacy requests, and retention cleanup evidence.
// Usage: node db/migrate_v28.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ensureLegalComplianceSchema } from '../lib/legal-policy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

ensureLegalComplianceSchema(db);

console.log('Migration v28 complete - legal compliance records ready.');
db.close();

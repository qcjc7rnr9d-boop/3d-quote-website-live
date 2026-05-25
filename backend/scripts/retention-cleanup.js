import { DatabaseSync } from 'node:sqlite';
import { runRetentionCleanup } from '../lib/retention-policy.js';
import { ensureLegalComplianceSchema } from '../lib/legal-policy.js';

const dryRun = process.argv.includes('--dry-run') || !process.argv.includes('--apply');
const db = new DatabaseSync('data/rfdewi.db');

try {
  db.exec('PRAGMA foreign_keys = ON');
  ensureLegalComplianceSchema(db);
  const summary = runRetentionCleanup(db, { dryRun });
  console.log(JSON.stringify(summary, null, 2));
  if (dryRun) {
    console.log('Dry run only. Re-run with --apply to delete or purge the listed records.');
  }
} finally {
  db.close();
}

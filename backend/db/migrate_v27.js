// Migration v27 - Stripe-hosted merchant subscription cancellation metadata.
// Usage: node db/migrate_v27.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ensureBillingSchema, ensureMerchantSubscription } from '../lib/billing-service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

ensureBillingSchema(db);

const shops = db.prepare('SELECT id FROM shops').all();
for (const shop of shops) {
  ensureMerchantSubscription(db, shop.id);
}

console.log('Migration v27 complete - subscription cancellation metadata ready.');
db.close();

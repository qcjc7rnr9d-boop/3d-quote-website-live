// Migration v26 - Trennen pricing plans, quote usage, capped checkout fees,
// and separated Stripe/payment processing fee records.
// Usage: node db/migrate_v26.js
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ensureBillingSchema, seedBillingPlans, ensureMerchantSubscription } from '../lib/billing-service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');

ensureBillingSchema(db);
seedBillingPlans(db);

const shops = db.prepare('SELECT id FROM shops').all();
for (const shop of shops) {
  ensureMerchantSubscription(db, shop.id);
}

console.log('Migration v26 complete - Trennen billing plans and fee ledgers ready.');
db.close();

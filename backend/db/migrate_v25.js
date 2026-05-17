import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { ensureEmailDeliverySchema } from '../lib/email-delivery.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));

ensureEmailDeliverySchema(db);

db.close();

import bcrypt from 'bcryptjs';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { BCRYPT_ROUNDS } from '../config.js';
import {
  DEMO_OWNER_EMAIL,
  DEMO_OWNER_PASSWORD,
  DEMO_SHOP_SLUG,
} from './seed-mahi3d-demo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendDir = resolve(__dirname, '..');
const dbPath = process.argv.find(arg => arg.startsWith('--db='))?.slice(5)
  || join(backendDir, 'data', 'rfdewi.db');

const db = new DatabaseSync(dbPath);

try {
  const shop = db.prepare('SELECT id, slug, name FROM shops WHERE slug = ?').get(DEMO_SHOP_SLUG);
  if (!shop) {
    throw new Error(`Demo shop not found for slug ${DEMO_SHOP_SLUG}`);
  }

  const hash = await bcrypt.hash(DEMO_OWNER_PASSWORD, BCRYPT_ROUNDS);
  db.prepare(`
    UPDATE shops
    SET email = ?,
        password_hash = ?,
        is_temp_password = 0,
        updated_at = ?
    WHERE id = ?
  `).run(DEMO_OWNER_EMAIL, hash, new Date().toISOString(), shop.id);

  console.log(JSON.stringify({
    ok: true,
    shop_id: shop.id,
    slug: shop.slug,
    email: DEMO_OWNER_EMAIL,
    password_reset: true,
  }, null, 2));
} finally {
  db.close();
}

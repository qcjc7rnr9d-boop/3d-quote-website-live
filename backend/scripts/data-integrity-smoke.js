import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const schemaSql = readFileSync(join(root, 'db/schema.sql'), 'utf8');
const materialsRoute = readFileSync(join(root, 'routes/materials.js'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSchemaIncludes(name) {
  assert(schemaSql.includes(name), `schema.sql is missing ${name}`);
}

assertSchemaIncludes('idx_materials_active_name_unique');
assertSchemaIncludes('idx_materials_shop_category_active_name');
assertSchemaIncludes('idx_orders_checkout_idempotency');
assertSchemaIncludes('idx_orders_shop_email_created');
assertSchemaIncludes('idx_orders_shop_created');
assertSchemaIncludes('idx_app_sessions_expires');
assert(
  materialsRoute.includes('MATERIAL_NAME_EXISTS'),
  'materials route should return a stable MATERIAL_NAME_EXISTS error for duplicate active material names'
);

const tempDir = mkdtempSync(join(tmpdir(), 'rfdewi-integrity-'));
const dbPath = join(tempDir, 'rfdewi.db');
const db = new DatabaseSync(dbPath);

try {
  db.exec(schemaSql);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');

  const insertShop = db.prepare(`
    INSERT INTO shops (name, slug, email, password_hash)
    VALUES (?, ?, ?, ?)
  `);
  const shopA = insertShop.run('Integrity A', 'integrity-a', 'integrity-a@example.test', 'hash').lastInsertRowid;
  const shopB = insertShop.run('Integrity B', 'integrity-b', 'integrity-b@example.test', 'hash').lastInsertRowid;

  const insertMaterial = db.prepare(`
    INSERT INTO materials (shop_id, name, category, active)
    VALUES (?, ?, ?, ?)
  `);
  const insertOrder = db.prepare(`
    INSERT INTO orders (shop_id, customer_email, customer_name, checkout_idempotency_key)
    VALUES (?, ?, ?, ?)
  `);

  insertMaterial.run(shopA, 'PLA Pro', 'FDM', 1);

  let duplicateBlocked = false;
  try {
    insertMaterial.run(shopA, ' pla pro ', 'FDM', 1);
  } catch (err) {
    duplicateBlocked = /UNIQUE|idx_materials_active_name_unique/i.test(String(err.message || err));
  }
  assert(duplicateBlocked, 'duplicate active material names in the same shop/category should be blocked');

  insertMaterial.run(shopA, 'PLA Pro', 'FDM', 0);
  insertMaterial.run(shopB, 'PLA Pro', 'FDM', 1);
  insertMaterial.run(shopA, 'PLA Pro', 'Archive', 1);

  insertOrder.run(shopA, 'buyer@example.test', 'Buyer', 'checkout-key-1');
  let duplicateCheckoutBlocked = false;
  try {
    insertOrder.run(shopA, 'buyer@example.test', 'Buyer', 'checkout-key-1');
  } catch (err) {
    duplicateCheckoutBlocked = /UNIQUE|idx_orders_checkout_idempotency/i.test(String(err.message || err));
  }
  assert(duplicateCheckoutBlocked, 'duplicate checkout idempotency keys in the same shop should be blocked');
  insertOrder.run(shopB, 'buyer@example.test', 'Buyer', 'checkout-key-1');
  insertOrder.run(shopA, 'buyer@example.test', 'Buyer', null);
  insertOrder.run(shopA, 'buyer@example.test', 'Buyer', null);

  const indexes = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'index'
  `).all().map(row => row.name);
  for (const expected of [
    'idx_materials_active_name_unique',
    'idx_materials_shop_category_active_name',
    'idx_orders_checkout_idempotency',
    'idx_orders_shop_email_created',
    'idx_orders_shop_created',
    'idx_app_sessions_expires',
  ]) {
    assert(indexes.includes(expected), `fresh schema did not create ${expected}`);
  }

  console.log('Data integrity smoke passed.');
} finally {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
}

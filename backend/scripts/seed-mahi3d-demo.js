import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { BCRYPT_ROUNDS } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendDir = resolve(__dirname, '..');
const defaultDbPath = join(backendDir, 'data', 'rfdewi.db');
const backupDir = join(backendDir, 'data', 'demo-backups');

export const DEMO_SHOP_SLUG = 'mahi3d';
export const DEMO_OWNER_EMAIL = 'owner@mahi3d-demo.test';
export const DEMO_OWNER_PASSWORD = 'MahiDemo!2026';
export const DEMO_CUSTOMER_EMAIL = 'alex@mahi3d-demo.test';
export const DEMO_CUSTOMER_PASSWORD = 'CustomerDemo!2026';
export const DEMO_CUSTOMER_NAME = 'Alex Morgan';

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function daysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function toSqlDatetime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function materialId(materials, key) {
  const material = materials[key];
  if (!material?.id) {
    throw new Error(`Missing active Mahi3D demo material: ${key}`);
  }
  return material.id;
}

function orderTotal(subtotal, tax, shipping) {
  return roundMoney(subtotal + tax + shipping);
}

export function assertDemoSeedAllowed({ env = process.env, argv = process.argv.slice(2) } = {}) {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo data while NODE_ENV=production.');
  }
  const allowed = env.ALLOW_MAHI3D_DEMO_SEED === '1' || argv.includes('--yes');
  if (!allowed) {
    throw new Error('Set ALLOW_MAHI3D_DEMO_SEED=1 or pass --yes to seed local demo data.');
  }
}

export function buildDemoShippingZones() {
  return [
    {
      id: 'demo-pickup',
      courier: 'Mahi3D',
      service: 'Local pickup',
      price: 0,
      recommended: false,
      active: true,
    },
    {
      id: 'demo-standard-tracked',
      courier: 'Demo Courier',
      service: 'Standard tracked',
      price: 8.5,
      recommended: true,
      active: true,
    },
    {
      id: 'demo-express-tracked',
      courier: 'Demo Courier',
      service: 'Express tracked',
      price: 14.9,
      recommended: false,
      active: true,
    },
  ];
}

export function buildDemoOrders(materials, { now = new Date() } = {}) {
  void now;
  const orders = [
    {
      customer_email: DEMO_CUSTOMER_EMAIL,
      customer_name: DEMO_CUSTOMER_NAME,
      file_name: 'Drone Camera Mount.stl',
      material_id: materialId(materials, 'PETG'),
      colour: 'Black',
      finish: 'Smooth — 0.12 mm layer height',
      quantity: 1,
      subtotal: 62.4,
      tax: 9.36,
      shipping: 8.5,
      stripe_payment_id: 'pi_demo_mahi3d_drone_mount',
      fulfilment_status: 'complete',
      payment_status: 'paid',
      tracking_number: 'M3D-DEMO-1001',
      tracking_url: 'https://example.com/tracking/M3D-DEMO-1001',
      customer_message: 'Your mount has been completed and is ready in the demo tracking view.',
      notes: 'Demo order. Dimensions: 118.4 × 65.2 × 42.0 mm. Volume: 34.6 cm³. Shipping: Standard tracked.',
      created_at: toSqlDatetime(daysAgo(27)),
    },
    {
      customer_email: DEMO_CUSTOMER_EMAIL,
      customer_name: DEMO_CUSTOMER_NAME,
      file_name: 'Desk Cable Clips.obj',
      material_id: materialId(materials, 'PLA'),
      colour: 'White',
      finish: 'Standard — 0.20 mm layer height',
      quantity: 12,
      subtotal: 38.4,
      tax: 5.76,
      shipping: 0,
      stripe_payment_id: 'pi_demo_mahi3d_cable_clips',
      fulfilment_status: 'complete',
      payment_status: 'paid',
      tracking_number: 'M3D-DEMO-1002',
      tracking_url: 'https://example.com/tracking/M3D-DEMO-1002',
      customer_message: 'Your cable clips have been completed for the demo customer portal.',
      notes: 'Demo order. Batch of 12 small clips. Dimensions: 32.0 × 18.0 × 9.5 mm each. Shipping: Local pickup.',
      created_at: toSqlDatetime(daysAgo(19)),
    },
    {
      customer_email: DEMO_CUSTOMER_EMAIL,
      customer_name: DEMO_CUSTOMER_NAME,
      file_name: 'Outdoor Sensor Housing.stl',
      material_id: materialId(materials, 'ASA'),
      colour: 'Grey',
      finish: 'Standard — 0.20 mm layer height',
      quantity: 2,
      subtotal: 145,
      tax: 21.75,
      shipping: 8.5,
      stripe_payment_id: 'pi_demo_mahi3d_sensor_housing',
      fulfilment_status: 'shipped',
      payment_status: 'paid',
      tracking_number: 'M3D-DEMO-1003',
      tracking_url: 'https://example.com/tracking/M3D-DEMO-1003',
      customer_message: 'Your demo tracking details are attached to this order.',
      notes: 'Demo order. Two-part enclosure. Dimensions: 142.0 × 88.0 × 54.5 mm. Shipping: Standard tracked.',
      created_at: toSqlDatetime(daysAgo(9)),
    },
    {
      customer_email: DEMO_CUSTOMER_EMAIL,
      customer_name: DEMO_CUSTOMER_NAME,
      file_name: 'Flexible Grip Sleeve.stl',
      material_id: materialId(materials, 'TPU'),
      colour: 'Black',
      finish: 'Standard — 0.20 mm layer height',
      quantity: 4,
      subtotal: 72,
      tax: 10.8,
      shipping: 8.5,
      stripe_payment_id: 'pi_demo_mahi3d_grip_sleeve',
      fulfilment_status: 'in_production',
      payment_status: 'paid',
      tracking_number: null,
      tracking_url: null,
      customer_message: null,
      notes: 'Demo order. Flexible grip sleeves. Dimensions: 76.0 × 34.0 × 21.0 mm each. Shipping: Standard tracked.',
      created_at: toSqlDatetime(daysAgo(4)),
    },
    {
      customer_email: DEMO_CUSTOMER_EMAIL,
      customer_name: DEMO_CUSTOMER_NAME,
      file_name: 'Nylon Gear Prototype.stl',
      material_id: materialId(materials, 'Nylon'),
      colour: 'White / Natural',
      finish: 'Standard — 0.20 mm layer height',
      quantity: 1,
      subtotal: 126.6,
      tax: 18.99,
      shipping: 14.9,
      stripe_payment_id: 'pi_demo_mahi3d_nylon_gear',
      fulfilment_status: 'processing',
      payment_status: 'paid',
      tracking_number: null,
      tracking_url: null,
      customer_message: null,
      notes: 'Demo order. Mechanical gear prototype. Dimensions: 86.0 × 86.0 × 18.5 mm. Shipping: Express tracked.',
      created_at: toSqlDatetime(daysAgo(1)),
    },
  ];

  return orders.map(order => ({
    ...order,
    total: orderTotal(order.subtotal, order.tax, order.shipping),
  }));
}

function getRows(db, sql, ...params) {
  return db.prepare(sql).all(...params);
}

function backupExistingDemoData(db, shop) {
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backupDir, `mahi3d-demo-backup-${stamp}.json`);
  const backup = {
    created_at: new Date().toISOString(),
    shop: db.prepare('SELECT * FROM shops WHERE id = ?').get(shop.id),
    store_settings: db.prepare('SELECT * FROM store_settings WHERE shop_id = ?').get(shop.id) || null,
    customer_accounts: getRows(db, 'SELECT * FROM customer_accounts WHERE shop_id = ? ORDER BY id', shop.id),
    customers: getRows(db, 'SELECT * FROM customers WHERE shop_id = ? ORDER BY id', shop.id),
    orders: getRows(db, 'SELECT * FROM orders WHERE shop_id = ? ORDER BY id', shop.id),
  };
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  return backupPath;
}

function loadRequiredMaterials(db, shopId) {
  const rows = db.prepare(`
    SELECT id, name
    FROM materials
    WHERE shop_id = ? AND active = 1
    ORDER BY sort_order, id
  `).all(shopId);

  const find = (label) => rows.find(row => row.name.toLowerCase() === label.toLowerCase())
    || rows.find(row => row.name.toLowerCase().includes(label.toLowerCase()));

  const materials = {
    PLA: find('PLA'),
    PETG: find('PETG'),
    ASA: find('ASA'),
    TPU: find('TPU'),
    Nylon: find('Nylon'),
  };

  for (const key of Object.keys(materials)) materialId(materials, key);
  return materials;
}

function resetShopDemoData(db, shopId) {
  db.prepare('DELETE FROM orders WHERE shop_id = ?').run(shopId);
  db.prepare('DELETE FROM customers WHERE shop_id = ?').run(shopId);
  db.prepare('DELETE FROM customer_accounts WHERE shop_id = ?').run(shopId);
}

function upsertStoreSettings(db, shopId) {
  db.prepare(`
    INSERT INTO store_settings (
      shop_id, tagline, about, phone, address, shipping_zones,
      support_email_mode, support_email, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(shop_id) DO UPDATE SET
      tagline = excluded.tagline,
      about = excluded.about,
      phone = excluded.phone,
      address = excluded.address,
      shipping_zones = excluded.shipping_zones,
      support_email_mode = excluded.support_email_mode,
      support_email = excluded.support_email,
      updated_at = datetime('now')
  `).run(
    shopId,
    'Instant quotes for practical 3D printed parts.',
    'Mahi3D is configured as a demo store for showing the quoting, checkout, order tracking, and customer portal flow.',
    '+64 9 887 0000',
    '12 Workshop Lane, Auckland 1010',
    JSON.stringify(buildDemoShippingZones()),
    'custom',
    'support@mahi3d-demo.test'
  );
}

function insertDemoCustomer(db, shopId, passwordHash) {
  db.prepare(`
    INSERT INTO customer_accounts (shop_id, email, name, password_hash, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(shopId, DEMO_CUSTOMER_EMAIL, DEMO_CUSTOMER_NAME, passwordHash);

  db.prepare(`
    INSERT INTO customers (shop_id, email, name, notes, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(
    shopId,
    DEMO_CUSTOMER_EMAIL,
    DEMO_CUSTOMER_NAME,
    'Demo customer account for live client walkthroughs.'
  );
}

function insertDemoOrders(db, shopId, materials) {
  const insert = db.prepare(`
    INSERT INTO orders (
      shop_id, customer_email, customer_name, file_name, material_id,
      colour, finish, quantity, subtotal, tax, shipping, total,
      stripe_payment_id, fulfilment_status, payment_status, notes,
      created_at, tracking_number, tracking_url, customer_message
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const orders = buildDemoOrders(materials);
  for (const order of orders) {
    insert.run(
      shopId,
      order.customer_email,
      order.customer_name,
      order.file_name,
      order.material_id,
      order.colour,
      order.finish,
      order.quantity,
      order.subtotal,
      order.tax,
      order.shipping,
      order.total,
      order.stripe_payment_id,
      order.fulfilment_status,
      order.payment_status,
      order.notes,
      order.created_at,
      order.tracking_number,
      order.tracking_url,
      order.customer_message
    );
  }
}

export async function seedMahi3dDemo({ dbPath = defaultDbPath } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');

  try {
    const shop = db.prepare('SELECT * FROM shops WHERE slug = ?').get(DEMO_SHOP_SLUG);
    if (!shop) throw new Error(`Shop "${DEMO_SHOP_SLUG}" was not found.`);

    const materials = loadRequiredMaterials(db, shop.id);
    const ownerHash = await bcrypt.hash(DEMO_OWNER_PASSWORD, BCRYPT_ROUNDS);
    const customerHash = await bcrypt.hash(DEMO_CUSTOMER_PASSWORD, BCRYPT_ROUNDS);
    const backupPath = backupExistingDemoData(db, shop);

    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`
        UPDATE shops SET
          name = ?,
          email = ?,
          password_hash = ?,
          is_temp_password = 0,
          plan = 'pro',
          stripe_account_id = NULL,
          stripe_secret_key = NULL,
          stripe_client_id = NULL,
          stripe_publishable_key = NULL,
          stripe_charges_enabled = 0,
          stripe_payouts_enabled = 0,
          stripe_details_submitted = 0,
          updated_at = datetime('now')
        WHERE id = ?
      `).run('Mahi3D', DEMO_OWNER_EMAIL, ownerHash, shop.id);

      resetShopDemoData(db, shop.id);
      upsertStoreSettings(db, shop.id);
      insertDemoCustomer(db, shop.id, customerHash);
      insertDemoOrders(db, shop.id, materials);

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const metrics = db.prepare(`
      SELECT
        COUNT(*) as order_count,
        SUM(CASE WHEN payment_status = 'paid' THEN total ELSE 0 END) as paid_total,
        SUM(CASE WHEN fulfilment_status = 'complete' THEN 1 ELSE 0 END) as delivered_count,
        SUM(CASE WHEN fulfilment_status NOT IN ('complete','cancelled') THEN 1 ELSE 0 END) as active_count
      FROM orders
      WHERE shop_id = ?
    `).get(shop.id);

    return {
      ok: true,
      backupPath,
      shopSlug: DEMO_SHOP_SLUG,
      ownerEmail: DEMO_OWNER_EMAIL,
      ownerPassword: DEMO_OWNER_PASSWORD,
      customerEmail: DEMO_CUSTOMER_EMAIL,
      customerPassword: DEMO_CUSTOMER_PASSWORD,
      orderCount: metrics.order_count || 0,
      deliveredCount: metrics.delivered_count || 0,
      activeCount: metrics.active_count || 0,
      paidTotal: roundMoney(metrics.paid_total || 0),
    };
  } finally {
    db.close();
  }
}

async function main() {
  assertDemoSeedAllowed();
  const result = await seedMahi3dDemo();
  console.log('Mahi3D demo seed complete.');
  console.log(`Backup: ${result.backupPath}`);
  console.log(`Shop admin: ${result.ownerEmail} / ${result.ownerPassword}`);
  console.log(`Customer: ${result.customerEmail} / ${result.customerPassword}`);
  console.log(`Orders: ${result.orderCount} (${result.deliveredCount} delivered, ${result.activeCount} active)`);
  console.log(`Paid total: $${result.paidTotal.toFixed(2)} NZD`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}

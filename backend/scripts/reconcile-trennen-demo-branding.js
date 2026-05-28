import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { DEMO_SHOP_SLUG, LEGACY_DEMO_SHOP_SLUG } from '../lib/shop-lookup.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const backendDir = resolve(__dirname, '..');
const defaultDbPath = join(backendDir, 'data', 'rfdewi.db');

const DEMO_NAME = 'Trennen';
const DEMO_OWNER_EMAIL = 'owner@trennen-demo.test';
const DEMO_TAGLINE = 'Instant quotes for practical 3D printed parts.';
const DEMO_ABOUT = 'Trennen is configured as a demo store for showing the quoting, checkout, order tracking, and customer portal flow.';
const DEMO_SUPPORT_EMAIL = 'support@trennen.co.nz';

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function backupDatabase(dbPath) {
  const backupDir = join(dirname(dbPath), 'backups');
  mkdirSync(backupDir, { recursive: true });
  const backupPath = join(backupDir, `rfdewi-before-trennen-branding-${timestamp()}.db`);
  copyFileSync(dbPath, backupPath);
  return backupPath;
}

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
}

function ensureStoreSettingsColumns(db) {
  const columns = [
    ['tagline', 'TEXT'],
    ['about', 'TEXT'],
    ['phone', 'TEXT'],
    ['address', 'TEXT'],
    ['support_email_mode', "TEXT NOT NULL DEFAULT 'signup'"],
    ['support_email', 'TEXT'],
    ['logo_url', 'TEXT'],
  ];
  for (const [name, definition] of columns) {
    if (!hasColumn(db, 'store_settings', name)) {
      db.exec(`ALTER TABLE store_settings ADD COLUMN ${name} ${definition}`);
    }
  }
}

function loadDemoRows(db) {
  return db.prepare(`
    SELECT *
    FROM shops
    WHERE lower(slug) IN (?, ?)
    ORDER BY CASE lower(slug) WHEN ? THEN 0 ELSE 1 END, id
  `).all(DEMO_SHOP_SLUG, LEGACY_DEMO_SHOP_SLUG, DEMO_SHOP_SLUG);
}

function reconcileTrennenDemoBranding({ dbPath = defaultDbPath } = {}) {
  const backupPath = backupDatabase(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');

  try {
    ensureStoreSettingsColumns(db);
    const rows = loadDemoRows(db);
    if (!rows.length) {
      throw new Error(`No demo shop found for slug "${DEMO_SHOP_SLUG}" or "${LEGACY_DEMO_SHOP_SLUG}"`);
    }

    const canonical = rows.find(row => String(row.slug).toLowerCase() === DEMO_SHOP_SLUG);
    const target = canonical || rows[0];
    const duplicateLegacyRows = rows.filter(row => (
      row.id !== target.id &&
      String(row.slug).toLowerCase() === LEGACY_DEMO_SHOP_SLUG
    ));

    db.exec('BEGIN IMMEDIATE');
    try {
      for (const duplicate of duplicateLegacyRows) {
        db.prepare(`
          UPDATE shops
          SET slug = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(`${LEGACY_DEMO_SHOP_SLUG}-legacy-${duplicate.id}`, duplicate.id);
      }

      db.prepare(`
        UPDATE shops
        SET name = ?,
            slug = ?,
            email = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(DEMO_NAME, DEMO_SHOP_SLUG, DEMO_OWNER_EMAIL, target.id);

      db.prepare('INSERT OR IGNORE INTO store_settings (shop_id) VALUES (?)').run(target.id);
      db.prepare(`
        UPDATE store_settings
        SET tagline = ?,
            about = ?,
            support_email_mode = 'custom',
            support_email = ?,
            logo_url = NULL,
            updated_at = datetime('now')
        WHERE shop_id = ?
      `).run(DEMO_TAGLINE, DEMO_ABOUT, DEMO_SUPPORT_EMAIL, target.id);

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const shop = db.prepare('SELECT id, name, slug, email FROM shops WHERE id = ?').get(target.id);
    const settings = db.prepare(`
      SELECT tagline, about, support_email_mode, support_email, logo_url
      FROM store_settings
      WHERE shop_id = ?
    `).get(target.id);

    return {
      backupPath,
      shop,
      settings,
      duplicateLegacyRowsRenamed: duplicateLegacyRows.length,
    };
  } finally {
    db.close();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  const result = reconcileTrennenDemoBranding();
  console.log(JSON.stringify(result, null, 2));
}

export { reconcileTrennenDemoBranding };

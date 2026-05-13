import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Singleton DB connection shared across all routes
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');

export { db };

/**
 * Require an authenticated shop session.
 * Sets req.shop on success.
 */
export function requireShopAuth(req, res, next) {
  const shopId = req.session && req.session.shopId;
  if (!shopId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId);
  if (!shop) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  req.shop = shop;
  next();
}

/**
 * Require an authenticated platform admin session.
 */
export function requirePlatformAuth(req, res, next) {
  if (!req.session || !req.session.platformAdmin) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

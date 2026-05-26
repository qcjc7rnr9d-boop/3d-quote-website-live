import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Singleton DB connection shared across all routes
const db = new DatabaseSync(join(__dirname, '../data/rfdewi.db'));
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA busy_timeout = 5000');

const SAFE_IMPERSONATION_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export { db };

export function platformImpersonationFor(req) {
  const session = req.session || {};
  const details = session.platformImpersonation;
  if (!session.platformAdmin || !session.shopId || !details?.active) {
    return { active: false };
  }
  return {
    active: true,
    shop_id: Number(session.shopId),
    platform_admin_id: details.platformAdminId || session.platformAdminId || null,
    started_at: details.startedAt || null,
  };
}

export function blockPlatformImpersonation(req, res, next) {
  if (platformImpersonationFor(req).active) {
    return res.status(403).json({
      error: 'This action is unavailable during platform support impersonation.',
      code: 'PLATFORM_IMPERSONATION_RESTRICTED',
    });
  }
  next();
}

/**
 * Require an authenticated shop session.
 * Sets req.shop on success.
 */
export function requireShopAuth(req, res, next) {
  const shopId = req.session && req.session.shopId;
  if (!shopId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const shop = db.prepare("SELECT * FROM shops WHERE id = ? AND plan != 'suspended'").get(shopId);
  if (!shop) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  req.shop = shop;
  req.platformImpersonation = platformImpersonationFor(req);
  if (req.platformImpersonation.active && !SAFE_IMPERSONATION_METHODS.has(req.method)) {
    return res.status(403).json({
      error: 'This action is unavailable during platform support impersonation.',
      code: 'PLATFORM_IMPERSONATION_RESTRICTED',
    });
  }
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

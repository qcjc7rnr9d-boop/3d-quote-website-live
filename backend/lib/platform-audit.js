import { db } from '../middleware/auth.js';

export function ensurePlatformAuditTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform_admin_id INTEGER,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      shop_id INTEGER,
      ip TEXT,
      user_agent TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_platform_audit_created
      ON platform_audit_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_platform_audit_shop
      ON platform_audit_events(shop_id);
    CREATE INDEX IF NOT EXISTS idx_platform_audit_action
      ON platform_audit_events(action);
  `);
}

export function logPlatformAudit(req, {
  action,
  targetType = null,
  targetId = null,
  shopId = null,
  metadata = {},
}) {
  try {
    ensurePlatformAuditTable();
    db.prepare(`
      INSERT INTO platform_audit_events
        (platform_admin_id, action, target_type, target_id, shop_id, ip, user_agent, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.session?.platformAdminId || null,
      action,
      targetType,
      targetId == null ? null : String(targetId),
      shopId,
      req.ip || null,
      req.get('user-agent') || null,
      JSON.stringify(metadata || {})
    );
  } catch (err) {
    console.error('Platform audit log error:', err);
  }
}

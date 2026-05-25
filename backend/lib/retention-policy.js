import { ensureLegalComplianceSchema } from './legal-policy.js';

export const RETENTION_POLICY = Object.freeze({
  resetTokensDays: 7,
  expiredSessionsDays: 30,
  savedQuotePayloadDays: 30,
  routineEmailEventDays: 180,
});

function sqlDatetime(date = new Date()) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function daysBefore(now, days) {
  return sqlDatetime(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
}

function count(db, sql, ...params) {
  return db.prepare(sql).get(...params).count || 0;
}

export function runRetentionCleanup(db, { now = new Date(), dryRun = true } = {}) {
  ensureLegalComplianceSchema(db);
  const resetCutoff = daysBefore(now, RETENTION_POLICY.resetTokensDays);
  const sessionCutoff = daysBefore(now, RETENTION_POLICY.expiredSessionsDays);
  const quoteCutoff = daysBefore(now, RETENTION_POLICY.savedQuotePayloadDays);
  const emailCutoff = daysBefore(now, RETENTION_POLICY.routineEmailEventDays);

  const counts = {
    customer_reset_tokens: count(db, `
      SELECT COUNT(*) AS count
      FROM customer_reset_tokens
      WHERE expires_at <= ?
         OR (used = 1 AND created_at <= ?)
    `, resetCutoff, resetCutoff),
    shop_reset_tokens: count(db, `
      SELECT COUNT(*) AS count
      FROM reset_tokens
      WHERE expires_at <= ? OR used = 1
    `, resetCutoff),
    platform_reset_tokens: count(db, `
      SELECT COUNT(*) AS count
      FROM platform_reset_tokens
      WHERE expires_at <= ?
         OR (used = 1 AND created_at <= ?)
    `, resetCutoff, resetCutoff),
    sessions: count(db, `
      SELECT COUNT(*) AS count
      FROM sessions
      WHERE expires_at <= ?
    `, sessionCutoff),
    app_sessions: count(db, `
      SELECT COUNT(*) AS count
      FROM app_sessions
      WHERE expires_at <= ?
    `, now.getTime()),
    saved_quotes_purged: count(db, `
      SELECT COUNT(*) AS count
      FROM customer_saved_quotes
      WHERE status != 'purged'
        AND (
          (status = 'deleted' AND updated_at <= ?)
          OR (expires_at <= ?)
        )
    `, quoteCutoff, quoteCutoff),
    email_delivery_events: count(db, `
      SELECT COUNT(*) AS count
      FROM email_delivery_events
      WHERE created_at <= ?
        AND COALESCE(status, '') NOT IN ('bounced', 'complained')
        AND complained_at IS NULL
        AND bounced_at IS NULL
    `, emailCutoff),
  };

  const summary = {
    dryRun: !!dryRun,
    policy: RETENTION_POLICY,
    cutoffs: {
      reset_tokens: resetCutoff,
      sessions: sessionCutoff,
      saved_quotes: quoteCutoff,
      routine_email_events: emailCutoff,
    },
    counts,
  };

  if (dryRun) return summary;

  const startedAt = sqlDatetime(now);
  let appliedSummary;
  db.exec('BEGIN');
  try {
    db.prepare(`
      DELETE FROM customer_reset_tokens
      WHERE expires_at <= ?
         OR (used = 1 AND created_at <= ?)
    `).run(resetCutoff, resetCutoff);
    db.prepare(`
      DELETE FROM reset_tokens
      WHERE expires_at <= ? OR used = 1
    `).run(resetCutoff);
    db.prepare(`
      DELETE FROM platform_reset_tokens
      WHERE expires_at <= ?
         OR (used = 1 AND created_at <= ?)
    `).run(resetCutoff, resetCutoff);
    db.prepare(`
      DELETE FROM sessions
      WHERE expires_at <= ?
    `).run(sessionCutoff);
    db.prepare(`
      DELETE FROM app_sessions
      WHERE expires_at <= ?
    `).run(now.getTime());
    db.prepare(`
      UPDATE customer_saved_quotes
      SET status = 'purged',
          quote_request = '{}',
          quote_snapshot = '{}',
          file_meta = '{}',
          selection = '{}',
          updated_at = ?
      WHERE status != 'purged'
        AND (
          (status = 'deleted' AND updated_at <= ?)
          OR (expires_at <= ?)
        )
    `).run(startedAt, quoteCutoff, quoteCutoff);
    db.prepare(`
      DELETE FROM email_delivery_events
      WHERE created_at <= ?
        AND COALESCE(status, '') NOT IN ('bounced', 'complained')
        AND complained_at IS NULL
        AND bounced_at IS NULL
    `).run(emailCutoff);

    const finishedAt = sqlDatetime();
    appliedSummary = { ...summary, dryRun: false, finished_at: finishedAt };
    db.prepare(`
      INSERT INTO retention_cleanup_runs (dry_run, started_at, finished_at, summary_json)
      VALUES (0, ?, ?, ?)
    `).run(startedAt, finishedAt, JSON.stringify(appliedSummary));
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    throw err;
  }

  return appliedSummary;
}

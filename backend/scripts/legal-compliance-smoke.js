import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  LEGAL_POLICY_VERSIONS,
  ensureLegalComplianceSchema,
  getMerchantLegalStatus,
  recordMerchantLegalAcceptance,
} from '../lib/legal-policy.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
}

const dir = mkdtempSync(join(tmpdir(), 'trennen-legal-compliance-'));
const dbPath = join(dir, 'rfdewi.db');
const db = new DatabaseSync(dbPath);

try {
  db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  ensureLegalComplianceSchema(db);

  assert(tableExists(db, 'legal_acceptances'), 'legal_acceptances table must exist');
  assert(tableExists(db, 'privacy_requests'), 'privacy_requests table must exist');
  assert(tableExists(db, 'retention_cleanup_runs'), 'retention_cleanup_runs table must exist');
  for (const column of ['agreement_type', 'version', 'accepted_at', 'ip_address', 'user_agent', 'metadata_json']) {
    assert(columns(db, 'legal_acceptances').includes(column), `legal_acceptances.${column} must exist`);
  }

  const shopId = db.prepare(`
    INSERT INTO shops (name, slug, email, password_hash, is_temp_password, plan)
    VALUES ('Legal Smoke Shop', 'legal-smoke', 'legal-smoke@example.test', 'hash', 0, 'starter')
  `).run().lastInsertRowid;

  const before = getMerchantLegalStatus(db, shopId, new Date('2026-05-26T00:00:00.000Z'));
  assert(before.required === true, 'merchant agreement should be required before acceptance');
  assert(before.accepted === false, 'merchant agreement should not be accepted before recording acceptance');
  assert(before.version === LEGAL_POLICY_VERSIONS.merchantAgreement, 'merchant status must report current agreement version');
  const expiredGrace = getMerchantLegalStatus(db, shopId, new Date('2026-06-02T00:00:00.000Z'));
  assert(expiredGrace.checkout_blocked === true, 'merchant checkout should be blocked after the grace period without acceptance');

  recordMerchantLegalAcceptance(db, {
    shopId,
    userEmail: 'owner@example.test',
    ipAddress: '203.0.113.10',
    userAgent: 'LegalSmoke/1.0',
    metadata: { source: 'smoke' },
  });

  const after = getMerchantLegalStatus(db, shopId, new Date('2026-05-26T00:00:00.000Z'));
  assert(after.accepted === true, 'merchant agreement should be accepted after recording acceptance');
  assert(after.accepted_at, 'merchant acceptance must include accepted_at');
  assert(after.grace_days_remaining === null, 'accepted merchant should not report remaining grace period');

  const row = db.prepare('SELECT * FROM legal_acceptances WHERE shop_id = ?').get(shopId);
  assert(row.version === LEGAL_POLICY_VERSIONS.merchantAgreement, 'stored merchant acceptance version mismatch');
  assert(row.ip_address === '203.0.113.10', 'merchant acceptance must store IP address');
  assert(row.user_agent === 'LegalSmoke/1.0', 'merchant acceptance must store user agent');

  console.log('Legal compliance smoke checks passed.');
} finally {
  db.close();
  rmSync(dir, { recursive: true, force: true });
}

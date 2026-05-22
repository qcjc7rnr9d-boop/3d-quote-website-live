import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runProductionReadinessCheck, formatProductionReadinessReport } from './production-readiness-check.js';

function createReadyDb() {
  const dir = mkdtempSync(join(tmpdir(), 'trennen-prod-check-'));
  const dbPath = join(dir, 'rfdewi.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE shops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE
    );
    CREATE TABLE sales_demo_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      company TEXT NOT NULL,
      monthly_quote_volume TEXT NOT NULL,
      message TEXT NOT NULL,
      delivery_status TEXT NOT NULL DEFAULT 'not_configured',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO shops (slug) VALUES ('mahi3d');
  `);
  db.close();
  return { dir, dbPath };
}

const readyEnv = {
  NODE_ENV: 'production',
  BASE_URL: 'https://trennen.co.nz',
  PORT: '3001',
  SESSION_SECRET: 'session-secret-with-more-than-thirty-two-characters',
  JWT_SECRET: 'jwt-secret-with-more-than-thirty-two-characters',
  PLATFORM_CONFIG_ENCRYPTION_KEY: 'encryption-key-with-more-than-thirty-two-characters',
  PLATFORM_DOMAIN: 'trennen.co.nz',
  RESEND_API_KEY: 're_secret_value_must_never_be_printed',
  EMAIL_FROM: 'Trennen <hello@trennen.co.nz>',
  SALES_DEMO_TO: 'hello@trennen.co.nz',
  STRIPE_SECRET_KEY: 'sk_live_secret_value_must_never_be_printed',
  STRIPE_PUBLISHABLE_KEY: 'pk_live_secret_value_must_never_be_printed',
  STRIPE_CLIENT_ID: 'ca_live_client_id_must_never_be_printed',
  STRIPE_WEBHOOK_SECRET: 'whsec_secret_value_must_never_be_printed',
  STRIPE_BILLING_STARTER_PRICE_ID: 'price_live_starter_value_must_never_be_printed',
  STRIPE_BILLING_GROWTH_PRICE_ID: 'price_live_growth_value_must_never_be_printed',
  STRIPE_BILLING_SCALE_PRICE_ID: 'price_live_scale_value_must_never_be_printed',
  SHOPIFY_API_KEY: 'shopify_key',
  SHOPIFY_API_SECRET: 'shopify_secret',
  SHOPIFY_FILE_STORAGE: 's3',
  SHOPIFY_S3_BUCKET: 'trennen-uploads',
  SHOPIFY_S3_ACCESS_KEY_ID: 'access_key',
  SHOPIFY_S3_SECRET_ACCESS_KEY: 'secret_key',
};

{
  const result = await runProductionReadinessCheck({
    env: { NODE_ENV: 'production', BASE_URL: 'http://localhost:3001' },
    dbPath: '/tmp/does-not-exist-rfdewi.db',
  });
  assert.equal(result.ok, false, 'unsafe production config should fail');
  assert(result.errors.some(error => /BASE_URL must use https/i.test(error)));
  assert(result.errors.some(error => /SESSION_SECRET/i.test(error)));
  assert(result.errors.some(error => /STRIPE_BILLING_STARTER_PRICE_ID/i.test(error)));
}

{
  const { dir, dbPath } = createReadyDb();
  try {
    const result = await runProductionReadinessCheck({ env: readyEnv, dbPath });
    assert.equal(result.ok, true, result.errors.join('\n'));
    assert(result.checks.some(check => check.includes('sales_demo_requests')));
    assert(result.checks.some(check => check.includes('mahi3d')));
    const report = formatProductionReadinessReport(result);
    assert(!report.includes(readyEnv.RESEND_API_KEY), 'report must not print RESEND_API_KEY');
    assert(!report.includes(readyEnv.STRIPE_SECRET_KEY), 'report must not print Stripe secret');
    assert(!report.includes(readyEnv.STRIPE_BILLING_STARTER_PRICE_ID), 'report must not print Stripe Billing price IDs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const { dir, dbPath } = createReadyDb();
  try {
    const result = await runProductionReadinessCheck({
      env: { ...readyEnv, SHOPIFY_FILE_STORAGE: 'local' },
      dbPath,
    });
    assert.equal(result.ok, false, 'production Shopify local storage should fail');
    assert(result.errors.some(error => /SHOPIFY_FILE_STORAGE=s3/i.test(error)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log('Production readiness smoke checks passed.');

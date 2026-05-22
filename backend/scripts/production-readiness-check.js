import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendDir = join(__dirname, '..');
const defaultDbPath = join(backendDir, 'data', 'rfdewi.db');

function value(env, name) {
  return String(env[name] || '').trim();
}

function hasValue(env, name) {
  return value(env, name).length > 0;
}

function isUnsafePlaceholder(raw) {
  const text = String(raw || '').trim().toLowerCase();
  if (!text) return true;
  return [
    '...',
    'replace_',
    'yourdomain.com',
    'set_a_strong_password_here',
    'dev-secret-change-me',
    'dev-jwt-secret',
    'xxxxxxxx',
  ].some(marker => text.includes(marker));
}

function hasStrongSecret(env, name) {
  const secret = value(env, name);
  return secret.length >= 32 && !isUnsafePlaceholder(secret);
}

function checkHttpsBaseUrl(env, errors, checks) {
  const baseUrl = value(env, 'BASE_URL');
  if (!baseUrl) {
    errors.push('BASE_URL is required.');
    return;
  }
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    errors.push('BASE_URL must be a valid absolute URL.');
    return;
  }
  if (parsed.protocol !== 'https:') {
    errors.push('BASE_URL must use https in production.');
  }
  if (['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
    errors.push('BASE_URL must not point at localhost in production.');
  }
  checks.push(`BASE_URL configured for ${parsed.hostname}`);
}

function checkEmail(env, errors, warnings, checks) {
  const hasResend = hasValue(env, 'RESEND_API_KEY');
  const hasSmtp = hasValue(env, 'SMTP_HOST');
  if (!hasResend && !hasSmtp) {
    errors.push('Configure RESEND_API_KEY or SMTP_HOST so production mail does not use dev/Ethereal mode.');
  } else {
    checks.push(`Email provider configured: ${hasResend ? 'Resend' : 'SMTP'}`);
  }

  if (!hasValue(env, 'EMAIL_FROM')) {
    errors.push('EMAIL_FROM is required for production email.');
  } else if (!/@trennen\.co\.nz\b/i.test(value(env, 'EMAIL_FROM'))) {
    warnings.push('EMAIL_FROM does not use the trennen.co.nz domain.');
  } else {
    checks.push('EMAIL_FROM uses the Trennen domain');
  }

  if (!hasValue(env, 'SALES_DEMO_TO')) {
    errors.push('SALES_DEMO_TO is required so homepage demo requests are delivered.');
  } else {
    checks.push('Sales demo lead recipient configured');
  }
}

function checkStripe(env, errors, warnings, checks) {
  for (const name of ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_CLIENT_ID', 'STRIPE_WEBHOOK_SECRET']) {
    if (!hasValue(env, name) || isUnsafePlaceholder(value(env, name))) {
      errors.push(`${name} is required for production payments.`);
    }
  }
  for (const name of ['STRIPE_BILLING_STARTER_PRICE_ID', 'STRIPE_BILLING_GROWTH_PRICE_ID', 'STRIPE_BILLING_SCALE_PRICE_ID']) {
    if (!hasValue(env, name) || isUnsafePlaceholder(value(env, name))) {
      errors.push(`${name} is required for Stripe-hosted Trennen subscriptions.`);
    }
  }

  if (value(env, 'STRIPE_SECRET_KEY').startsWith('sk_test_')) {
    warnings.push('STRIPE_SECRET_KEY is a test-mode key. Keep this only for staging.');
  }
  if (value(env, 'STRIPE_PUBLISHABLE_KEY').startsWith('pk_test_')) {
    warnings.push('STRIPE_PUBLISHABLE_KEY is a test-mode key. Keep this only for staging.');
  }
  if (hasValue(env, 'STRIPE_SECRET_KEY') && hasValue(env, 'STRIPE_PUBLISHABLE_KEY') && hasValue(env, 'STRIPE_WEBHOOK_SECRET')) {
    checks.push('Stripe platform keys and webhook secret are present');
  }
  if (['STRIPE_BILLING_STARTER_PRICE_ID', 'STRIPE_BILLING_GROWTH_PRICE_ID', 'STRIPE_BILLING_SCALE_PRICE_ID'].every(name => hasValue(env, name) && !isUnsafePlaceholder(value(env, name)))) {
    checks.push('Stripe Billing price IDs are present for Starter, Growth, and Scale');
  }
}

function checkShopifyStorage(env, errors, checks) {
  const shopifyConfigured = [
    'SHOPIFY_API_KEY',
    'SHOPIFY_API_SECRET',
    'SHOPIFY_FILE_STORAGE',
  ].some(name => hasValue(env, name));
  if (!shopifyConfigured) return;

  for (const name of ['SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET']) {
    if (hasValue(env, name) && isUnsafePlaceholder(value(env, name))) {
      errors.push(`${name} must be replaced before enabling Shopify in production.`);
    }
  }

  if (value(env, 'SHOPIFY_FILE_STORAGE') !== 's3') {
    errors.push('SHOPIFY_FILE_STORAGE=s3 is required when Shopify is configured in production.');
    return;
  }
  for (const name of ['SHOPIFY_S3_BUCKET', 'SHOPIFY_S3_ACCESS_KEY_ID', 'SHOPIFY_S3_SECRET_ACCESS_KEY']) {
    if (!hasValue(env, name) || isUnsafePlaceholder(value(env, name))) {
      errors.push(`${name} is required for Shopify production file storage.`);
    }
  }
  checks.push('Shopify file storage is configured for S3-compatible storage');
}

async function checkSqlite(dbPath, errors, checks) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
    checks.push(`Node ${process.versions.node} supports node:sqlite`);
  } catch {
    errors.push('Node runtime must support node:sqlite. Use Node 26.x for this deployment.');
    return;
  }

  if (!existsSync(dbPath)) {
    errors.push(`SQLite database not found at ${dbPath}. Run npm run migrate and seed/restore required data.`);
    return;
  }

  let db;
  try {
    db = new DatabaseSync(dbPath);
    for (const table of ['shops', 'sales_demo_requests']) {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      if (!row) errors.push(`Required SQLite table is missing: ${table}`);
      else checks.push(`SQLite table exists: ${table}`);
    }
    const demoShop = db.prepare("SELECT id FROM shops WHERE slug = 'mahi3d'").get();
    if (!demoShop) errors.push("Demo shop 'mahi3d' is missing; View demo will not work.");
    else checks.push("Demo shop exists: mahi3d");
  } catch (err) {
    errors.push(`SQLite readiness check failed: ${err.message}`);
  } finally {
    if (db) db.close();
  }
}

export async function runProductionReadinessCheck({ env = process.env, dbPath = defaultDbPath } = {}) {
  const errors = [];
  const warnings = [];
  const checks = [];

  if (value(env, 'NODE_ENV') !== 'production') {
    errors.push('NODE_ENV must be production.');
  } else {
    checks.push('NODE_ENV=production');
  }

  checkHttpsBaseUrl(env, errors, checks);

  const port = Number(value(env, 'PORT'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('PORT must be a valid TCP port.');
  } else {
    checks.push(`PORT configured (${port})`);
  }

  for (const name of ['SESSION_SECRET', 'JWT_SECRET', 'PLATFORM_CONFIG_ENCRYPTION_KEY']) {
    if (!hasStrongSecret(env, name)) {
      errors.push(`${name} must be set to a non-placeholder value with at least 32 characters.`);
    } else {
      checks.push(`${name} is set`);
    }
  }

  if (!hasValue(env, 'PLATFORM_DOMAIN')) {
    warnings.push('PLATFORM_DOMAIN is not set; emails will fall back to trennen.co.nz.');
  } else {
    checks.push('PLATFORM_DOMAIN configured');
  }

  checkEmail(env, errors, warnings, checks);
  checkStripe(env, errors, warnings, checks);
  checkShopifyStorage(env, errors, checks);
  await checkSqlite(dbPath, errors, checks);

  return { ok: errors.length === 0, errors, warnings, checks };
}

export function formatProductionReadinessReport(result) {
  const lines = ['Trennen production readiness check'];
  lines.push(result.ok ? 'Status: PASS' : 'Status: FAIL');
  if (result.checks.length) {
    lines.push('', 'Checks:');
    result.checks.forEach(check => lines.push(`  OK ${check}`));
  }
  if (result.warnings.length) {
    lines.push('', 'Warnings:');
    result.warnings.forEach(warning => lines.push(`  - ${warning}`));
  }
  if (result.errors.length) {
    lines.push('', 'Errors:');
    result.errors.forEach(error => lines.push(`  - ${error}`));
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  dotenv.config({ path: join(backendDir, '.env') });
  const result = await runProductionReadinessCheck();
  process.stdout.write(formatProductionReadinessReport(result));
  process.exitCode = result.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

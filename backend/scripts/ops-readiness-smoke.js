import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '../..');
const backend = resolve(root, 'backend');

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function assertNoSecretLikeValue(label, text) {
  assert.doesNotMatch(text, /\b(re|sk|pk|whsec|ca)_(live|test|[A-Za-z0-9])[A-Za-z0-9_]{12,}\b/, `${label} should not contain secret-like values`);
}

function assertOperationalDocs() {
  const envExample = read('backend/.env.example');
  assert.match(envExample, /PORT=3001/, '.env.example should pin the Node port used by Nginx');
  assert.match(envExample, /TRUST_PROXY=1/, '.env.example should include TRUST_PROXY=1 for Nginx');
  assert.match(envExample, /APP_EMAIL_DOMAIN=mail\.trennen\.co\.nz/, '.env.example should use Trennen email domain');
  assert.match(envExample, /APP_EMAIL_FALLBACK=["']?Trennen <hello@mail\.trennen\.co\.nz>["']?/, '.env.example should use Trennen fallback sender');
  assert.match(envExample, /DATABASE_URL=/, '.env.example should reserve DATABASE_URL for RDS/PostgreSQL');
  assert.match(envExample, /STORAGE_DRIVER=local/, '.env.example should document current local upload storage');
  assert.match(envExample, /S3_UPLOADS_BUCKET=/, '.env.example should reserve S3 uploads bucket config');
  assert.match(envExample, /SECRETS_MANAGER_PREFIX=/, '.env.example should reserve Secrets Manager prefix');
  assertNoSecretLikeValue('backend/.env.example', envExample);

  const runbook = read('docs/deployment/staged-saas-launch.md');
  for (const expected of [
    'npm run env:audit',
    'npm run production-health:smoke',
    'curl http://127.0.0.1:3001/api/health',
    'curl http://127.0.0.1/api/health',
    '502 Bad Gateway',
    'TRUST_PROXY=1',
    'backend/data/rfdewi.db',
    'pm2 save',
    'App Runner',
    'RDS PostgreSQL',
    'S3',
    'AWS Secrets Manager',
  ]) {
    assert.match(runbook, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `deployment runbook should mention ${expected}`);
  }
  assertNoSecretLikeValue('docs/deployment/staged-saas-launch.md', runbook);
}

function assertOperationalScripts() {
  const packageJson = JSON.parse(read('backend/package.json'));
  assert.equal(packageJson.scripts['env:audit'], 'node scripts/env-audit.js');
  assert.equal(packageJson.scripts['production-health:smoke'], 'node scripts/production-health-smoke.js');
  assert.equal(packageJson.scripts['ops:smoke'], 'node scripts/ops-readiness-smoke.js');
  assert.ok(packageJson.scripts['qa:full'].includes('npm run ops:smoke'), 'qa:full should include ops:smoke');
  assert.ok(existsSync(resolve(backend, 'scripts/env-audit.js')), 'env-audit script should exist');
  assert.ok(existsSync(resolve(backend, 'scripts/production-health-smoke.js')), 'production-health smoke script should exist');
}

async function waitForHealth(base) {
  const deadline = Date.now() + 10_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return res;
    } catch (err) {
      lastError = err;
    }
    await delay(150);
  }
  throw new Error(`Server did not become healthy: ${lastError?.message || 'no response'}`);
}

async function assertHealthReadiness() {
  const port = 4690 + Math.floor(Math.random() * 200);
  const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: backend,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      BASE_URL: base,
      TRUST_PROXY: '1',
      SESSION_SECRET: 'ops-readiness-session-secret',
      JWT_SECRET: 'ops-readiness-jwt-secret',
      PLATFORM_CONFIG_ENCRYPTION_KEY: 'ops-readiness-platform-secret',
      APP_EMAIL_DOMAIN: 'mail.trennen.co.nz',
      APP_EMAIL_FALLBACK: 'Trennen <hello@mail.trennen.co.nz>',
      RESEND_API_KEY: 'ops-readiness-resend-key-present',
      RESEND_WEBHOOK_SECRET: `whsec_${Buffer.from('ops-readiness-webhook-secret').toString('base64')}`,
      STRIPE_SECRET_KEY: '',
      STRIPE_PUBLISHABLE_KEY: '',
      STRIPE_CLIENT_ID: '',
      STRIPE_WEBHOOK_SECRET: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  server.stdout.on('data', chunk => { output += chunk.toString(); });
  server.stderr.on('data', chunk => { output += chunk.toString(); });

  try {
    const res = await waitForHealth(base);
    const health = await res.json();
    assert.equal(health.ok, true);
    assert.equal(health.database.engine, 'sqlite');
    assert.equal(health.database.status, 'ok');
    assert.equal(health.storage.uploads.mode, 'local');
    assert.equal(health.readiness.email.provider, 'resend');
    assert.equal(health.readiness.email.configured, true);
    assert.equal(health.readiness.email.domain, 'mail.trennen.co.nz');
    assert.equal(health.readiness.payments.stripeConfigured, false);
    assert.equal(health.readiness.proxy.trustProxy, true);
    assert.equal(health.readiness.secrets.platformEncryptionConfigured, true);
    assert.equal(typeof health.uptime_seconds, 'number');
  } finally {
    server.kill('SIGTERM');
  }

  assert.doesNotMatch(output, /ops-readiness-resend-key-present/, 'server output should not print API keys');
}

assertOperationalDocs();
assertOperationalScripts();
await assertHealthReadiness();

console.log('Ops readiness smoke checks passed.');

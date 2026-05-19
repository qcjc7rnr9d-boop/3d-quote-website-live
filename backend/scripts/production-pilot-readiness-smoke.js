import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function assertNoSecretLikeValue(label, text) {
  assert.doesNotMatch(
    text,
    /\b(re|sk|pk|whsec|ca)_(live|test|[A-Za-z0-9])[A-Za-z0-9_]{12,}\b/,
    `${label} should not contain real-looking API keys or webhook secrets`,
  );
}

const packageJson = JSON.parse(read('backend/package.json'));
assert.equal(
  packageJson.scripts['env:audit:pilot'],
  'node scripts/env-audit.js --pilot',
  'backend/package.json should expose a pilot env audit script',
);
assert.equal(
  packageJson.scripts['production-pilot:smoke'],
  'node scripts/production-pilot-readiness-smoke.js',
  'backend/package.json should expose a production pilot readiness smoke script',
);
assert.ok(
  packageJson.scripts['qa:full'].includes('npm run production-pilot:smoke'),
  'qa:full should include production-pilot:smoke',
);

const envAudit = read('backend/scripts/env-audit.js');
assert.match(envAudit, /--pilot/, 'env-audit should support a stricter pilot profile');
assert.match(envAudit, /https:\/\/app\.trennen\.co\.nz/, 'pilot env audit should know the production app URL');
assert.match(envAudit, /STRIPE_CLIENT_ID/, 'pilot env audit should check Stripe Connect client id');
assert.match(envAudit, /STRIPE_WEBHOOK_SECRET/, 'pilot env audit should check Stripe webhook secret');

const envExample = read('backend/.env.example');
assert.match(envExample, /BASE_URL=https:\/\/app\.trennen\.co\.nz/, '.env.example should default to the Trennen app domain');
assert.match(envExample, /NODE_ENV=production/, '.env.example should default to production for the live pilot');
assert.match(envExample, /TRUST_PROXY=1/, '.env.example should enable proxy trust behind Nginx');
assert.match(envExample, /APP_EMAIL_DOMAIN=mail\.trennen\.co\.nz/, '.env.example should use the verified Trennen mail subdomain');
assert.doesNotMatch(envExample, /yourdomain/i, '.env.example should not contain generic domain placeholders');
assertNoSecretLikeValue('backend/.env.example', envExample);

const nginxExample = read('deploy/lightsail-nginx.conf.example');
assert.match(nginxExample, /server_name app\.trennen\.co\.nz;/, 'Nginx example should target app.trennen.co.nz');
assert.match(nginxExample, /proxy_pass http:\/\/127\.0\.0\.1:3001;/, 'Nginx example should proxy only to local Node');
assert.match(nginxExample, /client_max_body_size 260m;/, 'Nginx example should support large model uploads');
assert.match(nginxExample, /X-Forwarded-Proto \$scheme;/, 'Nginx example should preserve forwarded protocol');
assert.doesNotMatch(nginxExample, /yourdomain/i, 'Nginx example should not contain generic domain placeholders');

const runbook = read('docs/deployment/staged-saas-launch.md');
for (const expected of [
  'app.trennen.co.nz',
  '13.239.77.56',
  'Lightsail snapshot',
  'A record',
  'sudo certbot --nginx -d app.trennen.co.nz',
  'NODE_ENV=production',
  'BASE_URL=https://app.trennen.co.nz',
  'npm run env:audit:pilot',
  'npm run production-pilot:smoke',
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'STRIPE_CLIENT_ID',
  'STRIPE_WEBHOOK_SECRET',
  'Stripe Connect Express',
  'application_fee_amount',
  'transfer_data',
  'pilot shop',
  'https://app.trennen.co.nz/embed/v1/widget.js',
]) {
  assert.match(
    runbook,
    new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `deployment runbook should mention ${expected}`,
  );
}
assert.doesNotMatch(runbook, /cdn\.yourdomain\.com/i, 'runbook should not use generic CDN embed domain');
assertNoSecretLikeValue('docs/deployment/staged-saas-launch.md', runbook);

const stripeRoute = read('backend/routes/stripe.js');
for (const expected of [
  'PLATFORM_STRIPE_NOT_CONFIGURED',
  'NO_CONNECTED_ACCOUNT',
  'ONBOARDING_INCOMPLETE',
  'SUBSCRIPTION_INACTIVE',
  'application_fee_amount',
  'transfer_data',
  'on_behalf_of',
]) {
  assert.match(stripeRoute, new RegExp(expected), `Stripe route should include ${expected}`);
}

assert.ok(existsSync(resolve(root, 'docs/pricing/trennen-pricing-and-fees.md')), 'pricing source-of-truth doc should exist');

console.log('Production pilot readiness smoke checks passed.');

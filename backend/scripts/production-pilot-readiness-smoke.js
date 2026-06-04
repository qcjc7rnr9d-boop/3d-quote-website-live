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
assert.equal(
  packageJson.scripts['stripe-connect:smoke'],
  'node scripts/stripe-connect-platform-smoke.js',
  'backend/package.json should expose a Stripe Connect platform smoke script',
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
assert.match(nginxExample, /server_name\s+[^;]*app\.trennen\.co\.nz[^;]*;/, 'Nginx example should target app.trennen.co.nz');
assert.match(nginxExample, /server_name\s+[^;]*embed\.trennen\.co\.nz[^;]*;/, 'Nginx example should target embed.trennen.co.nz');
assert.match(nginxExample, /server_name\s+[^;]*quotes\.trennen\.co\.nz[^;]*;/, 'Nginx example should target quotes.trennen.co.nz');
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
  'npm run stripe-connect:smoke',
  'npm run production-pilot:smoke',
  'npm run qa:full',
  'pm2 restart 3d-quote-website --update-env',
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'STRIPE_CLIENT_ID',
  'STRIPE_WEBHOOK_SECRET',
  'Stripe Connect Express',
  'Customer checkout is Stripe-only for launch',
  'Free pilot',
  '5% Trennen platform fee',
  'BANK_TRANSFER_DISABLED',
  'application_fee_amount',
  'transfer_data',
  'pilot shop',
  'https://embed.trennen.co.nz/widget.js',
  'quotes.trennen.co.nz',
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
  'CONNECT_PLATFORM_NOT_REGISTERED',
  'PLATFORM_STRIPE_NOT_CONFIGURED',
  'NO_CONNECTED_ACCOUNT',
  'ONBOARDING_INCOMPLETE',
  'application_fee_amount',
  'transfer_data',
  'on_behalf_of',
  '/dashboard-link',
  'createLoginLink',
]) {
  assert.match(stripeRoute, new RegExp(expected), `Stripe route should include ${expected}`);
}
assert.match(
  stripeRoute,
  /create-bank-transfer-order[\s\S]*BANK_TRANSFER_DISABLED/,
  'legacy bank-transfer API route should reject instead of creating customer orders',
);
assert.match(
  stripeRoute,
  /dashboard-link[\s\S]*requireShopAuth[\s\S]*stripe_account_id[\s\S]*createLoginLink[\s\S]*res\.json\(\{ url/,
  'Stripe dashboard-link route should create a safe Express dashboard login link for connected shops',
);
assert.match(
  stripeRoute,
  /dashboard-link[\s\S]*No Stripe account connected/,
  'Stripe dashboard-link route should reject shops without connected accounts',
);

const adminPayments = read('admin/payments.html');
for (const expected of [
  'Open Stripe dashboard',
  'Resume Stripe setup',
  'Ready for payments',
  '/api/stripe/dashboard-link',
]) {
  assert.match(adminPayments, new RegExp(expected), `Admin payments page should include ${expected}`);
}
assert.match(
  adminPayments,
  /onboarding_complete[\s\S]*can_accept_live_orders[\s\S]*Open Stripe dashboard/,
  'Admin payments page should only show dashboard access when Stripe is ready for live payments',
);

const stripeConnectSmoke = read('backend/scripts/stripe-connect-platform-smoke.js');
assert.match(stripeConnectSmoke, /stripe\.accounts\.create/, 'Stripe Connect smoke should test account creation');
assert.match(stripeConnectSmoke, /stripe\.accountLinks\.create/, 'Stripe Connect smoke should test onboarding link creation');
assert.match(stripeConnectSmoke, /stripe\.accounts\.del/, 'Stripe Connect smoke should clean up the test account');
assert.match(stripeConnectSmoke, /ALLOW_LIVE_STRIPE_CONNECT_SMOKE/, 'Stripe Connect smoke should refuse live keys unless explicitly allowed');

assert.ok(existsSync(resolve(root, 'docs/pricing/trennen-pricing-and-fees.md')), 'pricing source-of-truth doc should exist');

console.log('Production pilot readiness smoke checks passed.');

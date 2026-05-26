import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

function appearsBefore(source, left, right, message) {
  const leftIndex = source.indexOf(left);
  const rightIndex = source.indexOf(right);
  assert.notEqual(leftIndex, -1, `${message}: missing ${left}`);
  assert.notEqual(rightIndex, -1, `${message}: missing ${right}`);
  assert.ok(leftIndex < rightIndex, message);
}

const server = read('backend/server.js');
const csrf = read('backend/lib/csrf.js');

appearsBefore(
  server,
  "app.post('/api/stripe/webhook'",
  "app.use(express.json({ limit: '10mb' }))",
  'Stripe webhook must stay on the raw-body path before JSON parsing',
);
appearsBefore(
  server,
  "app.post('/api/email/resend-webhook'",
  "app.use(express.json({ limit: '10mb' }))",
  'Email webhook must stay on the raw-body path before JSON parsing',
);
appearsBefore(
  server,
  'app.use(session({',
  "app.get('/api/csrf-token', csrfTokenHandler)",
  'CSRF token route must be session-backed',
);
appearsBefore(
  server,
  "app.get('/api/csrf-token', csrfTokenHandler)",
  'app.use(csrfProtection)',
  'CSRF token route must be available before CSRF enforcement',
);

for (const mount of [
  "app.use('/api/auth', authRouter)",
  "app.use('/api/materials', materialsRouter)",
  "app.use('/api/orders', ordersRouter)",
  "app.use('/api/customers', customersRouter)",
  "app.use('/api/pricing', pricingRouter)",
  "app.use('/api/settings', settingsRouter)",
  "app.use('/api/stripe', stripeRouter)",
  "app.use('/api/platform', platformRouter)",
  "app.use('/api/customer', customerPortalRouter)",
  "app.use('/api/shipping', shippingRouter)",
  "app.use('/api/billing', billingRouter)",
]) {
  appearsBefore(server, 'app.use(csrfProtection)', mount, `${mount} must be mounted after CSRF protection`);
}

assert.match(csrf, /const SAFE_METHODS = new Set\(\['GET', 'HEAD', 'OPTIONS'\]\)/, 'safe methods should not require CSRF');
assert.match(csrf, /req\.path\.startsWith\('\/api\/'\)/, 'CSRF should only enforce API requests');
assert.match(csrf, /req\.session\?\.shopId/, 'shop-admin sessions should be covered');
assert.match(csrf, /req\.session\?\.customerId/, 'customer sessions should be covered');
assert.match(csrf, /req\.session\?\.platformAdmin/, 'platform-admin sessions should be covered');
assert.match(csrf, /req\.get\('x-csrf-token'\) \|\| req\.body\?\._csrf/, 'CSRF should accept header or body token only');
assert.doesNotMatch(csrf, /req\.query\??\._csrf|req\.query\[['"]_csrf['"]\]/, 'CSRF must not accept query-string tokens');
assert.match(csrf, /timingSafeEqual/, 'CSRF token comparison should be timing-safe');
assert.match(csrf, /EXEMPT_PATHS[\s\S]*\/api\/stripe\/webhook/, 'Stripe webhook should stay explicitly exempt from CSRF');
assert.match(csrf, /CSRF_REQUIRED/, 'CSRF failures should return a stable error code');

console.log('CSRF boundary smoke checks passed.');

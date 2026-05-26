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

const adminAuth = read('backend/routes/auth.js');
const customerAuth = read('backend/routes/customer-portal.js');
const platformAuth = read('backend/lib/platform-auth.js');
const platformRoutes = read('backend/routes/platform.js');
const resetTokens = read('backend/lib/reset-tokens.js');
const adminResetRoute = adminAuth.slice(adminAuth.indexOf("router.post('/reset-password'"));
const customerResetRoute = customerAuth.slice(customerAuth.indexOf("router.post('/reset-password'"));

assert.match(resetTokens, /sha256:/, 'reset tokens should carry an explicit digest prefix');
assert.match(resetTokens, /createHash\('sha256'\)/, 'reset tokens should be stored as SHA-256 digests');

for (const [label, source] of [
  ['shop admin reset', adminAuth],
  ['customer reset', customerAuth],
  ['platform reset', platformAuth],
]) {
  assert.match(source, /resetTokenDigest\(token\)/, `${label} should store digested reset tokens`);
  assert.match(source, /resetTokenLookupValues\(token\)/, `${label} should support digest lookup`);
  assert.match(source, /used = 0[\s\S]*expires_at > datetime\('now'\)/, `${label} should only accept unused, unexpired tokens`);
}

assert.match(adminAuth, /Number\(payload\.shopId\) !== Number\(row\.shop_id\)/, 'shop admin verify should bind JWT shop id to stored token row');
assert.match(adminAuth, /Number\(row\.shop_id\) !== Number\(payload\.shopId\)/, 'shop admin reset should bind stored token row to JWT shop id');
assert.match(adminAuth, /resetVerifyLimiter = rateLimit/, 'shop admin reset verify route should be rate limited');
assert.match(adminAuth, /router\.get\('\/reset-password\/verify', resetVerifyLimiter,/, 'shop admin reset verify route should use its limiter');
assert.match(customerAuth, /Number\(payload\.customerAccountId\) !== Number\(row\.customer_account_id\)/, 'customer reset should bind JWT customer id to stored token row');
assert.match(customerAuth, /Number\(payload\.shopId\) !== Number\(row\.shop_id\)/, 'customer reset should bind JWT shop id to stored token row');
assert.match(customerAuth, /customerResetVerifyLimiter = rateLimit/, 'customer reset verify route should be rate limited');
assert.match(customerAuth, /router\.get\('\/reset-password\/verify', customerResetVerifyLimiter,/, 'customer reset verify route should use its limiter');
assert.match(platformAuth, /payload\.purpose !== 'platform_password_reset'/, 'platform reset tokens should include a purpose check');
assert.match(platformAuth, /payload\.platformAdminId !== PLATFORM_ADMIN_ID/, 'platform reset tokens should bind to the platform admin id');
assert.match(platformRoutes, /platformResetVerifyLimiter = rateLimit/, 'platform reset verify route should be rate limited');
assert.match(platformRoutes, /router\.get\('\/reset-password\/verify', platformResetVerifyLimiter,/, 'platform reset verify route should use its limiter');

appearsBefore(
  adminResetRoute,
  'UPDATE reset_tokens',
  'UPDATE shops SET password_hash',
  'shop admin reset should claim token before updating password',
);
appearsBefore(
  customerResetRoute,
  'UPDATE customer_reset_tokens',
  'UPDATE customer_accounts',
  'customer reset should claim token before updating password',
);
appearsBefore(
  platformRoutes,
  'markPlatformResetTokenUsed(token)',
  'updatePlatformAdminAccount({ newPassword })',
  'platform reset should claim token before updating password',
);

for (const [label, source] of [
  ['shop admin forgot password', adminAuth],
  ['customer forgot password', customerAuth],
  ['platform forgot password', platformRoutes],
]) {
  assert.match(source, /res\.json\(\{\s*ok:\s*true,\s*message\s*\}\)/, `${label} should return a neutral response`);
}

assert.match(adminAuth, /revokeShopSessions\(db, payload\.shopId\)/, 'shop admin reset should revoke existing sessions');
assert.match(customerAuth, /revokeCustomerAccountSessions\(db, row\.customer_account_id\)/, 'customer reset should revoke existing sessions');
assert.match(platformRoutes, /revokePlatformSessions\(db\)/, 'platform reset should revoke existing sessions');

console.log('Reset-token boundary smoke checks passed.');

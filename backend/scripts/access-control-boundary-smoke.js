import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

const orders = read('backend/routes/orders.js');
const customers = read('backend/routes/customers.js');
const pricing = read('backend/routes/pricing.js');
const materials = read('backend/routes/materials.js');
const customerPortal = read('backend/routes/customer-portal.js');
const stripe = read('backend/routes/stripe.js');
const auth = read('backend/routes/auth.js');
const platform = read('backend/routes/platform.js');

for (const [label, source] of [
  ['orders', orders],
  ['customers', customers],
  ['pricing', pricing],
  ['materials', materials],
]) {
  assert.match(source, /requireShopAuth/, `${label} admin routes should require shop auth`);
}

for (const pattern of [
  /WHERE o\.id = \? AND o\.shop_id = \?/,
  /SELECT \* FROM orders WHERE id = \? AND shop_id = \?/,
  /UPDATE orders SET[\s\S]*WHERE id = \? AND shop_id = \?/,
]) {
  assert.match(orders, pattern, `orders route should keep shop ownership in query ${pattern}`);
}

assert.match(customers, /SELECT \* FROM customers WHERE id = \? AND shop_id = \?/, 'customer detail/update should check shop ownership');
assert.match(customers, /UPDATE customers SET notes = \? WHERE id = \? AND shop_id = \?/, 'customer notes update should include shop ownership in the write');

assert.match(pricing, /SELECT \* FROM discount_codes WHERE id = \? AND shop_id = \?/, 'discount detail/update should check shop ownership');
assert.match(pricing, /UPDATE discount_codes[\s\S]*WHERE id = \? AND shop_id = \?/, 'discount update should include shop ownership in the write');
assert.match(pricing, /DELETE FROM discount_codes WHERE id = \? AND shop_id = \?/, 'discount delete should include shop ownership in the write');
assert.match(pricing, /SELECT \* FROM discount_codes WHERE id = \? AND shop_id = \?'\)\.get\(result\.lastInsertRowid, req\.shop\.id\)/, 'discount create response should reload through shop ownership');

assert.match(materials, /SELECT \* FROM materials WHERE id = \? AND shop_id = \? AND category = \?/, 'material detail/update should check shop ownership and visible category');
assert.match(materials, /UPDATE materials SET[\s\S]*WHERE id = \? AND shop_id = \?/, 'material update should include shop ownership in the write');
assert.match(materials, /DELETE FROM materials WHERE id = \? AND shop_id = \? AND category = \?/, 'material delete should include shop ownership in the write');
assert.match(materials, /SELECT \* FROM materials WHERE id = \? AND shop_id = \? AND category = \?'\)[\s\S]*result\.lastInsertRowid, req\.shop\.id, VISIBLE_MATERIAL_CATEGORY/, 'material create response should reload through shop ownership');

assert.match(customerPortal, /JOIN shops s ON s\.id = ca\.shop_id[\s\S]*WHERE ca\.id = \? AND s\.plan != 'suspended'/, 'customer auth should block suspended shops at the middleware boundary');
assert.match(customerPortal, /WHERE o\.shop_id = \? AND LOWER\(o\.customer_email\) = LOWER\(\?\)/, 'customer order list should be scoped by shop and email');
assert.match(customerPortal, /WHERE o\.id = \? AND o\.shop_id = \? AND LOWER\(o\.customer_email\) = LOWER\(\?\)/, 'customer order detail should be scoped by id, shop, and email');
assert.match(customerPortal, /WHERE id = \? AND shop_id = \? AND customer_account_id = \?/, 'saved quote create reload should be scoped by shop and customer account');
assert.match(customerPortal, /WHERE id = \? AND customer_account_id = \?/, 'saved quote delete should be scoped by customer account');

for (const [label, source, patterns] of [
  ['shop auth', auth, [
    /change-password', requireShopAuth, blockPlatformImpersonation/,
    /sessions\/:id', requireShopAuth, blockPlatformImpersonation/,
    /sessions\/revoke-all', requireShopAuth, blockPlatformImpersonation/,
    /account', requireShopAuth, blockPlatformImpersonation/,
  ]],
  ['stripe connect', stripe, [
    /dashboard-link', requireShopAuth, blockPlatformImpersonation/,
    /connect-url', requireShopAuth, blockPlatformImpersonation/,
    /connect', requireShopAuth, blockPlatformImpersonation/,
    /disconnect', requireShopAuth, blockPlatformImpersonation/,
  ]],
]) {
  for (const pattern of patterns) {
    assert.match(source, pattern, `${label} sensitive route should block platform support impersonation: ${pattern}`);
  }
}

assert.match(
  platform,
  /if \(!isValidEmailAddress\(ownerEmail\)\)/,
  'platform login should reject malformed owner emails before bootstrap',
);
assert.match(
  platform,
  /Platform bootstrap password is unsafe/,
  'platform first-login bootstrap should enforce the normal password-strength rules',
);
assert.match(
  platform,
  /if \(nextEmail !== undefined \|\| new_password\) \{[\s\S]*verifyPlatformPassword\(current_password\)/,
  'platform owner-email changes should require the current platform password',
);

console.log('Access-control boundary smoke checks passed.');

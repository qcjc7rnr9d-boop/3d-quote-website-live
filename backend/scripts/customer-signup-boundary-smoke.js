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

const schema = read('backend/db/schema.sql');
const route = read('backend/routes/customer-portal.js');
const portalSmoke = read('backend/scripts/customer-portal-smoke.js');
const authEmailSmoke = read('backend/scripts/auth-email-smoke.js');
const loginHtml = read('customer/login.html');

assert.match(schema, /CREATE TABLE IF NOT EXISTS customers[\s\S]*UNIQUE \(shop_id, email\)/, 'customers table should be unique per shop/email');
assert.match(schema, /CREATE TABLE IF NOT EXISTS customer_accounts[\s\S]*UNIQUE \(shop_id, email\)/, 'customer_accounts table should be unique per shop/email');
assert.match(schema, /email\s+TEXT\s+NOT NULL COLLATE NOCASE/, 'customer email columns should be case-insensitive');

assert.match(route, /const normalisedEmail = normaliseCustomerEmail\(email\)/, 'customer registration should normalize email');
assert.match(route, /isValidCustomerEmail\(normalisedEmail\)/, 'customer registration should validate email');
assert.match(route, /validateCustomerPassword\(password\)/, 'customer registration should enforce password strength');
assert.match(route, /SELECT id FROM shops WHERE slug = \? AND plan != 'suspended'/, 'customer registration should block suspended shops');
assert.match(route, /bcrypt\.hash\(password, BCRYPT_ROUNDS\)/, 'customer registration should hash passwords');
assert.match(route, /db\.exec\('BEGIN IMMEDIATE'\)/, 'customer registration should use a write transaction');
assert.match(route, /INSERT INTO customer_accounts/, 'customer registration should create a login account row');
assert.match(route, /INSERT INTO customers[\s\S]*ON CONFLICT\(shop_id, email\) DO UPDATE SET/, 'customer registration should keep admin-visible customer row in sync');
assert.match(route, /err\.message && err\.message\.includes\('UNIQUE'\)/, 'duplicate customer registration should be handled cleanly');
assert.match(route, /regenerateSession\(req\)/, 'successful registration should regenerate the session');
assert.match(route, /req\.session\.customerId\s+=\s+result\.lastInsertRowid/, 'successful registration should bind the session to the new account id');
assert.match(route, /req\.session\.customerShopId = shop\.id/, 'successful registration should bind the session to the shop id');
appearsBefore(route, "db.exec('COMMIT')", 'regenerateSession(req)', 'registration should commit database rows before creating the session');

assert.match(portalSmoke, /expectConcurrentSignupIsAtomic/, 'customer portal smoke should cover concurrent signup');
assert.match(portalSmoke, /created === 1/, 'concurrent signup smoke should require exactly one successful create');
assert.match(portalSmoke, /accounts\.length === 1/, 'concurrent signup smoke should verify one customer_accounts row');
assert.match(portalSmoke, /customers\.length === 1/, 'concurrent signup smoke should verify one customers row');
assert.match(portalSmoke, /expectSuspendedShopBlocksCustomerAuth/, 'customer portal smoke should cover suspended shop registration/login');
assert.match(authEmailSmoke, /QA\+Smoke@Sub\.Example\.COM/, 'auth email smoke should cover plus aliases, subdomains, and case normalization');
assert.match(authEmailSmoke, /Duplicate Customer/, 'auth email smoke should cover duplicate registration');

assert.match(loginHtml, /fetch\('\/api\/customer\/register'/, 'customer login page should call the registration endpoint');
assert.match(loginHtml, /function passwordError\(password\)/, 'customer signup UI should validate password strength before submit');
assert.match(loginHtml, /Password must contain at least one uppercase letter/, 'customer signup UI should mention uppercase requirement');
assert.match(loginHtml, /Password must contain at least one digit/, 'customer signup UI should mention digit requirement');
assert.match(loginHtml, /Password must contain at least one special character/, 'customer signup UI should mention special-character requirement');

console.log('Customer signup boundary smoke checks passed.');

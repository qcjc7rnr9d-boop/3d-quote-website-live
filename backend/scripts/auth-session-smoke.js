import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db, requireShopAuth } from '../middleware/auth.js';
import { requireCustomerAuth } from '../routes/customer-portal.js';

const suffix = randomUUID().slice(0, 10);
let activeShopId = null;
let suspendedShopId = null;
let activeCustomerId = null;
let suspendedCustomerId = null;

function mockResponse() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

async function createShop(plan) {
  const hash = await bcrypt.hash(`AuthSession!${suffix}`, 4);
  const result = db.prepare(`
    INSERT INTO shops (name, slug, email, password_hash, is_temp_password, plan)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(
    `Auth Session ${plan}`,
    `auth-session-${plan}-${suffix}`,
    `auth-session-${plan}-${suffix}@example.test`,
    hash,
    plan,
  );
  return result.lastInsertRowid;
}

function runRequireShopAuth(shopId) {
  const req = {
    method: 'GET',
    session: { shopId },
  };
  const res = mockResponse();
  let nextCalled = false;
  requireShopAuth(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}

function createCustomer(shopId, emailPrefix) {
  const result = db.prepare(`
    INSERT INTO customer_accounts (shop_id, email, name, password_hash)
    VALUES (?, ?, ?, ?)
  `).run(
    shopId,
    `${emailPrefix}-${suffix}@example.test`,
    `${emailPrefix} Customer`,
    'not-a-real-login-hash',
  );
  return result.lastInsertRowid;
}

function runRequireCustomerAuth(customerId, customerShopId) {
  const req = {
    method: 'GET',
    session: { customerId, customerShopId },
  };
  const res = mockResponse();
  let nextCalled = false;
  requireCustomerAuth(req, res, () => { nextCalled = true; });
  return { req, res, nextCalled };
}

try {
  activeShopId = await createShop('starter');
  suspendedShopId = await createShop('suspended');
  activeCustomerId = createCustomer(activeShopId, 'active');
  suspendedCustomerId = createCustomer(suspendedShopId, 'suspended');

  const active = runRequireShopAuth(activeShopId);
  assert.equal(active.nextCalled, true, 'active shop session should pass requireShopAuth');
  assert.equal(active.req.shop.id, activeShopId, 'active shop should be attached to request');

  const suspended = runRequireShopAuth(suspendedShopId);
  assert.equal(suspended.nextCalled, false, 'suspended shop session must not pass requireShopAuth');
  assert.equal(suspended.res.statusCode, 401, 'suspended shop session should be treated as unauthenticated');
  assert.equal(suspended.req.shop, undefined, 'suspended shop must not be attached to request');

  const activeCustomer = runRequireCustomerAuth(activeCustomerId, activeShopId);
  assert.equal(activeCustomer.nextCalled, true, 'active customer session should pass requireCustomerAuth');
  assert.equal(activeCustomer.req.customerAccount.id, activeCustomerId, 'active customer account should be attached to request');

  const suspendedCustomer = runRequireCustomerAuth(suspendedCustomerId, suspendedShopId);
  assert.equal(suspendedCustomer.nextCalled, false, 'suspended shop customer session must not pass requireCustomerAuth');
  assert.equal(suspendedCustomer.res.statusCode, 401, 'suspended shop customer session should be treated as unauthenticated');
  assert.equal(suspendedCustomer.req.customerAccount, undefined, 'suspended customer account must not be attached to request');

  const authSource = await import('node:fs').then(fs => fs.readFileSync(new URL('../routes/auth.js', import.meta.url), 'utf8'));
  assert.match(authSource, /WHERE email = \? AND plan != 'suspended'/, 'shop admin login and reset lookup should exclude suspended shops');
  assert.match(authSource, /JOIN shops s ON s\.id = rt\.shop_id[\s\S]+AND s\.plan != 'suspended'/, 'shop admin reset tokens should be scoped to active shops');
  assert.doesNotMatch(authSource, /SELECT\s+id,\s*token,\s*ip,\s*user_agent,\s*created_at,\s*expires_at\s+FROM sessions/i, 'session listing must not return raw session tokens');
  assert.match(authSource, /CASE WHEN token = \? THEN 1 ELSE 0 END AS is_current/, 'session listing should compute current-session status server-side without exposing tokens');

  const customerSource = await import('node:fs').then(fs => fs.readFileSync(new URL('../routes/customer-portal.js', import.meta.url), 'utf8'));
  assert.match(customerSource, /FROM customer_accounts ca\s+JOIN shops s ON s\.id = ca\.shop_id\s+WHERE ca\.id = \? AND s\.plan != 'suspended'/, 'customer auth middleware should exclude suspended shops');
  const activeCustomerResetLookups = customerSource.match(/JOIN shops s ON s\.id = crt\.shop_id[\s\S]{0,220}?AND s\.plan != 'suspended'/g) || [];
  assert.equal(activeCustomerResetLookups.length, 2, 'customer reset token verify and reset should both be scoped to active shops');

  console.log('Auth session smoke checks passed.');
} finally {
  if (activeCustomerId) db.prepare('DELETE FROM customer_accounts WHERE id = ?').run(activeCustomerId);
  if (suspendedCustomerId) db.prepare('DELETE FROM customer_accounts WHERE id = ?').run(suspendedCustomerId);
  if (activeShopId) db.prepare('DELETE FROM shops WHERE id = ?').run(activeShopId);
  if (suspendedShopId) db.prepare('DELETE FROM shops WHERE id = ?').run(suspendedShopId);
}

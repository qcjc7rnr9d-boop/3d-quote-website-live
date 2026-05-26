import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

function read(path) {
  return readFileSync(resolve(root, path), 'utf8');
}

const adminAuth = read('backend/routes/auth.js');
const customerAuth = read('backend/routes/customer-portal.js');
const platformAuth = read('backend/routes/platform.js');
const stripeRoute = read('backend/routes/stripe.js');

for (const [label, source, checks] of [
  ['shop admin auth', adminAuth, [
    /router\.post\('\/login',\s*loginLimiter/,
    /router\.post\('\/forgot-password',\s*resetLimiter/,
    /router\.post\('\/reset-password',\s*resetLimiter/,
  ]],
  ['customer auth', customerAuth, [
    /router\.post\('\/register',\s*customerRegisterLimiter/,
    /router\.post\('\/login',\s*customerLoginLimiter/,
    /router\.post\('\/forgot-password',\s*customerResetLimiter/,
    /router\.post\('\/reset-password',\s*customerPasswordLimiter/,
    /router\.post\('\/change-password',\s*customerPasswordLimiter/,
    /router\.post\('\/quotes',\s*customerQuoteLimiter/,
  ]],
  ['platform auth', platformAuth, [
    /router\.post\('\/login',\s*platformLoginLimiter/,
    /router\.post\('\/forgot-password',\s*platformForgotLimiter/,
    /const platformResetLimiter = rateLimit/,
    /router\.post\('\/reset-password',\s*platformResetLimiter/,
  ]],
  ['stripe payments', stripeRoute, [
    /router\.post\('\/create-payment-intent',\s*paymentIntentLimiter/,
    /router\.post\('\/create-bank-transfer-order',\s*paymentIntentLimiter/,
  ]],
]) {
  for (const check of checks) {
    assert.match(source, check, `${label} is missing expected limiter pattern ${check}`);
  }
}

for (const [label, source] of [
  ['shop admin auth', adminAuth],
  ['customer auth', customerAuth],
  ['platform auth', platformAuth],
]) {
  assert.match(source, /standardHeaders:\s*true/, `${label} limiters should emit standard rate-limit headers`);
  assert.match(source, /legacyHeaders:\s*false/, `${label} limiters should disable legacy rate-limit headers`);
}

console.log('Rate-limit smoke checks passed.');

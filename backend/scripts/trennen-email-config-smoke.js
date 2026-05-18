import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildFromAddress, buildReplyTo } from '../lib/email-from.js';

const repoRoot = resolve('..');
const envExample = readFileSync(resolve('.env.example'), 'utf8');
const deploymentDoc = readFileSync(resolve(repoRoot, 'docs/deployment/staged-saas-launch.md'), 'utf8');

for (const [label, content] of [
  ['backend/.env.example', envExample],
  ['docs/deployment/staged-saas-launch.md', deploymentDoc],
]) {
  assert.match(
    content,
    /APP_EMAIL_DOMAIN=mail\.trennen\.co\.nz/,
    `${label} should use the verified Trennen sending subdomain`,
  );
  assert.match(
    content,
    /APP_EMAIL_FALLBACK=["']?Trennen <hello@mail\.trennen\.co\.nz>["']?/,
    `${label} should document the Trennen fallback From address`,
  );
  assert.match(
    content,
    /RESEND_API_KEY=<new rotated restricted key>|RESEND_API_KEY=replace-with-new-rotated-restricted-key/,
    `${label} should tell operators to use a new rotated restricted key`,
  );
  assert.doesNotMatch(
    content,
    /(APP_EMAIL_DOMAIN|APP_EMAIL_FALLBACK|EMAIL_FROM)=.*yourdomain\.com/,
    `${label} should not keep email sender placeholders on yourdomain.com`,
  );
}

const originalEnv = {
  APP_EMAIL_DOMAIN: process.env.APP_EMAIL_DOMAIN,
  APP_EMAIL_FALLBACK: process.env.APP_EMAIL_FALLBACK,
};

try {
  process.env.APP_EMAIL_DOMAIN = 'mail.trennen.co.nz';
  process.env.APP_EMAIL_FALLBACK = 'Trennen <hello@mail.trennen.co.nz>';

  const fallbackFrom = buildFromAddress({
    shopName: 'Mahi3D',
    shopSlug: 'mahi3d',
    category: 'orders',
    emailDomain: { domain: 'quotes.mahi3d.co.nz', status: 'pending' },
  });
  assert.equal(
    fallbackFrom,
    'Mahi3D · Orders <mahi3d-orders@mail.trennen.co.nz>',
    'pending client domains should send through the Trennen fallback domain',
  );

  const brandedFrom = buildFromAddress({
    shopName: 'Client Print Co',
    shopSlug: 'client-print-co',
    category: 'shipping',
    emailDomain: { domain: 'quotes.clientprint.co.nz', status: 'verified' },
  });
  assert.equal(
    brandedFrom,
    'Client Print Co · Shipping <shipping@quotes.clientprint.co.nz>',
    'verified client domains should use clean client-branded local parts',
  );

  assert.equal(
    buildReplyTo({ shop: { support_email: 'help@clientprint.co.nz', email: 'owner@clientprint.co.nz' } }),
    'help@clientprint.co.nz',
    'customer replies should go to the business support inbox',
  );

  console.log('Trennen email config smoke checks passed.');
} finally {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

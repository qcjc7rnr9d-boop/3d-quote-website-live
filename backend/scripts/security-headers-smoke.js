import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const server = readFileSync(resolve(root, 'backend/server.js'), 'utf8');

for (const expected of [
  'X-Content-Type-Options',
  'X-Frame-Options',
  'Referrer-Policy',
  'Permissions-Policy',
  'Strict-Transport-Security',
  'Content-Security-Policy',
  'X-Permitted-Cross-Domain-Policies',
  'X-Download-Options',
  'X-DNS-Prefetch-Control',
]) {
  assert.match(server, new RegExp(expected), `server.js should set ${expected}`);
}

for (const directive of [
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
]) {
  assert.match(server, new RegExp(directive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `server CSP should include ${directive}`);
}

assert.match(
  server,
  /embed\/quote[\s\S]*Content-Security-Policy[\s\S]*frame-ancestors/s,
  'embed route should override frame-ancestors with the shop allowlist',
);

console.log('Security headers smoke checks passed.');

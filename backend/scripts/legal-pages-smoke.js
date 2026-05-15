import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

const termsPath = resolve(root, 'terms.html');
const privacyPath = resolve(root, 'privacy.html');

assert(existsSync(termsPath), 'terms.html must exist at the public root');
assert(existsSync(privacyPath), 'privacy.html must exist at the public root');

const termsHtml = read('terms.html');
const privacyHtml = read('privacy.html');
const indexHtml = read('index.html');
const catalogHtml = read('catalog.html');
const serverJs = read('backend/server.js');

for (const [name, html] of [['terms.html', termsHtml], ['privacy.html', privacyHtml]]) {
  assert(html.includes('assets/brand.js'), `${name} must load the shared brand applier`);
  assert(html.includes('data-brand="name"') || html.includes('footer-wordmark'), `${name} must support dynamic shop branding`);
  assert(html.includes('Draft placeholder'), `${name} must visibly mark legal copy as draft placeholder content`);
  assert(html.includes('catalog.html?shop='), `${name} must link back to Materials with the shop slug`);
  assert(html.includes('quote.html?shop='), `${name} must link back to Quote with the shop slug`);
  assert(html.includes('customer/dashboard.html?shop='), `${name} must link to customer portal tabs with the shop slug`);
}

assert(serverJs.includes("'/terms.html'"), 'server public root pages must include /terms.html');
assert(serverJs.includes("'/privacy.html'"), 'server public root pages must include /privacy.html');

for (const [name, html] of [['index.html', indexHtml], ['catalog.html', catalogHtml]]) {
  assert(html.includes('terms.html?shop='), `${name} footer must link to terms.html with shop slug`);
  assert(html.includes('privacy.html?shop='), `${name} footer must link to privacy.html with shop slug`);
  assert(!html.includes('customer/dashboard.html?shop=mahi3d#help" data-pv-tab="help">Terms'), `${name} must not route Terms to the Help tab`);
  assert(!html.includes('customer/dashboard.html?shop=mahi3d#help" data-pv-tab="help">Privacy'), `${name} must not route Privacy to the Help tab`);
  assert(!html.includes('customer/dashboard.html?shop=mahi3d#help">Terms'), `${name} must not route Terms to the Help tab`);
  assert(!html.includes('customer/dashboard.html?shop=mahi3d#help">Privacy'), `${name} must not route Privacy to the Help tab`);
}

console.log('Legal page smoke checks passed.');

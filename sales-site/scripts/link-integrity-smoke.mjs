import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { defaultPublicRoot, resolveStaticRequest } from '../server.mjs';

const root = defaultPublicRoot;
const pages = [
  'index.html',
  'product.html',
  'how-it-works.html',
  'pricing.html',
  'faq.html',
  'integration.html',
  'changelog.html',
  'terms.html',
  'privacy.html',
  '404.html',
  'signup-success.html',
];

function attrsToMap(attrs) {
  return Object.fromEntries(
    [...attrs.matchAll(/\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)="([^"]*)"/g)].map(match => [match[1], match[2]]),
  );
}

function tags(source, tagName) {
  return [...source.matchAll(new RegExp(`<${tagName}\\b([^>]*)>`, 'gi'))].map(match => ({
    raw: match[0],
    attrs: attrsToMap(match[1]),
  }));
}

function pageHtml(page) {
  return readFileSync(new URL(page, root), 'utf8');
}

function pageIds(source) {
  return new Set([...source.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]));
}

function localExists(pathname) {
  const resolved = resolveStaticRequest(pathname, root);
  return resolved.status === 200 && existsSync(resolved.filePath);
}

function assertLocalUrl(page, value, context) {
  if (!value || value.startsWith('mailto:') || value.startsWith('tel:')) return;
  if (/^https?:\/\//.test(value)) return;
  if (value.startsWith('#')) return;
  const url = new URL(value, `https://trennen.co.nz/${page}`);
  assert.ok(localExists(`${url.pathname}${url.search}`), `${context} should resolve locally: ${value}`);
  if (url.hash) {
    const targetPage = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    assert.ok(pageIds(pageHtml(targetPage)).has(url.hash.slice(1)), `${context} hash should target an existing id: ${value}`);
  }
}

const htmlByPage = new Map(pages.map(page => [page, pageHtml(page)]));

for (const [page, source] of htmlByPage) {
  const ids = pageIds(source);

  for (const link of tags(source, 'a')) {
    const href = link.attrs.href;
    assert.ok(href, `${page}: link should have href`);
    if (href.startsWith('#')) assert.ok(ids.has(href.slice(1)), `${page}: same-page anchor should exist: ${href}`);
    assertLocalUrl(page, href, `${page}: link`);
    if (href.startsWith('https://app.trennen.co.nz/')) {
      assert.match(href, /^https:\/\/app\.trennen\.co\.nz\/quote\.html\?shop=trennen$/, `${page}: app links should use the public trennen quote route`);
    }
  }

  for (const link of tags(source, 'link')) {
    if (link.attrs.href) assertLocalUrl(page, link.attrs.href, `${page}: head link`);
  }

  for (const script of tags(source, 'script')) {
    const src = script.attrs.src;
    if (!src) continue;
    if (src === 'https://embed.trennen.co.nz/widget.js') continue;
    assertLocalUrl(page, src, `${page}: script`);
  }

  for (const img of tags(source, 'img')) {
    assert.ok(img.attrs.src, `${page}: image should have src`);
    assertLocalUrl(page, img.attrs.src, `${page}: image`);
  }
}

const indexHtml = htmlByPage.get('index.html');
const publicSource = [...htmlByPage.values()].join('\n');
assert.equal((indexHtml.match(/https:\/\/embed\.trennen\.co\.nz\/widget\.js/g) || []).length, 2, 'homepage should show one executable snippet and one code example for the canonical widget');
assert.match(indexHtml, /data-tenant-id="YOUR_TENANT_ID"/);
assert.match(indexHtml, /data-theme-primary="#0077c8"/);
assert.doesNotMatch(indexHtml, /mahi3d|demoStart=1|embedded=1|data-shop="trennen"|https:\/\/app\.trennen\.co\.nz\/embed\/v1\/widget\.js/i);
assert.doesNotMatch(publicSource, /launch-gate|DNS is not live|not be published with the canonical embed|hide widget messaging/i);
assert.doesNotMatch(publicSource, /mahi3d|demoStart=1|embedded=1|data-shop="trennen"|https:\/\/app\.trennen\.co\.nz\/embed\/v1\/widget\.js/i);

const sitemap = pageHtml('sitemap.xml');
for (const loc of [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1])) {
  const url = new URL(loc);
  assert.equal(url.hostname, 'trennen.co.nz');
  assert.ok(localExists(url.pathname === '/' ? '/' : url.pathname), `sitemap location should resolve locally: ${loc}`);
}
assert.match(sitemap, /integration\.html/);
assert.match(sitemap, /changelog\.html/);

console.log('Sales-site link integrity checks passed.');

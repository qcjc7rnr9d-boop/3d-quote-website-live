import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { cacheControlForStaticFile, createSalesSiteServer, defaultPublicRoot, formatListenError, resolveStaticRequest } from '../server.mjs';

const root = defaultPublicRoot;

for (const file of [
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
  'assets/sales.css',
  'assets/sales.js',
  'assets/trennen-wordmark.svg',
  'assets/social-card.png',
  'robots.txt',
  'sitemap.xml',
  'site.webmanifest',
]) {
  assert.ok(existsSync(new URL(file, root)), `sales-site/public should include ${file}`);
}

const html = readFileSync(new URL('index.html', root), 'utf8');
const integrationHtml = readFileSync(new URL('integration.html', root), 'utf8');
const css = readFileSync(new URL('assets/sales.css', root), 'utf8');
const js = readFileSync(new URL('assets/sales.js', root), 'utf8');
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');

assert.match(html, /<meta http-equiv="Content-Security-Policy" content="[^"]*https:\/\/embed\.trennen\.co\.nz[^"]*https:\/\/quotes\.trennen\.co\.nz/);
assert.match(html, /<title>Trennen &mdash; Instant 3D Printing Quote Widget<\/title>/);
assert.match(html, /<meta name="description" content="Embed instant 3D-printing quotes on your own website/);
assert.match(html, /<script src="https:\/\/embed\.trennen\.co\.nz\/widget\.js" data-tenant-id="ten_XtI4xnABbNGOdSUv6Uqm" data-theme-primary="#0077c8"><\/script>/);
assert.match(integrationHtml, /&lt;div id="trennen-quote-widget"&gt;&lt;\/div&gt;[\s\S]*src="https:\/\/embed\.trennen\.co\.nz\/widget\.js"[\s\S]*data-tenant-id="YOUR_TENANT_ID"[\s\S]*data-theme-primary="#0077c8"/);
assert.match(html, /<span class="widget-code-line">&lt;script src="https:\/\/embed\.trennen\.co\.nz\/widget\.js" data-tenant-id="YOUR_TENANT_ID" data-theme-primary="#0077c8"&gt;&lt;\/script&gt;<\/span>/);
assert.match(html, /<code>quote<\/code>/);
assert.match(html, /<code>quotes\.trennen\.co\.nz<\/code>/);
assert.doesNotMatch(html, /https:\/\/app\.trennen\.co\.nz\/embed\/v1\/widget\.js|data-shop="trennen"|mahi3d|demoStart=1|embedded=1/i);
assert.doesNotMatch(html, /launch-gate|DNS is not live|not be published with the canonical embed/i);

for (const selector of [
  '.widget-site-card',
  '.integration-snippet',
  '.integration-steps',
  '.technical-panel',
  '.guide-grid',
  '.changelog-grid',
]) {
  assert.match(css, new RegExp(`${selector.replace('.', '\\.')}\\s*\\{`), `CSS should include ${selector}`);
}
assert.match(js, /initLiveSoftwareWidgetFallback/);
assert.match(readme, /Sales site: `http:\/\/localhost:3000`/);

assert.equal(resolveStaticRequest('/', root).status, 200);
assert.equal(resolveStaticRequest('/integration.html', root).status, 200);
assert.equal(resolveStaticRequest('/changelog.html', root).status, 200);
assert.equal(resolveStaticRequest('/missing-page', root).status, 404);
assert.equal(cacheControlForStaticFile('/assets/sales.css'), 'no-store');
assert.match(cacheControlForStaticFile('/assets/sales.css', 'production'), /max-age=/);
assert.match(formatListenError(new Error('x'), 3000), /3000/);
assert.equal(typeof createSalesSiteServer, 'function');

console.log('Sales-site static server checks passed.');

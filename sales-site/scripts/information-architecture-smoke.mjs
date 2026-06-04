import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultPublicRoot } from '../server.mjs';

const root = defaultPublicRoot;
const html = readFileSync(new URL('index.html', root), 'utf8');
const productHtml = readFileSync(new URL('product.html', root), 'utf8');
const pricingHtml = readFileSync(new URL('pricing.html', root), 'utf8');
const faqHtml = readFileSync(new URL('faq.html', root), 'utf8');
const integrationHtml = readFileSync(new URL('integration.html', root), 'utf8');
const changelogHtml = readFileSync(new URL('changelog.html', root), 'utf8');

function stripTags(value) {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sectionById(id, source = html) {
  const opening = source.match(new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>`, 'i'));
  assert.ok(opening?.index !== undefined, `Expected #${id} section`);
  const tagPattern = /<\/?section\b[^>]*>/gi;
  tagPattern.lastIndex = opening.index;
  let depth = 0;
  let match = tagPattern.exec(source);
  while (match) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return source.slice(opening.index, tagPattern.lastIndex);
    match = tagPattern.exec(source);
  }
  assert.fail(`#${id} section should close`);
}

const nav = html.match(/<nav class="site-nav"[\s\S]*?<\/nav>/)?.[0] || '';
for (const label of ['Product', 'Pricing', 'Demo', 'FAQ', 'Start free']) {
  assert.match(nav, new RegExp(`>${label}<`), `main nav should include ${label}`);
}
assert.match(nav, /href="product\.html"/);
assert.match(nav, /href="pricing\.html"/);
assert.match(nav, /href="#demo"/);
assert.match(nav, /href="faq\.html"/);
assert.match(nav, /href="#pricing"[^>]*data-pricing-scroll/);
assert.doesNotMatch(nav, /Terms|Privacy|Admin|Buyer walkthrough|Mahi3D/i);

const hero = sectionById('product');
assert.match(hero, /Turn visitors into orders with instant 3D-printing quotes, right on your site\./);
assert.match(hero, /upload CAD\/STL files/i);
assert.match(hero, /pay online 24\/7/i);
assert.match(hero, /href="#pricing"[\s\S]*Start free trial/);
assert.match(hero, /href="#demo"[\s\S]*Try the demo/);
assert.ok(stripTags(hero).length <= 1200, 'hero should stay concise');

const process = sectionById('process');
for (const phrase of ['Configure pricing', 'Embed on your site', 'Receive orders']) {
  assert.match(process, new RegExp(phrase), `process should include ${phrase}`);
}
assert.equal((process.match(/class="route-step/g) || []).length, 3);

const featureSection = sectionById('features');
for (const feature of [
  'Instant quotes',
  'Custom domain and branding',
  'All major print processes',
  'Integrated payments',
  'Analytics and dashboard',
  'Fast setup',
]) {
  assert.match(featureSection, new RegExp(feature), `features should include ${feature}`);
}
assert.equal((featureSection.match(/class="surface-card/g) || []).length, 6);

const pricing = sectionById('pricing');
assert.match(pricing, /5 quotes\/month/);
assert.match(pricing, /No Trennen checkout fee/);
assert.match(pricing, /Stripe\/card processing stays separate/);
assert.doesNotMatch(pricing, /0\.5%|1%|capped checkout fee|platform fee/i);
assert.equal((pricing.match(/data-plan-select="/g) || []).length, 4);

const demo = sectionById('demo');
assert.match(demo, /embed\.trennen\.co\.nz\/widget\.js/);
assert.match(demo, /data-tenant-id="YOUR_TENANT_ID"/);
assert.match(demo, /data-theme-primary="#0077c8"/);
assert.match(demo, /quotes\.trennen\.co\.nz/);
assert.match(demo, /integration\.html/);
assert.doesNotMatch(demo, /mahi3d|demoStart=1|embedded=1|data-demo-|Fill demo/i);

const faqPreview = sectionById('faq');
for (const question of ['How do I embed the quote widget?', 'Can I host the quote tool on my own domain?', 'Do I need coding skills?']) {
  assert.match(faqPreview, new RegExp(question.replace(/[?]/g, '\\?')));
}

for (const [label, source, phrases] of [
  ['product page', productHtml, ['merchant quote widget', 'embed.trennen.co.nz/widget.js', 'quotes.trennen.co.nz', 'FDM', 'SLA', 'SLS', 'MJF', 'custom processes']],
  ['pricing page', pricingHtml, ['5 quotes/month', 'No Trennen checkout fee', 'NZ$1 per extra quote']],
  ['FAQ page', faqHtml, ['embed.trennen.co.nz/widget.js', 'quotes.trennen.co.nz', 'WordPress', 'Wix', 'Squarespace', 'Shopify', 'CNAME']],
  ['integration guide', integrationHtml, ['embed.trennen.co.nz/widget.js', 'data-theme-primary="#0077c8"', 'quotes.trennen.co.nz', 'Cloudflare', 'GoDaddy', 'Namecheap']],
  ['changelog', changelogHtml, ['Merchant quote widget', 'custom quote domain', 'integration.html']],
]) {
  for (const phrase of phrases) {
    assert.match(source, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `${label} should include ${phrase}`);
  }
}

console.log('Sales-site information architecture checks passed.');

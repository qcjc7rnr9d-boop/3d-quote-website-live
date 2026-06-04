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
const robotsTxt = readFileSync(new URL('robots.txt', root), 'utf8');
const sitemapXml = readFileSync(new URL('sitemap.xml', root), 'utf8');

function metaContent(selector, source = html) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const propertyMatch = source.match(new RegExp(`<meta\\s+property="${escaped}"\\s+content="([^"]+)">`));
  if (propertyMatch) return propertyMatch[1];
  const nameMatch = source.match(new RegExp(`<meta\\s+name="${escaped}"\\s+content="([^"]+)">`));
  return nameMatch?.[1] || '';
}

function getJsonLd(source, label) {
  const match = source.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
  assert.ok(match, `${label} should include JSON-LD`);
  return JSON.parse(match[1]);
}

function visibleFaqQuestions(source) {
  return [...source.matchAll(/<button class="faq-question"[^>]*>([\s\S]*?)<\/button>/g)]
    .map(match => match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
}

const homeJsonLd = getJsonLd(html, 'homepage');
assert.ok(Array.isArray(homeJsonLd), 'homepage JSON-LD should be a top-level array');
const homeTypes = new Map(homeJsonLd.map(item => [item['@type'], item]));
for (const type of ['Organization', 'WebSite', 'SoftwareApplication']) {
  assert.ok(homeTypes.has(type), `homepage JSON-LD should include ${type}`);
}
const software = homeTypes.get('SoftwareApplication');
assert.equal(software.name, 'Trennen');
assert.equal(software.applicationCategory, 'BusinessApplication');
assert.equal(software.audience.audienceType, '3D print shops');
assert.match(software.description, /instant 3D-printing quote widget/i);
for (const feature of ['Embeddable quote widget', 'Custom quote domains', 'CAD and STL file intake', 'Material and pricing rules', 'Stripe payment handoff']) {
  assert.ok(software.featureList.includes(feature), `SoftwareApplication featureList should include ${feature}`);
}

assert.equal(metaContent('description'), 'Embed instant 3D-printing quotes on your own website. Trennen lets customers upload CAD/STL files, choose options, see pricing, and pay online 24/7.');
assert.equal(metaContent('og:title'), 'Trennen - Instant 3D Printing Quote Widget');
assert.equal(metaContent('twitter:title'), 'Trennen - Instant 3D Printing Quote Widget');
assert.match(metaContent('og:description'), /embed quote tool/i);
assert.match(metaContent('twitter:description'), /custom domain quoting/i);
assert.match(html, /<link rel="preconnect" href="https:\/\/embed\.trennen\.co\.nz">/);
assert.match(html, /<link rel="dns-prefetch" href="\/\/embed\.trennen\.co\.nz">/);

const productJsonLd = getJsonLd(productHtml, 'product page');
const productTypes = new Map(productJsonLd.map(item => [item['@type'], item]));
assert.ok(productTypes.has('SoftwareApplication'));
assert.ok(productTypes.has('BreadcrumbList'));
assert.match(productTypes.get('SoftwareApplication').description, /merchant quote widget/i);
assert.match(metaContent('description', productHtml), /FDM, SLA, SLS, MJF/i);

const pricingJsonLd = getJsonLd(pricingHtml, 'pricing page');
const pricingTypes = new Map(pricingJsonLd.map(item => [item['@type'], item]));
assert.ok(pricingTypes.has('OfferCatalog'));
assert.equal(pricingTypes.get('OfferCatalog').itemListElement.length, 4);
assert.match(metaContent('description', pricingHtml), /5 free quotes/i);
assert.doesNotMatch(pricingHtml, /0\.5%|1%|capped checkout fee/i);

const faqJsonLd = getJsonLd(faqHtml, 'FAQ page');
const faqTypes = new Map(faqJsonLd.map(item => [item['@type'], item]));
assert.ok(faqTypes.has('FAQPage'));
const structuredQuestions = faqTypes.get('FAQPage').mainEntity.map(item => item.name);
assert.deepEqual(structuredQuestions, visibleFaqQuestions(faqHtml), 'visible FAQ questions should match FAQPage JSON-LD');
for (const question of ['How do I embed the quote widget?', 'Can I host the quote tool on my own domain?', 'What if I use WordPress, Wix, Squarespace, or Shopify?', 'Do I need coding skills?']) {
  assert.ok(structuredQuestions.includes(question), `FAQ schema should include ${question}`);
}

const integrationJsonLd = getJsonLd(integrationHtml, 'integration guide');
const integrationTypes = new Map(integrationJsonLd.map(item => [item['@type'], item]));
assert.ok(integrationTypes.has('TechArticle'));
assert.match(integrationTypes.get('TechArticle').headline, /Merchant quote widget setup/i);

const changelogJsonLd = getJsonLd(changelogHtml, 'changelog');
const changelogTypes = new Map(changelogJsonLd.map(item => [item['@type'], item]));
assert.ok(changelogTypes.has('Article'));
assert.match(changelogTypes.get('Article').headline, /Merchant quote widget/i);

for (const loc of ['/', '/product.html', '/pricing.html', '/faq.html', '/integration.html', '/changelog.html']) {
  assert.match(sitemapXml, new RegExp(`<loc>https://trennen\\.co\\.nz${loc === '/' ? '/' : loc}</loc>`), `sitemap should include ${loc}`);
}
assert.match(robotsTxt, /Sitemap: https:\/\/trennen\.co\.nz\/sitemap\.xml/);
assert.doesNotMatch(sitemapXml, /mahi3d|demoStart|embedded/i);

console.log('Sales-site SEO structured data checks passed.');

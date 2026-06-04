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
const css = readFileSync(new URL('assets/sales.css', root), 'utf8');

function stripTags(value) {
  return String(value).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function sectionById(id, source = html) {
  const opening = source.match(new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>`, 'i'));
  assert.ok(opening?.index !== undefined, `Expected #${id}`);
  const tagPattern = /<\/?section\b[^>]*>/gi;
  tagPattern.lastIndex = opening.index;
  let depth = 0;
  let match = tagPattern.exec(source);
  while (match) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return source.slice(opening.index, tagPattern.lastIndex);
    match = tagPattern.exec(source);
  }
  assert.fail(`#${id} should close`);
}

const hero = sectionById('product');
assert.match(hero, /class="[^"]*\bwidget-site-card\b[^"]*"/, 'hero should show the quote widget in a merchant-site context');
assert.match(hero, /src="assets\/workflow\/request-intake\.webp"/, 'hero visual should use a meaningful UI capture');
assert.match(hero, /Get a Quote/, 'hero visual should show the merchant CTA context');
assert.equal((hero.match(/class="hero-product-stat"/g) || []).length, 3);

const process = sectionById('process');
assert.equal((process.match(/class="route-step/g) || []).length, 3);
assert.ok(stripTags(process).length < 1000, 'process should stay scannable');

const features = sectionById('features');
assert.equal((features.match(/class="surface-card/g) || []).length, 6);
assert.ok(stripTags(features).length < 1600, 'feature grid should avoid dense text');

const demo = sectionById('demo');
assert.match(demo, /class="[^"]*\btechnical-panel\b[^"]*"/);
assert.match(demo, /class="integration-snippet"/);
assert.match(demo, /class="widget-preview-card"/);
assert.doesNotMatch(demo, /<iframe\b|data-demo-|Fill demo/i);

for (const [label, source] of [
  ['product', productHtml],
  ['pricing', pricingHtml],
  ['FAQ', faqHtml],
  ['integration', integrationHtml],
  ['changelog', changelogHtml],
]) {
  assert.doesNotMatch(source, /0\.5%|1%|capped checkout fee|fake testimonial|loved by thousands/i, `${label} should avoid stale or unsupported claims`);
}

for (const source of [html, productHtml, pricingHtml, faqHtml, integrationHtml, changelogHtml]) {
  const paragraphs = [...source.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map(match => stripTags(match[1])).filter(Boolean);
  for (const paragraph of paragraphs) {
    assert.ok(paragraph.length <= 240, `Paragraph is too long for scanability: "${paragraph.slice(0, 90)}..."`);
  }
  const headings = [...source.matchAll(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/g)].map(match => stripTags(match[1]));
  for (const heading of headings) {
    assert.ok(heading.length <= 86, `Heading is too long for responsive layout: "${heading}"`);
  }
}

assert.match(css, /\.widget-site-card\s*\{/);
assert.match(css, /\.integration-snippet\s*\{/);
assert.match(css, /\.guide-grid\s*\{/);
assert.doesNotMatch(css, /font-size:\s*[^;]*vw/, 'font sizes should not scale directly with viewport width');
assert.doesNotMatch(css, /letter-spacing:\s*-[^;]+;/, 'letter spacing should not be negative');

console.log('Sales-site design quality checks passed.');

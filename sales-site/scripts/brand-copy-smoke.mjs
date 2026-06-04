import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultPublicRoot } from '../server.mjs';

const root = defaultPublicRoot;
const pages = [
  ['home', 'index.html'],
  ['product', 'product.html'],
  ['pricing', 'pricing.html'],
  ['FAQ', 'faq.html'],
  ['integration', 'integration.html'],
  ['changelog', 'changelog.html'],
  ['terms', 'terms.html'],
  ['privacy', 'privacy.html'],
];
const css = readFileSync(new URL('assets/sales.css', root), 'utf8');
const wordmark = readFileSync(new URL('assets/trennen-wordmark.svg', root), 'utf8');

function stripVisibleText(source) {
  return String(source)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;/g, ' - ')
    .replace(/&copy;/g, 'Copyright ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const visibleTextByPage = new Map(pages.map(([label, path]) => [
  label,
  stripVisibleText(readFileSync(new URL(path, root), 'utf8')),
]));

for (const [label, text] of visibleTextByPage) {
  assert.doesNotMatch(text, /\b(Mahi3D|MAHI3D|RF DEWI|LayerWorks|Strategic Growth Solutions)\b/, `${label} should not show placeholder or sample-shop branding`);
  assert.doesNotMatch(text, /\b(revolutionary|world[- ]class|best[- ]in[- ]class|AI[- ]powered|growth hacking|unlock your potential)\b/i, `${label} should avoid generic hype`);
  assert.doesNotMatch(text, /\b(fake|testimonial from beta user|loved by thousands)\b/i, `${label} should not invent social proof`);
  assert.doesNotMatch(text, /\b0\.5%|1%|capped checkout fee|platform fee\b/i, `${label} should not show old Trennen checkout-fee copy`);
  assert.doesNotMatch(text, /\b(DNS is not live|launch-gate checklist|not be published with the canonical embed)\b/i, `${label} should not hide widget messaging behind DNS-gate copy`);
}

const homeText = visibleTextByPage.get('home');
for (const requiredPhrase of [
  'instant 3D-printing quotes',
  'embed quote tool',
  'custom domain quoting',
  'automated quoting for 3D printing',
  'No Trennen checkout fee',
  'Stripe/card processing stays separate',
]) {
  assert.match(homeText, new RegExp(requiredPhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `home should retain concrete widget positioning: ${requiredPhrase}`);
}

assert.match(wordmark, /aria-label="Trennen"/);
assert.doesNotMatch(wordmark, /gradient|linearGradient|radialGradient/i, 'wordmark should remain restrained');
assert.doesNotMatch(css, /letter-spacing:\s*-[^;]+;/, 'letter spacing should not be negative');

console.log('Sales-site brand and copy checks passed.');

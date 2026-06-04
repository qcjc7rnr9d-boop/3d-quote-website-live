import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultPublicRoot } from '../server.mjs';

const root = defaultPublicRoot;
const css = readFileSync(new URL('assets/sales.css', root), 'utf8');
const html = readFileSync(new URL('index.html', root), 'utf8');

function blockFor(selector, source = css) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`, 'm'));
  assert.ok(match, `Expected CSS block for ${selector}`);
  return match[1];
}

function mediaBlock(query) {
  const token = `@media ${query}`;
  const start = css.indexOf(token);
  assert.ok(start >= 0, `Expected media query ${query}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  assert.fail(`Expected media query ${query} to close`);
}

assert.match(blockFor('.hero'), /grid-template-columns:\s*minmax\(0,\s*0\.88fr\)\s*minmax\(500px,\s*1\.12fr\);/);
assert.match(blockFor('.product-desk'), /overflow:\s*hidden;/);
assert.match(blockFor('.widget-site-card'), /overflow:\s*hidden;/);
assert.match(blockFor('.demo-console'), /overflow:\s*hidden;/);
assert.match(blockFor('.integration-snippet'), /overflow-x:\s*auto;/);
assert.match(blockFor('.technical-panel'), /overflow:\s*hidden;/);

const tablet = mediaBlock('(max-width: 1180px)');
assert.match(tablet, /\.hero,\s*\n\s*\.story-pin\s*\{[\s\S]*?grid-template-columns:\s*1fr;/);
assert.match(tablet, /\.surface-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
assert.match(tablet, /\.guide-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr;/);
assert.match(tablet, /\.changelog-grid\s*\{[\s\S]*?grid-template-columns:\s*1fr;/);

const mobile = mediaBlock('(max-width: 860px)');
assert.match(mobile, /\.site-nav\s*\{[\s\S]*?position:\s*fixed;/);
assert.match(mobile, /\.demo-console,\s*\n\s*\.demo-brief,\s*\n\s*\.demo-path,\s*\n\s*\.demo-proof,\s*\n\s*\.pricing-grid,\s*\n\s*\.pricing-detail-grid,\s*\n\s*\.pricing-rules-shell,\s*\n\s*\.pricing-fee-map,\s*\n\s*\.surface-grid,\s*\n\s*\.product-fit-shell,\s*\n\s*\.fit-comparison,\s*\n\s*\.integration-steps\s*\{[\s\S]*?grid-template-columns:\s*1fr;/);
assert.match(mobile, /\.widget-site-card\s*\{[\s\S]*?min-height:\s*360px;/);
assert.match(mobile, /\.technical-panel\s*\{[\s\S]*?grid-template-columns:\s*1fr;/);

const smallMobile = mediaBlock('(max-width: 520px)');
assert.match(smallMobile, /\.hero-actions \.button\s*\{[\s\S]*?width:\s*100%;/);
assert.match(smallMobile, /\.hero-proof-grid\s*\{[\s\S]*?display:\s*none;/);
assert.match(smallMobile, /\.widget-code-line\s*\{[\s\S]*?white-space:\s*normal;/);

const reducedMotion = mediaBlock('(prefers-reduced-motion: reduce)');
assert.match(reducedMotion, /scroll-behavior:\s*auto !important;/);
assert.doesNotMatch(css, /100vw\s*[-+]\s*[0-9]/, 'avoid viewport-width math that causes horizontal overflow');
assert.doesNotMatch(css, /font-size:\s*[^;]*vw/, 'font sizes should not scale directly with viewport width');
assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1\.0">/);

console.log('Sales-site responsive layout checks passed.');

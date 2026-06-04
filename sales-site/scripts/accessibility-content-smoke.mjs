import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultPublicRoot } from '../server.mjs';

const root = defaultPublicRoot;
const pages = [
  ['home', 'index.html'],
  ['product', 'product.html'],
  ['how it works', 'how-it-works.html'],
  ['pricing', 'pricing.html'],
  ['FAQ', 'faq.html'],
  ['integration', 'integration.html'],
  ['changelog', 'changelog.html'],
  ['terms', 'terms.html'],
  ['privacy', 'privacy.html'],
  ['404', '404.html'],
  ['signup success', 'signup-success.html'],
];
const css = readFileSync(new URL('assets/sales.css', root), 'utf8');
const js = readFileSync(new URL('assets/sales.js', root), 'utf8');

function stripTags(value) {
  return String(value).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function attrsToMap(attrs) {
  return Object.fromEntries(
    [...attrs.matchAll(/\s([a-zA-Z_:][-a-zA-Z0-9_:.]*)="([^"]*)"/g)].map(match => [match[1], match[2]]),
  );
}

function allTags(source, tagName) {
  return [...source.matchAll(new RegExp(`<${tagName}\\b([^>]*)>`, 'gi'))].map(match => ({
    raw: match[0],
    attrs: attrsToMap(match[1]),
  }));
}

function allTagBlocks(source, tagName) {
  return [...source.matchAll(new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, 'gi'))].map(match => ({
    raw: match[0],
    attrs: attrsToMap(match[1]),
    text: stripTags(match[2]),
  }));
}

for (const [name, path] of pages) {
  const source = readFileSync(new URL(path, root), 'utf8');
  const ids = new Set([...source.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]));
  assert.equal(allTags(source, 'main').length, 1, `${name} page should have one main landmark`);
  assert.ok(source.includes('<a class="skip-link" href="#main-content">Skip to main content</a>'), `${name} page should include skip link`);
  assert.match(source, /<main\b[^>]*id="main-content"[^>]*tabindex="-1"[^>]*>/, `${name} page should make main focusable`);
  assert.equal(allTagBlocks(source, 'h1').length, 1, `${name} page should have one h1`);

  for (const section of allTags(source, 'section')) {
    const labelledBy = section.attrs['aria-labelledby'];
    const label = section.attrs['aria-label'];
    assert.ok(labelledBy || label, `${name}: section needs an accessible name: ${section.raw}`);
    if (labelledBy) assert.ok(ids.has(labelledBy), `${name}: aria-labelledby should point to an existing id: ${labelledBy}`);
  }

  for (const img of allTags(source, 'img')) {
    assert.ok(Object.hasOwn(img.attrs, 'alt'), `${name}: image should include alt text`);
    assert.ok((img.attrs.alt || '').length <= 130, `${name}: image alt text should stay concise`);
  }

  for (const link of allTagBlocks(source, 'a')) {
    const text = link.text || link.attrs['aria-label'] || link.attrs.title || '';
    assert.ok(text.trim(), `${name}: link should have accessible text`);
    assert.ok(link.attrs.href, `${name}: link should have href`);
    if (link.attrs.target === '_blank') assert.match(link.attrs.rel || '', /\bnoopener\b/, `${name}: new-tab links should use noopener`);
  }

  for (const button of allTagBlocks(source, 'button')) {
    assert.ok((button.text || button.attrs['aria-label'] || '').trim(), `${name}: button should have accessible text`);
  }
}

const home = readFileSync(new URL('index.html', root), 'utf8');
assert.match(home, /role="dialog" aria-modal="true" aria-labelledby="demoModalTitle"/);
assert.match(home, /role="dialog" aria-modal="true" aria-labelledby="signupPlanTitle"/);
assert.match(css, /\.button\s*\{[\s\S]*?min-height:\s*48px;/, 'primary buttons should meet touch target height');
assert.match(css, /\.demo-panel \.signup-close\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/, 'walkthrough close button should be easy to hit');
assert.match(js, /trapModalFocus/);
assert.match(js, /Escape/);
assert.match(js, /lastDemoTrigger\.focus/);
assert.match(js, /lastSignupTrigger\.focus/);

console.log('Sales-site accessibility and content structure checks passed.');

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const html = readFileSync(join(__dirname, 'prospects.html'), 'utf8');

test('company brief drawer renders scan-friendly sales prep sections', () => {
  assert.match(html, /Brief Snapshot/);
  assert.match(html, /Main pitch angle/);
  assert.match(html, /Current quote-flow issue/);
  assert.match(html, /Why this company is a fit/);
  assert.match(html, /How Trennen helps/);
  assert.match(html, /Other services note/);
  assert.match(html, /Evidence/);
  assert.match(html, /brief-snapshot/);
  assert.match(html, /brief-angle-card/);
  assert.match(html, /brief-info-grid/);
});

test('discovery UI asks for new stores and sends newLeadTarget with known keys', () => {
  assert.match(html, /New stores to find/);
  assert.doesNotMatch(html, /<label for="maxQueries">Queries<\/label>/);
  assert.match(html, /newLeadTarget:\s*\$\('newLeadTarget'\)\.value/);
  assert.match(html, /knownLeadKeys/);
  assert.match(html, /requested/);
  assert.match(html, /new businesses/);
  assert.match(html, /searches attempted/);
});

test('outreach workflow UI exposes simple pipeline actions and selected downloads', () => {
  assert.match(html, /Download selected/);
  assert.match(html, /Email list CSV/);
  assert.match(html, /Call sheet CSV/);
  assert.match(html, /Outreach Notes/);
  assert.match(html, /Pipeline status/);
  assert.match(html, /Mark called/);
  assert.match(html, /Mark emailed/);
  assert.match(html, /Interested/);
  assert.match(html, /Not interested/);
  assert.match(html, /Follow up/);
  assert.doesNotMatch(html, /Email-list status/);
});

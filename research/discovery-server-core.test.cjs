const test = require('node:test');
const assert = require('node:assert/strict');

const {
  leadMergeKey,
  mergeLeadLists,
  normalizeNewLeadTarget,
  parseEnvText,
  sanitizeKnownLeadKeys,
} = require('./discovery-server-core.cjs');

test('parseEnvText reads GOOGLE_PLACES_API_KEY without exposing comments', () => {
  const env = parseEnvText(`
    # local file
    GOOGLE_PLACES_API_KEY=abc123
    OTHER=value
  `);

  assert.equal(env.GOOGLE_PLACES_API_KEY, 'abc123');
  assert.equal(env.OTHER, 'value');
});

test('leadMergeKey prefers stable discovery identifiers', () => {
  assert.equal(leadMergeKey({ google_place_id: 'places/abc', website: 'https://example.nz' }), 'place:places/abc');
  assert.equal(leadMergeKey({ website: 'https://www.example.nz/' }), 'web:example.nz');
  assert.equal(leadMergeKey({ contact_email: 'HELLO@EXAMPLE.NZ' }), 'email:hello@example.nz');
});

test('sanitizeKnownLeadKeys accepts safe identity keys and limits malformed values', () => {
  const keys = sanitizeKnownLeadKeys([
    ' web:example.nz ',
    'place:places/abc',
    'bad key with spaces',
    '',
    null,
    'email:hello@example.nz',
    'x'.repeat(220),
  ]);

  assert.deepEqual(keys, ['web:example.nz', 'place:places/abc', 'email:hello@example.nz']);
});

test('normalizeNewLeadTarget defaults and clamps requested fresh stores', () => {
  assert.equal(normalizeNewLeadTarget(undefined), 10);
  assert.equal(normalizeNewLeadTarget('25'), 25);
  assert.equal(normalizeNewLeadTarget('0'), 1);
  assert.equal(normalizeNewLeadTarget('999'), 100);
});

test('mergeLeadLists updates duplicates and preserves existing manual fields', () => {
  const merged = mergeLeadLists([
    {
      company_name: 'Maker Lab',
      website: 'https://maker.example',
      status: 'ready',
      notes: 'manual note',
      pitch_angle: 'manual pitch',
      target_reason: 'manual target reason',
    },
  ], [
    {
      company_name: 'Maker Lab Ltd',
      website: 'https://maker.example/',
      google_review_count: 12,
      status: 'research',
      custom_fdm_status: 'target_confirmed',
      service_model: 'custom_fdm_service',
      target_reason: 'Generated target reason.',
      pitch_angle: 'generated pitch',
    },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].company_name, 'Maker Lab Ltd');
  assert.equal(merged[0].status, 'ready');
  assert.equal(merged[0].notes, 'manual note');
  assert.equal(merged[0].pitch_angle, 'manual pitch');
  assert.equal(merged[0].target_reason, 'manual target reason');
  assert.equal(merged[0].google_review_count, 12);
  assert.equal(merged[0].custom_fdm_status, 'target_confirmed');
  assert.equal(merged[0].service_model, 'custom_fdm_service');
});

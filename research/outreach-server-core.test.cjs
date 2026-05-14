const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildResendEmailPayload,
  normalizeOutreachEnv,
  deckPdfFilename,
  assertPdfBuffer,
  sanitizeSuppressionKeys,
} = require('./outreach-server-core.cjs');

test('normalizeOutreachEnv requires archive email before real sending', () => {
  const missing = normalizeOutreachEnv({
    RESEND_API_KEY: 're_test',
    OUTREACH_FROM_EMAIL: 'hello@trennen.co.nz',
    OUTREACH_FROM_NAME: 'Daniel',
    OUTREACH_REPLY_TO: 'hello@trennen.co.nz',
  });

  assert.equal(missing.ready, false);
  assert.match(missing.errors.join(' '), /archive/i);

  const ready = normalizeOutreachEnv({
    RESEND_API_KEY: 're_test',
    OUTREACH_FROM_EMAIL: 'hello@trennen.co.nz',
    OUTREACH_FROM_NAME: 'Daniel',
    OUTREACH_REPLY_TO: 'hello@trennen.co.nz',
    OUTREACH_ARCHIVE_EMAIL: 'archive@trennen.co.nz',
  });

  assert.equal(ready.ready, true);
  assert.equal(ready.from, 'Daniel <hello@trennen.co.nz>');
  assert.equal(ready.archiveEmail, 'archive@trennen.co.nz');
});

test('buildResendEmailPayload always includes mandatory archive bcc and PDF attachment', () => {
  const payload = buildResendEmailPayload({
    config: normalizeOutreachEnv({
      RESEND_API_KEY: 're_test',
      OUTREACH_FROM_EMAIL: 'hello@trennen.co.nz',
      OUTREACH_FROM_NAME: 'Daniel',
      OUTREACH_REPLY_TO: 'reply@trennen.co.nz',
      OUTREACH_ARCHIVE_EMAIL: 'archive@trennen.co.nz',
    }).config,
    to: 'owner@example.test',
    subject: 'quick thought',
    text: 'human email copy',
    html: '<p>human email copy</p>',
    pdfBuffer: Buffer.from('%PDF-1.4\nmock\n%%EOF'),
    pdfFilename: 'deck.pdf',
  });

  assert.deepEqual(payload.to, ['owner@example.test']);
  assert.deepEqual(payload.bcc, ['archive@trennen.co.nz']);
  assert.equal(payload.attachments[0].filename, 'deck.pdf');
  assert.equal(payload.attachments[0].content, Buffer.from('%PDF-1.4\nmock\n%%EOF').toString('base64'));
});

test('deckPdfFilename creates a safe company-specific filename', () => {
  assert.equal(deckPdfFilename({ company_name: 'Auckland 3D / Prints!' }), 'trennen-auckland-3d-prints-pitch-deck.pdf');
});

test('assertPdfBuffer rejects missing or non-pdf output', () => {
  assert.throws(() => assertPdfBuffer(Buffer.from('not a pdf')), /PDF generation failed/i);
  assert.doesNotThrow(() => assertPdfBuffer(Buffer.from('%PDF-1.4\nhello\n%%EOF')));
});

test('sanitizeSuppressionKeys keeps only normalized identity keys', () => {
  assert.deepEqual(
    sanitizeSuppressionKeys([' email:STOP@EXAMPLE.TEST ', 'bad key', 'web:example.test']),
    ['email:stop@example.test', 'web:example.test']
  );
});

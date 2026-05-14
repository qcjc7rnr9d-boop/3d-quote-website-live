const researchCore = require('./prospect-research-core.js');

function cleanText(value, max = 1000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function cleanEmail(value) {
  return cleanText(value, 240).toLowerCase();
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail(value));
}

function formatFrom(name, email) {
  const cleanName = cleanText(name, 120).replace(/["<>]/g, '');
  return cleanName ? `${cleanName} <${email}>` : email;
}

function normalizeOutreachEnv(env = {}) {
  const apiKey = cleanText(env.RESEND_API_KEY, 500);
  const fromEmail = cleanEmail(env.OUTREACH_FROM_EMAIL);
  const fromName = cleanText(env.OUTREACH_FROM_NAME || 'Trennen', 120);
  const replyTo = cleanEmail(env.OUTREACH_REPLY_TO || fromEmail);
  const archiveEmail = cleanEmail(env.OUTREACH_ARCHIVE_EMAIL);
  const errors = [];

  if (!apiKey) errors.push('Missing RESEND_API_KEY in research/.env.');
  if (!isEmail(fromEmail)) errors.push('Missing valid OUTREACH_FROM_EMAIL in research/.env.');
  if (!isEmail(replyTo)) errors.push('Missing valid OUTREACH_REPLY_TO in research/.env.');
  if (!isEmail(archiveEmail)) errors.push('Missing valid OUTREACH_ARCHIVE_EMAIL in research/.env. Archive BCC is mandatory.');

  const config = {
    apiKey,
    fromEmail,
    fromName,
    from: isEmail(fromEmail) ? formatFrom(fromName, fromEmail) : '',
    replyTo,
    archiveEmail,
    ready: errors.length === 0,
  };

  return {
    ready: errors.length === 0,
    errors,
    config,
    from: config.from,
    archiveEmail,
  };
}

function deckPdfFilename(lead = {}) {
  const slug = cleanText(lead.company_name || lead.company || 'prospect', 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'prospect';
  return `trennen-${slug}-pitch-deck.pdf`;
}

function assertPdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 10 || buffer.slice(0, 5).toString() !== '%PDF-') {
    throw new Error('PDF generation failed: renderer did not return a valid PDF file.');
  }
  return buffer;
}

function sanitizeSuppressionKeys(keys = []) {
  return researchCore.sanitizeIdentityKeys(
    (Array.isArray(keys) ? keys : []).map(key => {
      const text = cleanText(key, 180);
      return text.startsWith('email:') ? `email:${text.slice(6).toLowerCase()}` : text;
    })
  );
}

function buildResendEmailPayload({ config, to, subject, text, html, pdfBuffer, pdfFilename }) {
  if (!config?.archiveEmail) throw new Error('Archive BCC email is required for every outreach send.');
  assertPdfBuffer(pdfBuffer);
  const recipient = cleanEmail(to);
  if (!isEmail(recipient)) throw new Error('A valid recipient email is required.');
  if (!cleanText(subject, 300)) throw new Error('Email subject is required.');
  if (!cleanText(text, 10000)) throw new Error('Email text is required.');

  return {
    from: config.from,
    to: [recipient],
    bcc: [config.archiveEmail],
    reply_to: [config.replyTo],
    subject: cleanText(subject, 300),
    text,
    html,
    attachments: [
      {
        filename: cleanText(pdfFilename, 180) || 'trennen-pitch-deck.pdf',
        content: pdfBuffer.toString('base64'),
      },
    ],
  };
}

function safeArchiveRecord(record = {}) {
  return {
    sent_at: new Date().toISOString(),
    recipient: cleanEmail(record.recipient),
    company_name: cleanText(record.company_name, 180),
    subject: cleanText(record.subject, 300),
    body: cleanText(record.body, 12000),
    deck_filename: cleanText(record.deck_filename, 220),
    resend_id: cleanText(record.resend_id, 240),
    provider: 'resend',
    result: cleanText(record.result || 'sent', 120),
  };
}

module.exports = {
  assertPdfBuffer,
  buildResendEmailPayload,
  cleanEmail,
  deckPdfFilename,
  normalizeOutreachEnv,
  safeArchiveRecord,
  sanitizeSuppressionKeys,
};

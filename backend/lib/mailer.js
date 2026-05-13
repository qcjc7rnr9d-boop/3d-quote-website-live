/**
 * Unified outbound-mail helper.
 *
 * Chooses a provider in this order:
 *   1. Resend HTTP API   — set RESEND_API_KEY  (recommended, modern transactional)
 *   2. SMTP via nodemailer — set SMTP_HOST     (Google Workspace, M365, generic SMTP)
 *   3. Ethereal dev account — no config        (captures messages, logs preview URL)
 *
 * Call sites only need to know about `sendMail(...)`. Swapping providers
 * means changing environment variables; no application code changes.
 *
 * Required env (Resend path):
 *   RESEND_API_KEY=re_xxx
 *   EMAIL_FROM="Mahi3d <hello@yourdomain.com>"   ← verified domain in Resend
 *
 * Required env (SMTP path):
 *   SMTP_HOST   e.g. smtp.gmail.com
 *   SMTP_PORT   default 587
 *   SMTP_SECURE 'true' for port 465 / TLS-on-connect
 *   SMTP_USER
 *   SMTP_PASS
 *   EMAIL_FROM  (or SMTP_FROM)
 */

import nodemailer from 'nodemailer';

const RESEND_API_URL = 'https://api.resend.com/emails';

// ── Provider selection ──────────────────────────────────────
export function currentProvider() {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SMTP_HOST)      return 'smtp';
  return 'dev';
}

// ── Resend HTTP API ─────────────────────────────────────────
async function sendViaResend(msg) {
  const body = {
    from:    msg.from,
    to:      Array.isArray(msg.to) ? msg.to : [msg.to],
    subject: msg.subject,
  };
  if (msg.html)    body.html     = msg.html;
  if (msg.text)    body.text     = msg.text;
  if (msg.replyTo) body.reply_to = Array.isArray(msg.replyTo) ? msg.replyTo : [msg.replyTo];
  if (msg.cc)      body.cc       = Array.isArray(msg.cc) ? msg.cc : [msg.cc];
  if (msg.bcc)     body.bcc      = Array.isArray(msg.bcc) ? msg.bcc : [msg.bcc];

  const res = await fetch(RESEND_API_URL, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || `Resend ${res.status}`);
    err.code   = data.name || 'RESEND_ERROR';
    err.status = res.status;
    throw err;
  }
  return { ok: true, id: data.id, provider: 'resend' };
}

// ── SMTP via nodemailer ─────────────────────────────────────
let _smtpTransporter = null;
function getSmtpTransporter() {
  if (_smtpTransporter) return _smtpTransporter;
  _smtpTransporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return _smtpTransporter;
}

async function sendViaSmtp(msg) {
  const info = await getSmtpTransporter().sendMail(stripUndefined({
    from:    msg.from,
    to:      msg.to,
    cc:      msg.cc,
    bcc:     msg.bcc,
    replyTo: msg.replyTo,
    subject: msg.subject,
    text:    msg.text,
    html:    msg.html,
  }));
  return { ok: true, id: info.messageId, provider: 'smtp' };
}

// ── Ethereal dev fallback ───────────────────────────────────
let _devAccount     = null;
let _devTransporter = null;
async function getDevTransporter() {
  if (_devTransporter) return _devTransporter;
  _devAccount     = await nodemailer.createTestAccount();
  _devTransporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    auth: { user: _devAccount.user, pass: _devAccount.pass },
  });
  console.log('\n📧 [mailer] No RESEND_API_KEY / SMTP_HOST set — using Ethereal dev mode.');
  console.log(`   Ethereal user: ${_devAccount.user}`);
  console.log('   Real emails will NOT be delivered until you configure a provider in .env\n');
  return _devTransporter;
}

async function sendViaDev(msg) {
  const transporter = await getDevTransporter();
  const info = await transporter.sendMail(stripUndefined({
    from:    msg.from,
    to:      msg.to,
    cc:      msg.cc,
    bcc:     msg.bcc,
    replyTo: msg.replyTo,
    subject: msg.subject,
    text:    msg.text,
    html:    msg.html,
  }));
  const previewUrl = nodemailer.getTestMessageUrl(info);
  if (previewUrl) console.log(`📬 [mailer] Dev preview: ${previewUrl}`);
  return { ok: true, id: info.messageId, previewUrl, provider: 'dev' };
}

// ── Public API ──────────────────────────────────────────────
/**
 * Send an email through the configured provider.
 *
 * @param {object} opts
 * @param {string|string[]} opts.to     Recipient(s)
 * @param {string} opts.subject         Subject line
 * @param {string} [opts.text]          Plain-text body
 * @param {string} [opts.html]          HTML body
 * @param {string} [opts.from]          Defaults to EMAIL_FROM / SMTP_FROM env
 * @param {string|string[]} [opts.replyTo]
 * @param {string|string[]} [opts.cc]
 * @param {string|string[]} [opts.bcc]
 * @returns {Promise<{ok: true, id: string, provider: string, previewUrl?: string}>}
 */
export async function sendMail(opts) {
  if (!opts || !opts.to || !opts.subject) {
    throw new Error('sendMail requires at least { to, subject }');
  }
  const from =
    opts.from
    || process.env.EMAIL_FROM
    || process.env.SMTP_FROM
    || process.env.SMTP_USER
    || 'noreply@example.com';
  const msg = { ...opts, from };

  const provider = currentProvider();
  if (provider === 'resend') return sendViaResend(msg);
  if (provider === 'smtp')   return sendViaSmtp(msg);
  return sendViaDev(msg);
}

function stripUndefined(o) {
  const out = {};
  for (const k in o) if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
  return out;
}

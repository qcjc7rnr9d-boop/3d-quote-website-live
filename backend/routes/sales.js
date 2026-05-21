import express from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../middleware/auth.js';
import { sendMail } from '../lib/mailer.js';

const router = express.Router();

const VOLUME_OPTIONS = new Set(['1-25', '26-100', '101-300', '300+']);
const RATE_LIMIT_MAX = Math.max(3, Number(process.env.SALES_DEMO_RATE_LIMIT_MAX || 20));

export function ensureSalesDemoRequestsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales_demo_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL COLLATE NOCASE,
      company TEXT NOT NULL,
      monthly_quote_volume TEXT NOT NULL,
      message TEXT NOT NULL,
      source_path TEXT,
      ip TEXT,
      user_agent TEXT,
      delivery_status TEXT NOT NULL DEFAULT 'not_configured',
      delivery_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sales_demo_requests_email
      ON sales_demo_requests(email, created_at);
    CREATE INDEX IF NOT EXISTS idx_sales_demo_requests_created
      ON sales_demo_requests(created_at);
  `);
}

ensureSalesDemoRequestsTable();

function text(value, max = 500) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function messageText(value) {
  return String(value || '').trim().slice(0, 1600);
}

function validEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (email.length > 254 || email.includes('..')) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function esc(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function normaliseLead(body = {}) {
  const lead = {
    name: text(body.name, 120),
    email: text(body.email, 254).toLowerCase(),
    company: text(body.company, 160),
    monthlyQuoteVolume: text(body.monthlyQuoteVolume || body.volume, 40),
    message: messageText(body.message),
    sourcePath: text(body.sourcePath || body.source_path, 300),
    website: text(body.website, 300),
  };

  const errors = {};
  if (!lead.name) errors.name = 'Enter your name.';
  if (!lead.email) errors.email = 'Enter your work email.';
  else if (!validEmail(lead.email)) errors.email = 'Enter a valid work email.';
  if (!lead.company) errors.company = 'Enter your company name.';
  if (!VOLUME_OPTIONS.has(lead.monthlyQuoteVolume)) errors.monthlyQuoteVolume = 'Select a monthly quote range.';
  if (!lead.message) errors.message = 'Tell us what Trennen should help with.';
  return { lead, errors };
}

function insertLead(lead, req) {
  const result = db.prepare(`
    INSERT INTO sales_demo_requests (
      name, email, company, monthly_quote_volume, message,
      source_path, ip, user_agent, delivery_status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'not_configured')
  `).run(
    lead.name,
    lead.email,
    lead.company,
    lead.monthlyQuoteVolume,
    lead.message,
    lead.sourcePath || null,
    req.ip || null,
    req.get('user-agent') || null,
  );
  return Number(result.lastInsertRowid);
}

function updateDelivery(id, status, error = null) {
  db.prepare(`
    UPDATE sales_demo_requests
    SET delivery_status = ?, delivery_error = ?
    WHERE id = ?
  `).run(status, error ? String(error).slice(0, 500) : null, id);
}

async function deliverLeadEmail(id, lead) {
  const to = text(process.env.SALES_DEMO_TO || process.env.PLATFORM_SALES_EMAIL, 254);
  if (!to) {
    updateDelivery(id, 'not_configured');
    return { status: 'not_configured' };
  }

  const subject = `Trennen demo request: ${lead.company}`;
  const textBody = [
    'New Trennen demo request',
    '',
    `Name: ${lead.name}`,
    `Email: ${lead.email}`,
    `Company: ${lead.company}`,
    `Monthly quote volume: ${lead.monthlyQuoteVolume}`,
    lead.sourcePath ? `Source: ${lead.sourcePath}` : null,
    '',
    lead.message,
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;color:#101114;line-height:1.55;">
      <p style="margin:0 0 10px;color:#557b61;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">Trennen demo request</p>
      <h1 style="margin:0 0 18px;font-size:28px;line-height:1.1;">${esc(lead.company)}</h1>
      <table style="border-collapse:collapse;width:100%;max-width:620px;">
        <tr><td style="padding:8px 0;color:#62666f;">Name</td><td style="padding:8px 0;font-weight:700;">${esc(lead.name)}</td></tr>
        <tr><td style="padding:8px 0;color:#62666f;">Email</td><td style="padding:8px 0;font-weight:700;">${esc(lead.email)}</td></tr>
        <tr><td style="padding:8px 0;color:#62666f;">Volume</td><td style="padding:8px 0;font-weight:700;">${esc(lead.monthlyQuoteVolume)}</td></tr>
        ${lead.sourcePath ? `<tr><td style="padding:8px 0;color:#62666f;">Source</td><td style="padding:8px 0;font-weight:700;">${esc(lead.sourcePath)}</td></tr>` : ''}
      </table>
      <div style="margin-top:18px;padding:16px;border-radius:12px;background:#f5f5f2;border:1px solid #e2e3dc;white-space:pre-line;">${esc(lead.message)}</div>
    </div>`;

  try {
    const result = await sendMail({
      to,
      replyTo: lead.email,
      subject,
      text: textBody,
      html,
    });
    updateDelivery(id, 'queued');
    return { status: 'queued', provider: result.provider };
  } catch (err) {
    updateDelivery(id, 'failed', err.message);
    console.error('Sales demo request delivery failed:', err.message);
    return { status: 'failed' };
  }
}

const demoRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: 'Too many demo requests from this connection. Try again later.',
  },
});

router.post('/demo-request', demoRequestLimiter, async (req, res) => {
  const { lead, errors } = normaliseLead(req.body);

  if (lead.website) {
    return res.status(204).end();
  }

  if (Object.keys(errors).length) {
    return res.status(400).json({ ok: false, errors });
  }

  const id = insertLead(lead, req);
  const delivery = await deliverLeadEmail(id, lead);
  return res.status(201).json({ ok: true, id, delivery });
});

export default router;

import { db } from '../middleware/auth.js';
import {
  recordResendWebhookEvent,
  verifyResendWebhookPayload,
} from '../lib/email-delivery.js';

export function resendWebhookHandler(req, res) {
  const secret = process.env.RESEND_WEBHOOK_SECRET || '';
  if (!secret) {
    return res.status(503).json({ error: 'Resend webhook secret is not configured.' });
  }
  if (!verifyResendWebhookPayload(req.body, req.headers, secret)) {
    return res.status(400).json({ error: 'Invalid webhook signature.' });
  }

  let event;
  try {
    event = JSON.parse(Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '{}'));
  } catch {
    return res.status(400).json({ error: 'Invalid webhook payload.' });
  }

  try {
    recordResendWebhookEvent(db, event);
  } catch (err) {
    console.error('Resend webhook processing error:', err);
    return res.status(500).json({ error: 'Webhook processing failed.' });
  }

  res.json({ received: true });
}

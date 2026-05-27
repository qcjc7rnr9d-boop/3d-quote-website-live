import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';

import { renderTemplate } from '../lib/email-templates/index.js';
import { sendMail } from '../lib/mailer.js';
import {
  buildEmailIdempotencyKey,
  ensureEmailDeliverySchema,
  isRecipientSuppressed,
  recordResendWebhookEvent,
  verifyResendWebhookPayload,
} from '../lib/email-delivery.js';

const db = new DatabaseSync('data/rfdewi.db');
const originalEnv = {
  APP_EMAIL_DOMAIN: process.env.APP_EMAIL_DOMAIN,
  APP_EMAIL_FALLBACK: process.env.APP_EMAIL_FALLBACK,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
  EMAIL_FROM: process.env.EMAIL_FROM,
  SMTP_HOST: process.env.SMTP_HOST,
};
const originalFetch = globalThis.fetch;
const slug = `mail-smoke-${randomUUID().slice(0, 8)}`;
let shopId = null;

function signSvix({ id, timestamp, payload, secret }) {
  const rawSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  const digest = createHmac('sha256', Buffer.from(rawSecret, 'base64'))
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64');
  return `v1,${digest}`;
}

try {
  ensureEmailDeliverySchema(db);
  delete process.env.SMTP_HOST;
  delete process.env.EMAIL_FROM;
  process.env.RESEND_API_KEY = 're_reliable_email_smoke';
  process.env.APP_EMAIL_DOMAIN = 'mail.platform.test';
  process.env.APP_EMAIL_FALLBACK = 'Trennen <hello@mail.platform.test>';
  process.env.RESEND_WEBHOOK_SECRET = `whsec_${Buffer.from('reliable-email-webhook-secret').toString('base64')}`;

  const hash = await bcrypt.hash('ReliableEmail!2026', 4);
  const created = db.prepare(`
    INSERT INTO shops (name, slug, email, password_hash, is_temp_password, plan)
    VALUES (?, ?, ?, ?, 0, 'starter')
  `).run('Reliable Email Smoke', slug, `${slug}@example.test`, hash);
  shopId = created.lastInsertRowid;
  db.prepare(`
    INSERT INTO store_settings (
      shop_id,
      support_email_mode,
      support_email,
      email_sending_domain,
      email_sending_domain_status,
      email_sending_domain_records,
      email_use_platform_fallback
    ) VALUES (?, 'custom', ?, 'quotes.client.test', 'verified', ?, 1)
  `).run(
    shopId,
    `support@${slug}.example.test`,
    JSON.stringify([{ type: 'TXT', name: 'quotes.client.test', value: 'resend-domain-verification=abc123' }]),
  );

  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId);
  const verifiedTpl = renderTemplate('test_notification', { shop, recipientName: 'Email QA' });
  assert.match(verifiedTpl.from, /<alerts@quotes\.client\.test>$/, 'verified client domain should use category local part');
  assert.equal(verifiedTpl.replyTo, `support@${slug}.example.test`, 'Reply-To should use the shop support inbox');
  const rawResetToken = `reset-${slug}-secret-token`;
  const resetKey = buildEmailIdempotencyKey('customer-reset', shopId, rawResetToken);
  assert.equal(resetKey, buildEmailIdempotencyKey('customer-reset', shopId, rawResetToken), 'hashed email idempotency keys should be stable');
  assert.equal(resetKey.includes(rawResetToken), false, 'email idempotency keys must not contain reset tokens');

  db.prepare(`
    UPDATE store_settings
    SET email_sending_domain_status = 'pending',
        email_sending_domain_verified_at = NULL
    WHERE shop_id = ?
  `).run(shopId);
  const fallbackTpl = renderTemplate('test_notification', { shop, recipientName: 'Email QA' });
  assert.match(fallbackTpl.from, new RegExp(`<${slug}-alerts@mail\\.platform\\.test>$`), 'unverified client domain should use platform fallback');
  delete process.env.APP_EMAIL_DOMAIN;
  const fallbackOnlyTpl = renderTemplate('test_notification', { shop, recipientName: 'Email QA' });
  assert.match(fallbackOnlyTpl.from, /<hello@mail\.platform\.test>$/, 'full APP_EMAIL_FALLBACK values should be reduced to the fallback email address');
  process.env.APP_EMAIL_DOMAIN = 'mail.platform.test';

  const fetchCalls = [];
  globalThis.fetch = async (url, options) => {
    fetchCalls.push({ url, options, body: JSON.parse(options.body) });
    if (fetchCalls.length === 1) {
      return { ok: false, status: 503, json: async () => ({ message: 'try later', name: 'rate_limited' }) };
    }
    return { ok: true, status: 200, json: async () => ({ id: 'resend_smoke_1' }) };
  };

  const sent = await sendMail({
    shopId,
    shopSlug: shop.slug,
    templateId: fallbackTpl.templateId,
    category: fallbackTpl.category,
    to: 'customer@example.test',
    from: fallbackTpl.from,
    replyTo: fallbackTpl.replyTo,
    subject: fallbackTpl.subject,
    text: fallbackTpl.text,
    html: fallbackTpl.html,
    idempotencyKey: `smoke-${slug}`,
  });
  assert.equal(sent.provider, 'resend');
  assert.equal(fetchCalls.length, 2, 'transient Resend failures should retry once');
  assert.equal(
    fetchCalls[0].options.headers['Idempotency-Key'],
    fetchCalls[1].options.headers['Idempotency-Key'],
    'Resend retries should reuse one idempotency key',
  );
  assert.deepEqual(fetchCalls[1].body.tags, [
    { name: 'template', value: 'test_notification' },
    { name: 'category', value: 'alerts' },
    { name: 'shop', value: slug },
  ]);

  const logged = db.prepare('SELECT * FROM email_delivery_events WHERE idempotency_key = ?').get(`smoke-${slug}`);
  assert.equal(logged.status, 'sent');
  assert.equal(logged.provider_message_id, 'resend_smoke_1');
  assert.equal(logged.recipient_email, 'customer@example.test');
  const logColumns = db.prepare('PRAGMA table_info(email_delivery_events)').all().map(row => row.name);
  for (const forbidden of ['html', 'text', 'body', 'subject', 'reset_token', 'secret_key']) {
    assert.equal(logColumns.includes(forbidden), false, `email log must not include ${forbidden}`);
  }

  const deduped = await sendMail({
    shopId,
    shopSlug: shop.slug,
    templateId: fallbackTpl.templateId,
    category: fallbackTpl.category,
    to: 'customer@example.test',
    from: fallbackTpl.from,
    replyTo: fallbackTpl.replyTo,
    subject: fallbackTpl.subject,
    text: fallbackTpl.text,
    html: fallbackTpl.html,
    idempotencyKey: `smoke-${slug}`,
  });
  assert.equal(deduped.deduped, true, 'same idempotency key should not send a duplicate email');
  assert.equal(fetchCalls.length, 2, 'deduped send should not call Resend again');

  db.prepare(`
    INSERT INTO email_suppressions (email, reason, event_type)
    VALUES ('blocked@example.test', 'complained', 'email.complained')
  `).run();
  await assert.rejects(
    () => sendMail({
      shopId,
      templateId: 'test_notification',
      category: 'alerts',
      to: 'blocked@example.test',
      from: fallbackTpl.from,
      subject: 'Suppressed',
      text: 'No send',
    }),
    err => err.code === 'EMAIL_SUPPRESSED',
  );

  const payload = JSON.stringify({
    type: 'email.bounced',
    data: {
      email_id: 'resend_smoke_1',
      to: ['customer@example.test'],
      bounce: { type: 'hard' },
    },
  });
  const headers = {
    'svix-id': 'msg_smoke',
    'svix-timestamp': String(Math.floor(Date.now() / 1000)),
    'svix-signature': signSvix({
      id: 'msg_smoke',
      timestamp: String(Math.floor(Date.now() / 1000)),
      payload,
      secret: process.env.RESEND_WEBHOOK_SECRET,
    }),
  };
  assert.equal(verifyResendWebhookPayload(Buffer.from(payload), headers, process.env.RESEND_WEBHOOK_SECRET), true);
  assert.equal(verifyResendWebhookPayload(Buffer.from(payload), { ...headers, 'svix-signature': 'v1,bad' }, process.env.RESEND_WEBHOOK_SECRET), false);
  const recorded = recordResendWebhookEvent(db, JSON.parse(payload));
  assert.equal(recorded.status, 'bounced');
  assert.equal(isRecipientSuppressed(db, 'customer@example.test'), true, 'bounced recipient should be suppressed');

  console.log('Reliable email smoke checks passed.');
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (shopId) {
    db.prepare('DELETE FROM email_delivery_events WHERE shop_id = ?').run(shopId);
    db.prepare('DELETE FROM shops WHERE id = ?').run(shopId);
  }
  db.prepare("DELETE FROM email_suppressions WHERE email IN ('blocked@example.test', 'customer@example.test')").run();
  db.close();
}

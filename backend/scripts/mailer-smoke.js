import { sendMail, mailerStatus } from '../lib/mailer.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const originalEnv = {
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  SMTP_HOST: process.env.SMTP_HOST,
  EMAIL_FROM: process.env.EMAIL_FROM,
};
const originalFetch = globalThis.fetch;

try {
  delete process.env.SMTP_HOST;
  process.env.RESEND_API_KEY = 're_test_local_only';
  process.env.EMAIL_FROM = 'Trennen QA <qa@example.test>';

  const status = mailerStatus();
  assert(status.provider === 'resend', `Expected Resend provider, got ${status.provider}`);
  assert(status.from === 'Trennen QA <qa@example.test>', 'Mailer did not use EMAIL_FROM');

  let captured = null;
  globalThis.fetch = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'email_local_smoke' }),
    };
  };

  const sent = await sendMail({
    to: 'USER+Alias@Sub.Example.test',
    subject: 'Smoke message',
    text: 'This is a local smoke test.',
    replyTo: 'support@example.test',
  });
  assert(sent.ok && sent.provider === 'resend', 'sendMail did not report a Resend success');
  assert(captured.url.includes('api.resend.com/emails'), 'Resend API URL was not used');
  assert(captured.options.headers.Authorization === 'Bearer re_test_local_only', 'Resend auth header missing');
  assert(captured.body.to[0] === 'USER+Alias@Sub.Example.test', 'Mailer should preserve caller-supplied recipient casing');
  assert(captured.body.reply_to[0] === 'support@example.test', 'Mailer did not map replyTo');

  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ message: 'provider unavailable', name: 'RESEND_UNAVAILABLE' }),
  });
  let failed = false;
  try {
    await sendMail({ to: 'person@example.test', subject: 'Failure path', text: 'No send.' });
  } catch (err) {
    failed = true;
    assert(err.status === 503, 'Resend failure should preserve provider status');
    assert(err.code === 'RESEND_UNAVAILABLE', 'Resend failure should preserve provider code');
  }
  assert(failed, 'sendMail should throw when provider returns an error');

  let missingFields = false;
  try {
    await sendMail({ to: '', subject: '' });
  } catch (err) {
    missingFields = true;
    assert(/requires/.test(err.message), 'Missing-field error should explain required fields');
  }
  assert(missingFields, 'sendMail should reject missing to/subject before provider calls');

  console.log('Mailer smoke checks passed.');
} finally {
  globalThis.fetch = originalFetch;
  if (originalEnv.RESEND_API_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalEnv.RESEND_API_KEY;
  if (originalEnv.SMTP_HOST === undefined) delete process.env.SMTP_HOST;
  else process.env.SMTP_HOST = originalEnv.SMTP_HOST;
  if (originalEnv.EMAIL_FROM === undefined) delete process.env.EMAIL_FROM;
  else process.env.EMAIL_FROM = originalEnv.EMAIL_FROM;
}

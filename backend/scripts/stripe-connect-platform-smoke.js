import dotenv from 'dotenv';
import Stripe from 'stripe';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
const baseUrl = String(process.env.BASE_URL || 'https://app.trennen.co.nz').trim();

function fail(payload) {
  console.log(JSON.stringify({ ok: false, ...payload }, null, 2));
  process.exit(1);
}

if (!secretKey) {
  fail({ error: 'STRIPE_SECRET_KEY is missing.' });
}

if (secretKey.startsWith('sk_live_') && process.env.ALLOW_LIVE_STRIPE_CONNECT_SMOKE !== '1') {
  fail({
    error: 'Refusing to run Stripe Connect smoke with a live secret key.',
    hint: 'Use test mode, or set ALLOW_LIVE_STRIPE_CONNECT_SMOKE=1 only for an intentional live verification.',
  });
}

const stripe = new Stripe(secretKey);
let accountId = null;

try {
  const account = await stripe.accounts.create({
    type: 'express',
    country: 'NZ',
    email: `connect-test-${Date.now()}@trennen.co.nz`,
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    business_profile: {
      name: 'Trennen Connect Smoke Test',
    },
    metadata: {
      purpose: 'connect-platform-smoke',
    },
  });

  accountId = account.id;

  await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${baseUrl}/stripe-callback.html?refresh=1`,
    return_url: `${baseUrl}/stripe-callback.html`,
    type: 'account_onboarding',
  });

  const deleted = await stripe.accounts.del(accountId);
  console.log(JSON.stringify({
    ok: true,
    created: true,
    accountLinkCreated: true,
    deleted: !!deleted.deleted,
    accountId,
  }, null, 2));
} catch (err) {
  if (accountId) {
    try {
      await stripe.accounts.del(accountId);
    } catch {
      // Best-effort cleanup only. Report the original failure below.
    }
  }

  fail({
    created: false,
    type: err.type || null,
    code: err.code || null,
    message: err.message || 'Stripe Connect smoke failed.',
    requestId: err.requestId || err.raw?.requestId || null,
    statusCode: err.statusCode || null,
  });
}

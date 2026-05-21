import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const env = process.env;
const pilotMode = process.argv.includes('--pilot') || process.env.PILOT_READINESS === '1';
const pilotBaseUrl = 'https://app.trennen.co.nz';

function present(name) {
  return !!String(env[name] || '').trim();
}

function value(name, fallback = null) {
  const raw = String(env[name] || '').trim();
  return raw || fallback;
}

const checks = {
  profile: pilotMode ? 'production-pilot' : 'basic',
  app: {
    NODE_ENV: value('NODE_ENV', 'development'),
    PORT: value('PORT', '3000'),
    BASE_URL: value('BASE_URL'),
    TRUST_PROXY: value('TRUST_PROXY', '0'),
  },
  email: {
    APP_EMAIL_DOMAIN: value('APP_EMAIL_DOMAIN'),
    APP_EMAIL_FALLBACK_present: present('APP_EMAIL_FALLBACK'),
    RESEND_API_KEY_present: present('RESEND_API_KEY'),
    RESEND_WEBHOOK_SECRET_present: present('RESEND_WEBHOOK_SECRET'),
    SMTP_HOST_present: present('SMTP_HOST'),
  },
  payments: {
    STRIPE_SECRET_KEY_present: present('STRIPE_SECRET_KEY'),
    STRIPE_PUBLISHABLE_KEY_present: present('STRIPE_PUBLISHABLE_KEY'),
    STRIPE_CLIENT_ID_present: present('STRIPE_CLIENT_ID'),
    STRIPE_WEBHOOK_SECRET_present: present('STRIPE_WEBHOOK_SECRET'),
    STRIPE_BILLING_STARTER_PRICE_ID_present: present('STRIPE_BILLING_STARTER_PRICE_ID'),
    STRIPE_BILLING_GROWTH_PRICE_ID_present: present('STRIPE_BILLING_GROWTH_PRICE_ID'),
    STRIPE_BILLING_SCALE_PRICE_ID_present: present('STRIPE_BILLING_SCALE_PRICE_ID'),
  },
  secrets: {
    SESSION_SECRET_present: present('SESSION_SECRET'),
    JWT_SECRET_present: present('JWT_SECRET'),
    PLATFORM_CONFIG_ENCRYPTION_KEY_present: present('PLATFORM_CONFIG_ENCRYPTION_KEY'),
  },
  futureManagedAws: {
    DATABASE_URL_present: present('DATABASE_URL'),
    STORAGE_DRIVER: value('STORAGE_DRIVER', 'local'),
    S3_UPLOADS_BUCKET_present: present('S3_UPLOADS_BUCKET'),
    AWS_REGION: value('AWS_REGION'),
    SECRETS_MANAGER_PREFIX_present: present('SECRETS_MANAGER_PREFIX'),
  },
};

const required = [
  ['app.PORT', checks.app.PORT === '3001'],
  ['app.TRUST_PROXY', checks.app.TRUST_PROXY === '1'],
  ['email.domain_or_fallback', present('APP_EMAIL_DOMAIN') || present('APP_EMAIL_FALLBACK')],
  ['email.provider', present('RESEND_API_KEY') || present('SMTP_HOST')],
  ['secrets.SESSION_SECRET', checks.secrets.SESSION_SECRET_present],
  ['secrets.JWT_SECRET', checks.secrets.JWT_SECRET_present],
  ['secrets.PLATFORM_CONFIG_ENCRYPTION_KEY', checks.secrets.PLATFORM_CONFIG_ENCRYPTION_KEY_present],
];

if (pilotMode) {
  required.push(
    ['pilot.NODE_ENV_production', checks.app.NODE_ENV === 'production'],
    ['pilot.BASE_URL_app_trennen', checks.app.BASE_URL === pilotBaseUrl],
    ['pilot.email_domain_trennen', checks.email.APP_EMAIL_DOMAIN === 'mail.trennen.co.nz'],
    ['pilot.email_fallback', checks.email.APP_EMAIL_FALLBACK_present],
    ['pilot.resend_webhook_secret', checks.email.RESEND_WEBHOOK_SECRET_present],
    ['pilot.stripe_secret_key', checks.payments.STRIPE_SECRET_KEY_present],
    ['pilot.stripe_publishable_key', checks.payments.STRIPE_PUBLISHABLE_KEY_present],
    ['pilot.stripe_connect_client_id', checks.payments.STRIPE_CLIENT_ID_present],
    ['pilot.stripe_webhook_secret', checks.payments.STRIPE_WEBHOOK_SECRET_present],
    ['pilot.stripe_billing_starter_price', checks.payments.STRIPE_BILLING_STARTER_PRICE_ID_present],
    ['pilot.stripe_billing_growth_price', checks.payments.STRIPE_BILLING_GROWTH_PRICE_ID_present],
    ['pilot.stripe_billing_scale_price', checks.payments.STRIPE_BILLING_SCALE_PRICE_ID_present],
    ['pilot.storage_driver_local', checks.futureManagedAws.STORAGE_DRIVER === 'local'],
  );
}

const failures = required.filter(([, ok]) => !ok).map(([name]) => name);
const report = {
  ok: failures.length === 0,
  failures,
  checks,
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;

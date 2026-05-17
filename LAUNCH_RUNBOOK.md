# Launch Readiness Runbook

This repo is ready for staging demos after `launch-readiness-baseline`, but production launch should use this runbook before the first real merchant/customer traffic.

## Baseline And Rollback

- Current pre-hardening checkpoint: `launch-readiness-baseline`.
- To inspect the baseline: `git show --stat launch-readiness-baseline`.
- To create a new launch candidate after this sprint: run the verification commands below, commit, then tag `launch-readiness-stabilization-v1`.

## Required Production Configuration

Set these in the production/staging environment before starting the backend:

- `NODE_ENV=production`
- `BASE_URL=https://<public-domain>`
- `SESSION_SECRET` with a long random value
- `JWT_SECRET` with a separate long random value
- `PLATFORM_CONFIG_ENCRYPTION_KEY` with a separate long random value
- `RESEND_API_KEY` or SMTP settings
- Stripe platform configuration in either environment variables or the platform portal
- `STRIPE_WEBHOOK_SECRET` for live webhook processing

Production startup intentionally refuses unsafe/missing secrets.

## Staging Environment

Use a staging domain and Stripe test mode. Mirror production paths for:

- SQLite database location and backup schedule
- public uploads directory or S3-compatible storage
- email sender/domain verification
- webhook URLs
- platform/admin/customer sessions

Run:

```bash
cd /Users/daniel/3d-quote-website/backend
npm install
npm run migrate
npm run qa:full
```

## Provider Validation

Run these with safe test credentials only:

- Confirm platform Stripe is configured once by Trennen; stores should not enter Stripe API credentials.
- Stripe Connect onboarding for a test store.
- Confirm the shop Payments page only offers Stripe Connect onboarding/resume/disconnect actions.
- Stripe PaymentIntent success using a Stripe test card.
- Stripe decline and incomplete onboarding flows.
- Confirm end-customer checkout charges through Stripe only and transfers funds to the connected store account with the configured platform fee.
- Resend/SMTP password reset email to a controlled inbox.
- Notification test email from the shop admin portal.
- Customer saved quote sign-in/register flow.

Do not use production cards, real customers, or live fulfilment actions during validation.

## Backup And Restore

Before every staging or production migration:

```bash
cp backend/data/rfdewi.db backend/data/rfdewi.db.backup-$(date +%Y%m%d-%H%M%S)
```

To restore:

```bash
cp backend/data/rfdewi.db.backup-YYYYMMDD-HHMMSS backend/data/rfdewi.db
```

If using hosted storage later, pair database backups with uploaded asset backups from the same timestamp.

## Launch Verification Checklist

- `npm run qa:full`
- `npm audit --json`
- `git diff --check`
- Manual Stripe test checkout from quote to confirmation.
- Manual email password reset for platform, shop admin, and customer.
- Review screenshots in `backend/data/visual-smoke/`.
- Confirm platform audit events are created for platform order/customer data views.
- Confirm merchant terms disclose platform owner operational access.

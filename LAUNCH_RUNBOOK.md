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
- Stripe platform keys in either environment variables or the platform portal
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

- Stripe Connect onboarding for a test store.
- Stripe PaymentIntent success using a Stripe test card.
- Stripe decline and incomplete onboarding flows.
- Resend/SMTP password reset email to a controlled inbox.
- Notification test email from the shop admin portal.
- Customer saved quote sign-in/register flow.

Do not use production cards, real customers, or live fulfilment actions during validation.

## Backup And Restore

Before every staging or production migration:

```bash
cd backend
npm run ops:backup
```

The backup command writes a timestamped bundle under `~/3d-quote-backups/` by default. It includes a SQLite online backup, `backend.env`, `uploads.tar.gz`, the PM2 dump when available, the Nginx site config when readable, and `manifest.json` hashes.

To verify the backup mechanism locally before trusting it on a launch candidate:

```bash
cd backend
npm run ops:backup-smoke
npm run ops:restore-smoke
```

The backup smoke test runs the real backup script against a temporary SQLite database, env file, uploads directory, and Nginx config. It confirms the manifest hashes match, the database backup can be opened, the uploaded file archive contains the expected data, and the copied env file stays owner-readable only. The restore smoke test then runs a full rehearsal into a temporary app tree, verifies manifest hashes before overwrite, confirms stale uploads are removed, checks PM2 stop/restart behavior, and rejects a tampered backup before target files are touched.

To restore on the same server:

```bash
cd ~/3d-quote-website-live
BACKUP_DIR=~/3d-quote-backups/YYYYMMDD-HHMMSS
cd backend
RESTORE_CONFIRM=restore-runtime-state BACKUP_DIR="$BACKUP_DIR" RUN_MIGRATE=1 npm run ops:restore
```

If using hosted storage later, pair database backups with uploaded asset backups from the same timestamp and verify the restored app with `npm run production-health:smoke`.

## Launch Verification Checklist

- `npm run qa:full`
- `npm audit --json`
- `git diff --check`
- Manual Stripe test checkout from quote to confirmation.
- Manual email password reset for platform, shop admin, and customer.
- Review screenshots in `backend/data/visual-smoke/`.
- Confirm platform audit events are created for platform order/customer data views.
- Confirm merchant terms disclose platform owner operational access.

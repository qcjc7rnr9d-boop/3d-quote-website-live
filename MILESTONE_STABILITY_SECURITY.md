# Stability + Security Milestone

Commit target: `stability-security-v1`

## What This Milestone Locks In

- Private server files are no longer publicly served from `localhost:3000`.
- Express sessions use the SQLite-backed `app_sessions` table instead of memory storage.
- Production startup refuses weak/missing secrets and missing mail/base URL configuration.
- Material image uploads reject SVG and verify image content signatures before storing.
- Material catalog normalization is centralized in `backend/lib/material-config.js`.
- Stripe checkout now rebuilds material, finish, infill, quantity, and shipping totals server-side before charging.
- Password reset routes have rate limits.
- `nodemailer` was upgraded and `npm audit` reports zero vulnerabilities.
- Repeatable checks were added:
  - `npm run check`
  - `npm run security:smoke`

## Verification Checklist

- `node backend/db/migrate_v13.js`
- `npm run check`
- `npm audit --json`
- `npm run security:smoke`
- Browser smoke checks for:
  - landing page
  - material selection
  - quote handoff
  - checkout review
  - platform login
  - admin materials
  - admin payments

## Known Follow-Ups

- Move remaining large inline page scripts into local external assets so strict CSP can remove `'unsafe-inline'` page by page.
- Add automated browser tests for full quote-to-checkout flows with seeded shop data.
- Add encrypted-at-rest storage for platform Stripe secret keys before production launch.
- Replace local upload storage with object storage before scaling beyond a single server.

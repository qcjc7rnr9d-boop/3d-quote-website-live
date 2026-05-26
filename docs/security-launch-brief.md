# Launch Security Brief

This brief captures the current security and operations posture before a production push. It is not a claim that the platform is impossible to compromise; it is the working checklist for what is protected now, what is verified by smoke tests, and what must stay gated before broader customer launch.

## Current Data Storage

- Primary data store: SQLite at `backend/data/rfdewi.db`.
- Public business assets: local `uploads/` directory, served under `/uploads`.
- Customer model binaries: browser-local in the quoting flow; the backend stores metadata and quote/order snapshots, not raw STL/OBJ files.
- Sessions: persisted in `app_sessions` with signed cookies.
- Stripe platform secrets: encrypted at rest before being stored in platform settings.

## Backup And Recovery

- Run `npm run ops:backup` from `backend/` before migrations, deploys, or risky live data edits.
- The backup bundle includes:
  - SQLite online backup using `sqlite3 .backup` when available.
  - `backend.env`.
  - `uploads.tar.gz`.
  - PM2 dump when available.
  - Nginx site config when readable.
  - `manifest.json` with file hashes.
- `npm run ops:backup-smoke` exercises the real backup script against a temporary SQLite database, env file, upload tree, and Nginx config; it verifies the backed-up DB can be opened, manifest sizes/hashes match, uploads are archived, and the copied env file is mode `600`.
- `npm run ops:restore-smoke` rehearses a guarded restore into a temporary app tree, verifies backup manifest hashes before overwrite, snapshots current target files into a rollback bundle, removes stale uploads, and rejects tampered backups before target files are touched.
- Restore is automated by `npm run ops:restore` with `RESTORE_CONFIRM=restore-runtime-state`; restore steps are documented in `LAUNCH_RUNBOOK.md` and `docs/deployment/staged-saas-launch.md`.
- Before broad rollout, persistent state should move to RDS PostgreSQL, S3, and managed secrets as documented in `docs/deployment/production-hosting-strategy.md`.

## Tenant And Access Controls

- Shop admin routes require a shop session and use `req.shop.id` for shop-scoped queries.
- Customer portal routes require a customer session and validate the requested `shop` slug against that session.
- Platform routes require platform auth and have smoke coverage for unauthenticated access.
- Platform support impersonation is explicitly marked in the shop session, audit-logged on start/stop, and read-only for shop APIs by default. Credential, session, account deletion, Stripe setup/disconnect, and side-effectful Stripe dashboard/onboarding links are blocked with `PLATFORM_IMPERSONATION_RESTRICTED`.
- Public order views require an unguessable order token and omit customer PII.
- FDM-only mode hides non-FDM materials and rejects forged non-FDM quote/cart attempts.

## Passwords, Sessions, And Reset Tokens

- Shop/customer passwords are hashed with bcrypt.
- Customer signup and reset flows require stronger passwords.
- Shop, customer, and platform password reset tokens include a random token id, are stored as SHA-256 digests, and keep legacy raw-token lookup fallback only for old rows.
- CSRF tokens are required for authenticated mutating routes and are not accepted via query string.
- Production startup requires real session/JWT/platform encryption secrets.
- Session cookies are `HttpOnly`, `SameSite=Strict`, and `Secure` in production.
- Shop, customer, and platform login rotate the session id before authenticated state is set, blocking session fixation.
- Shop, customer, and platform logout destroy the server-side session and clear the browser cookie.
- Shop/customer password changes revoke other active sessions; password-reset flows revoke existing sessions for that account.
- Shop admin session management returns session metadata and current-session status only; raw session tokens are kept server-side and are not exposed through `/api/auth/sessions`.
- Every response gets `X-Content-Type-Options`, `X-Frame-Options` outside embed surfaces, `Referrer-Policy`, and a restrictive `Permissions-Policy`; production responses also send one-year HSTS.

## Upload And File Handling

- Logo uploads and material asset uploads are memory-limited and verify PNG/JPEG/WebP/GIF content signatures, not just MIME labels.
- Public `/uploads` static serving is restricted to PNG, JPEG, WebP, and GIF extensions so unexpected HTML/JS or other active content cannot be served from the app origin.
- Static file serving is restricted to public assets; direct access to backend source, database files, `.git`, and research data is covered by security smoke tests.
- Future launch hardening should add malware/content scanning before broad public file storage.

## Payments And Checkout

- Customer checkout is Stripe-only.
- Stripe PaymentIntent creation recalculates pricing server-side, ignores client totals, and creates an order before creating the PaymentIntent so webhook recovery has a stable order id.
- Shop-admin order responses use an explicit field allowlist and do not expose public order confirmation tokens or checkout idempotency keys.
- Cart-level shipping is calculated server-side and selected once per order.
- Checkout remains blocked until quote/cart validation, shipping, Stripe platform keys, and shop Connect readiness all pass.

## Concurrency And Reliability

- SQLite connections use `PRAGMA busy_timeout = 5000`.
- Critical customer signup and payment/order creation flows use `BEGIN IMMEDIATE` to avoid split writes under concurrent access.
- Fresh installs and migrated databases create a unique `orders(shop_id, checkout_idempotency_key)` index so repeated Stripe checkout submissions cannot create duplicate orders for the same shop checkout key while still allowing unrelated shops and legacy null keys.
- Active material names are unique per shop/category after trimming and case-normalisation, so concurrent duplicate material creation fails at the database boundary instead of relying only on UI checks.
- Shop settings saves validate customer-facing email-domain input before mutating data, then update the shop row, store settings row, and email-domain settings inside one `BEGIN IMMEDIATE` transaction so failed validation or write errors do not leave mixed branding/settings state.
- Shipping settings are validated before storage. Active methods require courier/service, non-negative price, valid delivery day ranges, and non-negative package-band limits. Blank, null, or zero band limits remain unlimited. Malformed or wrong-type legacy shipping JSON reads safely as no rates rather than crashing checkout.
- Customer portal smoke coverage fires simultaneous duplicate registrations and verifies exactly one `customer_accounts` row and one admin-visible `customers` row are created.
- Current SQLite/local-upload architecture is acceptable for demo and controlled pilots, but broad multi-merchant launch should move to PostgreSQL and object storage.

## Verified Smoke Coverage

Current targeted checks include:

- `npm run check`
- `npm run ops:smoke`
- `npm run ops:backup-smoke`
- `npm run ops:restore-smoke`
- `npm run data:integrity-smoke`
- `npm run shipping:smoke`
- `npm run access-control:boundary-smoke`
- `npm run csrf:boundary-smoke`
- `npm run upload:boundary-smoke`
- `npm run reset-token:boundary-smoke`
- `npm run redirect:boundary-smoke`
- `npm run rate-limit:smoke`
- `npm run security:headers-smoke`
- `npm run security:smoke`
- `npm run csrf:smoke`
- `npm run settings:logo-smoke`
- `npm run auth-email:smoke`
- `npm run customer:password-reset-smoke`
- `npm run customer:smoke`
- `npm run platform:smoke`

Run `npm run qa:full` before a launch-candidate push once the current dirty branch is intentionally scoped.

Latest local evidence from the restricted Codex sandbox:

- `npm run check` passed.
- `npm run checkout:smoke` passed.
- `npm run production-pilot:smoke` passed.
- `npm run data:integrity-smoke` passed, including fresh-schema duplicate checkout idempotency protection.
- `npm run security:headers-smoke`, `platform-secrets:smoke`, `access-control:boundary-smoke`, `csrf:boundary-smoke`, `upload:boundary-smoke`, `reset-token:boundary-smoke`, `redirect:boundary-smoke`, `rate-limit:smoke`, `reliable-email:smoke`, `customer:signup-boundary-smoke`, `ops:backup-smoke`, and `ops:restore-smoke` passed.
- A throwaway backend copy ran `node db/migrate.js` twice successfully, proving the migration chain can initialize and rerun cleanly without touching the local working database.
- HTTP smokes that require binding or connecting to `localhost` could not be run in the Codex sandbox because local sockets return `EPERM`; run those on Lightsail or an unrestricted local terminal before push.

## Remaining Launch Gates

- Run a real Stripe test-mode checkout after Connect is fully configured.
- Run server-bound HTTP smokes in an unrestricted environment: `npm run shipping:smoke`, `npm run settings:logo-smoke`, `npm run security:smoke`, `npm run csrf:smoke`, `npm run customer:smoke`, and full `npm run qa:full`.
- Confirm order appears in customer portal, shop admin, and platform admin.
- Confirm confirmation and password-reset emails deliver through the production email provider.
- Run `npm run ops:backup` and verify the bundle exists before live migrations.
- Inspect PM2 logs after deployment for proxy/rate-limit errors and secret leakage.
- Do not include scratch `brand/` or `research/` changes in a production push unless intentionally reviewed.

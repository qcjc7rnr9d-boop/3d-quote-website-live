# Post-Milestone Security Review

## Baseline

Last milestone: `stability-security-v1`

- Commit: `615362219201ff5d045603297e629775c62a2fdf` (`6153622`)
- Timestamp: May 14, 2026 at 08:33:45 +1200
- Subject: `Create stability security milestone`
- Scan scope: all changes since that tag, the current working tree, and untracked files.
- Codex Security artifacts: `/tmp/codex-security-scans/3d-quote-website/6153622_20260514-post-milestone`

## Threat Model Summary

The reviewed app has five main trust boundaries:

- Public browser/localStorage to backend quote and payment APIs.
- Customer session to customer-only account and order data.
- Shop admin session to one shop's materials, settings, uploads, orders, pricing, and Stripe Connect state.
- Platform admin session to platform-wide Stripe settings and cross-shop control-plane access.
- Public static/uploads routing versus private repo, database, secret, and research files.

Sensitive assets include Stripe keys and connected account IDs, password hashes, reset tokens, sessions, customer/order data, uploaded files, material and pricing configuration, and local research/env files.

## Findings Fixed

### 1. Size-limit bypass in checkout payment handoff

Severity: Medium

The quote page validated model dimensions, but the final checkout payment request only sent volume and selected options. A forged checkout request could omit dimensions, and the backend pricing engine previously skipped material max-size checks when dimensions were absent.

Fix:

- `assets/checkout.js` now carries `dimensions` into quote refresh and Stripe payment intent creation.
- `backend/lib/pricing-engine.js` now requires dimensions whenever a material has configured max X/Y/Z limits.
- The same engine rejects oversized models in quote preview and payment creation.

### 2. Customer portal auth brute-force surface

Severity: Medium

Customer login, registration, and password change routes were not locally rate-limited.

Fix:

- Added `express-rate-limit` protection to `POST /api/customer/login`, `POST /api/customer/register`, and `POST /api/customer/change-password`.

### 3. Customer dashboard tracking URL injection

Severity: Medium-Low

Shop-controlled tracking URLs were escaped for HTML but not scheme-validated before rendering in customer-facing anchors.

Fix:

- Added `safeHttpUrl()` in `customer/dashboard.html`.
- Tracking links now render only `http:` and `https:` URLs; invalid or non-web schemes render as plain text.

### 4. Private research paths returned HTTP 200 app shell

Severity: Low

`/research/.env` did not expose file contents, but it returned the public app fallback with `200`, which failed the private-path static exposure expectation.

Fix:

- Added `/research` and `/security_review_post_milestone.md` to the private static denylist in `backend/server.js`.
- Extended `npm run security:smoke` to check research paths.

### 5. Malformed quote preview produced a 500

Severity: Low

`POST /api/customer/quote-preview` with a missing `materialId` reached SQLite binding and returned a server error.

Fix:

- `backend/lib/pricing-engine.js` now returns a safe `400 MATERIAL_REQUIRED` before querying.
- Security smoke now covers malformed quote preview input.

### 6. Local research output hygiene

Severity: Low

The untracked `research/` workspace contains local env files and generated prospect datasets. The env files were already ignored globally, but generated prospect outputs needed explicit project hygiene.

Fix:

- Added explicit ignore rules for `research/.env*`, `research/node_modules/`, and `research/data/discovered-prospects.*`.
- Confirmed source files do not contain obvious committed API secrets.

## Validated OK

- Stripe checkout uses backend-calculated totals through the pricing engine; client-supplied totals are only compared for stale-price detection.
- Material asset uploads require shop auth and verify image magic bytes for PNG, JPEG, WebP, and GIF.
- Admin material library and AI lookup routes require shop auth and do not expose AI/API keys.
- Customer order APIs scope reads by authenticated customer account, `shop_id`, and customer email.
- Platform routes reviewed remain behind `requirePlatformAuth`.
- Public static routing serves explicit public roots, assets, admin/customer/platform pages, and uploads only; private prefixes now include research paths.

## Verification

Commands run:

```text
cd backend && npm run check
Syntax checks passed.

cd backend && npm audit --json
0 total vulnerabilities.

cd backend && npm run security:smoke
Security smoke checks passed.

git diff --check
No output.

cd research && node --test *.test.cjs *.test.mjs
72 tests passed.

cd research && npm audit --json
0 total vulnerabilities.
```

HTTP page-load check on `localhost:3000`:

```text
200 /index.html
200 /materials.html
200 /catalog.html
200 /quote.html
200 /checkout.html
200 /customer/login.html
200 /customer/dashboard.html
200 /admin/materials.html
200 /admin/pricing.html
200 /platform/login.html
200 /platform/admin.html
```

Security smoke coverage now includes:

- backend, database, Git, security report, and research path exposure checks
- unauthenticated platform/shop/customer API checks
- public customer catalog check
- malformed quote-preview rejection
- unauthenticated material upload rejection
- unauthenticated payment-intent rejection
- unauthenticated customer password-change rejection
- size-limited quote requires dimensions
- oversized quote rejection

## Residual Risks

- Cookie-auth state-changing routes still rely mainly on `SameSite=Strict`; dedicated CSRF tokens should be added before production.
- Platform-level cross-shop visibility is powerful and should have audit logging and clear governance before production use.
- Platform Stripe secrets are masked in APIs, but encrypted-at-rest storage remains a recommended hardening step.
- The `research/` tool is still a local/untracked workspace. Its generated datasets and env files are ignored and not public-served; if it becomes product code, it should get its own production-readiness review.

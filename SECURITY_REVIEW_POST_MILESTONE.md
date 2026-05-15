# Post-Milestone Security Review

## Baseline

Last milestone: `stability-security-v1`

- Commit: `615362219201ff5d045603297e629775c62a2fdf` (`6153622`)
- Timestamp: May 14, 2026 at 08:33:45 +1200
- Subject: `Create stability security milestone`
- Scan scope: all changes since that tag, the current working tree, and untracked files.

## Threat Model Summary

The reviewed app has five main trust boundaries:

- Public browser/localStorage to backend quote and payment APIs.
- Customer session to customer-only saved quotes, account data, and order data.
- Shop admin session to one shop's materials, settings, uploads, orders, pricing, and Stripe Connect state.
- Platform admin session to platform-wide reporting, Stripe settings, and cross-shop control-plane access.
- Public static/uploads routing versus private repo, database, secret, and research files.

Sensitive assets include Stripe keys and connected account IDs, password hashes, reset tokens, sessions, customer/order data, quote snapshots, uploaded model metadata, material and pricing configuration, and local research/env files.

## Findings Fixed

### 1. Public order confirmation IDOR

Severity: High

`GET /api/orders/public/:id` accepted a sequential order id and returned customer/order detail without an unguessable verifier. A public attacker could enumerate order ids and read confirmation details, including customer-identifying fields.

Attack path:

- Entry point: unauthenticated confirmation/order route.
- Trust boundary crossed: public browser to customer order data.
- Exploit: guess or increment order ids.
- Impact: unauthorized disclosure of order metadata and customer PII.

Fix:

- Added `orders.public_token` with an idempotent migration and unique partial index.
- New orders and demo orders now receive a random `base64url` public token.
- Checkout redirects to `confirmation.html?order=<id>&token=<token>&shop=<slug>`.
- Public order detail now requires the token and returns a sanitized confirmation payload without customer email/name.
- Security smoke now verifies missing token, wrong token, and correct token behavior.

### 2. Public quote-preview DoS/flow gap for model bundles

Severity: Medium

The browser limited quote groups to 20 models, but the public backend quote engine accepted arbitrary `models[]` length. A forged request could send oversized model arrays to the pricing endpoint and payment validation path.

Attack path:

- Entry point: unauthenticated `POST /api/customer/quote-preview`.
- Trust boundary crossed: public payload into pricing engine.
- Exploit: submit a very large model list.
- Impact: avoidable CPU/memory pressure and inconsistent UI/server behavior.

Fix:

- Added backend `MAX_MODELS_PER_QUOTE = 20` enforcement in the pricing engine.
- Added `TOO_MANY_MODELS` customer-safe pricing error.
- Applied the existing quote rate limiter to public `POST /api/customer/quote-preview`.
- Multi-model smoke now asserts the backend rejects 21 models.

### 3. Size-limit bypass in checkout payment handoff

Severity: Medium

The quote page validated model dimensions, but the final checkout payment request could previously omit dimensions. If a material had max X/Y/Z limits, the backend needed to reject missing dimensions instead of silently skipping the size check.

Fix:

- Checkout carries dimensions into quote refresh and Stripe payment intent creation.
- The pricing engine requires dimensions whenever the selected material has configured max limits.
- Quote preview and Stripe payment creation reject oversized or dimensionless carts for size-limited materials.

### 4. Customer portal auth brute-force surface

Severity: Medium

Customer login, registration, reset, and password-change flows needed consistent local rate limiting.

Fix:

- Added/kept `express-rate-limit` protection for customer auth, reset, password, and quote-save sensitive routes.
- Customer password reset smoke verifies the end-user reset path.

### 5. Customer dashboard tracking URL injection

Severity: Medium-Low

Shop-controlled tracking URLs were escaped for HTML, but needed scheme validation before becoming customer-facing anchors.

Fix:

- Customer dashboard tracking links now accept only `http:` and `https:` URLs.
- Invalid/non-web tracking values render as plain text.

### 6. Private static path exposure behavior

Severity: Low

Private paths such as backend/database/research files should return not-found/blocked responses rather than public app fallback responses.

Fix:

- Static serving denies backend, database, Git, package, security report, and research paths.
- Security smoke verifies `/backend/server.js`, database files, `.git`, `SECURITY.md`, and research paths are not publicly accessible.

### 7. Malformed quote-preview error handling

Severity: Low

Malformed quote-preview input could previously reach low-level query paths and return server-style failures.

Fix:

- Pricing validation now returns customer-safe 400 responses for missing/invalid material, model volume, dimensions, colours, finishes, shipping, and size limits.
- Security smoke covers malformed public quote-preview input.

## Validated OK

- Stripe checkout remains backend-priced; client totals are ignored except for stale-price comparison.
- Stripe-only checkout has no Shop Pay/Shopify processing path.
- Unconnected or incomplete Stripe setup blocks payment.
- Customer order, saved quote, and account APIs are scoped by authenticated customer and shop.
- Shop admin APIs remain behind shop auth.
- Platform reporting routes remain behind platform auth and omit secrets/passwords/card details.
- Material and logo uploads require auth and verify allowed image MIME/content; SVG is rejected.
- Material library auto-fill is local/admin-only; online lookup remains explicit.
- Customer catalog and material pages remain public but return enabled shop catalogue data only.

## Verification

Commands run:

```text
cd backend && npm run check
Syntax checks passed.

cd backend && npm audit --json
0 total vulnerabilities.

cd backend && npm run security:smoke
Security smoke checks passed.

cd backend && npm run checkout:smoke
Stripe-only checkout smoke checks passed.

cd backend && npm run quote:ui-smoke
Quote UI smoke checks passed.

cd backend && npm run multi-model:smoke
Multi-model smoke checks passed.

cd backend && npm run multi-line-cart:smoke
Multi-line cart smoke checks passed.

cd backend && npm run customer:smoke
Customer portal smoke checks passed.

cd backend && npm run customer:quotes-smoke
Customer saved quotes smoke checks passed.

cd backend && npm run customer:password-reset-smoke
Customer password reset smoke checks passed.

cd backend && npm run admin-orders:smoke
Admin orders smoke checks passed.

cd backend && npm run settings:logo-smoke
Settings logo smoke checks passed.

cd backend && npm run platform:smoke
Platform reporting smoke checks passed.

cd backend && npm run materials:smoke
Material library smoke checks passed.

cd backend && npm run materials:filter-smoke
Outdoor filter ranking smoke passed.

cd backend && npm run demo:materials:smoke
Mahi3D demo material range smoke checks passed.

cd backend && npm run legal:smoke
Legal page smoke checks passed.

git diff --check
No output.
```

Security smoke coverage includes:

- private static exposure checks
- unauthenticated platform/shop/customer route checks
- public order confirmation token checks
- customer catalog public access check
- malformed quote-preview rejection
- oversized quote rejection when size limits exist
- unauthenticated material upload rejection
- unauthenticated Stripe payment-intent rejection
- unauthenticated customer password-change rejection

## Residual Risks

- Cookie-auth state-changing routes still rely mainly on `SameSite=Strict`; dedicated CSRF tokens should be added before production.
- Platform-level cross-shop visibility is powerful and should stay audit-logged and disclosed in merchant terms/admin agreements.
- Platform Stripe secrets are masked in APIs, but encrypted-at-rest storage remains a recommended hardening step.
- Uploaded model binaries remain browser-local; if raw file storage is later added, it needs separate malware/content validation and retention rules.
- The `research/` tool is still a local/untracked workspace. Its generated datasets and env files are ignored and not public-served; if it becomes product code, it should get its own production-readiness review.

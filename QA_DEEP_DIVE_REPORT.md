# QA Deep Dive Report

Date: 2026-05-15

## A. Stack Summary

- Frontend framework: no SPA framework. Static HTML/CSS/inline JavaScript pages served by Express.
- Backend framework: Node.js ESM with Express.
- Package manager: npm, backend package rooted at `backend/`; secondary research package rooted at `research/`.
- Test tools used: existing Node smoke scripts, Playwright through `research/node_modules/playwright`, Node built-in test runner for `research/*.test.*`.
- Database/ORM: SQLite via Node `node:sqlite` `DatabaseSync`; no ORM.
- Email implementation: `backend/lib/mailer.js`, with Resend HTTP API, SMTP via Nodemailer, and Ethereal dev fallback.
- Auth/session system: `express-session` stored in SQLite `app_sessions`; shop/customer/platform sessions share cookie storage with separate session keys. Password reset tokens use JWT plus SQLite token rows.
- Roles/permissions:
  - Public customer/browser user.
  - Customer account scoped to one shop.
  - Shop admin scoped to one shop.
  - Platform owner/admin across shops.

## B. Test Inventory

### Frontend Pages

- Public lean release: `quote.html`, `catalog.html`, `materials.html`, `options.html`, `checkout.html`, `confirmation.html`, `terms.html`, `privacy.html`, `stripe-callback.html`.
- Customer: `customer/login.html`, `customer/forgot-password.html`, `customer/reset-password.html`, `customer/dashboard.html`.
- Shop admin: `admin/login.html`, `admin/forgot-password.html`, `admin/reset-password.html`, `admin/dashboard.html`, `admin/materials.html`, `admin/orders.html`, `admin/pricing.html`, `admin/settings.html`, `admin/shipping.html`, `admin/payments.html`, `admin/customers.html`, `admin/notifications.html`, `admin/account.html`, `admin/change-password.html`.
- Platform: `platform/login.html`, `platform/forgot-password.html`, `platform/reset-password.html`, `platform/admin.html`.

### Primary Forms, Buttons, Modals, And Navigation

- Landing upload, multi-file model list, reset/remove file, choose material, customer portal drawer, portal login, footer/nav links.
- Catalogue filters, specs expand/collapse, start quote.
- Material filters, selected material card, specs expand/collapse, size-limit warning, continue to options.
- Options colour swatches, finish cards, infill cards, continue to quote.
- Quote viewer controls, add files, per-model quantity steppers, save quote auth modal, add another group, checkout, currency selector.
- Checkout grouped cart review, remove group, stale cart clear, edit group, Stripe payment form and disabled/setup-error states.
- Customer portal tabs, profile form, password form, saved quote continue/remove, sign out, help links.
- Shop admin login/reset/password/session/account actions; CRUD/editor surfaces for materials, orders, customers, pricing, settings, shipping, payments, notifications.
- Platform login/reset/account, store creation/suspend/restore/impersonate, payments config, reporting filters, detail drawers.

### API Endpoint Inventory

- Public/platform info: `GET /api/platform-info`, root/static pages.
- Shop auth: `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/change-password`, `POST /api/auth/forgot-password`, `GET /api/auth/reset-password/verify`, `POST /api/auth/reset-password`, `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `POST /api/auth/sessions/revoke-all`, `DELETE /api/auth/account`.
- Customer public/auth: `GET /api/customer/shop-info`, `GET /api/customer/pricing`, `GET /api/customer/exchange-rates`, `GET /api/customer/catalog`, `POST /api/customer/quote-preview`, `POST /api/customer/register`, `POST /api/customer/login`, `POST /api/customer/forgot-password`, `GET /api/customer/reset-password/verify`, `POST /api/customer/reset-password`, `POST /api/customer/logout`, `GET/PATCH /api/customer/me`, `POST /api/customer/change-password`, `GET/POST /api/customer/quotes`, `DELETE /api/customer/quotes/:id`, `GET /api/customer/orders`, `GET /api/customer/orders/:id`.
- Shop admin data: `GET/PATCH/POST/DELETE /api/materials...`, `GET/PATCH/DELETE /api/orders...`, `GET/PATCH /api/customers...`, `GET/PUT /api/pricing`, discount routes, `GET/PUT/PATCH /api/settings`, logo upload, notification test, shipping rates.
- Stripe: webhook, key status, platform key legacy route, public key, payment intent, Connect URL/connect/disconnect/payouts.
- Platform: login/logout/me/account/reset, overview/stats/shops/orders/customers/audit/payments/impersonate.

### Database Mutations Covered

- Customer account create/login/reset/change password.
- Customer saved quote create/delete.
- Order visibility and public token checks.
- Platform audit row creation.
- Store settings/logo update and preservation.
- Exchange-rate cache create/update/fallback.
- Cart pricing validation without trusting client totals.
- Demo material catalogue validation.

### Email-Triggering Actions Covered

- Customer forgot/reset password path.
- Mailer provider success/failure with mocked Resend.
- Notification test and order update emails identified but not fully delivered through production providers.
- Platform and shop admin reset routes identified; shop/customer reset smoke coverage exists, platform reset is partially covered by platform route smoke/auth boundaries.

## C. New Or Modified Tests

- `backend/scripts/frontend-pages-smoke.js`: loads 30 frontend pages with Playwright, checks runtime errors, document titles, visible form labels, and same-origin link 404/500s.
- `backend/scripts/auth-email-smoke.js`: tests customer email validation, normalization, duplicate handling, uppercase/plus/subdomain login, and neutral forgot-password response.
- `backend/scripts/mailer-smoke.js`: stubs Resend success/failure and validates `sendMail` behavior without sending production email.
- `backend/scripts/exchange-rates-smoke.js`: validates live-rate cache behavior, provider success/failure, stale fallback, unsupported currency filtering, and Frankfurter response shapes.
- `backend/scripts/quote-ui-smoke.js`: extended to assert live exchange-rate endpoint usage and display-only currency messaging.
- `backend/scripts/security-smoke.js`: extended to assert the exchange-rate endpoint is public JSON and still covered by static exposure/auth checks.
- `backend/package.json`: added `frontend:smoke`, `mailer:smoke`, `auth-email:smoke`, `exchange-rates:smoke`, and `qa:full`.

## D. Bugs Found And Fixed

### 1. Customer signup accepted invalid email addresses

- Impact: invalid customer identities could be stored, making login/reset/receipts unreliable and polluting customer records.
- Reproduce: `POST /api/customer/register` with `email: "not-an-email"` previously returned `201`.
- Fix: added customer email normalization and validation in `backend/routes/customer-portal.js`; registration rejects invalid addresses, login treats invalid addresses as generic auth failure, and forgot password remains neutral.
- Regression test: `backend/scripts/auth-email-smoke.js`.

### 2. Quote quantity input had no accessible label

- Impact: screen-reader and keyboard users could encounter an unlabeled numeric control.
- Reproduce: frontend page smoke on `quote.html?shop=mahi3d` reported `input#qtyVal` as unlabeled.
- Fix: added `aria-label="Quantity"` to the quote quantity input.
- Regression test: `backend/scripts/frontend-pages-smoke.js`.

## E. Security And Abuse Coverage

- Static/private file exposure: backend, DB, `.git`, research, env, zip, and private docs return 404.
- Auth boundaries: unauthenticated shop/customer/platform endpoints return 401 where expected.
- Cross-shop customer access: customer cannot view another shop's orders or session data.
- Platform reporting: shop sessions cannot access platform reporting; sensitive fields are recursively rejected in platform smoke.
- Order public token: public order lookup requires token and omits customer PII.
- Upload security: logo upload rejects SVG and invalid image content.
- Payment safety: checkout is Stripe-only; payment intent route recalculates server-side and rejects invalid payloads.
- Currency: display rates are public and display-only; checkout still charges NZD.
- Email enumeration: forgot-password flows return neutral messages.

## F. Combination Strategy

- Exhaustive for small sets:
  - Valid/invalid/duplicate/uppercase/plus/subdomain customer emails.
  - Public/private static exposure list.
  - Major display currencies.
  - Core auth states: anonymous, customer, shop admin, platform admin.
- Pairwise/smoke for large spaces:
  - Frontend pages/buttons/forms loaded across representative states rather than clicking every possible admin editor sub-control.
  - Material library and demo catalogue checked by profile/category rather than every possible UI filter interaction in every viewport.
  - Multi-model/multi-line cart covers representative single/multiple file and material-group combinations.

## G. Commands Run

- `npm run auth-email:smoke` — failed first, exposed invalid-email signup; passed after fix.
- `npm run frontend:smoke` — failed first, exposed unlabeled quantity input; passed after fix.
- `npm run mailer:smoke` — passed.
- `npm run exchange-rates:smoke` — passed.
- `npm run check` — passed.
- `npm run quote:ui-smoke` — passed.
- `npm run checkout:smoke` — passed.
- `npm run security:smoke` — passed.
- `npm run qa:full` — passed.
- `npm audit --json` in `backend/` — passed, 0 vulnerabilities.
- `node --test research/*.test.*` — passed, 78 tests.
- `git diff --check` — passed.
- Restarted local server on `http://localhost:3000` so smoke tests exercised current code.

## H. Remaining Risks

- Production email delivery was not exercised against real Resend/SMTP credentials; provider behavior is mocked/local only.
- Real Stripe payment confirmation was not exercised; checkout smoke verifies UI/backend routing and setup gates, not live card processing.
- Full visual regression screenshots are not yet baseline-snapshotted.
- The frontend smoke checks page load, labels, and local links, but does not click every possible admin drawer/editor button because the combination space is large.
- Oversized model backend rejection was skipped in the security smoke because no demo material currently has size limits configured.
- No destructive race-condition testing was performed against the live local database.

## I. Final Recommendation

The platform is stronger after this pass and the automated QA suite is now broad enough for repeated local/staging validation. I would consider it ready for staging demos, not production launch, until real Stripe test-mode payment flows, production email provider configuration, visual regression snapshots, and a dedicated seeded size-limit test are added.

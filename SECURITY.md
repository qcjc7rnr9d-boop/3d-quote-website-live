# Security Checklist — RF DEWI

## Authentication

- [ ] **bcrypt** used for all password storage — `saltRounds: 12` (`config.js`)
- [ ] `is_temp_password` flag in DB — forces redirect to `/admin/change-password.html` on first login
- [ ] Login error message: "Incorrect email or password" — never specifies *which* field is wrong
- [ ] **Rate limiting** on `POST /api/auth/login`: 5 attempts / 15 min / IP (`express-rate-limit`)
- [ ] Session cookies: `httpOnly: true`, `secure: true` (prod), `sameSite: 'strict'`
- [ ] **All `/admin/` routes** check `req.session.shopId` server-side before responding

## Password Reset

- [ ] Reset tokens are **signed JWTs** with 1-hour expiry (`JWT_SECRET` in `.env`)
- [ ] Tokens are **single-use** — marked `used=1` immediately after first valid use
- [ ] Forgot-password response is always: *"If that email is registered, you'll receive a reset link shortly."* — no email enumeration
- [ ] Reset link format: `/admin/reset-password.html?token=xxxxx`
- [ ] Token validated on page **load** — expired/invalid tokens show error immediately, no form shown
- [ ] On success, redirect to login with "Password updated. Please sign in."

## Password Policy

- [ ] Minimum 8 characters
- [ ] Requires: uppercase letter, number, special character
- [ ] Live strength indicator (weak / fair / good / strong) shown on change-password page
- [ ] Never log or store plaintext passwords anywhere

## Payments / Stripe

- [ ] **No card data** stored anywhere in the database
- [ ] Stripe Elements iframe handles card entry — card numbers never pass through server code
- [ ] `stripe.createPaymentMethod()` → send only `paymentMethodId` to backend (never raw card data)
- [ ] **All Stripe webhooks** verified with `stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET)`
- [ ] Webhooks failing signature check are **rejected with 400** — never processed
- [ ] Stripe webhook route receives **raw body** (`express.raw`) — not parsed JSON
- [ ] `STRIPE_WEBHOOK_SECRET` in `.env` — never committed to source control
- [ ] Platform fee applied server-side only (`config.PLATFORM_FEE_PERCENT`) — never trusted from client

## Stripe Connect

- [ ] OAuth flow: `code` exchanged server-side at `POST /api/stripe/connect` — never client-side
- [ ] Connected `stripe_user_id` stored in DB against shop record
- [ ] Disconnect option in admin/payments.html requires confirmation modal

## Database

- [ ] **All queries use parameterised statements** — never string concatenation with user input
- [ ] `PRAGMA foreign_keys = ON` — referential integrity enforced
- [ ] `PRAGMA journal_mode = WAL` — concurrent read safety
- [ ] DB file stored outside web-accessible directory

## File Uploads

- [ ] File type validated **server-side** (read magic bytes), not just by extension
- [ ] File size limit enforced: 250MB (`config.UPLOAD_MAX_MB`)
- [ ] Uploaded files stored with UUID filenames — original names never used as filesystem paths
- [ ] Upload directory not web-accessible

## Session Management

- [ ] Sessions stored server-side (express-session + DB or memory store)
- [ ] `SESSION_SECRET` in `.env` — long random string, never committed
- [ ] `/admin/account.html` shows active sessions list + "Sign out all other sessions"
- [ ] Session destroyed on logout (`req.session.destroy()`)

## Content Security Policy

The following CSP is applied via `<meta>` tag on every page:
```
default-src 'self';
script-src 'self' https://js.stripe.com https://sdks.shopifycdn.com;
frame-src https://js.stripe.com;
connect-src 'self' https://api.stripe.com https://checkout.shopify.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src https://fonts.gstatic.com;
```

- [ ] Stripe.js loaded only from `https://js.stripe.com/v3/` — never self-hosted
- [ ] Shopify SDK loaded only from `https://sdks.shopifycdn.com`
- [ ] No inline `<script>` blocks other than page-specific JS (covered by 'self')

## Environment Variables

- [ ] `.env` in `.gitignore` — never committed
- [ ] `.env.example` committed with placeholder values only
- [ ] All secrets set via environment variables — nothing hardcoded in source
- [ ] Production secrets rotated from development secrets

## Admin Portal Access

- [ ] Admin login at `/admin/login.html` — **never linked from the public site**
- [ ] Platform admin at `/platform/admin.html` — separate password, server-side session only
- [ ] Admin URLs not discoverable from public pages

## HTTP Headers

- [ ] `X-Content-Type-Options: nosniff` set on all responses
- [ ] `X-Frame-Options: SAMEORIGIN` set on all responses
- [ ] `X-XSS-Protection: 1; mode=block` set on all responses
- [ ] HTTPS enforced in production (TLS required — Stripe rejects plain HTTP)

## Pre-Launch Checklist

- [ ] All `.env` values set to production (live keys, real secrets)
- [ ] Test payments completed with Stripe test cards
- [ ] Webhook endpoint registered and tested with Stripe CLI
- [ ] Rate limiting verified (try 6 logins in 15 min)
- [ ] HTTPS active before switching to live Stripe keys
- [ ] Error logs monitored — no stack traces exposed to client
- [ ] Database file backed up and excluded from web-accessible paths

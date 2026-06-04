# Shop Provisioning And Embed Onboarding

## Goal

Each store gets its own Trennen quote-flow install code without getting a separate backend or private copy of the app. The store-facing software is isolated by shop slug, settings, materials, pricing, shipping, Stripe Connect account, orders, and reporting. Trennen remains the central backend for pricing, checkout, audit logs, sales visibility, platform fees, security controls, and support.

## What Happens When A Shop Is Created

Platform Admin -> Stores -> Create store now creates:

- a `shops` row with a unique slug and owner login
- a `pricing_config` row
- a `store_settings` row
- optional approved iframe origins from the first website origin field
- a generated install package containing:
  - recommended script snippet
  - raw iframe fallback
  - public quote URL
  - admin login URL
  - settings URL
  - payments URL
- an install email to the shop owner, unless disabled in the create form

The install email intentionally excludes:

- passwords
- Stripe secret keys
- platform secrets
- customer data
- private database identifiers beyond the public shop slug

## Recommended Website Install

Use this script on the store website:

```html
<div id="trennen-quote-widget"></div>
<script src="https://embed.trennen.co.nz/widget.js" data-tenant-id="TENANT_ID"></script>
```

Optional theme attributes:

```html
<script src="https://embed.trennen.co.nz/widget.js" data-tenant-id="TENANT_ID" data-theme-primary="#5f8b62" data-theme-font="Inter"></script>
```

Legacy shop-slug snippets still work for old installs, but new merchant snippets should use `data-tenant-id`:

```html
<script src="https://app.trennen.co.nz/embed/v1/widget.js" data-shop="mahi3d"></script>
```

The widget injects the full upload -> material -> options -> quote -> checkout flow and automatically resizes the iframe height. If a shop has an active custom quote domain, the widget loads the iframe from that domain.

## Custom Quote Subdomain

Preferred setup:

```text
quote.example.com CNAME quotes.trennen.co.nz
```

Keep the custom domain in `pending_dns` until DNS and TLS are configured. Mark it `active` only when the hostname serves the Trennen quote flow over HTTPS.

## Iframe Fallback

Use this only if the website builder blocks third-party scripts:

```html
<iframe src="https://app.trennen.co.nz/embed/quote?tenant=TENANT_ID&embed=1" style="width:100%;border:0;min-height:760px;"></iframe>
```

## Security Requirements Before Public Launch

Before a shop embeds the quote flow on a live site:

1. Add the exact website origin in Admin -> Settings -> Embed allowed origins.
2. Use only `https://` origins, for example `https://example.co.nz`.
3. Do not use full page URLs in allowed origins. Use scheme + host only.
4. Confirm Stripe Connect is complete in Admin -> Payments.
5. Confirm the shop has real materials, colours, finish presets, pricing, shipping bands, support email, terms, and privacy copy.
6. Complete one Stripe test checkout before accepting real orders.

Normal quote pages keep `X-Frame-Options: SAMEORIGIN`. Only approved embed pages with `embed=1` can be framed by approved domains through `frame-ancestors`.

## Platform Visibility

Platform Admin remains the source of truth for:

- all stores
- total orders
- paid checkouts
- customer records
- shop-level revenue
- platform fee estimates
- audit events
- Stripe readiness
- billing status

Stores can manage their own public content and orders, but cannot see other stores' data.

## Operational Checks

Run after changing provisioning, embed, platform shop creation, or mailer code:

```bash
cd backend
npm run shop:provisioning-smoke
npm run embed:smoke
npm run saas-launch:smoke
npm run platform:smoke
npm run check
```

Before a launch deployment:

```bash
cd backend
npm run qa:full
git diff --check
```

# Shopify Custom App Setup

This repo now has an Express-backed Shopify custom app surface:

- Embedded admin: `/app?shop=your-store.myshopify.com`
- App proxy storefront route: `/apps/3d-quote`
- API routes: `/api/shopify/quote-preview`, `/api/shopify/model-files`, `/api/shopify/draft-order`
- Webhook receiver: `/api/shopify/webhooks`
- Theme app block: `extensions/instant-3d-quote`

## 1. Create and Link the App

1. Create a Shopify Partner app or custom app.
2. Copy its API key and secret into `backend/.env`.
3. Replace placeholders in `shopify.app.toml`:
   - `client_id`
   - `application_url`
   - `auth.redirect_urls`
4. Log in locally and link/deploy:

```bash
npm create @shopify/app@latest -- --help
shopify app config link
shopify app dev
shopify app deploy
```

The scaffold command needs an interactive Shopify browser login, so it cannot be completed unattended in this workspace.

## 2. Configure Shopify

Required scopes:

```text
write_draft_orders,read_draft_orders,read_orders,write_app_proxy
```

App proxy:

```text
prefix: apps
subpath: 3d-quote
destination URL: /apps/3d-quote
```

Webhooks:

```text
app/uninstalled -> /api/shopify/webhooks
orders/paid     -> /api/shopify/webhooks
orders/create   -> /api/shopify/webhooks
```

## 3. Production File Storage

Local file storage is intentionally blocked in production. Set:

```text
SHOPIFY_FILE_STORAGE=s3
SHOPIFY_S3_BUCKET=...
SHOPIFY_S3_ENDPOINT=...
SHOPIFY_S3_ACCESS_KEY_ID=...
SHOPIFY_S3_SECRET_ACCESS_KEY=...
```

Use `SHOPIFY_S3_PUBLIC_BASE_URL` if the bucket/object prefix is public. Otherwise the app stores signed URLs.

## 4. Smoke Checks

Run the Shopify-specific smoke test:

```bash
cd backend
npm run shopify:smoke
```

For a local unsigned proxy preview during development:

```bash
SHOPIFY_ALLOW_UNSIGNED_PROXY=1 npm run dev
open http://localhost:3000/apps/3d-quote?shop=your-store.myshopify.com
```

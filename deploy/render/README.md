# Trennen Render Preview Deployment

This is the easiest first hosted path for the real Trennen app. Render runs the existing Express backend, serves the marketing pages and quote flow, and keeps SQLite on a persistent disk.

Use this for a staging/preview URL first. Do not connect `trennen.co.nz` until the preview passes QA.

## Render Service

- Service type: Web Service
- Repo: `https://github.com/qcjc7rnr9d-boop/3d-quote-website-live`
- Branch: `codex/render-preview-deploy` or the reviewed launch branch you push
- Runtime: Node
- Node version: `26.0.0`
- Region: Singapore
- Build command: `cd backend && npm ci --omit=dev`
- Start command: `cd backend && npm run render:start`
- Health check path: `/api/platform-info`
- Persistent disk:
  - Name: `trennen-sqlite-data`
  - Mount path: `/opt/render/project/src/backend/data`
  - Size: `1 GB`

The disk mount path intentionally matches the app's current SQLite location, so no database path rewrite is needed.

## Required Environment Variables

Render can generate these from `render.yaml`:

- `SESSION_SECRET`
- `JWT_SECRET`
- `PLATFORM_CONFIG_ENCRYPTION_KEY`

Set these manually in Render before the first successful production-mode deploy:

- `BASE_URL=https://<your-render-service>.onrender.com`
- `EMAIL_FROM=Trennen <hello@trennen.co.nz>`
- `SALES_DEMO_TO=hello@trennen.co.nz`
- `RESEND_API_KEY=<resend key>` or SMTP variables if you choose SMTP later
- `PLATFORM_ADMIN_PASSWORD=<strong password>`
- Stripe test-mode values for staging:
  - `STRIPE_SECRET_KEY`
  - `STRIPE_PUBLISHABLE_KEY`
  - `STRIPE_CLIENT_ID`
  - `STRIPE_WEBHOOK_SECRET`

Leave Shopify variables unset for the first staging deploy unless Shopify is being tested at the same time. If Shopify is enabled in production, configure S3-compatible storage before accepting real quote files through Shopify.

## First Deploy Checklist

1. Push the reviewed deploy branch to GitHub.
2. In Render, create a Blueprint or Web Service from this repo.
3. Confirm the service is not connected to public DNS.
4. Confirm the persistent disk is attached before relying on SQLite data.
5. Enter staging environment variables.
6. Let Render build and start the service.
7. Open the Render URL and run smoke tests against it.

## Staging Verification

From this repo after the Render URL is live:

```bash
cd backend
npm run production:check:smoke
SMOKE_BASE_URL=https://<your-render-service>.onrender.com npm run sales:smoke
SMOKE_BASE_URL=https://<your-render-service>.onrender.com npm run sales-lead:smoke
SMOKE_BASE_URL=https://<your-render-service>.onrender.com npm run quote:ui-smoke
SMOKE_BASE_URL=https://<your-render-service>.onrender.com npm run frontend:smoke
```

Manual launch gates:

- Homepage loads on desktop and mobile.
- `Start free` opens `/onboarding.html`.
- `View demo` opens a clean upload-first quote demo.
- Demo leads persist to SQLite and send to `SALES_DEMO_TO`.
- Admin login page loads.
- Stripe is tested with test keys only.
- No `trennen.co.nz` DNS is pointed at Render until staging passes.

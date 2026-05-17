# Staged SaaS Launch Deployment

## Lightsail Demo Server

Use Lightsail only for the first live/demo server. Attach a static IPv4, point `app.yourdomain.com` at it, and keep only ports 80 and 443 public after Nginx is working. Port 3001 should be private to localhost.

Deploy/update from SSH:

```bash
cd ~/3d-quote-website-live
git pull
cd backend
nvm use 24
npm install
npm run migrate
pm2 restart 3d-quote-website
```

First `pm2` start:

```bash
cd ~/3d-quote-website-live/backend
pm2 start server.js --name 3d-quote-website
pm2 save
pm2 startup
```

## Environment

Production must use HTTPS:

```env
NODE_ENV=production
PORT=3001
BASE_URL=https://app.yourdomain.com
SESSION_SECRET=replace-with-long-random-secret
JWT_SECRET=replace-with-long-random-secret
PLATFORM_CONFIG_ENCRYPTION_KEY=replace-with-long-random-secret
RESEND_API_KEY=replace-with-real-provider-key
EMAIL_FROM=Trennen <hello@yourdomain.com>
```

For Shopify file uploads in production, configure S3-compatible storage:

```env
SHOPIFY_FILE_STORAGE=s3
SHOPIFY_S3_BUCKET=your-bucket
SHOPIFY_S3_REGION=ap-southeast-2
```

## Nginx

Copy `deploy/lightsail-nginx.conf.example` to an enabled Nginx site, replace `app.yourdomain.com`, then issue a certificate with Certbot or your chosen TLS tool. After HTTPS works, redirect HTTP to HTTPS.

## Customer Embed

Customers install:

```html
<script src="https://cdn.yourdomain.com/embed/v1/widget.js" data-shop="SHOP_SLUG"></script>
```

Each shop must list approved website origins in Admin Settings before the iframe can be embedded externally.

## Production Migration

Before broad paid rollout, move the app to App Runner, replace SQLite with RDS PostgreSQL, move all uploads to S3, and move secrets to AWS Secrets Manager.

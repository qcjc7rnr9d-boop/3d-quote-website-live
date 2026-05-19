# Staged SaaS Launch Deployment

## Lightsail Demo Server

Use Lightsail only for the first live/demo server. This lean release exposes the quote flow, Stripe checkout, admin/customer/platform essentials, transactional email, and the generic embed widget. Attach a static IPv4, point `app.trennen.co.nz` at it, and keep only ports 80 and 443 public after Nginx is working. Port 3001 should stay private to localhost.

## Deploy Checklist

Run from Lightsail SSH:

```bash
cd ~/3d-quote-website-live
git pull
cd backend
nvm use 24
npm install
npm run migrate
npm run check
npm run env:audit
pm2 restart 3d-quote-website --update-env
pm2 save
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1/api/health
npm run production-health:smoke
```

First `pm2` start:

```bash
cd ~/3d-quote-website-live/backend
pm2 start server.js --name 3d-quote-website --update-env
pm2 save
pm2 startup
```

## Environment

Production must use HTTPS:

```env
NODE_ENV=production
PORT=3001
TRUST_PROXY=1
BASE_URL=https://app.trennen.co.nz
SESSION_SECRET=replace-with-long-random-secret
JWT_SECRET=replace-with-long-random-secret
PLATFORM_CONFIG_ENCRYPTION_KEY=replace-with-long-random-secret
APP_EMAIL_DOMAIN=mail.trennen.co.nz
APP_EMAIL_FALLBACK="Trennen <hello@mail.trennen.co.nz>"
EMAIL_FROM="Trennen <hello@mail.trennen.co.nz>"
RESEND_API_KEY=replace-with-new-rotated-restricted-key
RESEND_WEBHOOK_SECRET=replace-with-resend-webhook-signing-secret
```

Verify `mail.trennen.co.nz` in Resend before sending live email. Add the DNS records Resend provides to the `trennen.co.nz` DNS zone, add DMARC at `p=none`, and rotate any API key that was copied into chat, screenshots, docs, or terminal history. Real keys belong only in the live server's `backend/.env`.

## Nginx

Copy `deploy/lightsail-nginx.conf.example` to an enabled Nginx site, replace `app.yourdomain.com` with `app.trennen.co.nz`, then issue a certificate with Certbot or your chosen TLS tool. After HTTPS works, redirect HTTP to HTTPS.

## Troubleshooting

- **502 Bad Gateway:** run `curl http://127.0.0.1:3001/api/health`. If it fails, inspect `pm2 logs 3d-quote-website --lines 50 --nostream`; if it passes, inspect Nginx config and `sudo systemctl status nginx --no-pager`.
- **Rate-limit `X-Forwarded-For` error:** ensure `TRUST_PROXY=1` is present in `backend/.env`, then run `pm2 restart 3d-quote-website --update-env`.
- **Wrong Node port:** ensure `PORT=3001` is present. Nginx proxies to `127.0.0.1:3001`.
- **Git asks for a password:** use the GitHub deploy key/SSH clone on Lightsail, or push from GitHub Desktop locally and `git pull` on the server.
- **Email domain not verified:** confirm `APP_EMAIL_DOMAIN=mail.trennen.co.nz`, verify the domain in Resend, and run `npm run env:audit` without printing secrets.

## Backup And Restore

Before moving servers or making risky changes, export:

```bash
cd ~/3d-quote-website-live
mkdir -p ~/3d-quote-backups/$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=$(ls -td ~/3d-quote-backups/* | head -1)
cp backend/data/rfdewi.db "$BACKUP_DIR/rfdewi.db"
cp backend/.env "$BACKUP_DIR/backend.env"
sudo cp /etc/nginx/sites-available/3d-quote-website "$BACKUP_DIR/nginx-3d-quote-website.conf"
pm2 save
cp ~/.pm2/dump.pm2 "$BACKUP_DIR/pm2-dump.pm2"
tar -czf "$BACKUP_DIR/uploads.tar.gz" uploads
```

To restore on a fresh server, clone from GitHub, install Node 24 and Nginx, copy `backend.env` back to `backend/.env`, restore `backend/data/rfdewi.db`, unpack `uploads.tar.gz`, restore the Nginx site, run `npm install && npm run migrate`, then restart with `pm2`.

## Customer Embed

Customers install:

```html
<script src="https://cdn.yourdomain.com/embed/v1/widget.js" data-shop="SHOP_SLUG"></script>
```

Each shop must list approved website origins in Admin Settings before the iframe can be embedded externally.

## Production Migration

Stay on Lightsail until the live demo is stable with real customers. Before broad paid rollout, move the app to App Runner, replace SQLite with RDS PostgreSQL using `DATABASE_URL`, move local uploads to S3 using `STORAGE_DRIVER=s3` and `S3_UPLOADS_BUCKET`, and move secrets to AWS Secrets Manager using `SECRETS_MANAGER_PREFIX`.

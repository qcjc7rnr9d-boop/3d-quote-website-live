# Trennen Lightsail Launch Runbook

This runbook turns the current launch homepage and quote platform into a repeatable first production deployment on Amazon Lightsail.

Baseline commit: `9360cd2 feat: launch Trennen sales homepage`

## 1. Production Shape

- Domain: `trennen.co.nz`
- App process: Node `26.x`, running `backend/server.js`
- App port: `127.0.0.1:3001`
- Public HTTPS proxy: Caddy
- Data store: SQLite at `/opt/trennen/3d-quote-website/backend/data/rfdewi.db`
- Backups: `/opt/trennen/backups/sqlite`
- Lead email: `Trennen <hello@trennen.co.nz>` to `hello@trennen.co.nz`

## 2. Lightsail Server Setup

Create an Ubuntu Lightsail instance, attach a static IP, and point DNS for `trennen.co.nz` and `www.trennen.co.nz` to that IP.

On the server:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git sqlite3

curl -fsSL https://deb.nodesource.com/setup_26.x | sudo -E bash -
sudo apt install -y nodejs

sudo install -d -o root -g root /etc/apt/keyrings
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
  | sudo gpg --dearmor -o /etc/apt/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy

sudo useradd --system --create-home --home-dir /opt/trennen --shell /usr/sbin/nologin trennen
sudo install -d -o trennen -g trennen /opt/trennen/3d-quote-website /opt/trennen/backups/sqlite
```

## 3. App Install

Clone the repo and install dependencies:

```bash
sudo -u trennen git clone https://github.com/qcjc7rnr9d-boop/3d-quote-website-live.git /opt/trennen/3d-quote-website
cd /opt/trennen/3d-quote-website
sudo -u trennen git checkout 9360cd2
cd backend
sudo -u trennen npm ci --omit=dev
```

Create production config:

```bash
sudo -u trennen cp /opt/trennen/3d-quote-website/deploy/lightsail/backend.env.production.example /opt/trennen/3d-quote-website/backend/.env
sudo -u trennen nano /opt/trennen/3d-quote-website/backend/.env
```

Replace every placeholder. Required production values include:

- `BASE_URL=https://trennen.co.nz`
- `SESSION_SECRET`, `JWT_SECRET`, and `PLATFORM_CONFIG_ENCRYPTION_KEY` as three different random values
- Resend `RESEND_API_KEY`
- `EMAIL_FROM=Trennen <hello@trennen.co.nz>`
- `SALES_DEMO_TO=hello@trennen.co.nz`
- Stripe keys and webhook secret
- S3-compatible storage values if Shopify is enabled

Generate strong secrets with:

```bash
openssl rand -base64 48
```

## 4. Database And Demo Data

Run the schema migration:

```bash
cd /opt/trennen/3d-quote-website/backend
sudo -u trennen npm run migrate
```

The homepage demo link depends on `quote.html?shop=mahi3d`. If this is a fresh database, create or restore the `mahi3d` demo shop before public launch. Do not run demo seeding while `NODE_ENV=production`; seed from a local/staging database and restore the reviewed SQLite file onto the server.

Before every migration or restore:

```bash
sudo -u trennen /opt/trennen/3d-quote-website/deploy/lightsail/backup-sqlite.sh
```

## 5. Service And HTTPS

Install the systemd unit:

```bash
sudo cp /opt/trennen/3d-quote-website/deploy/lightsail/trennen-backend.service /etc/systemd/system/trennen-backend.service
sudo systemctl daemon-reload
sudo systemctl enable trennen-backend
sudo systemctl start trennen-backend
sudo systemctl status trennen-backend --no-pager
```

Install the Caddy config:

```bash
sudo cp /opt/trennen/3d-quote-website/deploy/lightsail/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy will request and renew TLS certificates automatically once DNS points at the Lightsail static IP.

## 6. Production Readiness Check

Run the production checker after `.env`, migration, and demo data are ready:

```bash
cd /opt/trennen/3d-quote-website/backend
sudo -u trennen npm run production:check
```

The checker must pass before launch. It verifies safe production env, HTTPS base URL, mail provider, Stripe config presence, Shopify storage safety, SQLite schema, sales lead table, and the `mahi3d` demo shop.

## 7. Backup Schedule

Create a daily SQLite backup timer:

```bash
sudo crontab -u trennen -e
```

Add:

```cron
17 14 * * * /opt/trennen/3d-quote-website/deploy/lightsail/backup-sqlite.sh >> /opt/trennen/backups/sqlite/backup.log 2>&1
```

Manually test a backup:

```bash
sudo -u trennen /opt/trennen/3d-quote-website/deploy/lightsail/backup-sqlite.sh
ls -lh /opt/trennen/backups/sqlite
```

Restore by stopping the app, copying a known-good backup over `backend/data/rfdewi.db`, then starting the app:

```bash
sudo systemctl stop trennen-backend
gunzip -c /opt/trennen/backups/sqlite/rfdewi-YYYYMMDD-HHMMSS.db.gz \
  | sudo -u trennen tee /opt/trennen/3d-quote-website/backend/data/rfdewi.db >/dev/null
sudo systemctl start trennen-backend
```

## 8. Launch Verification

Run these before switching to live traffic:

```bash
curl -I https://trennen.co.nz/
curl https://trennen.co.nz/api/platform-info
cd /opt/trennen/3d-quote-website/backend
sudo -u trennen npm run production:check
sudo -u trennen env SMOKE_BASE_URL=https://trennen.co.nz npm run sales:smoke
sudo -u trennen env SMOKE_BASE_URL=https://trennen.co.nz npm run sales-lead:smoke
sudo -u trennen env SMOKE_BASE_URL=https://trennen.co.nz npm run frontend:smoke
```

Manual checks:

- Homepage desktop and mobile layout
- `Start free` opens `/onboarding.html`
- Onboarding has no placeholder Stripe URL such as `YOUR_PLATFORM_CLIENT_ID` or `yourdomain.com`
- `View demo` opens `/quote.html?shop=mahi3d`
- Demo request creates a SQLite row and delivers email to `hello@trennen.co.nz`
- Admin/platform password reset sends email
- Stripe test-mode checkout succeeds before live keys
- Stripe declined-card flow fails gracefully
- Caddy and app logs do not show repeated errors

## 9. Rollback

Rollback app code:

```bash
cd /opt/trennen/3d-quote-website
sudo -u trennen git fetch origin
sudo -u trennen git checkout <previous-good-commit>
cd backend
sudo -u trennen npm ci --omit=dev
sudo systemctl restart trennen-backend
```

Rollback database:

```bash
sudo systemctl stop trennen-backend
gunzip -c /opt/trennen/backups/sqlite/rfdewi-YYYYMMDD-HHMMSS.db.gz \
  | sudo -u trennen tee /opt/trennen/3d-quote-website/backend/data/rfdewi.db >/dev/null
sudo systemctl start trennen-backend
```

After rollback:

```bash
curl -I https://trennen.co.nz/
cd /opt/trennen/3d-quote-website/backend
sudo -u trennen npm run production:check
```

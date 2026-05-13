# Payments Setup Guide — RF DEWI

## 1. Create Stripe Account & Get API Keys

1. Go to https://dashboard.stripe.com and create/sign in to your account
2. In **Developers → API keys**, copy:
   - **Publishable key** → `STRIPE_PUBLISHABLE_KEY` in `.env`
   - **Secret key** → `STRIPE_SECRET_KEY` in `.env`
3. Start with **test mode** (keys beginning with `pk_test_` / `sk_test_`)

## 2. Test with Stripe Test Cards

While in test mode use these card numbers — any future expiry, any CVC:

| Card number         | Outcome           |
|---------------------|-------------------|
| 4242 4242 4242 4242 | Payment succeeds  |
| 4000 0000 0000 9995 | Insufficient funds|
| 4000 0025 0000 3155 | 3D Secure required|

## 3. Stripe Connect Setup (multi-shop platform)

RF DEWI operates as a **platform** — each print shop connects their own Stripe account, and the platform takes a 5% fee automatically.

1. In **Stripe Dashboard → Connect → Settings**:
   - Set your platform name: "RF DEWI"
   - Set redirect URI: `https://yourdomain.com/stripe-callback.html`
   - Copy **Client ID** (starts with `ca_`) → `STRIPE_CLIENT_ID` in `.env`
2. Connect OAuth URL used in `onboarding.html`:
   ```
   https://connect.stripe.com/oauth/authorize
     ?response_type=code
     &client_id=YOUR_PLATFORM_CLIENT_ID
     &scope=read_write
     &redirect_uri=https://yourdomain.com/stripe-callback.html
   ```
3. The callback page sends `?code=` to `POST /api/stripe/connect`, which exchanges it for a `stripe_user_id` (connected account ID) stored in the database.

## 4. Register Webhook Endpoint

1. In **Stripe Dashboard → Developers → Webhooks → Add endpoint**
2. URL: `https://yourdomain.com/api/stripe/webhook`
3. Select events to listen for:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `account.updated`
   - `capability.updated`
4. Copy **Signing secret** → `STRIPE_WEBHOOK_SECRET` in `.env`

> **Never skip webhook signature verification** — every webhook must pass
> `stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET)`

## 5. Shop Pay / Shopify Setup

Shop Pay is Shopify's accelerated checkout. To enable it:

1. Create a Shopify store at https://shopify.com
2. In **Apps → Develop apps → Create an app**, enable **Storefront API** access
3. Grant scopes: `unauthenticated_read_product_listings`, `unauthenticated_write_checkouts`
4. Copy the **Storefront access token** → `SHOPIFY_STOREFRONT_TOKEN` in `.env`
5. Copy your `.myshopify.com` domain → `SHOPIFY_STORE_DOMAIN` in `.env`

> Shopify handles **all payment capture** for Shop Pay — no card data ever reaches your server.

## 6. HTTPS is Required Before Going Live

Stripe **rejects plain HTTP** in production. Before switching to live keys:

1. Ensure your server has a valid TLS certificate
2. Set `NODE_ENV=production` in `.env`
3. This activates `secure: true` on session cookies

## 7. Deploy Your Express Backend

Recommended platforms (all have free tiers or low-cost plans):

| Platform   | Notes                                          |
|------------|------------------------------------------------|
| **Railway**   | `railway up` — easiest, persistent SQLite  |
| **Render**    | Free tier with auto-sleep, PostgreSQL add-on|
| **Fly.io**    | Fast cold starts, persistent volumes       |
| **Vercel**    | Serverless functions only — needs Postgres |

For Railway (recommended for this stack):
```bash
npm install -g @railway/cli
railway login
railway init
railway up
railway variables set STRIPE_SECRET_KEY=sk_live_...  # set all .env vars
```

## 8. Switch to Live Keys

Only after:
- ☐ HTTPS configured
- ☐ Webhook endpoint registered and tested
- ☐ All test payments working
- ☐ Error handling tested

Then replace `pk_test_` / `sk_test_` keys with `pk_live_` / `sk_live_` in your `.env`.

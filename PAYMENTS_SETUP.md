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

Trennen operates as a **platform** — each print shop connects their own Stripe account where possible. Trennen checkout/platform fees are plan-based and capped; Stripe/card/payment processing fees are pass-through costs recorded separately from Trennen platform revenue.

1. In **Stripe Dashboard → Connect → Settings**:
   - Set your platform name: "RF DEWI"
   - Set redirect URI: `https://yourdomain.com/stripe-callback.html`
   - Copy **Client ID** (starts with `ca_`) → `STRIPE_CLIENT_ID` in `.env`
2. Connect OAuth URL used from `admin/payments.html`:
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

## 5. HTTPS is Required Before Going Live

Stripe **rejects plain HTTP** in production. Before switching to live keys:

1. Ensure your server has a valid TLS certificate
2. Set `NODE_ENV=production` in `.env`
3. This activates `secure: true` on session cookies

## 6. Deploy Your Express Backend

For the first lean release, deploy the backend on the Lightsail instance behind Nginx:

```bash
cd ~/3d-quote-website-live
git pull
cd backend
nvm use 24
npm install
npm run migrate
pm2 restart 3d-quote-website
```

## 7. Switch to Live Keys

Only after:
- ☐ HTTPS configured
- ☐ Webhook endpoint registered and tested
- ☐ All test payments working
- ☐ Error handling tested

Then replace `pk_test_` / `sk_test_` keys with `pk_live_` / `sk_live_` in your `.env`.

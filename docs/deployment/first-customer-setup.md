# First Customer Setup Runbook

Use this for the first real pilot shop after the production pilot environment is deployed at `https://app.trennen.co.nz`.

## 1. Self-serve signup

- Ask the owner to sign up through the public onboarding page.
- Confirm Platform Admin shows the shop name, slug, owner email, selected plan, billing status, orders, and revenue.
- Confirm the owner lands on `admin/setup.html` and the shop starts on a no-card trial for paid plans.

## 2. Subscription billing

- Ask the owner to use Stripe-hosted subscription checkout from the setup or payments page.
- Confirm Trennen stores only Stripe customer, subscription, price, status, period, and cancellation references.
- Open Stripe Billing Portal from `admin/payments.html` and verify payment method updates and cancellation are hosted by Stripe.
- If the owner cancels, confirm access remains active until the period end shown by Stripe.

## 3. Customer-facing launch

- Set the public support email mode before sharing the shop.
- Review starter materials, pricing, GST, shipping, and bank transfer instructions.
- Open the hosted page at `https://app.trennen.co.nz/q/{shop-slug}`.
- Copy the iframe embed code from setup/settings and approve the customer's website origins.
- Place one bank transfer order and confirm the order appears in the owner admin.

## 4. Optional card checkout

- Connect Stripe Express only when the owner wants card payments for print orders.
- Keep bank transfer enabled first.
- In Stripe test mode, confirm customer card checkout is blocked before Connect is ready and works only after charges, payouts, and details are enabled.
- Confirm card payment fees and Trennen checkout fees stay separate from the owner's Trennen subscription.

## 5. Before sharing publicly

- Verify email sending with the shop's support contact privacy choice.
- Confirm the owner can identify their shop URL, embed snippet, billing status, and customer orders.
- Confirm Platform Admin can identify the shop by slug, owner email, plan, subscription state, orders, and revenue.
- Take a database and uploads backup before moving from test-mode pilot to live money.

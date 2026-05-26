# Trennen Pricing And Fees

This is the human source of truth for Trennen's pilot pricing model. Executable defaults live in `backend/lib/billing-plans.js` and are seeded into SQLite by migration v26.

## Free pilot only

The production pilot has one active membership plan:

| Plan | Monthly price | Quote allowance | Checkout requirement | Trennen platform fee |
| --- | ---: | ---: | --- | ---: |
| Free pilot | NZ$0 | Unlimited for pilot | Stripe Connect Express ready | 5% included in customer quote total |

No Stripe Billing subscription is required during the pilot. `/api/platform/shops` must return `billing_setup_status: "free_plan"` and `billing_checkout_url: null` for every new business. `/api/platform/shops/:id/billing-session` must return `FREE_PLAN_NO_BILLING_REQUIRED`.

Paid plans, plan trials, Stripe Billing checkout links, and monthly subscription price IDs are intentionally dormant until the pilot proves the full quote-to-payment flow.

## Included 5% Platform Fee

The 5% Trennen platform fee is included in the customer-facing quote total. It is not shown as a separate surcharge line.

Calculate the shop's seller net total first, then gross up the final customer total:

```text
customerTotal = sellerNetTotal / (1 - 0.05)
platformFeeIncluded = customerTotal - sellerNetTotal
```

When Stripe Connect checkout succeeds, `application_fee_amount` must equal the included Trennen fee. The PaymentIntent must still use `transfer_data.destination` and `on_behalf_of` so the remaining funds transfer to the connected business.

## Fee Separation

Customer print orders can contain these separate monetary concepts:

- Seller net print total
- Included Trennen platform fee
- GST if configured
- Shipping if configured
- Optional payment processing fee if passed through at cost
- Final customer total
- Actual Stripe/payment processing fee recorded as cost after payment

Stripe/payment processing fees are separate from Trennen platform revenue. Trennen must not use Stripe fees as a profit centre.

## Quote Usage

Count a quote only when it becomes customer-visible or submitted, such as a saved quote or checkout-created order. Do not count `/api/customer/quote-preview` drafts.

The free pilot does not enforce a monthly quote limit. Keep quote usage metrics so future paid plans can be designed from real data.

## Merchant Dashboard

Show:

- Plan name: Free pilot
- Quotes used this month
- Quote allowance: unlimited for pilot
- Stripe Connect readiness
- Card checkout volume this month
- Trennen platform fee collected this month
- Payment fee mode

## Payment Fee Modes

Allowed values:

- `merchant_absorbs`
- `pass_to_customer_at_cost`

Stripe card checkout shows a processing fee before confirmation only when the merchant passes it to the customer at cost. Customer checkout is Stripe-only for launch.

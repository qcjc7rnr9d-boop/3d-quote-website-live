# Trennen Pricing And Fees

This is the human source of truth for Trennen's customer-friendly pricing model. Executable defaults live in `backend/lib/billing-plans.js` and are seeded into SQLite by migration v26.

All prices exclude GST. Store plan prices internally in NZD cents. GST is configurable and defaults to 15%.

## Principles

- The monthly Trennen subscription pays for access to the quoting software.
- Stripe/card/payment processing fees are pass-through costs, not Trennen revenue.
- Merchants can absorb card fees, pass them to customers at cost, or use bank transfer only.
- Trennen checkout/platform fees are separate from Stripe fees and must be capped.
- Trennen must not use Stripe fees as a profit centre.
- No uncapped percentage-of-revenue model by default.
- Meter customer-understandable events, especially quotes sent or submitted to customers.

## Plans

| Plan | Monthly price | Included quotes | Overage | Checkout/platform fee |
| --- | ---: | ---: | ---: | --- |
| Community | NZ$0 | 3 | Disabled | Disabled or bank-transfer-only |
| Starter | NZ$29 + GST | 25 | NZ$1 per extra quote | 0.5%, capped at NZ$29/month |
| Growth | NZ$129 + GST | 250 | NZ$0.50 per extra quote | 0.5%, capped at NZ$79/month |
| Scale | NZ$899 + GST | 1,000 | NZ$0.25 per extra quote | Included or custom capped |
| Enterprise | Talk to us | Custom | Custom capped terms | Custom capped terms |

Starter and Growth have a 14-day trial. Growth trials apply only if the merchant has not used a trial before. Scale can be monthly or annual. Enterprise is annual or custom.

## Fee Separation

Customer print orders can contain these separate monetary concepts:

- Print order subtotal
- GST if applicable
- Shipping if applicable
- Payment processing fee if passed through
- Total paid by the end customer
- Stripe/payment processing fee recorded as cost
- Trennen checkout/platform fee recorded as platform revenue

Stripe/payment processing fees must never reduce Trennen subscription revenue. If Stripe Connect is used, each print shop should have its own connected account where possible. Trennen may collect the capped checkout/platform fee with `application_fee_amount`; that amount must not exceed the monthly cap.

## Quote Usage

Count a quote only when it becomes customer-visible or submitted, such as a saved quote or checkout-created order. Do not count `/api/customer/quote-preview` drafts.

Community cannot overrun its included 3 quotes. Starter, Growth, and Scale can exceed allowance and are billed in arrears. Show an overage warning before the user sends a quote beyond allowance.

## Merchant Dashboard

Show:

- Plan name
- Quotes used this month
- Quote allowance
- Remaining included quotes
- Estimated overage charges
- Checkout volume this month
- Checkout platform fee used so far
- Checkout platform fee cap
- Payment fee mode

## Payment Fee Modes

Allowed values:

- `merchant_absorbs`
- `pass_to_customer_at_cost`
- `bank_transfer_only`

Bank transfer has no processing fee. Card/Stripe shows a processing fee before confirmation only when the merchant passes it to the customer at cost.

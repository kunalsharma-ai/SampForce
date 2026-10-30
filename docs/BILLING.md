# Billing setup and verification status

DealFlow bills through **Stripe** (cards, global) and/or **Razorpay** (India). Either, both or neither can be
configured. With neither, the Billing page shows plans and usage, offers the free trial, and says that online
checkout is not configured. Design decisions are in [ADR 0010](adr/0010-billing-and-operator-realm.md).

## Verification status (2026-10-30)

| Piece | Status |
|---|---|
| Stripe adapter (Checkout, Customer Portal, subscription update, signed webhooks) | Built. Tested against a local fixture only. **Not run against Stripe test mode.** |
| Razorpay adapter (subscription link, update, cancel, signed webhooks) | Built. Tested against a local fixture only. **Not run against Razorpay test mode.** |
| Request and response shapes | Stripe: checked against docs.stripe.com for checkout session parameters, portal sessions, subscription update, status values, event names, and the move of `current_period_*` to subscription items and of `invoice.subscription` to `invoice.parent`. Razorpay: subscription states and webhook event names checked against razorpay.com/docs; **the create/update/cancel request bodies (`total_count`, `schedule_change_at`, `cancel_at_cycle_end`), the `X-Razorpay-Signature` algorithm, the `x-razorpay-event-id` header and the webhook payload fields were not confirmed from the docs** and must be checked in test mode. |
| Tax | Stripe Tax is requested only when `STRIPE_AUTOMATIC_TAX=true` and the Stripe account has it set up. DealFlow does not calculate or validate tax itself. |

Before taking real money: run each provider in test mode end to end (checkout, renewal, failed payment, seat
change, cancellation), confirm the webhook endpoint receives and verifies events, and compare the stored
invoices with the provider dashboard.

## Stripe

1. Create one recurring **price** per plan and interval you want to sell (per-unit, quantity = seats).
2. Set `STRIPE_SECRET_KEY` and map prices: `STRIPE_PRICES=launch:MONTH=price_…,launch:YEAR=price_…,growth:MONTH=price_…`.
3. Add a webhook endpoint `https://<your-domain>/api/v1/billing/webhooks/stripe` for
   `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.finalized`, `invoice.paid`, `invoice.payment_failed`; set its signing
   secret as `STRIPE_WEBHOOK_SECRET`.
4. Configure the Customer Portal (payment methods, invoices, cancellation) in the Stripe dashboard.
5. Promotion codes created in Stripe can be entered at checkout (`allow_promotion_codes`).

## Razorpay

1. Create one **plan** per plan and interval (amount per seat). Razorpay plans carry their own currency, usually INR.
2. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_PLANS=growth:MONTH=plan_…,…`.
3. Add a webhook to `https://<your-domain>/api/v1/billing/webhooks/razorpay` for the `subscription.*` events and
   set its secret as `RAZORPAY_WEBHOOK_SECRET`.
4. Razorpay has no customer portal: card changes go through the subscription's payment link, seat and plan
   changes apply from the next cycle, and a scheduled cancellation cannot be withdrawn.

## Other settings

| Variable | Default | Meaning |
|---|---|---|
| `BILLING_GRACE_DAYS` | 14 | Days a past-due workspace keeps paid allowances |
| `TRIAL_DAYS` | 14 | Length of the one free trial per workspace |
| `PRICING_PUBLISHED` | false | Removes the "preview" labels from the pricing page and Billing page |
| `SALES_CONTACT_EMAIL` | unset | Shown as "Contact sales" for Enterprise Plus |
| `OPERATOR_JWT_SECRET` | unset | Enables the operator console; must differ from `JWT_ACCESS_SECRET` |

Create the first operator: `OPERATOR_EMAIL=… OPERATOR_PASSWORD=… OPERATOR_ROLE=ADMIN pnpm --filter @dealflow/api operator:create`.

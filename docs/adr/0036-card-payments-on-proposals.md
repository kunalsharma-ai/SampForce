# ADR 0036: Card payments on proposals, into the workspace's own account

- Status: Accepted
- Date: 2026-11-01
- Part of: Enhancement programme, integrations (builds on ADR 0032)

## Context

Customers receive proposals by link. Sellers want them to be able to pay an accepted proposal by card straight
away, with the money going into the seller's own payment account, not SampForce's. SampForce already bills its own
subscriptions through Stripe and Razorpay with operator keys; that must stay separate.

## Decisions

1. **The workspace's own keys.** An admin pastes a Stripe restricted or secret key, or a Razorpay key id and secret,
   with a webhook secret. They are saved only after a read that charges nothing succeeds (`GET
   /v1/checkout/sessions` or `GET /v1/payment_links`), sealed with the SecretBox, and never returned. There is no
   operator secret, so the app is never Pending Configuration; it is Not connected until keys are saved, and shows a
   warning until the first signed webhook arrives.
2. **Hosted pages only.** Stripe Checkout Sessions and Razorpay Payment Links. SampForce never handles card data, so
   it stays out of PCI scope beyond SAQ A.
3. **Paid means confirmed.** The customer returning to the proposal is not proof. A payment is marked paid only by
   the provider's signed webhook (with Stripe's 5-minute timestamp window) and only when the amount in minor units
   and the currency match the recorded request. Updates are conditional, so retries and races mark it once.
4. **One webhook URL per workspace.** The URL carries a random 24-hex id stored as the connection's external account
   id. The lookup uses the existing `provider_lookup` RLS policy, and the signature is checked with that workspace's
   secret, so one workspace cannot confirm another's payment.
5. **When payment opens.** Only for a shared, accepted, latest version with a total above zero. Acceptance stays the
   seller's action (or the portal's); payment never changes the quote's status or prices.
6. **Records.** Each attempt is a `quote_payments` row (pending, paid, failed, expired) with the amount asked. The
   rep is notified, `quote.paid` is audited, and app events log starts, mismatches and failures.

## Consequences

- Tested only against a local stand-in of the documented Stripe and Razorpay APIs. A real test-mode run is needed
  before calling it working.
- No refunds, partial payments, deposits, instalments or invoices yet. Three-decimal currencies are refused.
- Disconnecting while a payment is in progress loses that confirmation, and the Integrations page warns about it.

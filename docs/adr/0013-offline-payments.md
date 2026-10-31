# ADR 0013: Offline payments first, online checkout switched off

**Status:** accepted, 2026-10-31. **Decided by:** Kunal (Sampledge): "keep offline payment acceptance only" for now.

**Context.** Phase 6 built Stripe and Razorpay checkout, tested against local fixtures only. Sampledge wants to
launch accepting payment offline (bank transfer against an invoice) and keep online checkout for later.

**Decision.**

- `ONLINE_PAYMENTS_ENABLED` (default `false`) gates **new** online subscriptions: with it off, the catalogue reports
  nothing buyable online, the Billing page shows no checkout, and `POST /billing/checkout` answers 503
  `ONLINE_PAYMENTS_OFF`, even when provider keys are set. The Stripe and Razorpay code, webhooks and portal stay in
  place so that existing provider subscriptions (if any) keep syncing and checkout can be turned back on with one
  setting.
- A workspace's billing manager **requests an invoice** for a self-serve plan, interval and seat count. DealFlow
  issues it at rate-card prices (price × seats × months, USD, taxes excluded), numbered `DF-000001` from a shared
  sequence, stored in `invoices` with provider `OFFLINE`. One open offline invoice per workspace (partial unique
  index). The workspace can cancel it while it is open. Enterprise Plus stays sold by quote through the operator
  plan override.
- How to pay comes from `OFFLINE_PAYMENT_INSTRUCTIONS` (the deployment's real bank details). DealFlow never invents
  them: unset, the invoice says the DealFlow team will send payment details.
- A platform **ADMIN operator records the payment** in the operator console (bank reference and date received; not
  in the future). That marks the invoice paid and applies its plan: same plan, interval and seats renews from the
  end of the current period; anything else starts a new period on the day the money arrived (no proration; any
  credit for unused time is handled by hand). Recorded in the workspace audit log and the platform audit log, and
  billing managers are notified. SUPPORT operators can see open invoices but not mark them paid or void them.
- The billing worker ends offline periods: with a scheduled cancellation the workspace moves to Free; otherwise it
  becomes past due, with the grace period (`BILLING_GRACE_DAYS`) counted from the end of the paid period, then
  unpaid (Free allowances, no data removed) until a renewal is paid.

**Consequences.** No card data or payment processor is involved, so nothing about payments needs a provider test
run before launch. The cost is manual work: someone at Sampledge must watch the bank account and record each
payment, and there is no automatic renewal reminder before a period ends (the workspace is notified when it ends).
DealFlow's invoice is a payment request, not a tax invoice: Sampledge issues any tax invoice its accounting
requires outside DealFlow.

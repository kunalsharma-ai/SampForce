# ADR 0010: Billing, entitlements and the operator realm

**Status:** accepted (2026-10-30)

**Context.** Phase 6 turns SampForce into something a workspace can pay for, and gives Sampledge staff a way to run
the platform. Both touch money and cross the tenant boundary, so they need the same guarantees as the rest of the
product: RLS isolation, an audit trail, and no claim the code cannot back up. There are no Stripe or Razorpay
accounts or keys in this environment.

**Decision.**

- **Hosted payment pages only.** Checkout is Stripe Checkout or a Razorpay subscription link. Card and bank
  details never reach SampForce; the database stores only provider references (customer, subscription, invoice
  ids) and amounts the provider reports.
- **Webhooks are the source of truth.** A paid plan becomes active when a webhook whose signature verifies over
  the raw request body says so (Stripe: `t.payload` HMAC-SHA256 with a 300 s tolerance; Razorpay: HMAC-SHA256 of
  the body). Each event id is stored in `billing_events` (unique per provider), so redelivery is a no-op. Because
  providers do not guarantee order, the handler re-reads the subscription from the provider API instead of
  trusting the event payload.
- **Finding the workspace.** A provider reference already on file wins (`app_billing_tenant()`, a SECURITY
  INVOKER function over a narrow `billing_ref_lookup` policy, like form tokens). Otherwise the `tenant_id`
  SampForce put in checkout metadata, which must name an existing workspace. Unknown workspaces are acknowledged
  and ignored.
- **Prices live with the provider.** `STRIPE_PRICES` / `RAZORPAY_PLANS` map each plan and interval to a provider
  price or plan id. An unmapped plan cannot be bought; the UI says so. The displayed USD rate card comes from
  `PLAN_CATALOG` and is labelled a preview until `PRICING_PUBLISHED=true`.
- **One entitlement rule.** `effectiveEntitlements()` in `@dealflow/types` decides what a workspace may use:
  Free is capped at 2 users; paid plans at the seats bought; trials at 10 seats. `UNPAID` and `CANCELED` fall back
  to Free allowances. Nothing is deleted when that happens, only new usage above the Free allowances is refused.
  Every limit check (seats, pipelines, AI credits, automation runs, custom roles) calls it.
- **Dunning in SampForce, not only at the provider.** `PAST_DUE` starts a `BILLING_GRACE_DAYS` window (default
  14); the worker moves the workspace to `UNPAID` when it ends and tells billing managers. A later successful
  payment restores the plan.
- **Trials need no card.** One per workspace (`trial_used_at`), for any self-serve plan, `TRIAL_DAYS` long. The
  worker returns the workspace to Free when it ends.
- **Operators are a separate realm.** Own table (`platform_operators`), own signing key (`OPERATOR_JWT_SECRET`,
  must differ from the workspace key), own issuer/audience, own cookie (`df_op`, HttpOnly, SameSite=Strict,
  `Path=/api/v1/operator`, 8 hours, no refresh). The console is disabled (404) when the key is unset. Operators are
  created from the command line; there are no default credentials.
- **What operators can see.** Cross-tenant reads use a transaction-local `app.operator_scan` flag that opens
  SELECT on tenants, subscriptions, memberships, invoices and support grants only. CRM tables have no such
  policy, so a scan returns no CRM rows even by mistake (tested). Member lists and the workspace audit log appear
  only while the workspace has granted support access (1 to 72 hours, with a reason, revocable).
- **Everything operators do is logged twice.** `platform_audit_logs` (append-only for the app role) and, for any
  change to a workspace, the workspace's own audit log with `actorType = PLATFORM_ADMIN`, the operator's email and
  the reason.

**Deviation from the plan.** The architecture planned a separate `apps/admin`. The operator console is instead a
route group (`/operator`) in the web app with its own layout and no shared session. A separate deployable can be
split out later without API changes; it was not worth a third app before there is a team using it.

**Consequences.**

- Nothing about either provider is verified against a real account. The adapters were checked against the
  providers' public documentation where the documentation was readable (see `docs/BILLING.md`) and tested
  against local fixtures that imitate those shapes. Some Razorpay request fields could not be confirmed from the
  docs and must be checked in Razorpay test mode before launch.
- Razorpay applies seat and plan changes from the next cycle and cannot undo a scheduled cancellation; Stripe
  prorates immediately and can. The UI says which applies.
- An operator plan override on a workspace that pays through a provider is overwritten by the provider's next
  webhook. The console warns about this.

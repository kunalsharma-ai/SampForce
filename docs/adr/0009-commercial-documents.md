# ADR 0009: Commercial documents, approvals and public forms

**Status:** accepted (2026-10-30)

**Context.** Phase 5 adds money-bearing records (quotes, contracts) and the first unauthenticated write path
(hosted lead forms). Both need the same guarantees as the rest of SampForce: tenant isolation by RLS, people in
control of anything that changes prices or commitments, and no claims the product cannot back up.

**Decision.**

- **Prices come from price books only.** Quote lines carry a product, quantity, discount and tax rate; the server
  reads the unit price from the quote's price book every time lines are written, and on revision. No API accepts a
  unit price on a quote. AI agents can read quotes but have no tool to create or change them.
- **Discount approvals reuse the approvals inbox.** An `approval_requests` row with `kind = 'quote_discount'`,
  `permission = 'quotes:approve'` and no workflow execution. The approvals service calls quote hooks on decide and
  on expiry, so the quote stays in step from whichever screen the decision is made. The creator of a quote cannot
  approve its discount.
- **Versions, not edits.** Once a quote leaves draft, changes happen by revising into a new version with the same
  number; earlier versions are kept and locked. A signed contract's value, terms and start date cannot change.
- **Signatures are recorded, not collected.** Contracts store who signed, when and how (paper, email confirmation
  or an external tool). No e-signature provider is integrated, and the UI says so.
- **Public forms resolve their tenant through a narrow policy.** The public endpoint sets `app.form_token` and
  calls `app_form_tenant(token)`, which can see only the one active form with that token; everything after that
  runs in the form's tenant context like any other request. Submissions are append-only, store the consent text
  the visitor saw, and store the client address only as an HMAC for rate limiting. `/f/:token` is the only route
  that may be framed.
- **Consent is explicit.** Marketing consent is opted in, opted out or not asked. A form counts consent only when
  it showed consent text and the box was ticked. Segment exports never include opted-out people.
- **Cross-tenant jobs read contracts through `app.worker_scan`.** As with the Phase 3 queues, the worker finds due
  contracts across tenants and then works inside each tenant's context.
- **Numbers are computed, never modelled.** Revenue analytics, attribution and customer health are deterministic
  functions in `@dealflow/types` or SQL over the tenant's records; other currencies use rates a person entered.

**Consequences.** Commercial changes are auditable and reversible by new versions rather than edits. There is no
email sending, e-signature or automatic FX yet; each needs a provider and is listed as deferred in the plan.

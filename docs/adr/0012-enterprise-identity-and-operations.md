# ADR 0012: Enterprise identity and production operations

**Status:** accepted (2026-10-31)

**Context.** Phase 8 makes DealFlow ready for larger customers and for running in production: two-step
verification, single sign-on, automated provisioning, session control, a strict content security policy, metrics
and traces, a Kubernetes deployment, backups that are known to restore, and runbooks. Each of these can lock people
out or leak data if done loosely, so the rules below favour failing closed and saying plainly what is not built.

**Decision.**

- **Two-step verification is TOTP (RFC 6238)** with 6 digits, 30 s steps and a ±1 step window. A code is accepted
  once (the last used step is stored and checked in the same conditional `UPDATE`). Secrets are sealed with
  `SecretBox`. Enrolment needs the password, then a working code; it returns 10 single-use recovery codes, stored
  as SHA-256 hashes, and signs out every other device. Password sign-in with MFA on returns a 5-minute signed
  challenge instead of cookies. WebAuthn/passkeys are not built.
- **Lockout:** 10 failed passwords in a row lock the account for 15 minutes, counted atomically in SQL. The error
  does not say whether the account exists or is locked. Owners have no exemption.
- **Sessions:** each refresh-token family is a row with device, IP, sign-in method and last use. The access guard
  checks the row on every request, so "sign out this device" takes effect at once. Theft detection (revoke the whole
  family) applies only when a rotated refresh token is reused, not after a deliberate sign-out.
- **Single sign-on is OIDC only** (authorization code, PKCE S256, `state` and `nonce`, `client_secret_basic`).
  Discovery must return exactly the configured issuer, every URL passes the private-network guard, and ID tokens are
  verified with the provider's JWKS (issuer, audience, `azp`, nonce, expiry, verified email). The workspace chooses
  allowed email domains, whether to create accounts just in time (with a default role, never Owner) and whether to
  enforce SSO. Enforcement needs a successful sign-in first (`lastVerifiedAt`) and never applies to Owners, who keep password sign-in as a break-glass route. An SSO session is
  bound to the workspace that issued it (`stid` claim) and cannot switch to another workspace. SAML 2.0 is not built.
- **SCIM 2.0 Users** (`/api/v1/scim/v2`) with bearer tokens (`dfscim_…`, SHA-256 hashed, at most 5, shown once).
  SCIM ids are membership ids. Deactivation suspends the membership; access to that workspace stops on the next request because the guard checks membership status every time. SCIM never
  changes an Owner, and changes a person's email or name only when this workspace is their only membership, so one
  customer's directory cannot rename someone in another customer's workspace. Seat limits apply. Groups are not built.
- **SSO and SCIM are on every plan, including Free** (decided by Kunal on 2026-10-31). An earlier draft made them
  Enterprise entitlements; migration `20261031000200_sso_all_plans` removed the `sso` key from the plan catalogue, so
  there is no plan check and enforcement no longer depends on the plan. Seat limits still apply to people added
  through SSO or SCIM.
- **CSP with per-request nonces** from Next.js middleware: `script-src 'self' 'nonce-…' 'strict-dynamic'`, no
  `unsafe-eval`, `frame-ancestors 'none'` except embeddable lead forms (`/f/…`), `upgrade-insecure-requests` only on
  HTTPS. The browser suite fails on any CSP violation. Pages are rendered per request as a result.
- **Observability:** Prometheus metrics on a separate port (`METRICS_PORT`), labelled by route template, never by
  raw URL; OpenTelemetry traces only when an OTLP endpoint is set; health checks are not traced; tokens, codes and
  cookies are redacted from URLs, logs and spans; logs carry `trace_id`.
- **Database settings per transaction:** every tenant transaction sets `plan_cache_mode = force_custom_plan` and
  `jit = off`. The load test showed generic plans (after five executions of a prepared statement) turning a 30 ms
  query into 20 s, and JIT taking 390 ms of a 410 ms report.
- **Backups are logical dumps taken by a read-only `dealflow_backup` role with BYPASSRLS**, because forced RLS makes
  `pg_dump` refuse to run as any other non-superuser role. Restores go into a new database and are verified (row
  counts, RLS check, runtime role sees nothing without a tenant). Point-in-time recovery is the database provider's
  job and is not tested here.
- **Encryption keys rotate** with `ENCRYPTION_KEY_PREVIOUS` (values open with either key) and a re-seal script.
- **Deployment is a Helm chart** with API, worker and web Deployments, a pre-upgrade migration Job, HPAs, PDBs,
  NetworkPolicies, and optional ServiceMonitors and alert rules. Pods run as non-root with a read-only root
  filesystem and no service-account token.

**Consequences.** Customers can meet common enterprise security questionnaires item by item, but DealFlow makes no
certification or compliance claim. The chart has not been rendered or installed here (no Helm binary or cluster in
the build environment); CI lints and schema-checks it. Deferred: SAML, WebAuthn, SCIM Groups, IP allow-lists,
password reset by email, egress NetworkPolicies, and PITR drills.

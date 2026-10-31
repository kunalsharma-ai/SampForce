# DealFlow Security Model

DealFlow does not claim any certification or legal compliance. This document describes controls designed to
support obligations under GDPR, India's DPDP Act, CCPA/CPRA and CAN-SPAM; independent assessment is needed
before any compliance statement is made.

## 1. Threat model summary

| Threat | Primary controls | Status |
|---|---|---|
| Cross-tenant data access | PostgreSQL RLS (FORCE) + non-bypass runtime role + per-request membership check + tests | **Implemented, tested** |
| Credential stuffing / brute force | argon2id, generic errors, constant-time unknown-user path, per-IP rate limits on auth, lockout after 10 failures (15 min), TOTP two-step verification with single-use recovery codes, workspace policy to require it | **Implemented, tested** (Phase 8) |
| Session theft | HttpOnly SameSite cookies, short access tokens, rotating refresh tokens with reuse detection | **Implemented, tested** |
| CSRF | SameSite=Lax + Origin allow-list on unsafe methods + JSON-only bodies | **Implemented, tested** |
| Privilege escalation | Permissions checked server-side on every route; owner role protected; last-owner guard | **Implemented, tested** |
| Tampering with history | Audit log append-only at the database grant level | **Implemented, tested** |
| Injection | Prisma parameterized queries; tagged-template raw SQL only; Zod validation on all input | **Implemented** |
| XSS | React escaping, no `dangerouslySetInnerHTML` except a nonce-bearing theme bootstrap; CSP with per-request nonces and `strict-dynamic`, no `unsafe-eval` | **Implemented, tested** (browser suite fails on any CSP violation) |
| Clickjacking / sniffing | `X-Frame-Options: DENY`, `nosniff`, Helmet on API | **Implemented** |
| Secrets leakage | Env-only secrets validated at boot; no secrets in repo; log redaction of cookies/auth headers | **Implemented** |
| AI misuse / prompt injection | Tool allowlists, approval tiers, untrusted-content wrapping, cost caps | Designed (Phase 4) |
| Malicious uploads | Signed uploads, type/size limits, malware scanning, tenant-prefixed keys | Designed (Phase 2) |
| Platform operator overreach | Separate auth realm (own accounts, key, cookie, guard); cross-tenant reads limited by RLS to tenants, subscriptions, memberships, invoices and support grants; members and audit log only under an owner's time-boxed grant; CRM records never; every action in an append-only platform log and the workspace audit log | **Implemented, tested** (Phase 6, ADR 0010) |
| Account takeover via SSO or directory | OIDC with PKCE, state, nonce, exact issuer, JWKS signature, audience and `azp` checks, verified email, domain allow-list; SSO sessions bound to their workspace; SCIM tokens hashed; SCIM cannot change owners or people who belong to other workspaces | **Implemented, tested against a local provider** (ADR 0012) |
| Stolen session after sign-out | Session row checked on every request; device sign-out and sign-out of all other devices | **Implemented, tested** |
| Secrets in telemetry | URL, header and span redaction of tokens, codes and cookies | **Implemented, tested** |
| Payment fraud / forged billing events | Hosted checkout only (no card data in DealFlow); webhooks verified by HMAC over the raw body, Stripe timestamp tolerance, idempotent per event id, state re-read from the provider | **Implemented, tested against fixtures** |

## 2. Identity and access

- **Roles:** Owner, Administrator, Sales Manager, Sales Representative, Viewer, each a list of
  `resource:action` permissions (`packages/types/src/permissions.ts`). Custom roles (Phase 6, Professional and above) reuse the same
  catalogue; nobody can create, assign or invite into a role with permissions they do not hold. Attribute-based rules (record ownership, territory, team) layer on top in Phase 2.
- **Owner protections:** only owners can grant or remove the owner role; the last owner cannot be demoted.
- **Two-step verification (Phase 8):** TOTP with recovery codes; a workspace can require it for password sign-in.
- **Single sign-on and SCIM (Phase 8, every plan):** OIDC per workspace with optional enforcement (owners keep
  password sign-in as break-glass); SCIM 2.0 Users. See ADR 0012.
- **Sessions (Phase 8):** Account security lists signed-in devices and signs them out immediately.
- **Not built:** WebAuthn/passkeys, SAML 2.0, SCIM Groups, IP allow-lists.
- **Password reset by email:** one-time links (32 random bytes, only a SHA-256 hash stored, 30 minutes by default),
  sent through the operator's SMTP service. The same answer whether or not the address has an account; at most 3
  links per account per hour; a new link cancels older ones; a reset signs out every device, clears any lockout,
  writes an audit entry and emails a "password changed" notice. Two-step verification still applies after a reset.
  The token travels in the URL fragment so it does not reach server logs. Tested only against a local SMTP stand-in.

## 3. Data protection

| Area | Control |
|---|---|
| In transit | TLS 1.2+ everywhere; HSTS; `COOKIE_SECURE=true` enforced in production at boot |
| At rest | Managed Postgres and object storage encryption; integration credentials envelope-encrypted with per-tenant keys (Phase 3) |
| Secrets | Environment / secret manager only; `.env.example` holds placeholders; JWT secret ≥ 32 chars enforced |
| Backups | `scripts/backup.sh` with a read-only BYPASSRLS backup role; restores into a new database with verification, drilled in Phase 8 (docs/runbooks/database-restore.md). Scheduling, off-site storage, encryption and PITR are the operator's and provider's job and are not tested here |
| Key rotation | `ENCRYPTION_KEY_PREVIOUS` plus a re-seal script; drilled (docs/runbooks/key-rotation.md) |
| Export controls | Exports require `data:export`, are audited, and are rate-limited; AI agents cannot export. Report CSV exports follow the same rule (Phase 7) |
| Report builder | Definitions are validated against a fixed field catalogue and compiled with bound parameters only; runs need the entity's read permission, stay inside RLS with an explicit tenant filter, and time out after 10 s (ADR 0011) |

## 4. Privacy operations (Phases 2–8)

| Mechanism | Design |
|---|---|
| Consent records | Per contact/lead, per channel and purpose, with source, timestamp and evidence |
| Access requests | Export of all records referencing a data subject, generated as a job and audited |
| Correction | Standard edit with audit trail |
| Deletion | Subject deletion workflow: hard-delete or anonymise across records, files, search and AI indexes, with a certificate of completion |
| Records of processing | Generated from data-category tags on fields |
| Retention | Tenant-configurable retention per entity, enforced by scheduled jobs |
| Subprocessors | Public list maintained with the marketing site; AI providers listed per tenant configuration |
| Communications law | Unsubscribe links, suppression lists, sender identity, sending limits; no deceptive tracking |

## 5. Audit logging (Implemented)

Events recorded today: `tenant.created`, `auth.login`, `auth.logout`, `auth.workspace_switched`,
`tenant.updated` (with before/after values), `member.role_changed`. Each entry stores actor, actor type
(user, system, AI agent, platform admin), entity, metadata, IP, user agent and request id. Failed sign-ins
are logged to the application log (no tenant to attribute them to).

## 6. Secure development

- TypeScript strict mode, lint and type checks in CI.
- Dependency pinning with a lockfile; Dependabot/Renovate and `pnpm audit` in CI (Phase 2).
- Dependency audit with pinned overrides (Phase 8: 6 of 8 advisories fixed, 2 mitigated; docs/security/PENTEST_PREP.md).
- SAST (CodeQL) and container scanning in CI are not set up yet; an external penetration test is needed before general availability.
- Security review checklist on PRs that touch auth, RLS, file handling or AI tools.

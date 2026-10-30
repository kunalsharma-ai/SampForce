# DealFlow Security Model

DealFlow does not claim any certification or legal compliance. This document describes controls designed to
support obligations under GDPR, India's DPDP Act, CCPA/CPRA and CAN-SPAM; independent assessment is needed
before any compliance statement is made.

## 1. Threat model summary

| Threat | Primary controls | Status |
|---|---|---|
| Cross-tenant data access | PostgreSQL RLS (FORCE) + non-bypass runtime role + per-request membership check + tests | **Implemented, tested** |
| Credential stuffing / brute force | argon2id, generic errors, constant-time unknown-user path, per-IP rate limits on auth | **Implemented** (account lockout + MFA in Phase 8) |
| Session theft | HttpOnly SameSite cookies, short access tokens, rotating refresh tokens with reuse detection | **Implemented, tested** |
| CSRF | SameSite=Lax + Origin allow-list on unsafe methods + JSON-only bodies | **Implemented, tested** |
| Privilege escalation | Permissions checked server-side on every route; owner role protected; last-owner guard | **Implemented, tested** |
| Tampering with history | Audit log append-only at the database grant level | **Implemented, tested** |
| Injection | Prisma parameterized queries; tagged-template raw SQL only; Zod validation on all input | **Implemented** |
| XSS | React escaping, no `dangerouslySetInnerHTML` except a static theme bootstrap; CSP (Phase 8 hardening) | Partial |
| Clickjacking / sniffing | `X-Frame-Options: DENY`, `nosniff`, Helmet on API | **Implemented** |
| Secrets leakage | Env-only secrets validated at boot; no secrets in repo; log redaction of cookies/auth headers | **Implemented** |
| AI misuse / prompt injection | Tool allowlists, approval tiers, untrusted-content wrapping, cost caps | Designed (Phase 4) |
| Malicious uploads | Signed uploads, type/size limits, malware scanning, tenant-prefixed keys | Designed (Phase 2) |
| Platform operator overreach | Separate auth realm (own accounts, key, cookie, guard); cross-tenant reads limited by RLS to tenants, subscriptions, memberships, invoices and support grants; members and audit log only under an owner's time-boxed grant; CRM records never; every action in an append-only platform log and the workspace audit log | **Implemented, tested** (Phase 6, ADR 0010) |
| Payment fraud / forged billing events | Hosted checkout only (no card data in DealFlow); webhooks verified by HMAC over the raw body, Stripe timestamp tolerance, idempotent per event id, state re-read from the provider | **Implemented, tested against fixtures** |

## 2. Identity and access

- **Roles:** Owner, Administrator, Sales Manager, Sales Representative, Viewer, each a list of
  `resource:action` permissions (`packages/types/src/permissions.ts`). Custom roles (Phase 6, Professional and above) reuse the same
  catalogue; nobody can create, assign or invite into a role with permissions they do not hold. Attribute-based rules (record ownership, territory, team) layer on top in Phase 2.
- **Owner protections:** only owners can grant or remove the owner role; the last owner cannot be demoted.
- **Planned:** MFA (TOTP, WebAuthn), SSO via SAML 2.0 / OIDC, SCIM provisioning, session management UI with
  device list and remote sign-out, IP allow-lists (Enterprise).

## 3. Data protection

| Area | Control |
|---|---|
| In transit | TLS 1.2+ everywhere; HSTS; `COOKIE_SECURE=true` enforced in production at boot |
| At rest | Managed Postgres and object storage encryption; integration credentials envelope-encrypted with per-tenant keys (Phase 3) |
| Secrets | Environment / secret manager only; `.env.example` holds placeholders; JWT secret ≥ 32 chars enforced |
| Backups | Daily snapshots + PITR, encrypted, restore drills (Phase 8) |
| Export controls | Exports require `data:export`, are audited, and are rate-limited; AI agents cannot export |

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
- SAST (CodeQL) and container scanning in CI (Phase 8); penetration test before general availability.
- Security review checklist on PRs that touch auth, RLS, file handling or AI tools.

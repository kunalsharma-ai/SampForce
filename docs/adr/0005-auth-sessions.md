# ADR 0005: First-party cookie sessions with rotating refresh tokens

**Status:** accepted (2026-10-30)

**Decision.** Short-lived JWT access tokens and opaque rotating refresh tokens, both in HttpOnly SameSite=Lax
cookies; the browser reaches the API through the web origin's `/api/v1` proxy. Bearer tokens are accepted
for API clients. Membership and role are re-checked on every request.

**Why.** No tokens in JavaScript-readable storage; immediate effect of role changes; refresh-token reuse
detection limits stolen-token damage. Building on standards keeps the door open for OIDC/SAML (Phase 8),
which will issue the same session after federation.

**Consequences.** A database read per request for membership (cache in Redis with short TTL if needed).

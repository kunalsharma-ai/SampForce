# ADR 0051: Provider keys can be entered in the operator console and apply without a restart

- Status: Accepted
- Date: 2026-11-02
- Builds on: ADR 0010 (operator realm), ADR 0031 (provider checks)

## Context

Every deployment-wide provider key (Apollo, Hunter, Deepgram, Google, Microsoft, Slack, Zoom, DocuSign, Anthropic,
SMTP, Zapier, Stripe, Razorpay) came only from environment variables. Adding or changing one meant editing the
deployment's secrets and restarting the API and the worker. Kunal asked for a screen in SampForce where keys can be
entered or updated, with the backend picking up a change straight away.

Per-workspace credentials (Twilio, WhatsApp, a workspace's own Stripe or Razorpay for quote payments, Teams webhook
URLs) already have their own screens under Settings > Apps and are out of scope.

## Decisions

1. **Stored sealed, in their own table.** `platform_secrets` keeps one row per environment variable name, the value
   sealed with `ENCRYPTION_KEY` (the same `SecretBox` as other secrets), a 12-hex SHA-256 fingerprint and a hint. The
   hint is the last four characters of a secret (none if it is shorter than 12), or the whole value of a setting that
   is not a credential (`MAIL_FROM`, `MICROSOFT_TENANT`, `DOCUSIGN_AUTH_BASE_URL`, `ZAPIER_INVITE_URL`). No tenant
   column and no row-level security, like `platform_settings`; only the operator API writes it.
2. **A fixed allow-list.** `MANAGED_KEYS` in `apps/api/src/common/provider-keys.ts` names the 26 variables the console
   may hold. `ENCRYPTION_KEY`, the JWT secrets and database URLs are never on it, because they protect the console
   itself. Each value is validated with the same zod rule as its environment variable, so the console cannot save a
   value that would stop the API from starting.
3. **The console wins, the environment is the fallback.** `ProviderKeysService` turns each managed property of the
   injected `ApiEnv` object into a getter: console value if there is one, otherwise the environment variable the
   process started with. Removing a console value falls back to the environment. Because services already read keys
   at call time (`this.env.SLACK_CLIENT_SECRET`), no call site needed to change. Three places that captured a key at
   startup now resolve it per call: the system mailer (transport rebuilt when `SMTP_URL`/`MAIL_FROM` change), the AI
   gateway (Claude client rebuilt when the key changes) and the Microsoft adapter (`MICROSOFT_TENANT`).
4. **Short cache.** Each process (API replicas and the worker) reloads and decrypts the table every
   `PROVIDER_KEYS_REFRESH_SECONDS` (default 10) and at once after its own save. A value that cannot be decrypted is
   skipped and logged, never used. A failed reload keeps the last good values.
5. **Admins change, everyone audited.** `POST /operator/providers/{key}/keys` (ADMIN, 20 a minute) takes
   `{ values: { NAME: "value" | null } }`. Each change writes `provider_key.set` or `provider_key.cleared` to the
   platform audit log with the operator, the name, the fingerprint and the last four characters, never the value.
   Support operators see the page read-only.
6. **A connection test for every provider.** ADR 0031's checks now cover all thirteen providers, each the cheapest
   call that proves the keys: Anthropic `GET /v1/models` (no tokens), Stripe `GET /v1/balance`, Razorpay
   `GET /v1/plans?count=1`, SMTP connect and sign in (nothing sent), Zapier opens the invite link, and for the OAuth
   apps (Google, Microsoft, Slack, Zoom, DocuSign) an exchange of a made-up authorization code: providers check the
   client credentials first, so `invalid_client` means wrong keys and `invalid_grant`/`invalid_code` means the keys
   were accepted. Nothing is issued or connected. Webhook signing secrets cannot be tested by an outbound call and
   are proven by the first signed event. The stored result carries the fingerprint of the keys it used, so changing
   a key makes the old result stale.

## Consequences

- Keys can be added in the console with no redeploy; the Helm Secret is still supported and remains the place for
  the keys the console cannot hold.
- Key rotation: `scripts/reseal-secrets.ts` now covers `platform_secrets` (and `app_connections`, which it had
  missed). See docs/runbooks/key-rotation.md.
- Anyone with operator ADMIN access can now replace a provider key. That raises the value of an operator account;
  operator sign-in, the audit log and the 20-a-minute limit are the controls.
- Every test runs against local stand-ins built from each provider's documentation. The first test with a real key
  is the first time SampForce talks to that provider.

# Key and secret rotation

## ENCRYPTION_KEY (drilled)

Protects TOTP secrets, SSO client secrets, webhook signing secrets, mailbox OAuth tokens, workspace app credentials
and provider keys saved in the operator console (`platform_secrets`).

1. Generate a new key: `openssl rand -base64 32`. Store it in the secret manager next to the old one.
2. Set `ENCRYPTION_KEY=<new>` and `ENCRYPTION_KEY_PREVIOUS=<old>` for the API and worker; roll out. Values sealed
   with either key now open; new values use the new key.
3. Re-seal stored values: `ENCRYPTION_KEY=<new> ENCRYPTION_KEY_PREVIOUS=<old> DATABASE_URL=<runtime role>
   pnpm --filter @dealflow/api secrets:reseal -- --dry-run`, then without `--dry-run`. It is safe to re-run; a second
   run reports 0 re-sealed. It stops without writing if a value opens with neither key. `--only=platform_secrets`
   (comma-separated table names) limits it to some tables.
4. Remove `ENCRYPTION_KEY_PREVIOUS`; roll out. Keep the old key in cold storage until backups older than the
   rotation have expired, because those backups still need it.

Drill result (Phase 8): with only the new key and no re-seal, two-step sign-in failed with HTTP 500 (expected; this
is why step 2 comes first). With both keys it worked; the re-seal changed 1 value and then 0; with only the new key
afterwards, sign-in worked.

## JWT_ACCESS_SECRET (not drilled)

Signs 15-minute access tokens, MFA challenges, and the SSO and mailbox OAuth state. Refresh tokens are random values
stored as hashes, so they survive rotation.
Change the secret and roll out. Every access token fails once with 401; the web app refreshes and continues.
People in the middle of an MFA challenge or an SSO or mailbox redirect start that step again. There is no
two-key overlap for this secret.

## OPERATOR_JWT_SECRET (not drilled)

Change and roll out; platform operators sign in again.

## Database passwords (not drilled)

`ALTER ROLE dealflow_app PASSWORD '...'`, update `DATABASE_URL` in the Secret, roll out the API and worker.
Existing connections keep working until they reconnect. Same for `dealflow_owner` (migration Job) and
`dealflow_backup`.

## Provider keys

Rotate the key in the provider's dashboard, then either save the new one in the operator console (Providers > Update
keys; it applies within `PROVIDER_KEYS_REFRESH_SECONDS`, default 10, with no restart) or update the Secret and roll out.
A key saved in the console wins over the Secret, so after rotating in the Secret, remove any console value. Run
"Test connection" afterwards: a test made with the old key no longer counts. The operator log records each change by
fingerprint and last four characters (ADR 0051).

Drill (2026-11-02, apps/api/test/provider-keys.e2e.test.ts): a console key saved under the old ENCRYPTION_KEY opened
with new + previous keys; with only the new key it was skipped (shown as missing, never used); after
`secrets:reseal --only=platform_secrets` it opened with only the new key. Webhook secrets for Stripe and Razorpay must change on both sides at the same time, or webhooks fail
verification until they match (providers retry).

## Workspace-held secrets

SCIM tokens and SSO client secrets belong to each workspace: owners rotate them under Workspace security. Workspace app credentials (Twilio, WhatsApp, card payments) are replaced under Settings > Apps.

# Key and secret rotation

## ENCRYPTION_KEY (drilled)

Protects TOTP secrets, SSO client secrets, webhook signing secrets and mailbox OAuth tokens.

1. Generate a new key: `openssl rand -base64 32`. Store it in the secret manager next to the old one.
2. Set `ENCRYPTION_KEY=<new>` and `ENCRYPTION_KEY_PREVIOUS=<old>` for the API and worker; roll out. Values sealed
   with either key now open; new values use the new key.
3. Re-seal stored values: `ENCRYPTION_KEY=<new> ENCRYPTION_KEY_PREVIOUS=<old> DATABASE_URL=<runtime role>
   pnpm --filter @dealflow/api secrets:reseal -- --dry-run`, then without `--dry-run`. It is safe to re-run; a second
   run reports 0 re-sealed. It stops without writing if a value opens with neither key.
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

Stripe, Razorpay, Google, Microsoft and Anthropic keys rotate in the provider's dashboard; update the Secret and roll
out. Webhook secrets for Stripe and Razorpay must change on both sides at the same time, or webhooks fail
verification until they match (providers retry).

## Workspace-held secrets

SCIM tokens and SSO client secrets belong to each workspace: owners rotate them under Workspace security.

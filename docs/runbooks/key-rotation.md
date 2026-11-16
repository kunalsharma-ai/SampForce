# Key and secret rotation

## ENCRYPTION_KEY

Protects TOTP secrets, SSO client secrets, webhook signing secrets, mailbox OAuth tokens, workspace app credentials,
the session signing secrets and provider keys saved in the operator console (`platform_secrets`). In production it
is stored in the database (`platform_settings`, ADR 0059), created by the API on its first start.

**Production (key in the database):**

- Self-host: `deploy/scripts/rotate-encryption-key.sh`.
- Kubernetes: `kubectl exec deploy/<release>-api -- node dist/cli/rotate-encryption-key.js start`, roll out the API
  and the worker, then `... rotate-encryption-key.js finish`.

`start` stores a new random key, keeps the old one as the previous key, and re-seals every stored secret. Restarted
processes open values sealed with either key. `finish` re-seals anything a not-yet-restarted process sealed with the old
key, forgets it, and keeps only its fingerprint so an old copy left in a settings file is recognised and ignored.
Backups made before the rotation contain the old key and still restore. Tested in
`apps/api/test/server-secrets.e2e.test.ts`.

**Manual rotation from the environment (development, or a key still kept outside the database):**

1. Generate a new key: `openssl rand -base64 32`. Store it in the secret manager next to the old one.
2. Set `ENCRYPTION_KEY=<new>` and `ENCRYPTION_KEY_PREVIOUS=<old>` for the API and worker; roll out. Values sealed
   with either key now open; new values use the new key. In production this also replaces the stored key (only when
   `ENCRYPTION_KEY_PREVIOUS` is the stored key; any other different key stops start-up).
3. Re-seal stored values: `ENCRYPTION_KEY=<new> ENCRYPTION_KEY_PREVIOUS=<old> DATABASE_URL=<runtime role>
   pnpm --filter @dealflow/api secrets:reseal -- --dry-run`, then without `--dry-run`. It is safe to re-run; a second
   run reports 0 re-sealed. It stops without writing if a value opens with neither key. `--only=platform_secrets`
   (comma-separated table names) limits it to some tables.
4. Remove `ENCRYPTION_KEY_PREVIOUS`; roll out.

Drill result (Phase 8): with only the new key and no re-seal, two-step sign-in failed with HTTP 500 (expected; this
is why step 2 comes first). With both keys it worked; the re-seal changed 1 value and then 0; with only the new key
afterwards, sign-in worked.

## JWT_ACCESS_SECRET and OPERATOR_JWT_SECRET

Both are stored in the database, sealed with `ENCRYPTION_KEY`, and read by the API and the worker at start-up
(ADR 0059). `JWT_ACCESS_SECRET` signs 15-minute access tokens, MFA challenges, the SSO and mailbox OAuth state, and
(through a derived key, unless `TRACKING_SECRET` is set) unsubscribe and tracking links. Refresh tokens are random
values stored as hashes, so they survive rotation.

- Self-host: `scripts/rotate-signing-secrets.sh` (or name just one, e.g. `OPERATOR_JWT_SECRET`). It saves new random
  values and restarts the API and the worker.
- Kubernetes: `kubectl exec deploy/<release>-api -- node dist/cli/rotate-signing-secrets.js`, then roll out the API
  and the worker.

Every access token then fails once with 401 and the web app refreshes and continues; operators sign in again.
People in the middle of an MFA challenge or an SSO or mailbox redirect start that step again. Unsubscribe and tracking
links in emails already sent stop working. There is no two-key overlap. Covered by `rotate-signing-secrets` tests.

## Database passwords (not drilled)

`ALTER ROLE dealflow_app PASSWORD '...'`, update `DATABASE_URL` in the Secret, roll out the API and worker.
Existing connections keep working until they reconnect. Same for `dealflow_owner` (migration Job) and
`dealflow_backup`.

## Provider keys

Rotate the key in the provider's dashboard, then either save the new one in the operator console (Providers > Update
keys; it applies within `PROVIDER_KEYS_REFRESH_SECONDS`, default 10, with no restart). In production the database is
the only place provider keys are read from (ADR 0059), so there is nothing to change in the Secret. Run
"Test connection" afterwards: a test made with the old key no longer counts. The operator log records each change by
fingerprint and last four characters (ADR 0051).

Drill (2026-11-02, apps/api/test/provider-keys.e2e.test.ts): a console key saved under the old ENCRYPTION_KEY opened
with new + previous keys; with only the new key it was skipped (shown as missing, never used); after
`secrets:reseal --only=platform_secrets` it opened with only the new key. Webhook secrets for Stripe and Razorpay must change on both sides at the same time, or webhooks fail
verification until they match (providers retry).

## Workspace-held secrets

SCIM tokens and SSO client secrets belong to each workspace: owners rotate them under Workspace security. Workspace app credentials (Twilio, WhatsApp, card payments) are replaced under Settings > Apps.

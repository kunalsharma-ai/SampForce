# ADR 0059: API keys and server secrets live in the database; only database settings stay in the environment

- Status: Accepted
- Date: 2026-11-16
- Builds on: ADR 0051 (provider keys in the operator console), ADR 0053 (every integration set up from the console)

## Context

Kunal asked (2026-11-16) that every API key be accepted and stored in SampForce's database, not in environment
variables or configuration files, so anyone can set SampForce up easily, and then narrowed it: "Keep database keys in
.env only, rest in database."

After ADR 0051 and 0053 every provider key could be entered in the operator console, but three things still pointed
people at files:

1. **The environment was still a fallback.** A key in `sampforce.env` or the Kubernetes Secret was used when the
   console had none, the templates listed every key, and removing a console value silently brought the file's value
   back. Two places for one key is exactly the confusion Kunal wanted gone.
2. **The session signing secrets** (`JWT_ACCESS_SECRET`, `OPERATOR_JWT_SECRET`) were required in `.env`.
3. **The install** was several commands, one of which generated secrets into a file.

## Decisions

1. **In production the database is the only source of every managed key and setting.** `ProviderKeysService`
   (`apps/api/src/common/provider-keys.ts`) ignores the environment when `NODE_ENV=production`: a key has its console
   value, or its built-in default, or is missing. The console never shows "from deployment secrets" in production.
2. **Old installs keep working: environment values are imported once.** At start-up, production copies each managed
   key still set in the environment into `platform_secrets`, sealed, when the console has no value for it. It records
   the value's fingerprint in `platform_settings` (`env_import:<NAME>`), so a key an operator later removes in the
   console does not come back on the next restart; a different value in the file is imported once more. A console
   value is never overwritten. Each import is written to the operator log as `provider_key.imported` (fingerprint and
   last four characters, never the value), and the Providers page says "copied from the server's settings file".
   Values equal to the built-in default are not copied. The API and the worker may import at the same moment; the
   create is conditional and the loser finds the row.
3. **The session signing secrets move into the database.** `loadSigningSecrets()`
   (`apps/api/src/common/server-secrets.ts`) runs first in the API and the worker in production. It reads
   `JWT_ACCESS_SECRET` and `OPERATOR_JWT_SECRET` from `platform_secrets` (sealed with `ENCRYPTION_KEY`, so a database
   copy alone cannot forge a sign-in), copies them in from the environment if an older install still has them there
   (nobody is signed out), or generates 32 random bytes each on a new server. It then puts them in `process.env` so
   the rest of start-up is unchanged. A value that will not open with `ENCRYPTION_KEY` stops start-up instead of
   quietly generating a new secret. They are not provider keys: the console neither lists nor edits them. Rotation:
   `node dist/cli/rotate-signing-secrets.js` (self-host: `deploy/scripts/rotate-signing-secrets.sh`, which restarts the
   API and worker). `reseal-secrets` covers them because they are rows of `platform_secrets`.
4. **ENCRYPTION_KEY moves into the database too (Kunal's decision).** Kunal was asked on a decision card, with the
   recommendation to keep it in `.env`, and chose "Store it in the database too" (2026-11-16). `loadEncryptionKey()`
   runs before the signing secrets: it reads the key from `platform_settings` (`server:encryption_key`, stored as is,
   because a key cannot be sealed with itself), copies it in from the environment on an older install, or generates
   32 random bytes on a new server. A *different* key in the environment stops start-up, because using it would make
   every stored secret unreadable and replacing the stored one could lose it for good; the exceptions are the manual
   rotation (`ENCRYPTION_KEY_PREVIOUS` equal to the stored key) and a key already rotated away (its fingerprint is
   kept in `server:encryption_key_retired`), which is ignored with a warning. Rotation:
   `rotate-encryption-key start` (new key stored, old kept as `server:encryption_key_previous`, everything re-sealed
   through the same `resealAll` the reseal-secrets tool uses), restart, `rotate-encryption-key finish` (re-seal what
   old processes sealed in between, forget the old key). Self-host: `deploy/scripts/rotate-encryption-key.sh`.
5. **What stays in the environment, and why** (listed in the console under Providers > Set once on the server):
   - `DATABASE_URL` (self-host: the generated MongoDB passwords): everything else is read from the database, so this
     must be known first.
   - `PUBLIC_WEB_URL` / `WEB_ORIGINS`, filled in from `DOMAIN`: the deployment's own address, needed by Caddy for the
     certificate and by the API before anyone signs in. These are addresses, not keys.
   - Limits and tuning (`EMAIL_DAILY_SEND_LIMIT`, `LOG_LEVEL`, ...) stay as optional settings with defaults; none is a
     key, and nothing needs to be set.
6. **One-command install.** `deploy/scripts/install.sh <domain> <admin email> [name]` generates the database
   passwords, builds, starts, waits for health, runs the smoke test and creates the first super admin.
   `generate-secrets.sh` writes only the database passwords. The templates (`deploy/.env.example`,
   `deploy/sampforce.env.example`, the Helm values) no longer list any API key, console-managed setting,
   `ENCRYPTION_KEY` or signing secret. Compose still passes those three through when an old `.env` has them, so the
   first start after upgrading copies them in and nobody is signed out.
7. **Outside production nothing changes.** Local development and the test suites still read provider keys from the
   environment, because they point providers at local stand-ins that way, and keep `JWT_ACCESS_SECRET` in `.env`.

## Consequences

- A production server can be installed and fully set up without opening a settings file; every key is typed into
  the console, encrypted, and applies within seconds.
- A fresh install now shows preview prices until an operator turns on "show final prices" under Providers > Plans and
  online checkout (the old `sampforce.env` template set `PRICING_PUBLISHED=true`). Existing installs keep their value,
  because it is imported.
- A test install ignores keys set in its environment once `NODE_ENV=production`, which can surprise someone who sets
  a key in a file out of habit; the start-up log and `deploy/sampforce.env.example` say where keys go.
- **A database copy now opens every stored secret.** With the key in the same database, a backup file or a leaked dump
  holds both the encrypted API keys and the key to them. Encryption still keeps secrets out of logs, query results
  and anything that reads one field, but it no longer protects a stolen backup. Backups must be encrypted at rest and
  access-restricted; the backup script, the restore runbook and the incident runbook say so. Kunal accepted this.
- In return a backup restores on any server with no separate key to keep, and losing `.env` loses only the database
  passwords (MongoDB's own root user can reset them).

## Tests

- `apps/api/test/provider-keys.e2e.test.ts`, "production: keys live only in the database": import once, sealed, audit
  entry, the app uses the database value, removal really removes, restart does not re-import, a console value is not
  overwritten, a fresh install has nothing from the environment, concurrent imports write one row.
- `apps/api/test/server-secrets.e2e.test.ts`: signing secrets generated on a new server, same values on the next start
  and in the worker, imported from an older install, concurrent start, wrong `ENCRYPTION_KEY` refuses, no effect
  outside production, rotation; `ENCRYPTION_KEY` generated from a database-only environment, imported once from an old
  `.env`, a different key refuses, short key refuses, `rotate-encryption-key` start/finish keeps every secret readable,
  keeps sessions, and ignores the rotated-away key left in an old `.env`.

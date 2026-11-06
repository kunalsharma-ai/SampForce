# ADR 0031: Provider keys are checked from the operator console, with no-cost live calls

- Status: Accepted
- Date: 2026-11-01
- Part of: Enhancement programme, launch readiness

## Context

The rules say "Until the actual API keys are configured and successful live API calls are tested, mark the
integration as Pending Configuration or Mock Mode", and keys must stay in the deployment's secrets. Before this, the
only way to prove an Apollo, Hunter or Deepgram key worked was for someone in a workspace to use the feature, which
for Apollo meant a search and for Deepgram a billed transcription. Operators also had no single place to see which
secrets a deployment was missing.

## Decisions

1. **One page, names only.** `GET /operator/providers` lists Apollo, Hunter, Deepgram, Google, Microsoft, Anthropic
   and SMTP with each secret's name and whether it is set. Values never leave the server. Any operator role can read it.
2. **Cheapest call that proves the key.** `POST /operator/providers/{apollo|hunter|deepgram}/check` (Admin only, 10 a
   minute) calls Apollo's people search for one result, Hunter's `GET /account`, or Deepgram's `GET /v1/projects`.
   Nothing is revealed, verified or transcribed. Refused keys and time-outs are stored as failed checks with the
   provider's answer; a key that is not set is refused with `NOT_CONFIGURED` before any call.
3. **Stored with a key fingerprint.** The result is kept in `platform_settings` under `provider_check:<key>` with the
   first 12 hex characters of the key's SHA-256. A check counts only while the same key is set, so rotating a key
   returns the status to "Key set, not verified". Every check is written to the platform audit log.
4. **What a check changes in workspaces.** A passed Apollo check is the same call workspaces make, so it moves every
   workspace's Apollo status from Pending Configuration to Connected. Hunter and Deepgram keep per-workspace status
   (Connected after the first verification, Verified after the first transcription), because the account call does
   not exercise the feature itself.
5. **No check where none is safe.** Google and Microsoft need a person's OAuth consent, SMTP would send mail, and an
   Anthropic call costs tokens, so those rows show set or missing only.

## Consequences

- The checks are tested only against local stand-ins that follow each provider's published documentation. The first
  real check after adding a key is the first time SampForce talks to that provider, and the page says what it answered.
- Operators can see a deployment's missing keys without shell access to the servers.

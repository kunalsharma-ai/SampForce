# ADR 0038: Workspace API keys and a Zapier app on REST hooks

- Status: Accepted
- Date: 2026-11-01
- Part of: Enhancement programme, integrations (builds on ADR 0032 and the Phase 3 webhooks)

## Context

Customers want DealFlow in Zapier (and Make, n8n and their own scripts). That needs a credential that is not a
browser session, and a way for Zapier to hear about changes without polling. The project rules forbid keys in
client code, mass communication or exports by automation, and claiming an integration works before it has run
against the real provider.

## Decisions

1. **Workspace API keys (`dfk_…`).** Created by a member with `integrations:manage`, shown once, stored only as a
   SHA-256 hash. A key acts as the person who created it: every request checks that their membership is still
   active and grants only the intersection of the key's scopes and their current role. Revoking, expiring,
   suspending or removing the member stops the key at once. At most 25 live keys per workspace.
2. **Opt-in routes only.** A Bearer `dfk_` header is accepted only by controllers marked `@ApiKeyAccess()`: leads,
   contacts, companies, deals, pipelines, activities and tasks, and the `/zapier` endpoints. Everything else
   (exports, settings, members, billing, integrations, AI, admin) answers 403 `API_KEY_NOT_ALLOWED`. Scopes are a
   fixed list of read and write scopes for those records; a key cannot be given a scope its creator lacks.
3. **Tenant lookup without a session.** The key's hash is the only input. An RLS policy (`api_key_lookup`) lets the
   lookup see exactly the row whose hash matches `app.api_key_hash`, so the lookup does not bypass row-level
   security. Origin checks are skipped for keyed requests because they carry no cookies.
4. **REST hooks reuse the webhook engine.** Zapier's subscribe creates an ordinary outbound webhook with
   `source = 'zapier'` and the key's id, for one event the key can read, to a public https URL (the same SSRF check
   as hand-made webhooks). Delivery, signing, retries and auto-disable are unchanged. A 410 from a Zapier hook
   removes it, which is what Zapier sends when a Zap is turned off. Revoking a key removes its hooks. These hooks
   show in the Webhooks list with their URL masked and cannot be edited there. At most 50 per key.
5. **Triggers carry real records.** The Zapier app reads `/zapier/events/:id` for each delivery and
   `/zapier/samples/:event` while a Zap is set up. Samples are the three most recent real events; when there are
   none the list is empty. Nothing is invented.
6. **Actions are single-record creates** (lead, contact, task) through the same services and validation as the app.
   There is no bulk send, export or delete action.
7. **Pending Configuration until published.** The app lives in `integrations/zapier` and is tested by running its
   functions against a local DealFlow. It is not in Zapier's directory until an operator registers and pushes it
   and sets `ZAPIER_INVITE_URL`; until then the Integrations page says Pending Configuration and offers API keys
   only.

## Consequences

- Keys are as powerful as their scopes allow within the creator's role, so the page lists last use and lets any
  admin revoke any key. `lastUsedAt` is written at most once a minute per key.
- Zapier's own platform behaviour (subscribe timing, retries on its side, field mapping in the editor) has not been
  observed. It must be checked after `zapier push` with a private invite before the integration is called working.

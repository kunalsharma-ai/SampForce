# ADR 0032: Workspace apps, starting with Slack

- Status: Accepted
- Date: 2026-11-01
- Part of: Enhancement programme, integrations (Slack, Teams, Zoom, DocuSign, card payments, WhatsApp, Zapier)

## Context

Mailbox and calendar integrations (`integration_accounts`) belong to one person. Slack, Teams, Zoom,
DocuSign, a payment account, WhatsApp Business and Zapier belong to the whole workspace: an admin installs them once
and workflows, quotes and teammates use them. Each needs encrypted credentials, a status that is honest about whether
it has ever worked, and a record of what was sent.

## Decisions

1. **One table for workspace apps.** `app_connections` has one row per workspace and provider (`AppProvider` enum,
   unique on tenant and provider) with the provider's account id and name, granted scopes, credentials sealed with
   SecretBox, provider-specific `settings` JSON, status and last error. `app_events` records each send, failure,
   connect and disconnect. Both are under FORCE row-level security like every tenant table.
2. **Inbound provider calls find their workspace without a tenant.** A `provider_lookup` SELECT policy lets a
   transaction that sets `app.app_provider` and `app.app_account` read the one matching connection, the same pattern
   as the client portal's slug lookup. Webhook handlers for later providers (payments, DocuSign, WhatsApp) use it to
   resolve the tenant, then switch to that tenant's normal context.
3. **Four states, never "working" by assumption.** Pending Configuration (deployment secrets missing), Not connected,
   Connected, Needs reconnecting (provider refused the token). A token the provider reports as revoked flips the
   status; the next successful call clears it.
4. **Install with OAuth state signed by the API.** The state carries tenant and user and expires; a callback with
   someone else's state is refused. Only `integrations:manage` can connect, change settings or disconnect.
5. **Workflows reuse the automation engine.** Slack adds a `post_to_chat` action. It is not an "external" action
   needing approval, because it posts to the workspace's own channels, not to customers. Text is escaped and capped
   at 3,000 characters.
6. **Background sweeps are time-sliced.** While testing, the hourly deal-health and customer-success sweeps were
   found to run every workspace inside one worker tick, which delayed workflow events by many seconds on a large
   database. They now use `SlicedSweep`: at most about two seconds per tick, resuming on the next tick.

## Consequences

- Each new provider adds an enum value, a client, stand-in fixture tests, and a row on the operator Providers page.
- Slack is tested only against a local stand-in of its Web API until real app credentials are added.

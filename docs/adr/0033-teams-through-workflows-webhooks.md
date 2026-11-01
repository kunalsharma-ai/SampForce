# ADR 0033: Microsoft Teams through Teams Workflows webhooks

- Status: Accepted
- Date: 2026-11-01
- Part of: Enhancement programme, integrations (builds on ADR 0032)

## Context

Workflows need to post updates to Teams channels, as they do to Slack. There were three ways to do it:

- **Office 365 connector incoming webhooks.** Microsoft is retiring these in favour of Workflows, so building on them now would break later.
- **Microsoft Graph `ChannelMessage.Send`.** This is delegated-only: messages would post as one person, and it would
  need an Entra ID app with admin consent.
- **A Bot Framework bot.** This needs an Azure Bot registration, a Teams app package that each customer's Teams admin
  must approve, and an always-on messaging endpoint.

## Decision

Use the Teams Workflows app's webhook URLs, one URL per channel, pasted by a workspace admin.

1. **Storage.** The URLs are kept sealed in the workspace's single `TEAMS` row in `app_connections`, keyed by a
   DealFlow channel id (`tc_` + 12 hex characters). Channel names, the default channel and the error for each
   channel are kept in `settings`.
2. **Checked before saving.** Adding a channel posts a welcome Adaptive Card first, and only an accepted card saves
   it. So "Connected" always means a live call has succeeded. The generic Pending Configuration state does not
   apply, because no deployment secret exists.
3. **Allowed URLs.** Only `https` URLs on `*.logic.azure.com` or `*.powerplatform.com` that resolve to public
   addresses are accepted. Redirects are refused. Tests and local stand-ins rely on `ALLOW_PRIVATE_NETWORK_TARGETS`,
   which production refuses.
4. **Errors stay on the broken channel.** A broken channel keeps its error until a post to that same channel
   succeeds. A success on another channel does not hide it.
5. **Shared workflow step.** The same `post_to_chat` action serves both apps, with `app: 'teams'`.

## Consequences

- No Microsoft app registration is needed. Each customer creates the workflow in their own tenant, under their own
  Power Automate policies.
- A workflow posts as the "Workflows" app, not as a DealFlow bot. DealFlow cannot list a workspace's channels or
  turn off a workflow in Teams.
- If DealFlow later needs interactive messages (buttons that act in DealFlow), it will need a Bot Framework app. That
  would be a separate decision.
- Teams is tested only against a local stand-in of the documented request shape until a real Workflows URL is used.

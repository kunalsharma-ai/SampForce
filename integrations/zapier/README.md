# DealFlow for Zapier

A [Zapier Platform CLI](https://github.com/zapier/zapier-platform) app. It connects with a DealFlow workspace API key
and uses DealFlow's REST hooks, so Zaps start within seconds of the change instead of polling.

**Status: Pending Configuration.** The app is not published in Zapier's directory. Until an operator deploys it, no
one can pick DealFlow in Zapier. It has been tested only by running its functions against a local DealFlow
(`apps/api/test/zapier-app.e2e.test.ts`); it has not been pushed to or run inside Zapier.

## What it does

- **Authentication:** DealFlow address plus an API key (`dfk_…`, created under Integrations, API keys). Tested with
  `GET /api/v1/zapier/me`.
- **Triggers (REST hooks):** New Lead, Updated Lead, Converted Lead, New Contact, Updated Contact, New Company,
  New Deal, Deal Changed Stage, Deal Won, Deal Lost, New Task, Task Completed. Subscribing creates an outbound
  webhook tagged with the key. When the Zap is turned off, Zapier unsubscribes (or answers 410, and DealFlow removes
  the subscription).
- **Actions:** Create Lead, Create Contact, Create Task.

A key acts as the admin who created it, limited to its scopes and that person's current role. Revoking the key
stops it at once and removes its subscriptions.

## Deploying (operator)

1. `cd integrations/zapier && npm install`
2. `npx zapier login` with the Zapier account that will own the integration.
3. `npx zapier register "DealFlow"` once, then `npx zapier push` for each version.
4. Invite users from the Zapier developer platform (private), or submit it for public review.
5. Set `ZAPIER_INVITE_URL` in the DealFlow deployment so the Integrations page links to it.

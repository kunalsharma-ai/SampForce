# Integrations: mailbox, calendar and webhooks (Phase 3)

## What is built

| Integration | Status | Notes |
|---|---|---|
| Google (Gmail read and send, Google Calendar read) | **Implemented, tested against a local fixture of the Google APIs.** Not yet tested against Google with real credentials. | Needs `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` |
| Microsoft 365 (Outlook inbox read and send, calendar read via Microsoft Graph) | **Implemented, tested against a local fixture of Microsoft Graph.** Not yet tested against Microsoft with real credentials. | Needs `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, optional `MICROSOFT_TENANT` |
| Deepgram (meeting and voice note transcription) | **Pending Configuration.** Implemented and tested against a local stand-in only. Not yet tested against Deepgram with a real key. The app shows Pending Configuration until a key is set, and Verified only after a successful transcription. | Needs `DEEPGRAM_API_KEY` (server secret). Optional `MEETING_UPLOAD_MAX_MB` |
| Apollo.io (people search and email reveal for Prospect Lists and the extension) | **Mock Mode** without a key: search returns labelled sample people on `.example` domains that can never reach the CRM, exports or sequences. With a key it is **Pending Configuration** until the first successful call, then Connected. Tested against a local stand-in only; the request and response shapes follow Apollo's published docs and have not been checked against Apollo with a real key. | Needs `APOLLO_API_KEY` (server secret, a master key for `people/bulk_match`). Optional `APOLLO_API_BASE_URL`, `PROSPECT_DAILY_LIMIT` (provider calls per person per 24 hours, default 100) |
| Hunter.io email verification (Prospect Lists) | **Pending Configuration** without a key: the Verify button explains it needs one and no status is ever guessed. Tested against a local stand-in only. | Needs `HUNTER_API_KEY` (the same key as the Email Finder) |
| Outbound webhooks | Implemented and tested end to end (signing, retries, auto-disable, redelivery) | No credentials needed |
| Slack, Teams, Zoom, Twilio, WhatsApp, Stripe, Razorpay, DocuSign, Zapier | Not built | Shown as "Not available yet" in the app |

Without credentials the Integrations page says which variables are missing and offers no Connect button.

## Setting up Google

1. In Google Cloud Console create an OAuth client of type "Web application".
2. Authorised redirect URI: `<PUBLIC_WEB_URL>/api/v1/integrations/google/callback`.
3. Enable the Gmail API and Google Calendar API. Scopes requested: `openid`, `email`, `gmail.readonly`,
   `gmail.send`, `calendar.readonly`.
4. Gmail read scopes are restricted scopes: a public launch needs Google's OAuth verification and,
   for restricted scopes, a security assessment. Until then the app works only for test users you add.
5. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `PUBLIC_WEB_URL`.

## Setting up Microsoft 365

1. In Microsoft Entra ID register an application (web platform).
2. Redirect URI: `<PUBLIC_WEB_URL>/api/v1/integrations/microsoft/callback`.
3. Delegated permissions: `offline_access`, `openid`, `email`, `User.Read`, `Mail.Read`, `Mail.Send`,
   `Calendars.Read`. Some organisations require admin consent.
4. Create a client secret. Set `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and `MICROSOFT_TENANT`
   (`common` for multi-tenant, or a directory id).

## Behaviour

- Each member connects their own account (permission `activities:write`). OAuth `state` is signed and
  bound to the signed-in user and workspace; it expires after 10 minutes.
- Tokens are encrypted with AES-256-GCM using `ENCRYPTION_KEY` (required in production). Disconnecting
  deletes the stored tokens; synced emails and meetings stay on their records.
- Sync runs every 15 minutes per connection (and on "Sync now"). Only messages and events that involve
  an existing contact or lead are stored. The first sync looks back 30 days (up to 200 Gmail messages);
  calendar covers the past 30 and next 60 days.
- Microsoft sync reads the Inbox only. Mail sent from DealFlow is recorded when sent; mail sent from
  Outlook directly is not imported yet.
- A revoked or expired sign-in marks the connection "Needs attention", stops scheduled syncs and notifies
  the person. After 5 consecutive other failures the connection is also paused.
- Sending: one recipient per message, from the sender's own mailbox, at most `EMAIL_DAILY_SEND_LIMIT`
  (default 200) per person per 24 hours. Headers are sanitised. A sent email is logged as an EMAIL
  activity on the matching contact or lead. Sequence emails (Phase 9, ADR 0014) count towards the same limit.
- Email sequences send one-to-one from each person's own connected mailbox, inside a send window and under a
  per-sequence daily limit. Mailbox sync also detects replies and bounces to sequence emails. DealFlow does not
  send newsletters or bulk email from a shared domain.
- Tracking and unsubscribe links point at `TRACKING_BASE_URL` (default `PUBLIC_WEB_URL`), which must be reachable
  from the internet and serve `/api/v1/t/*` and `/unsubscribe/*`.

## Browser extension

The DealFlow lead-capture extension for Chrome and Edge (`apps/extension`, ADR 0015) saves people found on web pages
as leads. Each person creates a connection code under Integrations → Browser extension; the extension can only look
people up, save leads and enrol them, within what the person's role allows. Connections show under the person's
signed-in devices and end with any "sign out other devices". Automatic capture is off by default and only saves
addresses at the website's own domain, never personal mailboxes. It is not in the Chrome Web Store yet: load
`apps/extension/dist` unpacked (see `apps/extension/README.md`).

From version 0.2.0 people can also sign in from the extension with their DealFlow email and password (and their
second-factor code), which creates the same kind of connection; workspaces that enforce single sign-on still use a
connection code. "Find prospects" shows people at the company whose website is open, from Apollo.io through the API
(Mock Mode sample people without a key), and imports the chosen people to a prospect list or the CRM (ADR 0030).

## Email finder

The Email Finder (ADR 0016) reads a company's public website to find published work addresses and their pattern,
and checks the domain's mail server. It needs outbound https and DNS from the API. Set `FINDER_DAILY_LIMIT` (lookups
per person per day, default 50). To add a data provider, set `HUNTER_API_KEY` to your own Hunter.io key; it has only
been tested against a local stand-in, so check the first results after adding it.

## Meeting transcription (Deepgram)

1. Create an API key in the Deepgram console and set `DEEPGRAM_API_KEY` in the API server's secrets. Never put it in
   the web app or the extension.
2. Restart the API. The meeting notes page changes from "Pending Configuration" to "Configured, not yet verified".
3. Upload a short recording with consent confirmed. After it succeeds the page shows "Verified".

Recordings are streamed to Deepgram and not stored by DealFlow. Meet, Zoom and Teams are recognised from calendar
links only; there is no Zoom, Meet or Teams API connection and no meeting bot.

The same key transcribes voice notes (up to 25 MB each, with a language choice or automatic detection). Voice
recordings are not stored either, and any successful transcription, meeting or voice note, marks the workspace Verified.

## Webhooks

- Admins with `integrations:manage` add an https endpoint and choose events. The signing secret is shown
  once and stored encrypted.
- Body: `{ id, type, createdAt, data: { entityType, entityId, actorUserId, changes } }`. Headers:
  `X-DealFlow-Event`, `X-DealFlow-Delivery`, and `X-DealFlow-Signature: t=<unix>,v1=<hex>` where
  `v1 = HMAC-SHA256(secret, "<t>.<raw body>")`. Reject timestamps older than a few minutes.
- At-least-once delivery. A non-2xx answer or timeout (10 s) retries after 1 min, 5 min, 30 min, 2 h and
  6 h (`WEBHOOK_MAX_ATTEMPTS`, default 6 attempts), then the delivery is marked failed and can be
  redelivered by hand. After `WEBHOOK_DISABLE_AFTER_FAILURES` (default 15) failures in a row the
  endpoint is switched off and admins are notified.
- Targets must be public https URLs. Private, loopback, link-local and metadata addresses are refused
  (checked at save time and before every delivery). Redirects are not followed. Known gap: a DNS
  rebinding between the check and the request is not prevented; pin resolved addresses before launch.

## Testing

`apps/api/test/fixtures/provider-fixture.ts` is a local HTTP server that mimics the Google and Graph
endpoints the adapters call. `apps/api/test/integrations.e2e.test.ts` runs the full OAuth round trip,
sync, send, reconnect-on-revoke and tenant isolation against it. Passing these tests shows our side of
the protocol is consistent with the documented API shapes; it does not prove the live providers accept
the app, which needs a run with real credentials.

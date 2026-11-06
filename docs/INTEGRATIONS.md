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
| Slack (workspace app: post to channels from workflows) | **Pending Configuration** until `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` are set; then Not connected until an admin installs it. Implemented and tested against a local stand-in of Slack's Web API only. Not yet tested against Slack with a real app. | Needs `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` (server secrets) |
| Microsoft Teams (workspace app: post to channels from workflows) | **Not connected** until an admin adds a channel. A channel is saved only after Teams accepts a welcome card, so a listed channel has worked at least once. Implemented and tested against a local stand-in of Teams Workflows webhooks only; not yet tested against Teams. | No deployment secret. Each channel's Workflows URL is a workspace secret, stored encrypted |
| Zoom (workspace app: schedule meetings from records; import transcripts of recorded meetings) | **Pending Configuration** until `ZOOM_CLIENT_ID` and `ZOOM_CLIENT_SECRET` are set; transcript import is separately Pending Configuration until `ZOOM_WEBHOOK_SECRET_TOKEN` is set. Implemented and tested against a local stand-in of Zoom's OAuth, REST API v2 and event notifications only; not yet tested against Zoom. | Needs `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_WEBHOOK_SECRET_TOKEN` (server secrets) |
| DocuSign (workspace app: send contracts for e-signature) | **Pending Configuration** until `DOCUSIGN_INTEGRATION_KEY` and `DOCUSIGN_SECRET_KEY` are set; automatic status updates are separately Pending Configuration until `DOCUSIGN_CONNECT_HMAC_KEY` is set ("Check status" works without it). Implemented and tested against a local stand-in of DocuSign's OAuth, eSignature REST API v2.1 and Connect only; not yet tested against DocuSign. | Needs `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_SECRET_KEY`, `DOCUSIGN_CONNECT_HMAC_KEY` (server secrets); `DOCUSIGN_AUTH_BASE_URL` for the demo environment |
| Card payments on proposals (workspace app: customers pay accepted proposals into the workspace's own Stripe or Razorpay account) | **Not connected** until an admin saves keys; keys are saved only after a read that charges nothing succeeds. Shows a warning until the first signed webhook arrives. A proposal is marked paid only by the provider's signed webhook with the exact amount asked. Implemented and tested against a local stand-in of Stripe Checkout Sessions and Razorpay Payment Links only; not yet tested against either provider. | No deployment secret. Each workspace's keys and webhook secret are workspace secrets, stored encrypted |
| WhatsApp Business (workspace app: one-to-one messages from contact records and approved workflow steps, through the workspace's own Cloud API number) | **Not connected** until an admin saves credentials; they are saved only after a read of the number succeeds (nothing is sent). Replies and delivery status are Pending Configuration until Meta's first signed webhook arrives. Implemented and tested against a local stand-in of Meta's Graph API (Cloud API) only; not yet tested against Meta. | No deployment secret. Each workspace's System User token and App Secret are workspace secrets, stored encrypted. Optional `WHATSAPP_API_BASE_URL` (default Graph API v21.0) |
| Workspace API keys (REST API for Zapier, Make, n8n and scripts) | Implemented and tested end to end against the local API. Keys are shown once and stored hashed; only CRM record, pipeline, activity and task routes accept them. | No deployment secret |
| Zapier (triggers on REST hooks; create lead, contact and task actions) | **Pending Configuration** until an operator publishes the app in `integrations/zapier` and sets `ZAPIER_INVITE_URL`. Its functions are tested against a local SampForce only; it has not been pushed to or run inside Zapier. | Optional `ZAPIER_INVITE_URL` |
| SMS through Twilio (workspace app: one-to-one texts from contact records and approved workflow steps, through the workspace's own Twilio number) | **Not connected** until an admin saves credentials; they are saved only after reads of the account and number succeed (nothing is sent). Replies and delivery status are Pending Configuration until Twilio's first signed request arrives. Implemented and tested against a local stand-in of Twilio's REST API only; not yet tested against Twilio. | No deployment secret. Each workspace's Auth Token is a workspace secret, stored encrypted. Optional `TWILIO_API_BASE_URL` |
| Twilio voice calls | Not built yet | Shown as "Not available yet" in the app |

Without credentials the Integrations page says which variables are missing and offers no Connect button.

## Checking keys after adding them (operator console)

The operator console's **Providers** page (`/operator/providers`, ADR 0031) lists every provider, which of its
deployment secrets are set or missing (names only, never values) and what workspaces show for it. After adding
`APOLLO_API_KEY`, `HUNTER_API_KEY` or `DEEPGRAM_API_KEY` and restarting the API, an operator with the Admin role can
press **Run live check**:

| Provider | What the check calls | Cost |
|---|---|---|
| Apollo.io | One `mixed_people/api_search` for one result | Apollo returns no addresses from search and nothing is revealed. Whether a search uses credits depends on your Apollo plan, so check it there |
| Hunter.io | `GET /account` | Not counted as a search or a verification by Hunter |
| Deepgram | `GET /v1/projects` | Nothing is transcribed, so nothing is billed |

The result (passed or failed, the provider's answer, who ran it and when) is stored and written to the operator log.
A passed Apollo check moves every workspace from Pending Configuration to Connected. Hunter and Deepgram keep their
per-workspace status, because each workspace's first real verification or transcription is what proves the feature.
Each stored check carries a one-way fingerprint of the key it used, so changing the key makes the old result stale
until the check is run again. Google, Microsoft, Anthropic and SMTP have no automatic check; they are confirmed the
first time someone connects or uses them.

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

## Setting up Slack

Slack is a workspace app: one admin installs it for the whole SampForce workspace, and workflows post to
channels with a "Post to Slack" step. Nobody's personal Slack account is used.

1. At api.slack.com/apps create an app ("From scratch"). Under **OAuth & Permissions** add the redirect URL
   `<PUBLIC_WEB_URL>/api/v1/apps/slack/callback` and the bot scopes `chat:write`, `chat:write.public`,
   `channels:read`, `groups:read`.
2. Under **Basic Information** copy the Client ID and Client Secret into `SLACK_CLIENT_ID` and
   `SLACK_CLIENT_SECRET` in the deployment's secret manager. Never put them in the web or extension bundles.
3. Restart the API. Integrations then shows Slack as Not connected instead of Pending Configuration, and an admin
   (integrations:manage) can press **Connect Slack**.
4. After installing, pick a default channel and press **Send test message**. That is the first live call: until it
   succeeds, treat Slack as untested. Private channels need the bot invited (`/invite @YourApp`).

How it behaves:

- The bot token is stored encrypted (SecretBox) in `app_connections`, one row per workspace, under row-level security.
  It is never sent to the browser.
- Every post and failure is recorded in `app_events` and shown as "Recent Slack activity". A revoked or uninstalled
  app changes the status to **Needs reconnecting** and the workflow step fails with a clear reason instead of retrying
  forever. Reconnecting clears it.
- Message text from workflows is escaped (`&`, `<`, `>`), so record data cannot trigger `@channel` or fake links, and
  each message ends with a link back to the record.
- Disconnect revokes the token at Slack (`auth.revoke`) and deletes it.
- The Slack row on the operator Providers page shows whether the two secrets are set. There is no live check there,
  because Slack has no call that proves an app's client secret without a workspace installing it; the test message is
  the check.

## Setting up Microsoft Teams

Teams uses the **Workflows** app in Teams, which Microsoft recommends as it retires Office 365 connector webhooks.
No Entra ID app registration or SampForce-wide secret is needed.

1. In Teams, open the channel, choose **Workflows** and the template **Send webhook alerts to a channel** (or build a
   Power Automate flow with the trigger "When a Teams webhook request is received" and the action "Post card in a chat
   or channel"). Copy the URL it shows.
2. In SampForce, Integrations, Microsoft Teams: enter a channel name and paste the URL, then **Add channel**. SampForce
   posts a welcome card first and saves the channel only if Teams accepts it.
3. Add up to 20 channels and pick a default. Workflow steps "Post to Slack or Teams" with Microsoft Teams chosen post
   an Adaptive Card with the message and an "Open in SampForce" button.

How it behaves:

- Only `https` URLs on `*.logic.azure.com` or `*.powerplatform.com` are accepted, and they must resolve to public
  addresses; redirects are refused. Old `webhook.office.com` URLs are refused with an explanation, because Microsoft is retiring them.
- The URL is the secret: it is sealed with SecretBox, never returned to the browser, and only a 12-character
  fingerprint goes to the audit log.
- If Teams answers 401, 403, 404 or 410 (the workflow was deleted, turned off or its URL changed), that channel is
  marked "Not accepting messages" and the app shows **Needs attention** until a post to it succeeds again or it is
  removed. A 429 is reported as rate limiting.
- Removing a channel deletes its URL; SampForce cannot turn off the workflow in Teams, so the page reminds the admin to.
- Record values cannot add their own links to the card (markdown link syntax is broken up).

## Setting up Zoom

Zoom is a workspace app: an admin connects the company's Zoom account once. People then schedule Zoom meetings from
any lead, contact or deal, in their own Zoom user (matched by their SampForce email), and the meeting is logged on the
record. If the organiser chooses cloud recording and confirms participants' consent, the transcript is added to
meeting notes after the meeting, ready for the existing AI meeting summary and review.

1. In the Zoom App Marketplace, create a **General app**, choose **admin-managed**, and set the OAuth redirect URL
   to `<PUBLIC_WEB_URL>/api/v1/apps/zoom/callback`.
2. Add the scopes for: viewing users (`user:read:user:admin`), creating meetings for users
   (`meeting:write:meeting:admin`), and reading cloud recordings (`cloud_recording:read:list_recording_files:admin`).
   The scope names are from Zoom's granular-scope list at the time of writing; check them in the Marketplace.
3. Under **Access**, turn on **Event subscription**. Use the endpoint URL `<PUBLIC_WEB_URL>/api/v1/apps/zoom/events`,
   and subscribe to **Recording: Transcript files have completed** and **App deauthorized**. Turn on
   "include a download token". Copy the **Secret Token**.
4. Set `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` and `ZOOM_WEBHOOK_SECRET_TOKEN` in the deployment's secret manager and
   restart the API. Then press **Validate** on the event subscription in Zoom. SampForce answers Zoom's URL validation
   challenge.
5. A workspace admin presses **Connect Zoom** under Integrations. Scheduling the first meeting is the first live call.

How it behaves:

- Access and refresh tokens are sealed with SecretBox. Refreshes are serialised per connection (Zoom rotates refresh
  tokens). A refused refresh shows **Needs reconnecting**.
- If the person's email is not a user in the Zoom account, scheduling fails with that explanation. Nothing is created.
- Events must carry a valid `x-zm-signature` (HMAC-SHA256 of `v0:{timestamp}:{body}`) no more than 5 minutes old.
  Events for Zoom accounts or meetings SampForce does not know are ignored. **Only meetings scheduled from SampForce
  with recording chosen are ever imported.**
- The worker downloads the WebVTT transcript, at most 5 MB, following only checked public redirects. It stores the
  text and speaker segments in meeting notes, with the organiser's consent recorded. An expired link is reported
  and not retried; other failures are retried up to 3 times.
- **App deauthorized** (the app was removed in Zoom) deletes the connection. Meeting history stays.

## Setting up DocuSign

DocuSign is a workspace app. An admin connects the company's DocuSign account once. Anyone who can edit contracts
can then send a **draft** contract to one signer from the contract page. Sending needs an explicit confirmation
("Email this contract to … now"). When the envelope is completed, the contract becomes Active, signed by the signer
on the completion date, with "Signed with DocuSign" as the method.

1. In DocuSign **Apps and Keys**, add an app (integration key) with **Authorization Code Grant**, and add a secret
   key. Add the redirect URI `<PUBLIC_WEB_URL>/api/v1/apps/docusign/callback`.
2. Under **Connect**, add an **HMAC key** (Connect, HMAC). SampForce sets the status callback on each envelope and
   asks DocuSign to sign it. No account-wide Connect configuration is needed.
3. Set `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_SECRET_KEY` and `DOCUSIGN_CONNECT_HMAC_KEY` in the deployment's secret
   manager. For the developer (demo) environment, also set `DOCUSIGN_AUTH_BASE_URL=https://account-d.docusign.com`.
   Restart the API.
4. A workspace admin presses **Connect DocuSign** under Integrations. Sending the first contract is the first live
   call. Going live in DocuSign's production environment needs DocuSign's go-live review of the integration key.

How it behaves:

- The account and its API address (`base_uri`) come from DocuSign's userinfo. Only `https` addresses on
  `docusign.net` or `docusign.com` are accepted. Tokens are sealed and refreshed under a row lock.
- SampForce renders the contract (name, customer, value, dates, terms) as a PDF, with hidden `/sn1/` and `/ds1/`
  anchors where the signature and date fields go.
- One open envelope per contract. **Void** (with a reason) and **Check status** are on the contract page.
  **Download signed PDF** fetches the combined document and certificate from DocuSign on demand; SampForce does not
  store a copy.
- Connect messages must carry a valid `X-DocuSign-Signature-N` (base64 HMAC-SHA256 of the body; any key in a
  rotation matches). Envelopes SampForce did not send are acknowledged and ignored. Status only moves forward, and a
  completed, declined or voided envelope stays that way.
- A declined or voided envelope leaves the contract as a draft, with the reason shown.

## Setting up card payments on proposals

Card payments are a workspace app, and each workspace uses **its own** Stripe or Razorpay account: the money goes
straight to the seller, and SampForce never sees card details. This is separate from SampForce's own subscription
billing (`STRIPE_SECRET_KEY` and friends in docs/BILLING.md), which pays the SampForce operator. No operator secret is
needed.

Stripe:

1. In the Stripe dashboard, create a **restricted key** with **Checkout Sessions: Write** (a secret key also works).
   Use test-mode keys first.
2. In SampForce, under Integrations, Card payments, choose Stripe, paste the key, and press **Check and save**. Paste
   any `whsec_` value for now if the endpoint does not exist yet, then replace it in step 4.
3. Copy the **Webhook URL** shown on the card. In Stripe, add a webhook endpoint with that URL and the events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`
   and `checkout.session.expired`.
4. Press **Replace keys** and paste the endpoint's signing secret. The webhook URL does not change.

Razorpay:

1. In Razorpay, Account & Settings, generate an API key (key id and secret). Use test mode first.
2. Under Webhooks, add the Webhook URL from the SampForce card with a secret you choose, and the events
   `payment_link.paid`, `payment_link.expired` and `payment_link.cancelled`. Save the same secret in SampForce.

How it behaves:

- "Pay by card" appears on the online proposal only when the quote is **accepted**, is the latest version, has a
  total above zero and is shared. Before that the customer sees why they cannot pay yet. The rep's preview shows the
  button turned off.
- Each press creates a Stripe Checkout Session or a Razorpay Payment Link (expires after 24 hours) for the exact
  quote total, with SampForce's payment id in its metadata, and sends the customer to the provider's hosted page.
- A payment counts only when the provider's webhook arrives with a valid signature (Stripe: `Stripe-Signature`,
  timestamp within 5 minutes; Razorpay: `X-Razorpay-Signature`) **and** the amount and currency match what was asked.
  A mismatch is logged and not counted. Retries are idempotent. The rep is notified and `quote.paid` is audited.
- Each workspace's webhook URL carries a random id and is checked with that workspace's own secret, so one
  workspace cannot confirm another's payment.
- Three-decimal currencies (such as KWD) are refused rather than guessed. Refunds, partial payments, deposits and
  instalments are not supported yet; refunds are made in the provider's dashboard and are not reflected here.
- Disconnecting removes the button. Payments still in progress at that point are not recorded, so disconnect only
  when none are open. Payment history stays on each quote.

## Setting up WhatsApp Business

Each workspace uses **its own** WhatsApp Business Platform (Cloud API) number in Meta. SampForce never sends from a
shared number, and there is no operator secret.

1. In Meta Business Manager, have a Meta app with the WhatsApp product, a registered business phone number, and a
   **System User** with an access token that has `whatsapp_business_messaging` and `whatsapp_business_management`.
2. In SampForce, under Integrations, WhatsApp Business, enter the **phone number id**, the **WhatsApp Business
   Account id**, the token and the app's **App Secret**, then press **Check and save**. SampForce reads the number and
   checks that it belongs to that business account; nothing is sent.
3. Copy the **Callback URL** and **Verify token** from the card into the Meta app (WhatsApp, Configuration) and
   subscribe to the `messages` field. Meta's verification request is answered automatically. The warning on the card
   clears when the first signed webhook arrives.

How it behaves:

- **Consent first.** A business-initiated message must be an approved template, and SampForce sends one only if the
  contact's WhatsApp consent is recorded (who recorded it, when, and how the person agreed). A reply of STOP (or
  UNSUBSCRIBE, OPT OUT) withdraws it and notifies the contact's owner. Consent can also be withdrawn by hand.
- **The 24-hour window.** Free-form replies are allowed only within 24 hours of the contact's last message, as
  WhatsApp requires; otherwise only a template.
- **Numbers.** Only phone numbers written with a country code (`+44…` or `0044…`) are used. SampForce never guesses a
  country. Inbound messages are linked to a contact only when exactly one contact has that number; others are kept
  unlinked, and the admin who connected WhatsApp is notified.
- **One to one only.** Every send is one message to one contact, confirmed by the sender ("Send this WhatsApp
  message to +… now"), or a workflow step that needs an approval for each run. There is no bulk send, and AI agents
  cannot send WhatsApp messages.
- **Status.** "Accepted by WhatsApp" is all SampForce knows when it sends. Sent, Delivered, Read and Failed come only
  from Meta's signed status webhooks and only move forward. Read appears only if the person has read receipts on.
- **Templates.** Approved templates whose only variables are in the body are offered. Templates with media headers
  or button variables are not supported yet. Media messages received are shown as "(image message: open WhatsApp to
  see it)"; SampForce does not download media.
- Webhooks must carry a valid `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the App Secret). Each
  workspace has its own URL id and secret, so one workspace cannot write into another. Retries are stored once.
- A refused token (Meta error 190 or a missing permission) marks the app Needs new credentials; replacing them keeps
  the callback URL and verify token.

## Setting up SMS (Twilio)

Each workspace uses its own Twilio account and number. There is no SampForce-wide Twilio secret.

1. In the Twilio console, note the **Account SID** and **Auth Token**, and buy or choose a number with SMS
   capability. For US numbers, complete A2P 10DLC registration first, or carriers will filter the texts (error 30007
   or 30034). Trial accounts can only text verified numbers and add a trial notice.
2. In SampForce, an admin opens Integrations, **SMS (Twilio)**, and saves the three values. SampForce reads the
   account and checks the number belongs to it and can send SMS. Nothing is sent. The Auth Token is stored
   encrypted and never shown again.
3. Copy the **Inbound message URL** into the number's Messaging configuration, "A message comes in", HTTP POST.
   Status callbacks need no setup: each text tells Twilio where to report its status.
4. The card shows Pending Configuration for replies and delivery status until Twilio's first signed request
   arrives. Then send a test text to your own phone and reply to it.

Rules the app enforces:

- A text goes to one contact, only with a recorded SMS consent (who recorded it, when, and how the person agreed),
  and only after the sender ticks a confirmation. The `send_sms` workflow step is an external action: every run
  waits for a person's approval, and consent is checked again when it runs. AI agents cannot send texts.
- A STOP reply (STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, or Twilio's `OptOutType=STOP`) withdraws consent.
  Consent cannot be recorded again until the person texts START, matching how Twilio blocks the number.
- Every request from Twilio is checked with `X-Twilio-Signature` (HMAC-SHA1 with the Auth Token over the exact URL
  and the sorted form fields). Status only moves forward; undelivered and failed are final and notify the sender.
- The segment count (GSM-7 or UCS-2) is shown before sending, since Twilio bills per segment.
- Numbers must be written with their country code; SampForce never guesses a country.

## Setting up Zapier and API keys

API keys work as soon as this version is deployed:

1. An admin opens Integrations, **API keys**, names the key, picks scopes (for example `leads:write` and
   `deals:read`) and an optional expiry. The key is shown once; copy it into the tool that will use it.
2. Call the API with `Authorization: Bearer dfk_…`. Only lead, contact, company, deal, pipeline, activity and task
   routes accept keys; everything else answers 403 `API_KEY_NOT_ALLOWED`. A key never has more than its creator's
   current role allows, and stops working if that person is suspended or removed.
3. Revoke a key on the same page. It stops at once and its Zapier subscriptions are removed.

The Zapier app needs a one-time publish by an operator (see `integrations/zapier/README.md`):

1. `cd integrations/zapier && npm install && npx zapier login`
2. `npx zapier register "SampForce"` once, then `npx zapier push`.
3. Invite users from the Zapier developer platform, or submit for public review.
4. Set `ZAPIER_INVITE_URL` to the invite or directory link and restart the API. The Integrations page then shows
   **Available** with a link, instead of Pending Configuration.
5. Before calling it working, build a test Zap with a private invite: connect with a key, turn on "New Lead",
   create a lead in SampForce and check the Zap run, then run "Create Lead" and check the lead appears.

Each trigger is a REST hook: turning a Zap on creates a webhook for that one event (marked "Made by a Zap" in the
Webhooks list), and turning it off removes it. Samples in the Zap editor are your latest real records; if there
are none yet, create one first.

## Behaviour

- Each member connects their own account (permission `activities:write`). OAuth `state` is signed and
  bound to the signed-in user and workspace; it expires after 10 minutes.
- Tokens are encrypted with AES-256-GCM using `ENCRYPTION_KEY` (required in production). Disconnecting
  deletes the stored tokens; synced emails and meetings stay on their records.
- Sync runs every 15 minutes per connection (and on "Sync now"). Only messages and events that involve
  an existing contact or lead are stored. The first sync looks back 30 days (up to 200 Gmail messages);
  calendar covers the past 30 and next 60 days.
- Microsoft sync reads the Inbox only. Mail sent from SampForce is recorded when sent; mail sent from
  Outlook directly is not imported yet.
- A revoked or expired sign-in marks the connection "Needs attention", stops scheduled syncs and notifies
  the person. After 5 consecutive other failures the connection is also paused.
- Sending: one recipient per message, from the sender's own mailbox, at most `EMAIL_DAILY_SEND_LIMIT`
  (default 200) per person per 24 hours. Headers are sanitised. A sent email is logged as an EMAIL
  activity on the matching contact or lead. Sequence emails (Phase 9, ADR 0014) count towards the same limit.
- Email sequences send one-to-one from each person's own connected mailbox, inside a send window and under a
  per-sequence daily limit. Mailbox sync also detects replies and bounces to sequence emails. SampForce does not
  send newsletters or bulk email from a shared domain.
- Tracking and unsubscribe links point at `TRACKING_BASE_URL` (default `PUBLIC_WEB_URL`), which must be reachable
  from the internet and serve `/api/v1/t/*` and `/unsubscribe/*`.

## Browser extension

The SampForce lead-capture extension for Chrome and Edge (`apps/extension`, ADR 0015) saves people found on web pages
as leads. Each person creates a connection code under Integrations → Browser extension; the extension can only look
people up, save leads and enrol them, within what the person's role allows. Connections show under the person's
signed-in devices and end with any "sign out other devices". Automatic capture is off by default and only saves
addresses at the website's own domain, never personal mailboxes. It is not in the Chrome Web Store yet: load
`apps/extension/dist` unpacked (see `apps/extension/README.md`).

From version 0.2.0 people can also sign in from the extension with their SampForce email and password (and their
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

Recordings are streamed to Deepgram and not stored by SampForce. Meet, Zoom and Teams are recognised from calendar
links only; there is no Zoom, Meet or Teams API connection and no meeting bot.

The same key transcribes voice notes (up to 25 MB each, with a language choice or automatic detection). Voice
recordings are not stored either, and any successful transcription, meeting or voice note, marks the workspace Verified.

## Webhooks

- Admins with `integrations:manage` add an https endpoint and choose events. The signing secret is shown
  once and stored encrypted.
- Body: `{ id, type, createdAt, data: { entityType, entityId, actorUserId, changes } }`. Headers:
  `X-SampForce-Event`, `X-SampForce-Delivery`, and `X-SampForce-Signature: t=<unix>,v1=<hex>` where
  `v1 = HMAC-SHA256(secret, "<t>.<raw body>")`. Reject timestamps older than a few minutes.
- At-least-once delivery. A non-2xx answer or timeout (10 s) retries after 1 min, 5 min, 30 min, 2 h and
  6 h (`WEBHOOK_MAX_ATTEMPTS`, default 6 attempts), then the delivery is marked failed and can be
  redelivered by hand. After `WEBHOOK_DISABLE_AFTER_FAILURES` (default 15) failures in a row the
  endpoint is switched off and admins are notified.
- Targets must be public https URLs. Private, loopback, link-local and metadata addresses are refused
  (checked at save time and before every delivery). Redirects are not followed. The connection is made only
  to the addresses that passed the check, so a DNS answer that changes after the check (DNS rebinding) cannot reach
  an internal address.

## Testing

`apps/api/test/fixtures/provider-fixture.ts` is a local HTTP server that mimics the Google and Graph
endpoints the adapters call. `apps/api/test/integrations.e2e.test.ts` runs the full OAuth round trip,
sync, send, reconnect-on-revoke and tenant isolation against it. Passing these tests shows our side of
the protocol is consistent with the documented API shapes; it does not prove the live providers accept
the app, which needs a run with real credentials.

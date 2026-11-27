# 0101. Universal dialer, recordings and call outcomes

Date: 2026-11-27. Status: accepted. Builds on ADR 0088 (Calls section).

## Context

ADR 0088 gave SampForce a Calls page with link dialers and Twilio click-to-call. People use many other phone systems: cloud dialers with an API (Exotel, Knowlarity, Aircall, RingCentral and others), softphones, desk phones, Teams or Zoom Phone, and their own mobile SIM. They also asked for recordings, a full call history, richer outcomes that do the right follow-up, and calls that update the company, contact and deal on their own. Two rules held throughout: nothing may claim a connection that is not real, and nobody is recorded without the workspace's consent rules.

## Decision

### Dialers are adapters with declared capabilities

A dialer has a **kind** and a **provider**. The kind is the adapter that does the work. The provider is a preset with its own fields, labels and help.

- **LINK**: opens an app on this device from a URL template (`tel:`, `callto:`, `sip:`, Teams, Zoom Phone, Dialpad, FaceTime, or any link). It cannot report back on its own.
- **API**: any cloud phone system with a click-to-call HTTP API. The person sets the base URL, the call path, the method, a JSON or form body with `{placeholders}`, and how it signs in: none, Basic, a header, a bearer token, or OAuth 2 client credentials or a refresh token. The person also sets where the provider's call ID and recording URL are found in the response. Optional settings cover a hang-up path, a test path, region limits and extra values. Exotel, Knowlarity, Aircall and RingCentral are presets of this adapter, with the request filled in. Requests go through the public-URL guard, have a timeout, and retry once on 5xx or 429.
- **TWILIO**: the workspace's Twilio connection (ADR 0039). Mute, hold and recording can be controlled live.
- **SIP** (browser WebRTC phone) and **SIM** (the mobile companion app) exist in the types but **cannot be added yet**. The server refuses them, and the gallery says they come later. Showing them as connected would be a fake connection.

Each provider declares **capabilities**: place calls, receive calls, end calls, mute, hold, record, fetch recordings, report status, caller ID, open an app, and send details. The UI shows only the controls a dialer really has. A call says what is missing, for example "Not available with Office dialer: Mute, Hold".

### Credentials

Keys, tokens, client secrets and refresh tokens are sealed with the secret box (ADR 0059) and are never returned. Rows only say which secrets are saved. A form leaves a saved secret alone when the field is empty, and can remove it. Removing a dialer clears its secrets and its events hook.

### Dialer settings

The Dialer settings tab lists the built-in Phone app and each dialer with:

- its status: never tested, connected, failed, or switched off;
- a switch to turn it on or off;
- its capability chips;
- its events URL, which can be copied, and a new webhook secret;
- **Test connection**, which shows each step and the request it sent with secrets masked;
- Make default, Edit, Remove, and an **integration log** of tests, calls, events and recordings.

Adding a dialer starts from a gallery grouped by kind. The setup dialog shows only the fields the provider uses. For "any cloud dialer", it shows only the sign-in fields for the chosen sign-in type. Its header and buttons stay in view while the form scrolls, so nothing overlaps. Each person keeps up to 20 dialers. ADR 0088 allowed 10.

### Provider events

`POST /api/v1/calls/events/:hookId/:token` takes status, duration, recording and incoming-call events from a provider. A wrong token gets a 401. Events are matched to the call by the provider's call ID. A duplicate recording is kept once. An incoming call is matched to an employee or company by number, and shows as ringing on the Calls page until it is answered or missed.

### The dialer

- The keypad plays DTMF tones, and a right-click on 0 types `+`.
- There are pickers for the country code (remembered per device), the dialer and the caller ID (from the dialer's list).
- A search finds companies and contacts, and quick picks offer favourites and recents.
- A call shows its status and timer, ringback and connect/end sounds, and only the controls the dialer supports. Sounds can be switched off and the choice is kept on the device.

### Recordings

A workspace **recording policy** has these settings:

- whether recording is on;
- whether consent is required, and the consent notice that is read out;
- retention in days, or kept until deleted;
- who may download: nobody, managers, or everyone who can play.

Recordings come from the provider (fetched by its adapter), are uploaded by the caller, or (later, with the SIP phone) are recorded in the browser. Browser recording needs the consent button first. The Recordings tab lists recordings by visibility scope (mine, team, everyone), with search and dates. Each one has a player with seek and volume, notes, delete, and download where the policy allows. Audio is served with range requests. A dialer without recording support says so and offers an upload instead.

### Outcomes

There are 17 built-in outcomes: not picked up, not answered, callback, not interested, wrong number, busy, details by email, another call, call scheduled, interested, qualified, RFQ expected, RFQ received, deal created, existing client, connected and other. Voicemail is kept from ADR 0088. Each outcome has:

- an icon and a colour;
- whether it counts as reaching the person;
- a follow-up action (next call, email, meeting, none) and a delay.

Admins (`crm:configure`) can rename the built-in outcomes, recolour them, switch them off, and add custom outcomes (`CUSTOM_…`). A follow-up is suggested from the outcome and can be changed.

**A no-answer never marks a company lost.** Unanswered outcomes are attempts. Only "not interested", when the caller ticks it, marks the contact as not interested, and the company's status is not touched. "Wrong number" can flag the number for checking. The flag is shown on the call card until someone confirms the number.

### Records update themselves

Logging a call writes the call interaction on the company and contact timelines. It updates the contact's and company's last call, call count and reached count. It can link the call to a deal or create one (`deals:write`), and it plans the follow-up as a CALL, EMAIL or MEETING follow-up.

### Call history

The history has a **table** view with these columns: date and time, company and deal, contact (designation, email), phone and caller ID, called by, dialer, talk time and recording, status, outcome and notes, next follow-up, and actions. It also has an **activity** view, a timeline grouped by day. Both views have filters for scope, outcome, status, direction, dialer, date range and "with a recording", plus a sort and "Show more". The chosen view is kept per device.

### AI

No core call feature depends on AI.

## Changes to earlier behaviour (ADR 0088)

- Outcome labels are renamed, for example "Connected" is now "Call completed successfully". New outcomes are added, and old stored keys still read.
- `twilioStatus` and `twilioSid` on calls are now `providerStatus` and `providerCallId`, for every provider.
- "Remarks" is now "Notes" in the log form.
- "Add my dialer" is now "Add a dialer", in the Dialer settings tab with a provider gallery.
- The Calls page has tabs: Dialer, Call history, Next calls, Recordings, Dialer settings (`?tab=`).
- The dialer limit rose from 10 to 20.

## Consequences

- Link dialers still cannot report back. The person logs the outcome, and talk time comes from the timer.
- A cloud dialer works only as well as its API settings. Test connection and the log show exactly what was sent and what came back.
- The browser SIP phone and the SIM companion app are the next parts. Until then they are listed as coming, not offered.
- Recordings are kept in the database (up to 12 MB each, 5 per call), which is fine for call audio. Moving them to object storage is a later change.

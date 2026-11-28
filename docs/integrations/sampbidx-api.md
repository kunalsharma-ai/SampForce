# SampBidx inbound API, version 1

This is what SampBidx has to build so SampForce can send it RFQs. SampForce already sends exactly this (ADR 0061).
The stand-in at `apps/api/test/fixtures/sampbidx-fixture.ts` implements this document and is what SampForce's
tests run against. Nothing here has been tried against SampBidx itself yet.

There are three calls from SampForce to SampBidx, and one from SampBidx back to SampForce.

| Direction | Call | Purpose |
| --- | --- | --- |
| SampForce → SampBidx | `GET  {base}/v1/ping` | Check the address and key when an admin connects |
| SampForce → SampBidx | `POST {base}/v1/rfqs` | A filled-in RFQ with its attachments (option 1) |
| SampForce → SampBidx | `POST {base}/v1/rfq-emails` | The RFQ email itself (option 2) |
| SampBidx → SampForce | `POST {callback URL}` | Status updates: received, in review, bidding, quoted, won, lost… |

`{base}` is the address the SampForce admin types into **Integrations → SampBidx → SampBidx API address**, for
example `https://bids.frequentresearch.com/api`. SampForce adds `/v1/...` to it.

## Connecting

SampBidx's Integration Hub asks for the callback URL and signing secret before it saves and creates the key, so
SampForce gives them out first:

1. In SampForce, a workspace admin opens **Integrations → SampBidx** (or **SampBidx settings**) and presses **Show
   the callback URL and signing secret** (`POST /apps/sampbidx/callback-setup`). The connection stays "not
   connected" and status updates to that URL are refused until step 3.
2. In SampBidx, paste them into **Status callback URL** and **Callback signing secret**, save, and create an API
   key for SampForce.
3. Back in SampForce, enter SampBidx's API address and the key, and press **Check and save**. SampForce calls
   `GET /v1/ping` once and saves only if SampBidx answers 200. The callback URL and secret stay the same.

In production a public address must be `https://`. SampForce refuses private and internal addresses (10.x,
192.168.x, 172.16-31.x, localhost and so on) so a typed-in address cannot reach internal systems, unless the
SampForce operator approves them.

If SampBidx runs on the same server or private network as SampForce, the operator adds its host name, address or
range in the SampForce operator console under **Providers → Workspace servers → Approved private hosts** (for
example `sampbidx-api, 172.16.0.0/12` for a Docker network, or `127.0.0.1`). After that, the workspace admin can
enter the private address, and plain `http://` is accepted for that approved private host only.

## Authentication (SampForce → SampBidx)

Every request carries:

```
Authorization: Bearer <the API key>
Accept: application/json
User-Agent: SampForce
```

Answer **401** or **403** for a wrong or revoked key. When a send is refused with 401 or 403, SampForce asks
`GET /v1/ping` again with the same key: if ping refuses it too, the connection is marked as needing a new key; if
ping accepts it, the send fails with "SampBidx accepts the API key but refused the client (403 at PUT /v1/clients): …"
and the connection stays usable, because the key is fine and that path is what is missing or not allowed.

## GET /v1/ping

Answer 200 with any JSON. If it has `account.name` (or `name`), SampForce shows it as the connected account.

```json
{ "ok": true, "account": { "name": "Frequent Research Bids" }, "apiVersion": "v1" }
```

## POST /v1/rfqs — option 1, a filled-in RFQ

`Content-Type: multipart/form-data`, with these parts:

| Part | Content type | What |
| --- | --- | --- |
| `rfq` | `application/json` | The RFQ and who sent it (below) |
| `files` (0–20 times) | the file's own type | Each attachment the sender ticked, with `filename` |

At most 20 files and 40 MB in all. SampForce only sends an RFQ once project name, research methodology,
country/market, sample size and submission deadline are filled in.

The `rfq` part:

```json
{
  "system": "SampForce",
  "workspace": "Frequent Research Fieldwork Solutions",
  "transferId": "6b0c4c1e-6f0e-4a3e-9f0a-2f5d8b7f1c11",
  "sentBy": { "id": "…", "name": "Rahul Verma", "email": "rahul@frequentresearch.com", "designation": "Business Development Manager" },
  "clientTeam": {
    "poc": { "id": "…", "name": "Kunal Sharma", "email": "kunal@frequentresearch.com", "designation": "Director" },
    "owner": { "id": "…", "name": "Rahul Verma", "email": "rahul@frequentresearch.com", "designation": "Business Development Manager" },
    "manager": null
  },
  "note": "Client wants the quote by Friday.",
  "rfq": {
    "id": "c0a8…",
    "number": "RFQ-0001",
    "projectName": "India B2B IT decision makers",
    "description": null,
    "status": "RECEIVED",
    "methodology": "Online survey",
    "market": "IN",
    "industry": null,
    "targetAudience": "IT decision makers, 500+ employees",
    "sampleSize": 400,
    "loiMinutes": 15,
    "incidenceRatePercent": 20,
    "cpi": 12.5,
    "totalQuotation": 5000,
    "currency": "USD",
    "receivedAt": "2026-11-16T09:00:00.000Z",
    "deadlineAt": "2031-03-12T12:30:00.000Z",
    "company": { "id": "…", "name": "Acme Panels Pvt Ltd", "leadNumber": "FRFS01" },
    "contact": { "id": "…", "name": "Priya Nair" },
    "owner": { "name": "Rahul Verma" },
    "manager": { "name": "Kunal Sharma" }
  },
  "attachments": [
    { "name": "questionnaire.pdf", "contentType": "application/pdf", "sizeBytes": 48211, "sha256": "…" }
  ]
}
```

`sentBy` is the SampForce user who sent the RFQ (on a retry by someone else, still the original sender).
`clientTeam` is who looks after this client in SampForce: `poc` (the client's point of contact), `owner` and
`manager`. Each person is `{ id, name, email, designation }` or `null`; `clientTeam` is `null` when no company is
linked. Show `sentBy` and `clientTeam.poc` on the bid so everyone can see who sent it and who the client's POC is.

`market` is an ISO 3166 country code. `currency` is an ISO 4217 code. Dates are ISO 8601 in UTC. Any field except
`number`, `projectName` and the required ones above can be `null`.

## POST /v1/rfq-emails — option 2, the RFQ email itself

`Content-Type: multipart/form-data`, with these parts:

| Part | Content type | When |
| --- | --- | --- |
| `email` | `application/json` | Always |
| `message` | `message/rfc822` (.eml) or `application/vnd.ms-outlook` (.msg) | When the person uploaded the email file. It is the whole original email, its attachments included, up to 10 MB |
| `files` (0–10 times) | the file's own type | Only with `source: "pasted"`: the email's attachments, added by hand next to the pasted text, each up to 20 MB, with `filename` |

The `email` part:

```json
{
  "system": "SampForce",
  "workspace": "Frequent Research Fieldwork Solutions",
  "transferId": "…",
  "sentBy": { "id": "…", "name": "Rahul Verma", "email": "rahul@frequentresearch.com", "designation": "Business Development Manager" },
  "clientTeam": { "poc": { "id": "…", "name": "Kunal Sharma", "email": "kunal@frequentresearch.com", "designation": "Director" }, "owner": null, "manager": null },
  "note": null,
  "source": "mailbox",
  "company": { "id": "…", "name": "Acme Panels Pvt Ltd", "leadNumber": "FRFS01", "country": "IN" },
  "rfq": null,
  "email": {
    "subject": "RFQ: UK consumer study, 1,000 completes",
    "from": "priya@acmepanels.example",
    "to": ["rahul@frequentresearch.com"],
    "cc": [],
    "date": "2026-11-16T04:45:00.000Z",
    "text": "Need 1,000 UK adults, LOI 12…",
    "attachmentsIncluded": false
  }
}
```

- `source: "mailbox"`: an email from the sender's synced mailbox. SampForce has its text, not its attachments, so
  there is no `message` part and `attachmentsIncluded` is `false`.
- `source: "file"`: an uploaded .eml or .msg file. The `message` part is the file, and `email` carries `fileName`,
  plus `subject`, `from` and `date` read from the file's headers when it is an .eml (null for .msg).
- `source: "pasted"`: the email's text, copied from a mail program and pasted into SampForce wherever the client
  conversation is (a company, contact, lead or deal page, an inbox email, or the RFQs page). `text` is exactly what
  was pasted, usually including the From, Sent, To and Subject lines. `subject`, `from`, `to`, `cc` and `date` are
  read from those lines (or typed by the person); any of them can be `null` or empty. SampForce never fills a value
  it could not read. Pasted text cannot carry files, so the person adds the email's attachments by hand: they come
  as `files` parts, listed in `attachments` (`[{ "name", "contentType", "sizeBytes", "sha256" }]`), and
  `attachmentsIncluded` is `true` when there is at least one. There is no `message` part. Also sent:
  - `contact`: `{ "id", "name", "email" }`, the client's employee who sent the email, or `null`.
  - `sourceReference`: `{ "type", "id", "url" }`, where in SampForce the email was captured. `type` is `company`,
    `contact`, `lead`, `deal`, `email` or `rfqs`; `url` opens that page in SampForce (for signed-in users), or is `null`.
  - `company` can be `null` when the sender chose to send without linking a client.
- `company` and `rfq` are set when the sender linked the email to a company lead or to an RFQ (same shape as above).

## PUT /v1/clients/{externalId} — the client company and its contacts

Added in ADR 0080. A person presses **Send to SampBidx** on a company, picks the employee who shared the RFQ (and
any other employees who should be client contacts), reviews what goes, and sends. SampForce first creates or
updates the company as a SampBidx **client** with this call, then sends the RFQ with `POST /v1/rfqs` (below), which
then names the client and the contact.

`{externalId}` is SampForce's company id, which never changes. **The same `externalId` must always update the same
client**, never create a second one. `Content-Type: application/json`, same `Idempotency-Key` headers as every send.

```json
{
  "system": "SampForce",
  "workspace": "Frequent Research Fieldwork Solutions",
  "transferId": "0d3e…",
  "externalId": "3f5c…",
  "company": {
    "name": "Northwind Insights Ltd",
    "website": "https://northwind.example",
    "industry": "Market research",
    "leadNumber": "FRFS07",
    "notes": null,
    "logoUrl": null
  },
  "offices": [{ "label": "Head office", "headOffice": true, "country": "IN", "city": "Mumbai", "address": null }],
  "contacts": [
    {
      "externalId": "9a1b…",
      "id": null,
      "name": "Bilal Khan",
      "email": "bilal@northwind.example",
      "jobTitle": "Procurement Manager",
      "phone": "+91 98100 00000",
      "country": "IN",
      "timeZone": "Asia/Kolkata",
      "mayReceiveQuotes": true,
      "marketingConsent": null
    }
  ],
  "sentBy": { "id": "…", "name": "Rahul Verma", "email": "rahul@frequentresearch.com", "designation": "Business Development Manager" },
  "clientTeam": { "poc": null, "owner": { "…": "…" }, "manager": null },
  "note": null
}
```

- The fields match the SampBidx Clients screen. SampForce only sends once company `name` and, for each contact,
  `name`, `email`, `country` and `timeZone` are filled in (the person completes them in the review step).
- `contacts[].externalId` is SampForce's employee id. `contacts[].id` is SampBidx's contact id from an earlier
  answer, or `null` the first time. Match a contact by `id`, else by `externalId`, else by email; update it rather
  than adding a duplicate. Contacts not in the list are **left as they are** (SampForce sends only the ones the
  person ticked).
- `marketingConsent` is `true`, `false` or `null` (not recorded). Bid number prefix is left to SampBidx.
- `logoUrl` is always `null` for now: logos are not sent.
- No pricing, tax, PMF, PSF, discount, prepayment, validity or payment terms are ever sent: SampForce has none from
  the client. The bid manager sets them in SampBidx.

Answer **200** (updated) or **201** (created) with the client's id and each contact's id:

```json
{
  "id": "CL-1042",
  "url": "https://bids.frequentresearch.com/clients/1042",
  "status": "created",
  "contacts": [{ "externalId": "9a1b…", "id": "CC-88" }]
}
```

SampForce keeps these ids and sends them back next time. Errors are answered as below; a **409** means the client
duplicates another record in SampBidx; SampForce shows "SampBidx reported a duplicate: …" with your message.
If the client fails, the RFQ is not sent: the person sees the reason and **Try again**.

### What the RFQ carries after a client send

`POST /v1/rfqs` then has two more top-level fields, and the `rfq` part three more fields:

```json
{
  "client": { "id": "CL-1042", "externalId": "3f5c…" },
  "contact": { "id": "CC-88", "externalId": "9a1b…", "name": "Bilal Khan", "email": "bilal@northwind.example", "jobTitle": "Procurement Manager", "phone": "+91 98100 00000" },
  "rfq": {
    "serviceCategory": "QUANTITATIVE",
    "service": "CAWI",
    "countries": ["GB", "DE"],
    "lines": [
      { "country": "GB", "targetGroup": "Gen pop 18+", "quota": 500, "loiMinutes": 15, "incidenceRatePercent": 30, "cpi": null, "description": null },
      { "country": "DE", "targetGroup": "Gen pop 18+", "quota": 300, "loiMinutes": 15, "incidenceRatePercent": 25, "cpi": null, "description": null }
    ]
  }
}
```

- `contact` is **the employee who shared the RFQ**, which the person picked; it is not simply the company's primary
  contact. Attach the bid to that client contact.
- `serviceCategory` is `QUANTITATIVE` or `QUALITATIVE`; `service` is one of `CAWI`, `CATI`, `CAPI`, `F2F`, `IDI`,
  `FGD`, `ONLINE_COMMUNITY`, `OTHER`. Either can be `null`.
- `lines` has **one row per country and target group**. Keep the rows separate: two target groups in one country are
  two rows. An RFQ without its own rows sends one row from its market, or none. `cpi` is the client's target CPI
  when they gave one, else `null` (to quote).
- An RFQ sent from the RFQ itself (not from the company) has `client` and `contact` as `null` when the company was
  never sent as a client.

Sending an RFQ to SampBidx never marks it as won in SampForce. Received, sent to SampBidx, accepted by SampBidx and
the outcome stay four separate records.

## The client's relationship: won companies (ADR 0099)

`PUT /v1/clients/{externalId}` carries one more field, `relationship`. It is `null` while the company is not won.
For a won company (sent from **Send won companies to SampBidx** or any later client send) it is:

```json
"relationship": {
  "status": "WON",
  "wonAt": "2026-11-20T10:12:00.000Z",
  "wonDeal": { "externalId": "7d2e…", "number": "DEAL-0012", "name": "Northwind tracker", "amount": 8000, "currency": "EUR", "closedAt": "2026-11-20T10:12:00.000Z" }
}
```

Mark the client as a customer. Nothing about prices, taxes, discounts or prepayment is in it.

## PUT /v1/deals/{externalId} — a deal for a client (ADR 0099)

SampForce sends deals one at a time from **Send deals to SampBidx** (many selected deals at once, each its own
request). `externalId` is SampForce's deal id: **create the deal, or update the one you already have for that id**.
SampForce always sends the deal's company as a client first (`PUT /v1/clients/…`) when you do not have it yet or it
changed, so the client exists by the time the deal arrives.

Headers as for every send: `Authorization: Bearer <key>`, `Content-Type: application/json`, `Idempotency-Key`
(the SampForce transfer id; a retry carries the same one) and `X-SampForce-Transfer-Id`.

```json
{
  "system": "SampForce",
  "workspace": "Frequent Research Fieldwork Solutions",
  "transferId": "c0a8…",
  "sentBy": { "name": "Asha Rao", "email": "asha@example.com", "designation": "Sales Manager" },
  "clientTeam": { "poc": null, "owner": null, "manager": null },
  "note": null,
  "externalId": "7d2e…",
  "client": { "id": "CL-1042", "externalId": "3f5c…" },
  "contact": { "id": "CC-88", "externalId": "9a1b…", "name": "Priya Nair", "email": "priya@acmepanels.example", "jobTitle": "Head of Insights", "phone": null },
  "deal": {
    "id": "7d2e…",
    "number": "DEAL-0012",
    "name": "India B2B tracker",
    "amount": 5000,
    "currency": "USD",
    "status": "OPEN",
    "pipeline": "Sales Pipeline",
    "stage": "Qualification",
    "probability": null,
    "expectedCloseDate": null,
    "closedAt": null,
    "lossReason": null,
    "owner": "Asha Rao",
    "manager": null,
    "createdAt": "2026-11-27T09:00:00.000Z"
  }
}
```

- `status` is `OPEN`, `WON` or `LOST`. `amount` is the deal value the salesperson entered in SampForce (always above
  0), in `currency`. It is not a price, tax, discount or prepayment.
- `contact` is the deal's contact, or `null` when the deal has none. `number` can be `null` for very old deals.
- Answer **201** (created) or **200** (updated) with `{ "id": "DL-…", "url": "https://…" (optional), "status": "received" (optional) }`.
  Without an `id` SampForce treats the send as failed.
- **422** with `{"error": {"message": "…"}}` when you cannot take it (for example an unknown client); SampForce shows
  your message to the person, who can correct the record and retry.

## Connection test

The SampBidx settings page in SampForce (Integrations → SampBidx settings) tests the connection step by step:
the address, whether SampForce may call it (public https, or a private address an operator approved), whether
anything answers, whether `GET /v1/ping` exists (a 404 here means this API is not built at that address yet),
whether the key is accepted, and whether you have sent a signed status update yet. Only `GET /v1/ping` is called.

## Answering a send

Answer **200** or **201** with SampBidx's own id. `url` (a page in SampBidx) and `status` are optional:

```json
{ "id": "SBX-A78881", "url": "https://bids.frequentresearch.com/bids/A78881", "status": "received" }
```

Every send carries the headers:

```
Idempotency-Key: <transferId>
X-SampForce-Transfer-Id: <transferId>
```

When a send fails or times out, the person can press **Try again**, and the same `Idempotency-Key` is sent again.
**If SampBidx has already accepted a request with that key, answer 200 with the same id** rather than creating a
second record. A person who wants a deliberate second copy sends a new transfer, which has a new key.

Errors SampForce shows to the person:

| Status | What SampForce shows |
| --- | --- |
| 400 or 422 with `{"error": {"message": "…"}}` | "SampBidx refused the RFQ: …" with your message, so make it readable |
| 401 / 403, and ping refuses the key too | The key was refused; an admin must enter a new one |
| 401 / 403, but ping accepts the key | "SampBidx accepts the API key but refused … (403 at PUT /v1/clients)", with your message |
| 404 at `/v1/ping` | No API at that address |
| 404 at another path | "SampBidx has not built PUT /v1/clients yet (404)" |
| 413 | Files too large |
| 429 | SampBidx is busy |
| 5xx, timeout (60 s), network error | "Try again shortly"; the send can be retried |

## Status updates — SampBidx → SampForce

Whenever an RFQ's status changes in SampBidx, `POST` to the callback URL shown in SampForce:

```
POST https://<sampforce>/api/v1/apps/sampbidx/callbacks/<id>
Content-Type: application/json
X-SampBidx-Timestamp: 1763286000
X-SampBidx-Signature: sha256=<hex>
```

```json
{ "transferId": "6b0c4c1e-…", "sampbidxId": "SBX-A78881", "status": "quoted", "note": "Quoted at USD 11.50 CPI", "url": "https://…" }
```

- Send `transferId` (from the request) or `sampbidxId` (your own id), or both.
- `status` is one of `received`, `in_review`, `bidding`, `quoted`, `won`, `lost`, `rejected`, `cancelled` (any case).
- `note` and `url` are optional. The note is shown to the sales team on the RFQ.

The signature is the hex HMAC-SHA256 of the timestamp, a dot, and the exact body bytes, keyed with the callback
signing secret:

```
signature = "sha256=" + hex(HMAC_SHA256(secret, timestamp + "." + body))
```

The timestamp is Unix seconds and must be within 5 minutes of SampForce's clock. SampForce answers **401** to a
missing, wrong or stale signature, **400** to a body it cannot read, and **200** `{"ok": true, "matched": true|false}`
otherwise (`matched: false` means it does not know that RFQ; do not retry those). Retry a 5xx or timeout with a
fresh timestamp and signature.

Node.js example:

```js
import { createHmac } from 'node:crypto';

const body = JSON.stringify({ sampbidxId: 'SBX-A78881', status: 'quoted', note: 'Quoted at USD 11.50 CPI' });
const ts = String(Math.floor(Date.now() / 1000));
const sig = 'sha256=' + createHmac('sha256', process.env.SAMPFORCE_CALLBACK_SECRET).update(`${ts}.${body}`).digest('hex');
await fetch(process.env.SAMPFORCE_CALLBACK_URL, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-sampbidx-timestamp': ts, 'x-sampbidx-signature': sig },
  body,
});
```

An admin can make a new signing secret in SampForce at any time. Callbacks signed with the old one are refused from
that moment, so update SampBidx straight away.

## Checklist for the SampBidx team

- [ ] `GET /v1/ping` with Bearer key check
- [ ] `POST /v1/rfqs` reading the `rfq` part and the `files` parts
- [ ] `POST /v1/rfq-emails` reading the `email` part and the optional `message` part
- [ ] `PUT /v1/clients/{externalId}`: create or update the client by `externalId`, contacts by id, externalId or email; answer with the contact ids
- [ ] `POST /v1/rfqs` reading `client`, `contact`, `serviceCategory`, `service` and the country `lines` (kept separate)
- [ ] `PUT /v1/clients/{externalId}` reading `relationship` (won companies)
- [ ] `PUT /v1/deals/{externalId}`: create or update the deal by `externalId`, linked to the client; answer with its id
- [ ] Same `Idempotency-Key` → same record, answered with the same id
- [ ] Readable error messages in `{"error": {"message": "…"}}`
- [ ] Signed status callbacks to SampForce on every status change
- [ ] HTTPS on a public address

## Chat with the SampBidx team

SampForce has a **Chat with SampBidx team** section inside Team chat (ADR 0078). It holds one general line to the
SampBidx team and one chat per RFQ sent to SampBidx. Messages go both ways. Who in SampForce can chat is decided in
SampForce: the Console Admin allows it for an organisation, its Super Workspace hands it down to Manager Workspaces,
and they to Executive Workspaces. The same API key and callback signing secret as above are used, so nothing new
needs to be set up.

### SampForce → SampBidx: `POST /v1/messages`

Each message a SampForce person writes is posted once, as multipart, with the Bearer key:

```
POST https://<sampbidx>/api/v1/messages
Authorization: Bearer <key>
Idempotency-Key: <messageId>
X-SampForce-Message-Id: <messageId>
Content-Type: multipart/form-data; boundary=…
```

- A `message` part holding JSON (below).
- Zero to five `files` parts, one per attachment, with the file name and content type. Up to 10 MB each.

```json
{
  "id": "0d3f5a0e-…",
  "system": "SampForce",
  "workspace": "Frequent Research Fieldwork Solutions",
  "conversation": {
    "type": "rfq",
    "transferId": "6b0c4c1e-…",
    "sampbidxId": "SBX-A78881",
    "title": "RFQ: UK B2C grocery shoppers, n=1,000",
    "rfq": { "number": "RFQ-0042", "projectName": "UK grocery tracker" },
    "company": { "name": "Acme Panels" }
  },
  "author": { "id": "a1c…", "name": "Kunal Sharma", "email": "kunal@example.com", "role": "Owner", "workspace": "Sales UK" },
  "text": "Can you confirm feasibility for n=1,000 at IR 40%?",
  "sentAt": "2026-11-24T21:10:00.000Z",
  "attachments": [{ "name": "brief.pdf", "contentType": "application/pdf", "sizeBytes": 18233, "sha256": "…" }]
}
```

- `conversation` is `{ "type": "general" }` for the general line. For an RFQ chat it carries SampForce's
  `transferId` and your `sampbidxId`, so you can put the message on the right bid. `rfq` and `company` can be `null`.
- `text` can be empty when the message is only files.
- Answer **200** or **201**, optionally with your own id: `{ "id": "MSG-991" }`.
- **Same `Idempotency-Key` → answer 200 again and do not show the message twice.** SampForce retries.

SampForce shows the sender "Delivered to SampBidx" once you answer. When a post fails it tries again by itself after
30 s, 2 min, 10 min, 30 min and 2 h (six tries in all), and the sender can press **Try again** at any time. A 400,
401, 403, 404 or 413 is not retried by itself, since trying again would get the same answer. Errors use the same
table as above.

### SampBidx → SampForce: `POST …/callbacks/<id>/messages`

When someone in SampBidx writes, post JSON to the callback URL with `/messages` added, signed exactly like the status
callbacks (same secret, same `X-SampBidx-Timestamp` and `X-SampBidx-Signature` headers, same 5-minute window):

```
POST https://<sampforce>/api/v1/apps/sampbidx/callbacks/<id>/messages
```

```json
{
  "id": "sbx-msg-1201",
  "sampbidxId": "SBX-A78881",
  "author": { "id": "u-7", "name": "Arjun Rao", "email": "arjun@sampbidx.example", "role": "Senior bidder" },
  "text": "Feasible. We can deliver n=1,000 in 6 field days. Our feasibility note is attached.",
  "sentAt": "2026-11-24T21:14:00.000Z",
  "attachments": [{ "name": "feasibility.pdf", "contentType": "application/pdf", "data": "<base64>" }]
}
```

- `id` is your message id, and is required. **SampForce keeps one message per id**, so a retry is safe.
- Send `transferId` or `sampbidxId` (or both) for an RFQ chat. Leave both out for the general line.
- `author.name` is required. `id`, `email` and `role` are optional but help: they show beside the message and in the
  chat's people list.
- `text` up to 4,000 characters. `sentAt` is optional (ISO time).
- `attachments`: up to 5 files, base64 in `data`, 10 MB each and 20 MB in all.

SampForce answers:

| Status | Meaning |
| --- | --- |
| 200 `{"ok": true, "matched": true, "messageId": "…"}` | Shown in SampForce |
| 200 `{"ok": true, "matched": true, "messageId": "…", "duplicate": true}` | Already had that `id`; nothing new shown |
| 200 `{"ok": true, "matched": false, "messageId": null}` | No RFQ with that `transferId`/`sampbidxId`; do not retry |
| 400 | Body not readable, or a required field is missing |
| 401 | Missing, wrong or stale signature |
| 403 `CHAT_OFF` | The Console Admin has not allowed SampBidx chat for this organisation |
| 413 | Files too large |

Retry a 5xx or timeout with a fresh timestamp and signature.

When an RFQ's status changes (the status callback above), SampForce also puts a line about it in that RFQ's chat,
so there is nothing extra to send.

### SampBidx → SampForce: `GET …/callbacks/<id>/people`

The SampForce people who may chat with you: everyone active whose workspace has SampBidx chat. Sign it like the
others, with **an empty body** (`signature = "sha256=" + hex(HMAC_SHA256(secret, timestamp + "."))`).

```
GET https://<sampforce>/api/v1/apps/sampbidx/callbacks/<id>/people
X-SampBidx-Timestamp: 1763286000
X-SampBidx-Signature: sha256=<hex>
```

```json
{
  "workspace": "Frequent Research Fieldwork Solutions",
  "people": [
    { "id": "a1c…", "name": "Kunal Sharma", "email": "kunal@example.com", "role": "Owner", "workspace": "Frequent Research", "level": "SUPER" },
    { "id": "b72…", "name": "Priya Shah", "email": "priya@example.com", "role": "Sales", "workspace": "Sales UK", "level": "MANAGER" }
  ]
}
```

Only name, email, role and workspace are shared. The list is empty while chat is switched off. Read it when you need
it (for example once an hour, or when someone opens a chat) rather than storing it for good, since people come and
go.

### Chat checklist for the SampBidx team

- [ ] `POST /v1/messages` reading the `message` part and the `files` parts, keyed by `Idempotency-Key`
- [ ] Show SampForce messages on the general line or on the bid named by `sampbidxId`
- [ ] Post your team's messages to `…/callbacks/<id>/messages`, signed, with your own message `id`
- [ ] Read `…/callbacks/<id>/people` to show who in SampForce can be reached

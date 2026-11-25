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

1. In SampBidx, create an API key for SampForce.
2. In SampForce, a workspace admin opens **Integrations → SampBidx**, enters the API address and the key, and
   presses **Check and save**. SampForce calls `GET /v1/ping` once and saves only if SampBidx answers 200.
3. SampForce then shows a **status callback URL** and a **callback signing secret**. Store both in SampBidx.

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

Answer **401** or **403** for a wrong or revoked key. SampForce then marks the connection as needing a new key.

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
  "sentBy": { "name": "Rahul Verma" },
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

`market` is an ISO 3166 country code. `currency` is an ISO 4217 code. Dates are ISO 8601 in UTC. Any field except
`number`, `projectName` and the required ones above can be `null`.

## POST /v1/rfq-emails — option 2, the RFQ email itself

`Content-Type: multipart/form-data`, with these parts:

| Part | Content type | When |
| --- | --- | --- |
| `email` | `application/json` | Always |
| `message` | `message/rfc822` (.eml) or `application/vnd.ms-outlook` (.msg) | When the person uploaded the email file. It is the whole original email, its attachments included, up to 10 MB |

The `email` part:

```json
{
  "system": "SampForce",
  "workspace": "Frequent Research Fieldwork Solutions",
  "transferId": "…",
  "sentBy": { "name": "Rahul Verma" },
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
- `source: "pasted"`: the email's text, copied from a mail program and pasted on a company's page in SampForce. There
  is no `message` part and `attachmentsIncluded` is `false`. `text` is exactly what was pasted, usually including
  the From, Sent, To and Subject lines. `subject`, `from`, `to`, `cc` and `date` are read from those lines (or typed
  by the person); any of them can be `null` or empty. A `contact` object `{ "id", "name", "email" }` names the
  company's employee who sent it, or is `null`.
- `company` and `rfq` are set when the sender linked the email to a company lead or to an RFQ (same shape as above).
  A pasted email always has `company`.

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
| 401 / 403 | The key was refused; an admin must enter a new one |
| 404 | No API at that address |
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

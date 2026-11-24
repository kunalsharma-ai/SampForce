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

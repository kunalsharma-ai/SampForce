# ADR 0061: Sending RFQs to SampBidx

- Status: Accepted (built against a stand-in; SampBidx's side is not built yet)
- Date: 2026-11-16

## Context

SampBidx is Frequent Research's own bidding tool. RFQs come in to the sales team, and pricing happens in SampBidx.
Kunal asked for two ways to get an RFQ there from SampForce:

1. Fill in the RFQ's details, attach its documents, then press a button to send it.
2. Send the RFQ email itself, with no form to fill in.

SampBidx has no API yet, and Kunal will do the integration work on SampBidx's side later. So SampForce defines the
contract, sends to it, and the SampBidx team builds to it.

## Decision

- **A workspace app.** SampBidx is a workspace app like SMS through Twilio (`AppProvider.SAMPBIDX`, plan feature
  `sampbidx`, added to every stored plan once by `SHIPPED_FEATURES`). An admin enters the API address and key under
  Integrations. SampForce checks them with `GET /v1/ping` before saving, and seals the key. The address is called
  through `workspaceFetch` (ADR 0068): https on a public address, or an operator-approved private host.
- **The contract** is `docs/integrations/sampbidx-api.md`:
  - `POST /v1/rfqs` (multipart: an `rfq` JSON part and `files` parts)
  - `POST /v1/rfq-emails` (an `email` JSON part and an optional `message` part holding the original .eml or .msg)
  - Bearer auth
  - `Idempotency-Key` set to the transfer id
- **Option 1, on the RFQ**, is three steps.
  - (1) Details: SampBidx needs project name, methodology, market, sample size and deadline, and they must be saved.
    Unsaved form changes block sending, because SampBidx gets what is saved.
  - (2) Attachments: tick which of the RFQ's files go. There are at most 20 files and 40 MB in all.
  - (3) Send, with an optional note.
  - A new RFQ can be saved with "Save and add attachments", which keeps the dialog open.
  - Sending needs `companies:write` and the right to change that company (ADR 0060 visibility).
  - An RFQ already with SampBidx is only sent again when the person ticks "send another copy".
- **Option 2, the email itself**, comes from one of three places.
  - From the person's own synced mailbox. Only the mailbox owner can pick its emails. Synced mail has text but no
    attachments, so the screen says so.
  - From an .eml or Outlook .msg file they upload, up to 10 MB. The file is checked by its headers or signature,
    sent as it is with its attachments, and kept on the transfer row so a retry works.
  - Pasted, wherever the client conversation is (added 2026-11-24, Kunal: "just paste my RFQ email then one single
    click", then the "One-Click RFQ Transfer" spec). The "Capture RFQ & send to SampBidx" card is on company pages
    (top of Interactions), contact, lead and deal pages, under each inbound email in the inbox, and as the first tab
    of the RFQs page's transfer dialog. The person pastes the email text, SampForce reads subject, sender, recipients
    and date from the header lines Outlook, Gmail and Apple Mail put on a copied email (`parsePastedEmail` in
    `@dealflow/types`) and checks the client (`POST /apps/sampbidx/pasted-email/check`):
    - the page's company and contact are used (confidence `given`), and a sender who belongs to another company is
      flagged for review;
    - otherwise a contact whose address matches the sender is used (`contact`);
    - otherwise a company whose website domain matches is suggested (`domain`, never for free mail), and the person
      must press "This client is right" or pick another before sending;
    - otherwise nothing is linked (`none`), and the person picks a company or sends without one.
    No company or contact is ever created by a capture. Values that could not be read stay empty, never invented.
    One click sends it (`POST /apps/sampbidx/transfers/pasted-email`, kind `PASTED_EMAIL`, `source: "pasted"`). The
    text goes exactly as pasted. Pasted text cannot carry files, so the card warns when the email mentions an
    attachment and lets the person add up to 10 files (20 MB each, stored as `sampbidx_attachments` until sent,
    unused ones removed after a day); they go as `files` parts. The transfer keeps the text, its hash, the contact,
    the files and where it was captured (`sourceType`, `sourceId`), sent as `sourceReference` with a link back.
    The same text (ignoring spacing) already sent from this workspace is shown as "Duplicate RFQ detected" and
    refused unless the person sends another copy. It is logged as an "RFQ received" interaction on the company
    unless they untick that. The card's states are Ready to send, Check the client, Sending, Sent (only after
    SampBidx answers), Transfer failed (text kept, "Try again" resends) and Duplicate RFQ detected. Needs
    `activities:write`.
  - Every send names who sent it (`sentBy`: name, email, designation) and who looks after the client (`clientTeam`:
    POC, owner, manager), so SampBidx can show "sent by Rahul Verma, client POC Kunal Sharma" on the bid (Kunal,
    2026-11-24). A retry by someone else keeps the original sender.
  - Any of them can be linked to a company lead or an RFQ. A mailbox email whose contact belongs to a company the person
    can change is linked to that company automatically.
- **Transfers.** Every send is a `sampbidx_transfers` row with:
  - kind, title, links and files
  - delivery: SENDING, SENT or FAILED
  - attempts and the last error
  - SampBidx's id, link, status and note
  - A failed or interrupted send keeps its row. "Try again" resends with the same `Idempotency-Key`, and the request
    is rebuilt from the RFQ as it is then.
- **Status back.** SampBidx posts updates to a per-workspace callback URL.
  - The signature is `X-SampBidx-Signature: sha256=HMAC(secret, "timestamp.body")` with a 5-minute window. The secret
    is generated by SampForce, shown to admins, and can be replaced.
  - A callback moves the transfer to SENT if SampForce never saw the answer, records SampBidx's status and note, and
    notifies the sender.
  - The RFQ's own status is not changed: the sales team decides when an RFQ is won.
- **Where it shows:**
  - the RFQ dialog (the steps and earlier sends)
  - the RFQs page ("Transfer RFQ email to SampBidx" and a "Sent to SampBidx" tab)
  - the Integrations card (connection, callback URL and secret, recent activity)
  - company, contact, lead and deal pages and inbox emails (the "Capture RFQ & send to SampBidx" card)

## Consequences

- Nothing has been sent to a real SampBidx. The tests use `apps/api/test/fixtures/sampbidx-fixture.ts`, which
  follows the document. Until SampBidx implements it, connecting fails at the ping.
- A SampBidx on a private network (same LAN or VM as SampForce) is refused in production unless the operator lists
  it under console Providers > Workspace servers > Approved private hosts (`TRUSTED_PRIVATE_HOSTS`, ADR 0068). SampBidx
  calls go through the same `workspaceFetch` guard as a workspace's own AI and email servers (added 2026-11-24).
- Synced mailbox emails go without their attachments, because mailbox sync does not store attachments. The .eml/.msg
  upload is the way to send those.
- Sends are synchronous (up to 60 seconds) rather than queued. Retries are by hand.

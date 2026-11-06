# ADR 0039: SMS through the workspace's own Twilio account

- Status: Accepted
- Date: 2026-11-01
- Part of: Enhancement programme, integrations (builds on ADR 0032 and ADR 0037)

## Context

Twilio was the last integration listed as "Not available yet". Sales teams want to text contacts and see replies on
the record. The project rules forbid bulk messaging by automation or AI agents, require confirmation for actions
that reach customers, and require integrations to show Pending Configuration until they have worked for real.
SMS consent and opt-out rules (TCPA in the US, PECR in the UK, carrier rules everywhere) make consent a record, not a
flag.

## Decisions

1. **The workspace's own account and number.** Each workspace saves its Account SID, Auth Token and an SMS-capable
   number on that account. They are checked with reads (the account, then the number and its SMS capability),
   sealed, and never returned. No operator secret; Twilio subaccounts or a shared SampForce number are a later
   decision.
2. **Consent is a record.** `sms_consents` stores who recorded it, when, for which number and how the person agreed.
   Every text needs an active consent. This is stricter than WhatsApp, where an open 24-hour window allows a reply.
3. **STOP is final until START.** A STOP-type reply revokes consent, and new consent is refused until the person
   texts START, so a colleague cannot override an opt-out. This matches Twilio's own blocking (error 21610).
4. **One to one, confirmed.** The API needs `confirm: true`; the page needs a checkbox naming the number. The
   `send_sms` workflow step is external, so every run waits for approval and checks consent when it runs. It is not
   available to AI agents.
5. **Signed requests only.** Inbound texts and status callbacks are accepted only with a valid
   `X-Twilio-Signature` computed over the URL SampForce gave Twilio and the raw form fields (parsed from the raw body,
   not the framework's parser). Status only moves forward.
6. **Matching inbound texts.** Numbers are compared in E.164, only for contacts whose number has a country code, and
   linked only when exactly one contact matches; otherwise the owner of the connection is notified.
7. **Segments shown before sending.** The GSM-7 or UCS-2 segment count is computed in the shared types package and
   shown in the composer and the workflow editor; Twilio's billed count is stored after sending.

## Consequences

- Tested against a local stand-in that follows Twilio's published API only. It must be checked with a real Twilio
  account (send, reply, STOP, START, status callback) before it is called working.
- MMS, voice, short codes, Messaging Services and sender pools are not built.

# ADR 0080: Employee communication stages, RFQ contributors and sending companies to SampBidx

- Status: Accepted (built against the SampBidx stand-in; SampBidx's `PUT /v1/clients` is not built yet)
- Date: 2026-11-26

## Context

Kunal asked for three things on the company-centric CRM (ADR 0060):

1. A **Send to SampBidx** button on the company profile that sends the company as a SampBidx client (the fields of the
   SampBidx Clients screen) together with an RFQ, after a preview in four sections: company, client contact, RFQ and
   bid, pricing and commercial. The person picks the employee who shared the RFQ; the primary contact must not be
   chosen for them. Nothing may be invented (prices, taxes, discounts, prepayment), nothing may say "sent" before
   SampBidx confirms, and a failure shows the real reason with a retry.
2. Marking employees as **RFQ contributors**, by hand or from recorded RFQs, with three statuses.
3. A **communication stage** per employee: 20 built-in stages, each with its own colour that reads well in both
   themes, more can be added, no fixed order, every change in a history, plus an employee activity section with
   filters, a timeline and follow-up reminders.

The SampBidx contract (ADR 0061) only had RFQ sends. An employee already had a status (kind `EMPLOYEE`), which is a
different thing (active, left the company, and so on).

## Decision

- **Stages are a third kind of CRM status (`STAGE`)**, next to company and employee statuses, so workspaces manage
  them in CRM settings like the others (rename, recolour, reorder, deactivate, add). Each stage has a `phase` (New,
  RFQ, Follow-ups, Discussion, Calls, Negotiation, Won, Closed – not won, On hold) that the filters and automatic moves
  use, and the 20 built-in ones also have a fixed `key`. A built-in stage keeps its phase. The 20 are seeded per
  workspace on first use. The employee's stage lives on the contact (`stageId`, `stageChangedAt`, `stageChangedById`);
  each change is a `contact_stage_changes` row with from, to, source (`MANUAL`, `RFQ`, `FOLLOW_UP`, `INTERACTION`,
  `CALL_SCHEDULED`, `RFQ_OUTCOME`, `SAMPBIDX`), note, RFQ and who.
- **Colours**: each stage has one base colour. The chip is a subtle tint (light: 12 % over white; dark: 20 % over the
  dark surface) with a border and text derived from the base and darkened or lightened until text reaches 4.6:1 and the
  dot 3:1 in both themes. A unit test checks every built-in stage. No solid blocks of colour.
- **Automatic moves, forward only.** A new RFQ moves the employee who shared it to RFQ Received (this also restarts a
  closed cycle). Completed follow-ups since that RFQ move them through Follow-up 1 to 5 and Additional; a reply or
  meeting to Discussion; a scheduled call to Call Scheduled; a logged call to Call Completed; a negotiation to
  Negotiation; a SampBidx-accepted send to RFQ Sent to SampBidx. An RFQ marked won, lost or cancelled sets the matching
  stage. Automatic moves never go backwards and never take someone out of a won, lost or on-hold stage; a person can
  pick any stage at any time. Each employee is independent.
- **RFQ contributors**: Active (an RFQ in the last 90 days), Contributor (an RFQ before that, or marked by hand), No RFQ
  Received. The hand mark is stored on the contact with who and when, and shows in the history.
- **Company employee activity** on the company page lists every employee with designation, email, phone, contributor
  status, RFQ counts (total, last, won, lost, in SampBidx), stage with a picker, next follow-up and overdue, last
  activity and the assigned team member, with eight filter tiles, a stage bar, search and sort. Each employee has a
  history panel; the contact page has the same stage card and timeline (stage changes, interactions, RFQs,
  follow-ups, SampBidx sends, the contributor mark), newest first.
- **SampBidx clients**: a new transfer kind `CLIENT` sent with `PUT /v1/clients/{companyId}` (JSON, same API key,
  idempotency key and retry rules as RFQ sends). SampForce stores SampBidx's client id and contact ids in
  `sampbidx_clients` (one per company) and sends them back, so a second send updates the same client. The
  RFQ send that follows carries `client` and `contact` (the employee who shared it). If the client fails, the RFQ is
  not sent. Sending never changes the RFQ's own status.
- **Preview and completion**: the preview endpoint returns each field with its value, whether SampBidx requires it,
  whether it is missing and where it came from (a contact's country and time zone fall back to the company's). Missing
  required fields are typed in the review step and saved to the SampForce records before sending (audited), so they
  are typed once. Pricing and commercial terms are shown as "Set by the bid manager in SampBidx" and never sent.
- **RFQs** gain a service category, a service and country rows (country, target group, quota, LOI, IR, CPI, notes;
  up to 50), kept separate and sent as `lines`.
- **Duplicates**: an RFQ already accepted by SampBidx is refused (409) unless the person ticks "Send a second copy";
  the client itself is always an update.
- **Gating**: a new plan feature `rfq_contributors` (catalogue version 5, on from the free plan) covers stages and
  contributors; the Send button needs the `sampbidx` app and `companies:write`.

## Consequences

- SampBidx must build `PUT /v1/clients/{externalId}` and read the new RFQ fields before company sends work live; until
  then the client send fails with SampBidx's real answer (404) and the RFQ is not sent. The contract is in
  `docs/integrations/sampbidx-api.md`.
- Logos are not sent yet (`logoUrl` is `null`); notes stay internal.
- Exports should add the new employee columns (contributor status, stage, RFQ counts, next follow-up); that is
  coordinated with the export work (PR #134).

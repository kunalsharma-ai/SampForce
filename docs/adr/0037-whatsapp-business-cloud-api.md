# ADR 0037: WhatsApp Business through the workspace's own Cloud API number

- Status: Accepted
- Date: 2026-11-01
- Part of: Enhancement programme, integrations (builds on ADR 0032)

## Context

Sales teams want to message contacts on WhatsApp from SampForce and see replies on the record. WhatsApp's rules are
strict: a business may start a conversation only with an approved template and only with the person's opt-in, and
free-form messages are allowed only within 24 hours of the person's last message. The project rules also forbid
bulk messaging by automation and AI agents, and require confirmed and estimated events to be kept apart.

## Decisions

1. **The workspace's own number.** Each workspace saves its Cloud API phone number id, business account id, a System
   User token and the Meta App Secret. They are checked with reads (the number, and that the number belongs to the
   account), sealed, and never returned. There is no operator secret and no shared SampForce number. Business
   Solution Provider onboarding (Embedded Signup) is a later decision.
2. **Consent is a record, not a flag.** `whatsapp_consents` stores who recorded it, when, for which number and how
   the person agreed. A template needs an active consent. A STOP-style reply revokes it automatically.
3. **The 24-hour window is enforced before calling Meta**, from the time SampForce received the person's last
   message. Meta's own refusal (131047) is shown in plain words if the two disagree.
4. **One to one, confirmed.** The API needs `confirm: true` and the page needs a checkbox naming the number. The
   `send_whatsapp` workflow step is an external action, so every run waits for a person's approval, and it checks
   consent again when it runs. It is not available to AI agents.
5. **Status from signed webhooks only.** Sends are stored as "accepted". Sent, delivered, read and failed come only
   from Meta's webhook (`X-Hub-Signature-256`), and only move forward. Read depends on the person's read receipts,
   and the page says so.
6. **Matching inbound messages.** Numbers are compared as international digits, and only for contacts whose number
   has a country code. A message is linked to a contact only on a single exact match. The conversation is shown by
   number, so it appears on each contact that has it.

## Consequences

- Tested only against a local stand-in of Meta's Graph API. A real run with a test number is needed before calling it
  working.
- No media sending or downloading, no templates with media headers or button variables, no bulk or broadcast, and no
  embedded signup yet.

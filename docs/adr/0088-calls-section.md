# 0088. Calls section and "Add my dialer"

Date: 2026-11-26. Status: accepted.

## Context

People call companies and their employees all day, but there was no place to make a call from. They copied numbers into their phone or softphone, then came back and typed the outcome into an interaction by hand. The company name, the employee's name, designation, email and phone, and the company phone all had to be retyped somewhere.

## Decision

A **Calls** section at `/app/calls`, in the Workspace group of the menu, behind the `interactions` plan feature.

- **Call buttons everywhere a number lives.** The company page (hero and employee directory), the employee activity panel and the contact page have a green Call button. It opens `/app/calls?company=…&contact=…`, and the call card loads every detail from the server: company name, logo, company phone, lead number, employee name, designation, email and phone, the company's local time and whether it is a good time to call, the last call and the next planned call, and the colleagues at the same company. Nothing is retyped. Record visibility rules apply: a person who cannot see a contact's details sees the company only.
- **"Add my dialer".** Each person keeps up to ten dialers. One is their default. The built-in **Phone app** (`tel:`) always exists. A dialer is one of:
  - **a link**: a URL template with placeholders (`{phone}`, `{phoneE164}`, `{phoneDigits}`, `{companyName}`, `{companyPhone}`, `{employeeName}`, `{designation}`, `{email}`, `{employeePhone}`, `{callId}`, `{companyUrl}`). Presets cover `tel:`, `callto:` (Skype, Teams), `sip:` and a custom web dialer. `javascript:`, `data:`, `file:` and similar schemes are refused, and a phone placeholder is required. An optional webhook gets a signed `call.started` JSON post (`X-SampForce-Signature`, HMAC-SHA256, the secret is shown once and stored sealed) with all the call details, so a dialer that cannot take them in a link still receives them. The webhook goes through the public-URL guard.
  - **Twilio click-to-call**, when the workspace has connected Twilio (ADR 0039). Twilio rings the person's own phone first, then bridges to the number. Status callbacks are verified with Twilio's signature and move the call through ringing, in progress and ended, with the talk time.
- **Every call is a record** (`phone_calls`), keeping a snapshot of the details at the time of the call, the dialer used, the status, outcome, remarks, talk time, sentiment and the next call.
- **Logging reuses the company work engine (PR 139).** Saving a call with a company writes a `CALL_OUTGOING` interaction ("Call with Priya Nair: Connected") with the remarks, so it shows on the company's interactions, and plans the next call as a `CALL` follow-up for the caller. A call that did not reach anyone (no answer, busy, voicemail, wrong number) is logged as an attempt: it does not move the employee's stage or stop a follow-up cadence.
- **The page** shows today's numbers (calls, reached, talk time, next calls due), a search to find any company or employee, a keypad for any number, the call card, the live call panel for logging, the call history (mine, my team, everyone, by visibility) with filters and editing, and the next calls (overdue, today, upcoming).
- **Good time to call** is worked out from the company's time zone: weekdays 09:00 to 18:00 are good, 13:00 to 14:00 is lunch. When the shared time-zone check lands, the card can switch to it.

## Consequences

- Calls placed from a link dialer cannot report back on their own; the person logs the outcome. Twilio calls fill in the status and talk time.
- Dialer links open with `window.open`, so a desktop softphone registered for `tel:` or `callto:` takes over.
- Numbers on the keypad or typed in are kept as "other" calls and are not tied to a company unless one is picked.

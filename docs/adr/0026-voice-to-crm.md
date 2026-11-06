# ADR 0026: Voice notes suggest CRM actions; a person confirms each one

- Status: Accepted
- Date: 2026-10-31
- Part of: Enhancement programme, Phase 3 (feature 12)

## Context

Feature 12 asks for voice-to-CRM: a salesperson speaks a note ("follow up with Priya tomorrow at 3 pm, add a lead,
summarise my last call") and SampForce turns it into tasks, notes and records, in more than one language. SampForce
already had Deepgram transcription for meeting recordings (ADR 0023, Pending Configuration until a live call
succeeds), the AI agent layer with run records and credits, and the normal task, activity, lead and contact services.
The standing rule is that sensitive or irreversible CRM actions are never executed without the person's confirmation.

## Decisions

1. **One speech service, one key.** Recordings use the existing `DeepgramClient` and `DEEPGRAM_API_KEY`. The voice
   panel shows the same state as meetings: Pending Configuration with no key, Configured not yet verified, and
   Verified only after a successful transcription in the workspace (meeting or voice note). Typing a note always works.
2. **Audio is never stored.** The browser records with MediaRecorder, the API streams the body to Deepgram (25 MB
   cap) and keeps only the transcript, detected language and duration. Each recording needs the person to tick that
   everyone on it agreed to transcription; the API rejects uploads without `consent=true`.
3. **Languages.** The person picks a language or "Detect automatically" (`detect_language=true`). The detected
   language is shown. The AI writes suggestions in the language of the note.
4. **The AI only suggests.** A new `voice_assistant` agent (fast tier) returns a summary, up to ten actions of four
   kinds (task, note on the record, new lead, new contact), whether the last call was asked for, and a list of things
   it will not do. Nothing is written until the person ticks, edits if needed, and saves. Saving runs each action
   through `TasksService`, `ActivitiesService`, `LeadsService` and `ContactsService`, so the normal permissions,
   validation, duplicate checks, automation triggers and audit apply. Each action can be saved once and cannot change
   kind; editing the note after anything is saved is refused.
5. **No invented details.** The server drops emails and phone numbers that do not appear in the note, clears dates
   outside yesterday to about thirteen months ahead, and says why on the item. "Summarise my last call" shows the
   newest saved meeting summary or logged call/meeting activity for the record; it is never generated. If there is
   none the panel says so.
6. **Out of scope by design.** Deleting records, sending email, and changing amounts, stages or owners are listed under
   "Not done from a voice note" and never executed. "Schedule a meeting" becomes a task marked as a meeting; no
   calendar invite is sent.
7. **Voice notes are personal.** A note is visible only to the person who made it (other members get 404); what they
   save from it is shared like any task or note. Viewers cannot use voice notes (they need `activities:write`).

## Consequences

- Live Deepgram transcription is still untested with a real key; the voice panel stays Pending Configuration until
  a key is set. AI suggestions in tests come from the fixture, not a real model.
- Times are saved in the person's own time zone (the browser sends its offset); the AI is given the person's date.
- There is no wake word or always-on listening. Recording starts and stops only on a button press.

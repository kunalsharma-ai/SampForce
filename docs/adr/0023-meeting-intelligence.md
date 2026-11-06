# ADR 0023: Meeting intelligence is a reviewed record, not an automatic note

- Status: Accepted
- Date: 2026-10-31
- Part of: Enhancement programme, Phase 2d (feature 7)

## Context

Feature 7 asks for Google Meet, Zoom and Teams meetings, recording and transcript processing, speaker
identification, summaries, key points, requirements, objections, decisions, action items, commitments, automatic
tasks, follow-up emails and CRM updates. SampForce already synced calendar events with known contacts and had a
one-shot "summarise meeting notes" dialog. This replaces that dialog with a meeting record that a person reviews.

## Decisions

1. **One meeting record per meeting.** `meeting_records` holds the notes or transcript, speaker segments, the AI
   reading and its review state. It can belong to a synced calendar meeting (one record per meeting) or stand
   alone for a call that was not in a calendar. It links to a deal, contact or lead.
2. **Meeting platforms come from the calendar.** Google events give `hangoutLink` or `conferenceData`, Graph events
   give `onlineMeeting.joinUrl`, and either may put a Zoom link in the location. SampForce stores the link, labels it
   Google Meet, Zoom or Teams, and shows a Join link. There is no Zoom, Meet or Teams API integration and no bot
   that joins calls. Recordings come from the person, who downloads them from their meeting tool.
3. **Recordings are transcribed by Deepgram, streamed and not stored.** The upload is streamed straight to
   Deepgram's pre-recorded API (`nova-3`, diarisation, utterances) and the audio is never written to disk or the
   database. The uploader must confirm that everyone agreed to the recording; the confirmation and who gave it are
   stored and audited. Without `DEEPGRAM_API_KEY` the feature shows **Pending Configuration** and returns
   `409 PENDING_CONFIGURATION`. With a key and no successful transcription yet it shows "Configured, not yet
   verified". It shows "Verified" only after a transcription succeeded in that workspace. Tests use a local stand-in;
   it has not been run against Deepgram with a real key.
4. **Speakers are numbered, then named by people.** Deepgram reports speaker numbers. The AI may propose a name
   when someone says who they are ("I'm Priya"). Names are never looked up elsewhere, and people correct them.
5. **AI proposes, a person reviews.** Analysis fills a structured reading validated by a schema. Until a person
   saves a reviewed version, nothing goes onto the CRM: no tasks, no timeline note. Analysing again resets the
   review. Creating tasks and adding the summary to the record are separate, explicit buttons.
6. **Follow-up emails are drafts.** The follow-up opens in the normal compose box, sent from the person's own
   mailbox only when they press Send.

## Consequences

- The old `/ai/meeting-notes` endpoint stays for API callers; the screens use meeting records.
- Recording size is capped by `MEETING_UPLOAD_MAX_MB` (default 100).
- Live meeting capture and real-time transcription are not built.

# ADR 0034: Zoom meetings scheduled from records, with transcripts imported only for those meetings

- Status: Accepted
- Date: 2026-11-01
- Part of: Enhancement programme, integrations (builds on ADR 0032)

## Context

Sales teams want two things from Zoom:

1. Schedule a Zoom meeting from the deal, contact or lead they are working on, and have it logged on that record.
2. Get the call's transcript into meeting notes without paying for transcription twice.

Zoom transcripts come from cloud recordings, which is sensitive data, and an account-level Zoom app can see every
meeting in the company.

## Decisions

1. **The workspace connects once.** The workspace connects one admin-managed Zoom General app (ADR 0032's
   `app_connections`, with provider `ZOOM` and the Zoom account id as the external id). Meetings are created with
   `POST /users/{email}/meetings` for the signed-in person's DealFlow email, so they belong to that person in Zoom.
2. **Only DealFlow's own meetings are read.** `zoom_meetings` records each meeting scheduled here.
   `recording.transcript_completed` events are matched against that table, and only rows where the organiser chose
   recording are imported. DealFlow never lists or downloads other meetings' recordings.
3. **Consent is explicit.** Choosing cloud recording needs the organiser to confirm that participants agree. This is
   recorded in the audit log and on the meeting notes, in addition to Zoom's own recording notice.
4. **Events are authenticated by signature only.** The check uses Zoom's v0 HMAC with a 5-minute window, and the
   endpoint URL validation challenge is supported. A Zoom account connected to several workspaces routes each event
   to the workspace that owns the meeting, through the `provider_lookup` policy.
5. **Imports are queued.** The event only stores the sealed download link. The worker claims rows with a status
   change from `ready` to `importing`, so only one worker takes each, and retries up to 3 times. Expired links fail
   at once with a reason.
6. **Tokens are refreshed under a row lock.** Zoom rotates refresh tokens, so two concurrent refreshes would lock
   the workspace out.

## Consequences

- Zoom calls do not need Deepgram. Their transcripts flow into the same meeting notes, AI summary and review as
  uploaded recordings.
- People who are not users in the connected Zoom account cannot schedule from DealFlow. They are told why.
- Zoom is tested only against a local stand-in of its documented API until real app credentials are added.

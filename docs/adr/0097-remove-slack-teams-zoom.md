# 0097: Remove the Slack, Microsoft Teams and Zoom workspace apps

Date: 2026-11-27. Status: accepted. Supersedes ADR 0032 (for Slack), 0033 and 0034.

## Context

Kunal asked for the Slack, Microsoft Teams and Zoom cards under Integrations, Workspace apps to be removed. All three
were built against local stand-ins only and were never connected to the real services.

## Decision

The three apps are removed completely, not hidden:

- **Workspace apps:** the Slack, Microsoft Teams and Zoom cards, their API routes (`/apps/slack/*`, `/apps/teams/*`,
  `/apps/zoom/*`, including the Zoom event webhook) and their clients are gone. `APP_KEYS` now lists DocuSign, card
  payments, WhatsApp, SMS (Twilio) and SampBidx. The OAuth connect flow serves DocuSign only.
- **Workflows:** the "Post to Slack or Teams" step (`post_to_chat`) is no longer a step type. A definition that
  contains one is refused.
- **Records:** the Zoom meetings card on leads, contacts and deals is gone, and the worker no longer imports Zoom
  transcripts. Meeting notes and activities already made from Zoom meetings stay.
- **Operator console:** the Slack and Zoom provider entries, their keys (`SLACK_*`, `ZOOM_*`), connection tests and the
  Zoom webhook receipt are gone.
- **Plans:** the `slack`, `teams` and `zoom` plan features are gone.
- **Help and translations:** help topics, FAQs and phrases that named these apps were changed or removed.

Kept on purpose: recognising Zoom and Teams links on calendar events (the meeting platform label and Join button), and
any Zoom or Teams presets of the personal dialer (Calls). Neither talks to those services.

## Data

`removeChatAndMeetingApps` runs with the database set-up on every deploy and is idempotent. It deletes the SLACK,
TEAMS and ZOOM app connections and their app events, drops the `zoom_meetings` collection, deletes the Slack and Zoom
console keys, check results, environment-import markers and the Zoom webhook receipt, takes the three features out of
stored plans and per-workspace overrides, and removes "Post to Slack or Teams" steps from saved workflow versions.
Arrows that pointed at a removed step now point at the step after it; a wait left with nothing after it goes too; a
run waiting on a removed step moves on to the next one. Without this, Prisma could not read the old rows (their enum
values are gone) and saved workflows with the step would no longer parse.

## Consequences

- Deployments can delete `SLACK_*` and `ZOOM_*` from their settings; nothing reads them now.
- Teams that relied on workflow posts to Slack or Teams can use in-app notifications or a signed outbound webhook step
  instead.

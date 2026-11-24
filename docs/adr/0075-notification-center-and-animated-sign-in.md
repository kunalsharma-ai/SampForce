# 0075: Notification Center and animated sign-in

Status: accepted (2026-11-23)

## Context

Kunal asked for one notification system across the Console, the Super, Manager and Executive Workspaces and the phone
app, reached three ways (the bell, the home dashboard and the section a notification comes from), with an optional
pleasant sound, plus a distinct animated SampForce-red sign-in and welcome for each level.

The workspaces already shared one `notifications` collection (written by `NotificationsService.send`) but the bell
polled every 30 seconds, had no history, no sound, and nothing appeared on the dashboard or in sections.

## Decision

- **One store, more ways to read it.** Each notification now records its `section` (the page its link opens, else its
  type: `NOTIFICATION_SECTIONS` in `packages/types/src/notification-center.ts`). Older rows without one are matched by
  their link. New routes: `GET /notifications` pages history by filter (all, unread, action), section or exact page;
  `GET /notifications/summary` gives unread, action-required and important counts and counts per section;
  `POST /notifications/read` takes ids, `all` or a section; `POST /notifications/:id/unread`.
- **Live without a socket.** `GET /notifications/wait?after=&wait=25` holds the request until something newer exists.
  It is an ordinary request, so it passes self-hosted nginx gateways (the chat SSE lesson of ADR 0069). One browser tab
  holds it (Web Locks) and shares the result over a BroadcastChannel.
- **Sound.** A two-note chime made with Web Audio (no file), quiet by default, brighter for urgent and action-required
  items. It plays once per notification, in one tab, never for what existed when SampForce opened, and waits for the
  browser to allow audio. Personal preferences (`notification_preferences`: sound, volume, muted categories, browser
  notifications) follow the person everywhere, including the phone.
- **Three places.** The bell (swing and badge pop on arrival, All/Unread/Action required), a Notifications card on the
  Command Center, a red count beside each sidebar section and a strip at the top of the section's page (or the unread
  notifications about one record on its page). The history page `/app/notifications` holds the settings.
- **Brand red.** `--sf-red` (#E02424, the logo's red) is used for notifications and sign-in whatever theme is chosen.
- The Console keeps its own operator notifications (ADR 0074, C3b); it gets the same look in a later PR.

## Consequences

- Leave Management and HR sections from the request do not exist in SampForce, so they have no section yet.
- The chime and browser notifications cannot be heard or seen in CI; the browser test replaces Web Audio with a counter.

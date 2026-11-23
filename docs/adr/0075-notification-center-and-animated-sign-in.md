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

## Animated sign-in (N2)

- `components/sign-in/`: one scene per level (`console`, `super`, `manager`, `executive`) behind the sign-in pages,
  in the logo's red, deep red and amber. `AnimatedMark` reuses the logo's exact shapes (`LOGO_PARTS` in
  `components/logo.tsx`): the two halves fly in and lock, a flash and a light sweep cross the mark, the spark pops.
- Each level is its own world so nobody mistakes one for another (redesigned twice on Kunal's request, 2026-11-24).
  The page greets the person ("Good evening 👋 Welcome to **Manager Workspace**", by this device's clock) and
  names the level in bold again on the sign-in box. Each level's main animation runs on its own stage beside the
  words, never under them; the full-screen backdrop stays quiet. Console (Sampledge staff only): a command center
  with a 3D grid floor and a security radar round a lock. Super: a crimson galaxy, the company as a crowned sun with
  workspaces orbiting it. Manager: a sunrise, the team's honeycomb lighting up in waves, a team-target gauge, a
  heartbeat line. Executive: bright red speed, the SampForce bolt launching, deal cards popping, a confetti peak.
- The sign-in box has a light running round its edge, the level's emblem with a turning ring, fields with icons and a
  glowing focus, a sign-in button with light sweeping across it, and a "secure, encrypted sign-in" line.
- A small bar on every sign-in page switches light or dark and picks a palette (SampForce red, Royal rose, Ocean
  blue, Emerald, Sunset amber), remembered on this device only (`localStorage sampforce:sign-in-style`). The card
  carries its own colour tokens for the chosen mode and palette, whatever the app's theme. Palettes other than red
  recolour the artwork with a hue rotation (none is applied for red). In light mode the animation sits on a dark
  glass screen so its light lines stay visible.
- The form is on an opaque card, usable from the first frame; the scene is `aria-hidden` and never takes clicks.
  The card uses SampForce red for its buttons and links whatever theme is chosen (contrast checked in light and dark).
- `/login` picks the scene from `?workspace=super|manager|executive`, else the level this device last opened
  (`localStorage sampforce:last-level`), else Executive. After signing in, a ~1.7 s welcome for the workspace actually
  opened plays once (sessionStorage flag set by the form), skippable by any key or click.
- CSS and SVG only, transforms and stroke offsets. Under reduced motion every animation and delay collapses to its
  final frame (checked: no running animations, axe clean).

## Part 4: the phone app

The phone uses the same notification store and routes (they already allowed the phone through `@MobileModuleAccess('notifications')`).

- **One summary**: `NotificationCenterProvider` (apps/mobile/src/lib/notification-center.tsx) asks for `/notifications/summary` every 20 seconds while the app is open, and again whenever the app comes back. The phone does not hold a long-poll, because phones suspend background requests.
- **What the summary feeds**:
  - The bell in every header, with its count.
  - The tab badges, one per module that matches a notification section (Tasks counts tasks, Follow-ups counts follow-ups; Notifications counts everything).
  - A notifications card at the top of the home screen.
- **Something new**: an animated banner slides down. The sound is the phone's own notification sound, played through a local notification. It plays only when the person's chime is on and that category isn't muted, and only when the phone doesn't already get push notifications, so the sound never plays twice.
- **Sign-in**: the sign-in screen opens on the scene of the level this phone last used (Executive the first time). Each level has its own scene drawn with plain views and `Animated`: Super is a crowned sun with orbiting planets, Manager is the team circling its lead, Executive is a rocket with rising deals.
  - The greeting names the workspace in bold.
  - The password has an eye button, named "Show characters" so that the label "Password" still finds only the field.
  - "Forgot your password?" opens the server's web page.
  - A wrong password shakes the box and shows a red cross; the right one draws a green tick.
- **Welcome**: after signing in, a 2.8-second welcome plays: the level's scene, "Welcome back, {name}" and a progress bar. Under reduced motion it lasts 0.9 seconds. A tap skips it.
- **Tests**: covered by `apps/web/e2e/mobile-notifications.spec.ts` and `apps/mobile/test/notification-center.test.ts`.

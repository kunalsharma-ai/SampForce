# ADR 0072: The SampForce mobile app, and who decides who may use it

**Status:** accepted (2026-11-22). M1 of the mobile plan; later parts extend this ADR.

**Context.** Kunal asked for a premium iPhone and Android app that is an extension of SampForce, not a second CRM:
same accounts, data, permissions and business rules. The Console Admin (the operator console) decides whether a
client organisation may use the app at all; the client's Super Workspace decides how the app looks and what it
shows; Manager and Executive Workspaces (ADR 0071) get only what they are given. Mobile access must be separate from
web access, and nothing about it may be enforced only in the app. Plan doc:
https://claude.ai/artifact/P7ae36uT6ywiYt8rqZbF85.

**Decision.**

- **One app, built with Expo (React Native)** in the monorepo as `apps/mobile` (from M3), using `@dealflow/types`.
  It is one official store identity; organisations brand it after sign-in. Super Workspaces cannot publish their own.
- **Three gates, checked by the API on every phone request** (`apps/api/src/mobile/mobile-gate.ts`):
  1. The plan includes the new feature `mobile_app` (on every plan by default, shipped to stored plans once by
     `SHIPPED_FEATURES`; the Console can take it off a plan or a client).
  2. The Console has approved the organisation: `MobileAccess.status` is `APPROVED`. Statuses are `OFF`,
     `REQUESTED`, `APPROVED`, `REJECTED`, `SUSPENDED`, `REVOKED`. Approving needs no request ("enable"); approval
     needs the plan feature. Every decision needs a reason, which the client sees, and is written to the platform
     audit log and the workspace's own audit log (actor `PLATFORM_ADMIN`). Only console ADMINs decide.
  3. The Super Workspace has switched it on (`MobileAccess.activatedAt`). Until ADR 0071's levels land, "Super
     Workspace" means a person with `tenant:manage`.
- **A third session channel.** Phones sign in at `POST /mobile/auth/login` (+ `mfa/verify`) with the same password,
  lockout and second-factor rules as the web. The session row is marked `client = MOBILE` with its `deviceId`; the
  refresh token comes back in the body for the phone's secure storage and refreshes only at `POST /mobile/auth/refresh`
  (a web cookie refresh refuses it, and the phone route refuses a web token). The access token is the usual JWT.
  The guard sets `via: 'mobile'` and lets a phone reach only routes marked `@MobileAccess()`, like the browser
  extension's allow-list, so a modified app or hand-made request reaches nothing else.
- **Immediate effect.** On every phone request the guard re-checks the three gates and that the phone is still
  signed in (`MobileDevice.signedOutAt` is null), so access tokens issued before a change stop working at once.
  Refusals carry `MOBILE_ACCESS_BLOCKED` with the reason in `details` (`NOT_IN_PLAN`, `NOT_APPROVED`, `SUSPENDED`,
  `REVOKED`, `NOT_ACTIVATED`, `WORKSPACE_SUSPENDED`); a refresh reports the reason even for an ended session, so the
  app can say why. Suspending only blocks (reinstating restores everything as it was); revoking and the Super
  Workspace switching mobile off sign every phone out. Web access and data are never touched.
- **Devices.** `MobileDevice` is one row per person, organisation and app install (`installId`, random, kept by the
  app). One live session per phone. The organisation sees its phones with names and can sign any out; the Console
  sees counts, platforms and app versions, and names only while the organisation grants support access (the existing
  rule that operators do not read member data otherwise). The Console can cap phones per organisation.
- **Not supported yet:** single sign-on on phones (SSO-enforced workspaces are told to use the browser), enrolling
  two-step verification on the phone (workspaces that require it ask people to turn it on in the browser first).

**Consequences.** Every new mobile screen needs its routes marked `@MobileAccess()` and tested with a phone token;
everything else stays closed to phones by default. Field-level rules (M2) and the hierarchy's feature and action
checks (ADR 0071) are applied on top of this, never instead of it.

## M2: the Mobile Configuration Center (2026-11-22)

- **Draft, publish, versions.** `MobileConfig` holds one draft per organisation; publishing copies it into a numbered
  `MobileConfigVersion`, which is what phones get. Rolling back publishes an older version again as a new number
  (`restoredFrom`), so history is never rewritten. Until the first publish, phones get the built-in default (version
  0). Saving, discarding, publishing and rolling back are written to the workspace audit log. Routes:
  `/mobile-config` (GET, `PUT/DELETE draft`, `POST publish`, `POST rollback`), `tenant:manage` and the `mobile_app`
  feature, web only.
- **One configuration shape** (`packages/types/src/mobile-config.ts`): branding (app name, colours, theme, a logo kept
  as a data URL up to 250 KB), modules, field rules per module, field and level (view, edit, set on new, clear), record
  rules per module and level (view, create, edit, delete), dashboard cards per level in order, up to 5 bottom tabs per
  level, chat, notification types, profile pictures and phone actions. `normalizeMobileConfig` makes it consistent
  (view is the floor, read-only fields never change, required fields always show, cards only for levels they suit),
  the same way on the web and the API.
- **Resolved per person.** `resolveMobileConfig` narrows the published version to the person's level, plan features
  and role permissions; the phone gets only that (`GET /mobile/config?known=<version>`, which answers `unchanged`
  when the phone is up to date; `GET /mobile/session` carries `configVersion`). The web preview uses the same function.
- **Field rules on the server.** `apps/api/src/mobile/field-policy.ts` strips fields a person may not see from every
  record a phone route sends (`mobileReadable`) and refuses writes to fields they may not set or clear
  (`checkMobileWrite`, `MOBILE_FIELD_NOT_ALLOWED` with the fields in `details`) or record actions their level may not
  take (`MOBILE_ACTION_NOT_ALLOWED`). M4's record routes must use them; hiding a field in the app is never the control.
- **Level.** The person's workspace (ADR 0071) decides the level: a membership placed in a Manager or Executive
  workspace works at that level, and one with no workspace node (the owner, admins) is Super. The workspace's features
  and allowed actions narrow the configuration further, so a module the workspace may only view cannot be changed on
  the phone either.

## M3: the app foundation (2026-11-23)

- **Stack.** Expo SDK 58 (React Native 0.88, Expo Router) in `apps/mobile`, sharing `@dealflow/types` with the API and
  web. One official app identity: name SampForce, bundle and package id `com.sampledge.sampforce`. Organisation
  branding (name, logo, colours, theme) applies after sign-in, from the published configuration.
- **Sign-in and tokens.** `/mobile/auth/login`, `/mfa/verify`, `/refresh`, `/logout` and `/switch-workspace`. Tokens
  live in the Keychain or Keystore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, never backed up); a random install id keeps one
  phone as one device row. One refresh at a time, so a rotated refresh token is never sent twice. A 401 on refresh
  signs the phone out; a block (403 `MOBILE_ACCESS_BLOCKED`) keeps the tokens, so reinstating carries on.
- **Server address.** Defaults to `extra.apiUrl` in `app.json`; organisations on their own server can change it at
  sign-in. HTTPS only, except localhost and the Android emulator.
- **Configuration.** The app keeps a copy of its resolved configuration keyed by organisation, person, level, role and
  permissions, and asks `GET /mobile/config?known=N` only when `configVersion` in the session moves or the key changes.
  Returning to the app reloads the session, so blocks and new versions show at once.
- **Screens.** Bottom tabs in the order the Super Workspace chose, More for the rest, Help (`GET /help`) and the
  person's support questions (`/support/tickets`, marked `@MobileAccess()`), Profile with organisation switching and
  sign-out. No Recent list anywhere. Record modules say plainly that their screens arrive in the next update (M4 to M8)
  and show what the person will be allowed to do there.
- **Languages.** The app's own phrases are in `src/lib/phrases.ts` (es, fr, de, ar; shared phrases reuse the web's
  translations); server messages arrive translated through `accept-language`.
- **Tests.** Unit tests for the API client, configuration copy, session states and phrases (`pnpm --filter
  @dealflow/mobile test`). `pnpm build` makes a web export that `apps/web/e2e/mobile-app.spec.ts` drives at phone size
  against the real API. Native builds, the Keychain and store review cannot be tested in CI.
- **Web packages and React Native.** `.pnpmfile.cjs` drops React Native as an optional peer of the 3D chart packages,
  so the web app never resolves React Native.

## M4: records on the phone (2026-11-23)

- **Routes.** `/mobile/records/options`, `GET /mobile/records/:module`, `GET|PATCH|DELETE /mobile/records/:module/:id`
  and `POST /mobile/records/:module`, for `companies` (leads), `contacts`, `follow_ups` and `tasks`. Deals follow
  separately. All are `@MobileAccess()`; anything else under `/mobile/records` is 404.
- **The web's own services.** Every call goes through `CompaniesService`, `ContactsService`, `CompanyWorkService` and
  `TasksService`, so visibility down the hierarchy, ownership, audit, numbering and notifications are exactly the
  web's. The phone layer only renames fields (MOBILE_FIELDS names such as `owner`, `company`, `followUpType` to the
  services' `ownerId`, `companyId`, `type`), validates with the CRM's own zod schemas (errors come back under the
  phone's names), and applies the field rules: records are narrowed to the fields the person may see, and a write to
  a field they may not set, or a clear without the delete rule, is refused with `MOBILE_FIELD_NOT_ALLOWED`. A module
  that is off for the person answers `MOBILE_MODULE_OFF`, even for an empty list.
- **Follow-ups and tasks.** Both live in the task table; the tasks list leaves follow-ups out and a follow-up id is not
  a task. A follow-up's status changes only to `DONE` (with an outcome) or `CANCELED`, as on the web, and "delete"
  cancels it. Lists are the person's own (`scope: mine`), follow-ups by the web's buckets in the phone's time zone.
- **Custom fields.** `options` returns the custom fields the configuration shows for each module, with the web's own
  field access deciding whether the person may edit them; formula and file fields are read only on the phone.
- **Screens.** Each record module is a stack inside its tab: list (search, buckets or open/done, more on request,
  refreshed whenever it comes back into view), record page (fields for the level, call / WhatsApp / email /
  directions as the configuration allows, mark done, cancel, edit, delete with an inline confirmation, a lead's
  contacts and quick add), and one form for add and edit that offers only the fields the person may set and sends
  only what changed. Dates are typed (`2026-12-01 14:30`) or picked (later today, tomorrow, next week); a native
  date picker can come with the store builds.
- **Brand colour as text.** `primaryText` in the theme is the brand colour moved just far enough towards black (or
  white in dark mode) to read on cards, used for the active tab, so any brand colour passes WCAG AA.

## M5: home screen figures and targets (2026-11-23)

- **Routes.** `GET /mobile/dashboard?period=TODAY|WEEK|MONTH|QUARTER` and `GET /mobile/targets`, both `@MobileAccess()`.
- **Same numbers as the web.** The dashboard reuses the web's level dashboard (ADR 0071 part 6: organisation,
  team or day), the targets page and the CRM task and pipeline lists, so every figure matches what the web shows.
  Only the cards the configuration chose for the person's level are built, and only what they need is loaded.
- **Cards.** Each card carries headline numbers, bars or a short list, and target progress. A card that has nothing
  to count says so in one plain sentence (no target set, no pipeline). Tapping a card opens the module behind it when
  the person has that module. Deal amounts on the pipeline card follow the deals `amount` field rule, so Executives
  see counts only by default. `showChart` decides whether the bars are drawn.
- **Announcements.** SampForce has no announcements feature yet; the card says where they will appear. They come with
  notifications (M8).
- **Targets screen.** Read only, with achievement per target; targets are still set on the web.
- **Reloading.** `useApi().reload` is now stable, so screens reload whenever they come back into view without
  looping.

## M6: profile photos (2026-11-23)

- **Storage.** `UserPhoto` (collection `user_photos`), one per person and kept apart from the user so lists never
  load image bytes. The same photo is used in every organisation the person belongs to.
- **Routes.** `PUT /me/photo` (the image is the raw body: PNG, JPEG or WebP, 64 to 4096 pixels, up to 1 MB, checked
  by its bytes, not its name or header), `DELETE /me/photo`, and `GET /people/:id/photo`. All work from the web and
  the phone. A photo is served only to the person and to active members of the caller's organisation, with
  `nosniff`, a sandboxing CSP and a long private cache (the URL carries a version). Setting and removing are audited.
- **Hiding photos.** When the organisation's Mobile Configuration turns profile pictures off, phones get 404 for
  other people's photos (and show initials); the person's own photo and the web are not affected.
- **Where it shows.** `/auth/me` and `/mobile/session` carry `photoUrl`. The web shows it in the account menu and
  lets the person set it on Account security; the phone shows it on the home screen and Profile, where it can be
  chosen from the library or taken with the camera. Both crop the centre square and shrink to 512 pixels JPEG before
  sending. Chat (M7) uses the same URLs.
- **Packages.** `expo-image-picker` (with photo and camera permission texts in `app.json`) and
  `expo-image-manipulator`.

## M7: chat on the phone (2026-11-23)

The phone uses the web's team chat (ADR 0069) as it is: the same conversations, people rules (ADR 0071 part 5),
read and delivered marks and live events. There is no second chat back end.

- **Access.** `ChatController` is marked `@MobileModuleAccess('chat')`: a phone token reaches it only while the
  person's published Mobile Configuration has the chat module and the chat switch on, otherwise `MOBILE_MODULE_OFF`.
  Web sessions are not checked by it. The guard (`mobile-module.guard.ts`) is reusable for other modules.
- **Live.** The phone asks for a socket ticket and opens `wss://<server>/api/v1/chat/socket` (a native app sends no
  Origin header, which the socket already allows). For a phone session the socket's periodic check also requires
  mobile access to be live, the phone not signed out, and chat still on in its configuration, so switching chat off
  closes open phone sockets. After two sockets that never open, the app uses the `/chat/events` catch-up route.
  Events are handed to the screens once, by their `sid`.
- **Screens.** Conversations (newest first, unread counts, the other person's photo), a conversation (grouped
  bubbles, "Sending / Sent / Delivered / Read" under the person's last message, "is writing…", older messages on
  scroll, a failed send can be tapped to try again with the same `clientId`), and New message (the people the
  person may write to, with photos and who is online). Opening a conversation marks it read; loading the list marks
  messages delivered.
- **Photos.** `ChatPerson` carries `photoUrl` (M6), in members, authors and the people list.
- **Left for later.** Sending attachments and editing or deleting messages stay on the web for now; the phone shows
  attachment names, edits and deletions.

## M8: push notifications and announcements (2026-11-23)

- **One path for every notification.** `NotificationsService.send` (the web's bell) also queues a phone notification
  when the web type has a phone type (`MOBILE_PUSH_TYPE_OF`: tasks and follow-ups assigned, due soon and overdue,
  leads assigned, targets set, announcements, billing status). Chat messages queue one for the other members. The
  queue (`MobilePush`, collection `mobile_pushes`) is written in the same transaction as the change, and only for
  people who have a signed-in phone with a push token, so most events store nothing.
- **Sending.** The worker sends due pushes through Expo's push service (`EXPO_PUSH_URL`), which passes them to Apple
  and Google with the credentials kept in the Expo project. Each push is checked again when it goes: mobile access
  live, the person still an active member, and their level's published Mobile Configuration sending that type (and
  chat on, for chat). Otherwise it is SKIPPED with the reason. Network failures retry with back-off, five times. A
  token Apple or Google reject (`DeviceNotRegistered`) is removed from the phone's row. Titles are translated into
  the person's saved language. An optional `EXPO_ACCESS_TOKEN` (Console > Providers > Phone notifications) is sent
  when the Expo project uses enhanced push security.
- **The phone.** `GET/PUT/DELETE /mobile/push` (phone sessions only) read, set and clear this phone's token; a token
  also on another row in the organisation (a shared phone) is let go. Profile has "Turn on notifications", which asks
  the system for permission only when pressed. At start the app sends its current token again if notifications are
  on. A tap opens the screen in `data.route` (`mobileRouteFor` maps the web link), or Notifications. The Notifications
  screen shows the same list as the web's bell (`/notifications`, now open to phones while the configuration has the
  notifications module), with mark as read.
- **Task reminders.** The reminder sweep (ADR 0062) now also covers tasks with a due date (`task.due_soon`,
  `task.overdue`), with the follow-up timing settings and categories.
- **Announcements.** `Announcement` (collection `announcements`); `GET /announcements` for everyone (web and phone),
  `POST` and `DELETE` for `tenant:manage`, audited. Posting notifies every active member (`announcement.posted`,
  category "Important announcements"). The web page is `/app/announcements`, linked from Settings; the phone's
  announcements card shows the latest three.
- **Not testable here.** Real delivery needs the Expo project with the APNs key and the FCM service account, and a
  real phone (simulators and the web build cannot get push tokens). The server side is tested against a stand-in of
  Expo's push service.

## M9: ready for the App Store and Google Play (2026-11-23)

- **One identity.** Name SampForce, bundle id and package `com.sampledge.sampforce`, phones only (`supportsTablet:
  false`, so no iPad screenshots or review), `ITSAppUsesNonExemptEncryption: false` (HTTPS only, so no export
  paperwork for each build).
- **Icons and splash.** `scripts/make-store-assets.mjs` renders the web's `icon.svg` into the App Store icon (1024,
  no transparency, as Apple requires), the Android adaptive icon foreground, the splash image and the white Android
  notification icon. Run it again after the logo changes.
- **Permissions.** Only the camera and photos (profile picture, with the reason shown) and notifications. The
  microphone, location, storage and draw-over-apps permissions that libraries add are blocked on Android. The iOS
  privacy manifest declares the system APIs React Native and Expo use, and no tracking.
- **Privacy.** A public page `/app-privacy` on the web says what the app uses, where it goes and how to remove it;
  the app links it from Profile (`extra.privacyUrl`). The app makes no accounts, so account deletion is the
  organisation removing the person (Apple's rule applies to apps that create accounts).
- **Builds.** `eas.json`: `preview` (internal, Android APK for testers) and `production` (store builds, build
  numbers kept by EAS and raised on each build); `eas submit` sends the Android build to the internal track as a draft.
- **Checked before a build.** `test/store.test.ts` reads `app.json`, `eas.json` and the PNG headers, so a missing
  icon, a transparent App Store icon or a missing permission reason fails in tests rather than in store review.
- **Left for the owner.** Apple and Google developer accounts, `eas init` (the project id that push needs), the APNs
  key and FCM service account in Expo, store screenshots from a real build, the listing, and a reviewer sign-in.

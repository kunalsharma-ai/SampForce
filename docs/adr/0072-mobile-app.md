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

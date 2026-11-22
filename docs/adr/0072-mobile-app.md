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

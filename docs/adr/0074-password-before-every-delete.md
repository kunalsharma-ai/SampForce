# ADR 0074: A password check before every delete

**Status:** accepted (2026-11-23). Part W1 of the workspace structure, permissions and security redesign. Spec doc:
https://claude.ai/artifact/XR39A98XhRqbovs9dqjYmb.

**Context.** Kunal asked that every destructive action, at every level (Console, Super, Manager and Executive
Workspaces), asks for the person's password first, and that the backend enforces it rather than the screen alone.
Refused and failed attempts must be in the audit log with their status.

**Decision.**

- **A one-time pass.** `POST /auth/confirm-password` takes the password (or, for single sign-on people, a two-step
  code) and returns a pass that lasts 5 minutes, is bound to the person and the session, and works once. Only a
  SHA-256 hash is stored (`PasswordConfirmation`). The pass goes on the delete request in the
  `X-Password-Confirmation` header.
- **Enforced by a global guard**, `PasswordConfirmationGuard`, which runs after the auth, feature and hierarchy
  guards. A route opts in with `@ConfirmPassword()` (optionally `{ when }`, as bulk actions use for `delete` only).
  Without a valid pass it answers 403 `PASSWORD_CONFIRMATION_REQUIRED`; a pass that was sent but is invalid, used or
  expired is written to the audit log as `security.delete_refused` with outcome `REFUSED`. API keys and the browser
  extension cannot spend a pass, so they cannot delete anything that needs one.
- **Every delete route is marked.** `routes.test.ts` scans every controller: each `@Delete` and each POST whose path
  says delete, remove, erase or purge carries `@ConfirmPassword()` or `@NoPasswordConfirmation(reason)`. Exempt are
  things that only touch the person's own settings or undo access rather than data: preferences, profile photo,
  signing a device out, leaving or tidying a chat, saved views, revoking invitations, API keys, webhooks and SCIM
  tokens, phone devices and drafts, consents. CRM, workspace, organisation and integration deletes must not be exempt.
- **Wrong passwords pause the check.** Five wrong tries in 15 minutes give 429 `PASSWORD_CHECK_PAUSED` for that
  person (`PasswordCheckFailure`); each wrong try is audited as `security.password_check_failed`, outcome `REFUSED`.
- **Audit status.** `AuditLog.outcome` is `DONE` (default) or `REFUSED`. The audit log screen has a Result filter and
  column, and a new "Security and passwords" category. Refused entries never fire domain events.
- **Pluggable principal.** The service resolves who is confirming through registered resolvers. Workspace people are
  built in; the Console registers its own (operators) with `POST /operator/auth/confirm-password`.
- **Web and phone.** The web API client catches the 403, shows the Confirm deletion dialog, and retries with the pass;
  cancelling throws `CONFIRMATION_CANCELLED` ("Nothing was deleted."). The dialog has no workspace-only hooks so the
  Console can reuse it, and can ask the person to type a name for critical deletes (used from W4). The phone app asks
  for the password on its delete card.

**Consequences.** One check per action: a bulk delete is one check. Scripts and integrations that deleted with an
API key must now be run by a person. Typing the password again within 5 minutes is needed for a second delete, which
is deliberate.

## W2: Delete is a permission, off by default (2026-11-23)

- `defaultChildActions` never includes `delete`: a new Manager or Executive Workspace cannot delete anything until the
  workspace above ticks Delete in the Permission Center. Existing workspaces keep what they were given. The Super
  Workspace keeps Delete unless the Console's ceiling takes it away.
- `HierarchyGuard` adds a `delete` check, for every feature the route belongs to, on any route whose
  `@ConfirmPassword` rule applies. So a bulk delete (a POST, now tied to its list's feature) and a configuration delete
  (which asks for `manage`) need Delete too. Phone deletes name their module's feature for the same reason.
- The web hides delete buttons with `useCanDelete(feature?)` (the page's own feature when none is given). The API
  refuses anyway, with `ACTION_NOT_GRANTED`.

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

## W3: Console rules for workspaces (2026-11-23)

- The Console sets, per plan (`PlanWorkspaceRules`), with a per-client override (`Subscription.workspaceRules`, only
  the fields that differ): whether Manager and Executive Workspaces may be given Delete, which modules each level may
  use, and whether each level must use two-step sign-in. No row means no extra limits.
- They are limits. `resolveOrganisation` caps every Manager and Executive Workspace by them (`capByRules`) after the
  Super Workspace's grants, so a change applies on the next request and nothing stored is rewritten. The Super
  Workspace is never capped, and rules never create or remove one.
- Two-step sign-in: the auth guard puts a password-only session of a required level in the existing `mfa_enrolment`
  restriction, as the workspace-wide setting does.
- API: `GET /operator/workspace-rules`, `PUT /operator/workspace-rules/plans/:code`, `GET` and
  `PUT /operator/workspace-rules/clients/:id`. Every operator reads; only ADMINs change, with a reason, written to the
  platform audit log (and the client's own log for a client change). Page: Console, Workspace rules; the client card
  is on the client profile. The Permission Center says when a rule keeps Delete or a module from a level.

## W4: Deactivating and deleting Manager and Executive Workspaces (2026-11-23)

- **Deactivate** (`POST /workspaces/:id/deactivate`, reason required) asks for the password but not the Delete action
  (`@ConfirmPassword({ deletes: false })`), because it erases nothing. The workspace's people, and everyone in the
  workspaces below it, get the restriction `workspace_deactivated` on their next request: the web shows a page that
  says so, every other route answers 403 `WORKSPACE_DEACTIVATED`, and API keys and the extension stop working.
  Grants are kept, so `POST /workspaces/:id/reactivate` restores things exactly. A deactivated workspace still counts
  towards the plan's limit.
- **Delete** (`DELETE /workspaces/:id` with `{ confirmName, handoverToId }`) needs the Delete action, the password and
  the typed name. `GET /workspaces/:id/impact` shows first who loses access, the records that move and the Executive
  Workspaces that move. Nothing in the CRM is erased: companies, contacts, leads and deals owned by its people, and
  its open tasks, go to the receiving workspace's person (the caller in their own workspace, otherwise its first
  member). A manager's Executive Workspaces move under the receiving workspace with their people. Its own people's
  memberships are suspended (accounts and history stay), its invitations are withdrawn, and the node is archived so
  audit entries keep its name. A receiving workspace is required whenever there is something to hand over.
- Who may: the workspace above (the Super Workspace over all, a manager over its own executives), as for every other
  hierarchy change.

## W5: The creation wizard and one email, one role (2026-11-23)

- Creating a Manager or Executive Workspace is a 6-step wizard: type (the Super Workspace is never offered),
  workspace (name, department, designation, description, reports to, executives moved into a new manager's team,
  active or created deactivated), person (name, work email, work phone), permissions (modules and actions from the
  parent, Delete off, the Console's rules applied; a manager's access level), review, then create.
- New fields: `WorkspaceNode.department`, `description`, `accessLevel` (null means TEAM; OWN limits a manager to its
  own people's records), `Invitation.name` and `phone` (the name pre-fills the accept page, the phone goes on a new
  account as `User.phone`).
- **One email, one role** within an organisation: `GET /workspaces/email-check` answers while the email is typed,
  and creating a workspace refuses the same cases with 409 `EMAIL_IN_WORKSPACE` (already works here, naming where)
  or `EMAIL_INVITED` (a pending invitation elsewhere). The team page's invitation no longer replaces a pending
  invitation into another workspace silently; it refuses with `EMAIL_INVITED`. Re-inviting into the same workspace
  still replaces the link. One person can still belong to two separate client organisations.

## W6: The hierarchy tree, Settings in nine sections and changing the password (2026-11-23)

- **Hierarchy tree.** The Workspaces page draws the company, its one Super Workspace, the Manager Workspaces and
  their Executive Workspaces as a tree with connector lines. Each card shows the person (name and email, or the
  pending invitation), a status (Active, Invited, Empty, Deactivated), plan-limit use (the Super Workspace shows both
  limits, a manager the executives in its team) and an Actions menu (Edit, Permissions, Deactivate or Reactivate,
  Delete when the Delete action is granted). A banner tells the Super Workspace why there is only one.
- **Settings in nine sections**, each with one sentence on what it is for: Workspace (the existing forms, inline),
  Users & Workspaces, Roles & Permissions, Security, Password & Authentication, Data Management, Notifications,
  Integrations and Audit Logs. The sections lead to the pages that already exist, so every old link keeps working;
  the Team page's roles card and the Workspaces structure card gained anchors (`#roles`, `#structure`).
- **Changing the password while signed in**: `POST /auth/password` with `{ currentPassword, newPassword }`. A wrong
  current password counts towards the same five-in-fifteen-minutes pause as the password check and is audited as
  `auth.password_change_failed` (REFUSED). On success every other session is revoked (this one stays), outstanding
  reset links stop working, `auth.password_changed` is recorded in each organisation the person belongs to, and the
  person gets an email. Single sign-on accounts have no password to change (400 `PASSWORD_NOT_SET`); API keys and
  the extension cannot call it. The form is on Account security, linked from Password & Authentication next to the
  existing reset-by-email flow.

## W7: Closing the company, with 30 days to reopen (2026-11-23)

- Only an **owner in the Super Workspace** may close the company (403 `COMPANY_CLOSE_FORBIDDEN` otherwise; API keys
  and the extension never can). Settings, then Workspace, then Close company shows every workspace with its people
  and the data counts (`GET /tenants/current/close-impact`), then asks for the typed company name and the password,
  then a second confirmation. `POST /tenants/current/close` takes `{ confirmName, reason?, understood: true }` with
  the password pass (`@ConfirmPassword({ deletes: false })`: closing is an owner's right, not a workspace's Delete).
- Closing sets the tenant to `PENDING_DELETION` with `closedAt`, `closedById`, `closeReason` and `eraseAfter`
  (closedAt + 30 days). Every access check already refuses a tenant that is not ACTIVE (cookies, API keys, the
  extension, the chat socket, automation and sequences), so sign-in stops for everyone at once; the company's
  sessions are also revoked. Signing in afterwards answers 403 `COMPANY_CLOSED` with the date until which it can be
  reopened. The owner gets an email; the tenant audit log records `tenant.closed`, the platform log
  `client.closed_by_owner`.
- The Console shows such a client as **Closing** with who closed it, the reason and the erase date, and an ADMIN can
  reopen it (`POST /operator/clients/:id/reopen` with a reason) until `eraseAfter` (409 `REOPEN_TOO_LATE` after).
  Reopening restores everything: nothing was removed while it was closing.
- After `eraseAfter` the worker's sweep erases the company: every collection with a workspace field is emptied of its
  documents by `tenant_id` (the audit log included), people who belong to no other organisation are anonymised
  (email freed, name, phone and password removed, signed out; the account row stays because other records may point
  at it), and the tenant row stays with `deletedAt` and `erasedAt` as the record that the client existed. The
  platform audit log keeps `client.erased` with the counts. People who also belong to another organisation keep
  their account.

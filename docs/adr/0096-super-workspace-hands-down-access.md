# 0096: The Super Workspace hands down sections, actions and fields, within the Console's limits

Date: 2026-11-27. Status: accepted.

## Context

Kunal asked that the Super Workspace can pass on to its Manager and Executive Workspaces every role and permission the
Super Admin (the Console) made available, and that the Super Workspace always keeps every right: it can hide, lock and
delete anything. Since R8 (ADR 0092) the Console alone decided which record fields each level sees, and the Permission
Center offered sections the Console withholds from the level without saying so (they were dropped silently).

## Decision

- **The Console stays the ceiling.** Its rules per level (modules, Delete, sections, fields; ADR 0074 W3 and ADR 0092)
  still cap what any Manager or Executive Workspace gets, whatever the Super Workspace ticks.
- **The Super Workspace is never limited by them.** It keeps everything its plan has, sees and changes every field,
  and may delete. Field access cannot be set on it (`INVALID_SETTING`).
- **Field access per workspace.** `WorkspaceNode.hiddenFields` and `lockedFields` (ids from `FIELD_ACCESS_CATALOGUE`)
  are set with `PUT /workspaces/:id/permissions` by the workspace above, the same route as sections and actions.
  - Hide: never shown, never changed (as R8).
  - Lock: shown, can be filled in on a new record (a POST to the list itself, such as `POST /companies`), never
    changed afterwards. The `FieldAccessInterceptor` drops locked properties from every other write.
  - Limits only add up down the tree (`combineFieldAccess`): a workspace's fields = what the Console withholds from its
    level + what its parent has hidden or locked + its own. A manager cannot open for its executives what is hidden or
    locked for itself. A hidden field is never also locked.
  - The stored lists keep only the workspace's own choice, so a field the Console later reopens follows the Super
    Workspace's choice, not the Console's old one.
- **Rows and `/auth/me`.** `WorkspaceRow` has `hiddenFields`/`lockedFields` (its own) and `effectiveHiddenFields`/
  `effectiveLockedFields`. `/auth/me` gives `workspace.hiddenFields` (now including the ones set above) and
  `workspace.lockedFields`; edit forms show locked inputs read only.
- **Permission Center.** For a Super Workspace caller it says the Super Workspace keeps every right; a "Give
  everything allowed" button ticks every section, action and field the level may have; sections and fields the
  Console keeps back are shown with "Kept back by SampForce" and cannot be ticked; a Fields section gives Show, Lock or
  Hide per field of companies, employees, deals and RFQs. Changes are audited (`fieldsHidden`, `fieldsShown`,
  `fieldsLocked`, `fieldsUnlocked` on `workspace.permissions_changed`).

## Not covered

As in ADR 0092: names, owners, statuses and links between records cannot be hidden or locked, and search results,
exports, reports, AI answers and emails are not stripped field by field. People's roles (Owner, Admin, Manager…) are
still given in Team management; the workspace decides what a person may reach, the role what they may do there.

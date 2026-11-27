# 0092: Section and field access per level, set only in the Console

Date: 2026-11-26. Status: accepted. Redesign R8.

## Context

Kunal asked that every section and every field the Super Workspace has can be passed on to Manager and Executive
Workspaces, but only as the Super Admin Console allows. The Console rules from W3 (ADR 0074) already capped whole
modules and Delete per level. The Leads and Accounts switch (ADR 0082, PR #146) sat in the client's own Settings.

## Decision

- `WorkspaceRules` gains four lists, per plan and per client override like the other rules:
  `managerHiddenSections` / `executiveHiddenSections` (feature keys) and `managerHiddenFields` /
  `executiveHiddenFields` (ids from `FIELD_ACCESS_CATALOGUE`, such as `company.primaryEmail`). Missing lists mean
  nothing is withheld, so rules saved before R8 still parse and old screens can still save.
- Sections: `capByRules` removes a withheld feature (and the features under it) and its actions. The
  HierarchyGuard then refuses its routes, and `/auth/me` gives `workspace.hiddenSections` so the menu, search and
  shortcuts leave it out instead of showing a lock.
- Fields: a global `FieldAccessInterceptor` works on `/companies`, `/company-leads`, `/contacts`, `/deals` and
  `/rfqs` for Manager and Executive callers. It blanks the hidden properties in responses (null, [] or {}): in the
  path's own records, in list wrappers and in records nested under keys like `company`, `contacts` and `rfqs`. It
  also deletes them from request bodies, so a blank sent back by a form cannot wipe the real value. `/auth/me` gives
  `workspace.hiddenFields`, and the edit forms leave those inputs out.
- The Console shows a grid on the client's profile and on Workspace rules: sections by module and fields by record
  type, with Super (always), Manager and Executive columns, a search box and all/none per module.
- The Leads and Accounts switch moves to the Console (`/operator/workspace-rules/clients/:id/menu-sections`). The
  client's `PUT /tenants/current/menu-sections` route and Settings card are removed; reading it stays.

## Not covered

Names, owners, statuses and links between records cannot be hidden. Search results, exports, reports, AI answers
and emails built from records are not stripped field by field; withhold the section (Reports, AI assistant…) for
that level when that matters.

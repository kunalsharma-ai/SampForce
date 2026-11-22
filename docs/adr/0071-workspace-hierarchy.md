# ADR 0071: Four-level workspace hierarchy

**Status:** accepted (2026-11-22), first part (foundations)

**Context.** Kunal asked for SampForce to work as a four-level hierarchy: the Console (the platform owner, today's
operator console), one Super Workspace per client organisation, Manager Workspaces under it, and Executive Workspaces
(one person each). Each level may only give the level below it what it has itself, limits per client decide how many
Manager and Executive Workspaces exist, and every rule must hold on the server, against direct URLs and API calls, not
only in the interface. This ADR covers the foundations (PR 1). Console client management, the Permission Center
screens, targets and tasks, chat and support tickets, the four dashboards and the audit screens follow in later PRs
and will extend this record.

**Decision.**

- **The tree.** A new `WorkspaceNode` collection holds the tree inside an organisation (an organisation is today's
  tenant, so tenant isolation still applies to every row). Levels are `SUPER`, `MANAGER` and `EXECUTIVE`. A node has a
  name (unique within the organisation, compared case-insensitively), a designation, its own feature allow-list, its
  own action grants, `canCreateExecutives` and `canViewOtherManagers`. `Membership.workspaceNodeId` places a person in
  a workspace; a membership without one belongs to the Super Workspace, so existing organisations keep working
  unchanged. Until an organisation changes its hierarchy the Super Workspace is virtual; the first change stores it.
- **Inheritance, never copying.** A workspace's features are its parent's effective features intersected with its own
  list, and its actions are intersected per module the same way. The Super Workspace's features are the subscription's
  (plan plus overrides, ADR 0057) and its actions are the Console's ceiling. This is recomputed from the subscription
  down on every request, so when the Console removes a feature, every workspace below loses it immediately, and a
  subfeature whose parent is missing is dropped.
- **Feature catalogue.** The catalogue gains the core modules as features with subfeatures (lead management with
  assignment, conversion and merge; account management with branches, files and owner changes; opportunities with the
  board, bulk update, cloning and history; tasks, notifications, search, import, export, workspace, user and permission
  management, sales targets, audit log, CRM configuration, and more). They are on every plan. Features carry
  `since: 2`; plan lists saved before catalogue version 2 get them added, lists the Console saves now record version 2
  so a module the Console removes stays removed.
- **Actions.** Eleven actions: view, create, edit, delete, export, assign, approve, manage, configure, access reports
  and access other workspaces. They are granted per module (the feature's group). By default a Manager Workspace gets
  everything except configure and access other workspaces; an Executive Workspace gets view, create, edit, delete and
  reports, and only view on Administration.
- **Enforcement.** A global `HierarchyGuard` runs after `AuthGuard` and `FeatureGuard`. A route's features come from
  its `@RequireFeature`, from its permission's resource (leads, companies, deals and so on) and from
  `@AlsoRequireFeature` for subfeature routes; its action comes from `@RequireAction` or the permission verb and HTTP
  method. A missing feature is refused with `FEATURE_NOT_GRANTED`, a missing action with `ACTION_NOT_GRANTED`. Roles
  and permissions inside a workspace still apply on top.
- **Record visibility.** In an Executive Workspace a person sees only their own records. In a Manager Workspace a
  person sees records of the people in their branch (their workspace and the Executive Workspaces under it); a role
  scoped to own records still means own. The Super Workspace keeps the role's scope.
- **Creation rules and limits.** The Super Workspace creates Manager Workspaces, and Executive Workspaces only when the
  Console allows it. A Manager Workspace creates Executive Workspaces under itself only when the Super Workspace allowed
  it. An Executive Workspace creates nothing. The subscription holds `maxManagerWorkspaces` and
  `maxExecutiveWorkspaces` (plan defaults, overridable per client; empty means unlimited); a creation over the limit is
  refused with `WORKSPACE_LIMIT_REACHED`, and creations take an organisation lock so two at once cannot both pass.
  Usage is shown as "used / allowed". Nobody may grant themselves or their own workspace anything (`SELF_GRANT_FORBIDDEN`),
  and nobody may grant more than their own workspace has.
- **People.** Creating a workspace can invite its person by email (the invitation carries the workspace) or place an
  existing member. An Executive Workspace holds one person. Moving a workspace or a person is a Super Workspace action.
  A workspace with people or workspaces under it cannot be archived.
- **Identity.** `GET /auth/me` returns the workspace (level, name, designation, actions) and the workspace-effective
  features, with the plan's features alongside. The header shows a workspace badge, and the account menu shows the
  designation, workspace, level and organisation. A feature the plan has but the workspace was not given says so and
  points to the administrator above.
- **Audit.** Creating, renaming, granting or withdrawing features and actions, moving, assigning and archiving
  workspaces are written to the audit log with who did it and what changed.
- **No recent history.** At Kunal's request no workspace shows recent-history or recent-activity lists, in dashboards
  or navigation.
- **Console and client data.** The Console manages clients, plans, limits and the ceiling of features and actions; it
  does not read client CRM records.

**Consequences.** Every request resolves the organisation's tree (one small query per request). Existing
organisations behave as before until they create Manager or Executive Workspaces. Routes added later must name their
feature or map to a resource, or they are only checked by role.

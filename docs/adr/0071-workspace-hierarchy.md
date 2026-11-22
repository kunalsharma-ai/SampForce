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

## Part 2: Console clients, plans and limits

- **Plans you sell.** Console Admins create plans of their own (`custom_<slug>` codes) next to the shipped ones. A plan
  holds its features, limits (including Manager and Executive Workspaces), price, currency, billing frequency, support
  level, term, auto-renewal, the plans it may move to, and whether it is on sale. Editing a shipped plan stores a row
  the first time. Changes reach every client on the plan, and every workspace inside it, on the next request.
- **Clients.** Creating a client provisions the organisation, its Super Workspace (with the administrator's
  designation), the subscription (plan, seats, start, term, price, payment status, workspace limits) and an
  administrator invitation link. The administrator becomes the owner on accepting.
- **Subscription changes** (scenario 14) take the organisation's lock, honour the plan's "moves to" list, and record
  each change with its reason, so the client's history reads "Manager Workspaces: plan limit (4) → 5".
- **State.** Suspended clients cannot sign in; deactivated clients are suspended with the subscription cancelled;
  activating restores both. Data is kept in every state.
- **Authority.** The Console sets the Super Workspace's action ceiling and whether it may create Executive Workspaces.
- **Overview** shows client counts, revenue, outstanding payments, plans sold and renewals due. It has no activity feed.

## Part 3: Permission Center

- **Workspaces page** (Settings, Workspaces; `/app/settings/workspaces`) shows the organisation, Manager and Executive
  Workspace limits, and the structure as a tree. The Super Workspace sees every workspace; a manager sees its team; an
  executive sees its own. Creating a workspace takes a name, designation, who it reports to and an optional invite.
- **Permission Center** opens on any workspace the caller is the parent level of. Features are listed by module with
  their subfeatures under them, and only features the parent has are offered; a subfeature cannot be on without its
  feature. Actions are a module-by-action matrix where anything the parent lacks shows as a dash. The Super Workspace
  also sets whether a manager may create Executive Workspaces and see other managers' records.
- **Enforcement stays on the server.** The page only offers what the API allows; a direct request to hand down more is
  refused with FEATURE_NOT_GRANTED or ACTION_NOT_GRANTED (covered by the browser test).
- Editing renames, changes the designation, moves an Executive Workspace to another manager (Super Workspace only) and
  moves a member in. Archiving needs the workspace to be empty, withdraws its pending invitations and frees its slot.

## Part 4: Targets and tasks

- **Targets** (`WorkspaceTarget`, `/targets`, page `/app/targets`): a metric (leads generated, calls, deals won,
  revenue) over a daily, weekly, monthly, quarterly or custom period, set for one workspace. The Super Workspace sets
  targets for any workspace below it; a manager sets them for its own Executive Workspaces and splits a target it
  received among them. Both need "assign" in Sales target management, so the Super Workspace can take that away.
  Each target records who set it and from which level (`setByLevel`), so the page says "Set by the Super Workspace" or
  "Handed down by the manager". Parts can never add up to more than the target they come from, and a target cannot
  be lowered below what was handed down.
- **Achievement is counted, not typed**: leads are companies the people created (as in the Command Center), calls are
  logged calls, deals won and revenue come from credited revenue records in the organisation's currency. The people
  counted are everyone in the target's workspace and below it, so an executive's new lead moves its own target and
  its manager's (scenario 11).
- **Tasks** (`/assigned-tasks`, page `/app/tasks`) are ordinary `Task` rows with `workspaceNodeId` and
  `assignedByNodeId`, so they also show in My Work. New `TaskComment` and append-only `TaskEvent` keep comments and
  the full history. The creator and the levels above may change a task; the assignee may change its status. The
  assignee is notified on creation and every change, and the creator when it is finished or reopened (scenario 12).
- Both appear at the top of every Command Center dashboard ("Tasks for you", "Your targets"): high-priority tasks are
  bold with a strong edge and overdue ones are marked in the critical colour. There is no recent-activity list.
- Calendar boundaries are UTC days for now; a per-organisation time zone can come with the dashboards in part 6.

## Part 5: Chat rules and support tickets

- **One chat, with rules by level** (on top of the real-time chat of ADR 0069; no second chat system). The server
  decides who may talk (`ChatReach`) whenever a direct conversation is opened, people are put into a channel or a
  direct message is sent; the people list only offers whom the caller may reach:
  - people of the same workspace, and the Super Workspace with everyone;
  - a manager with the executives of its own team;
  - two managers only when the Super Workspace allows both (`canChatWithPeers` on each Manager Workspace);
  - two executives only of the same team, and only when their parent allows both.
  A channel takes members from whoever adds them. When a permission is withdrawn, an existing direct conversation
  keeps its history but refuses new messages (CHAT_NOT_ALLOWED). The SampForce support line in chat is for the Super
  Workspace's administrators only.
- **Support tickets go up the hierarchy** (on top of the Help Center ticket core, ADR 0073): an executive's query goes
  to its manager, a manager's (or an executive's straight under the Super Workspace) to the Super Workspace, and the
  Super Workspace's to SampForce support (scenario 13). The workspace handling it answers (`WORKSPACE` messages), sets
  its status and resolution note, or escalates it one level up (`POST /support/tickets/:id/escalate`). The handlers
  are notified; `scope=handling` lists what waits on the caller.
- **The Console only sees tickets that reached it.** Queries answered inside the organisation never leave it, which
  keeps support conversations separate from internal ones. Operators assign a support representative
  (`assignedOperatorId`, shown to the client) and write a resolution note; both are audited.
- File attachments on tickets are not built yet; chat already carries files.

## Part 6: Four dashboards

- **One dashboard per level** (`GET /workspace-dashboard?period=TODAY|WEEK|MONTH|QUARTER`), counted on each request
  through the Command Center's `Metrics` and the targets page's own achievement, so the numbers agree everywhere:
  - **Super Workspace, "Organisation"** (administrators with members:manage only): workspaces used and left, leads,
    calls, deals and sales, the organisation's running targets, performance by Manager and by Executive Workspace,
    the leading manager and executive, open and overdue tasks and follow-ups.
  - **Manager, "Team"**: its executives, team totals and targets, an executive ranking with the top one and the one
    needing support, a daily, weekly and monthly report, an 8-week trend, and other managers' figures (never their
    records) only when the Super Workspace allows it.
  - **Executive, "My day"**: today's lead target, leads, what remains, calls against the call target, today's sales,
    the monthly sales target, follow-ups coming up and overdue.
  - **Console Admin**: the platform overview of part 2 now also counts support queries waiting on SampForce.
- Each level has its own colour (violet, sky, green, as in the header badge), title and layout. Managers see only the
  Team and Manager tabs; executives only My day and Executive. The designation dashboards (ADR 0063) stay one tab away
  for the Super Workspace. No dashboard has a recent-activity list (Kunal, 2026-11-22).
- "Important announcements" are the tasks and instructions already shown at the top; no separate announcement feed.

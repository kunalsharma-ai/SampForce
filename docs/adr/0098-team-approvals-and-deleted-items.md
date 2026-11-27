# ADR 0098: Team approvals and Deleted items

- Status: accepted
- Date: 2026-11-27

## Context

Kunal's brief (section 4, "Complete Data Deletion and Approval System"):

- Super and Manager Workspaces delete anything without asking anyone.
- An Executive Workspace asks its assigned manager. If approved, the executive completes the delete; if rejected,
  the record stays as it is.
- A new Approval section, in every workspace and on the phone, shows each request with the requester and their
  workspace, the record type, name and ID, the reason, the dates, the assigned manager, the status (Pending,
  Approved, Rejected, Cancelled, Expired) and the manager's comment. Managers decide there.
- An approval is tied to the exact record and the exact delete; if the record changes after approval, it must be
  asked for again. The executive does not ask again to carry out an approved delete.
- Single, multi-select and select-all deletes; deletion reason, approval status and history; safeguards for
  critical, legal, financial and audit data; recovery where feasible, with permanent removal by retention policy.
- The coordinator added: make it extensible to task, target and data changes, with the Super Workspace configuring
  the categories and escalation. Core features must not depend on AI.

Every delete route is already marked `@ConfirmPassword` (W1), and PR #159 / ADR 0096 added delete-all routes. W2 gave
Manager and Executive Workspaces no Delete by default.

## Decision

### One guard for every delete

`ApprovalGuard` runs after `HierarchyGuard` and before the password check. A request from an Executive Workspace to a
route that deletes data (the `@ConfirmPassword` metadata, so single deletes, `/records/bulk` with `action: delete`,
every `delete-all` route and the phone's `/mobile/records/:module/:id`) is refused with 403 `APPROVAL_REQUIRED`
unless it carries `x-approval-id`. The refusal names the record (`recordTypeLabel`, `recordName`, `recordCount`) and
an identical request already waiting (`pendingId`). API keys and the browser extension are not workspace people and
are not affected. When the Super Workspace switches it on, PATCH or PUT on one company, contact, lead or deal from an
executive is guarded the same way (category `record_edit`).

The web client's `api()` turns that refusal into the "Ask your manager to approve" dialog, mounted once in the app
shell, so every delete button in the app asks instead of failing, without each page knowing. The phone shows the
same as a card on the record screen.

### What an approval is tied to

A request stores the method, the path (after `/api/v1`, no query), a SHA-256 of the canonical JSON body (keys sorted)
and a fingerprint of the records as they were when asked: SHA-256 of the canonical records by id, with missing
records counted as missing. `apps/api/src/team-approvals/record-of-route.ts` maps paths to record kinds.

Carrying out sends the same action again with `x-approval-id`. The guard checks: the request is the caller's own, it
is APPROVED and not used, `approvedUntil` has not passed, the method, path and body hash match, and the records'
fingerprint is unchanged. Any difference is 403 `APPROVAL_NOT_VALID` with the reason. The password is still asked.
`ApprovalInterceptor` claims the approval (a conditional update, so two tabs cannot both use it; a stale claim frees
itself after 10 minutes), runs the handler, and marks it COMPLETED on success or releases it on failure. So an
approval works exactly once, for exactly what was approved.

### Who decides

The workspace directly above the requester's decides: an executive under a manager goes to that manager; an
executive directly under the Super Workspace goes to the Super Workspace. The Super Workspace can decide every
request. Nobody decides their own request (`NO_SELF_APPROVAL`). A request nobody decides within
`escalateAfterHours` moves one level up (status stays PENDING, `escalated` shown). Pending requests expire after
`expireAfterDays`; approved ones that are not used lapse after `approvalValidDays`. The worker tick does both.

Notifications go through `NotificationsService.send`: `approval.requested` and `approval.escalated` to the deciders
(action required), `approval.approved`, `approval.rejected` and `approval.expired` to the requester (the
`approval_decisions` category, so the animated cards show them), `approval.completed` to the decider. On the phone
they arrive as the new `approval` push type and open the Approvals screen.

### Other kinds of request

`task_change`, `target_change`, `data_change` and `other` are requests in words (a title and a reason) with the same
decide, cancel, expire and escalate flow. They carry no action, so approving one tells the requester, who then makes
the change (or the manager does). The Super Workspace can switch them off.

### Deleted items

Every delete made through the API inside a request is kept, whoever made it. The Prisma workspace guard extension
calls `noteRemoval` (`packages/database/src/recycle.ts`) for soft deletes (`deletedAt` set) and hard deletes; hard
deletes keep the whole document, and the documents removed with it by `onDelete: Cascade` (from the Prisma DMMF, four
levels deep). The interceptor writes one `RecycleBatch` with its `RecycleEntry` rows after the handler succeeds.
Users, sessions, memberships, audit logs, notifications, platform records and the approval and bin collections
themselves are never kept (`NOT_KEPT`).

Restore puts soft-deleted records back (`deletedAt: null`) and recreates hard-deleted ones that do not exist again;
records that cannot come back are counted and shown. A batch restores once. Batches are removed after
`keepDeletedDays` (the retention policy, default 30), or earlier with "Remove for good" (password required). The
Super Workspace sees every batch, a manager its own and its team's, an executive their own.

Audit entries: `approval.requested`, `approval.approved`, `approval.rejected`, `approval.cancelled`,
`approval.completed`, `approvals.settings_changed`, `records.restored`, `records.purged`; the delete itself keeps its
own audit entry as before.

### Settings (Super Workspace, Approvals > Rules)

`lowerLevelsDelete` (default off), `deleteNeedsApproval` (on), `editNeedsApproval` (off), `freeFormRequests` (on),
`escalateAfterHours` (24, 0 = never), `expireAfterDays` (7), `approvalValidDays` (3), `keepDeletedDays` (30).

## What changed in earlier work

- W2 (no Delete below Super by default) is kept as the default. Kunal's brief says managers delete freely, which W2
  does not allow, so the new switch "Manager and Executive Workspaces can delete" turns the Delete action on wherever
  a Manager or Executive Workspace can edit, now and for workspaces created later, and off again. It changes the same
  per-workspace actions as the Permission Center, which still works workspace by workspace.
- The Approvals page (automation steps and quote discounts) became the Approval section; those approvals are one of
  its tabs, unchanged.
- The record page's delete dialog closes when the delete went to the manager instead, and the bulk bar shows the
  client's own messages translated.

## Not done

- Safeguards for legal, financial and audit data are the existing ones: audit logs, users and billing records have no
  delete route, and a quote can only be deleted as a first-version draft. No new category of protected records.
- Deleted items and the rules are on the web only; the phone shows and decides requests and carries them out.
- An approved `record_edit` is carried out by sending the same change again from Approvals; the edit form does not
  reopen with the values.

# ADR 0081: Role and workflow redesign, part 1: the header and working status

Date: 2026-11-26. Status: accepted.

## Context

Kunal's 40-section redesign spec (26 Nov 2026) starts with the header: the old top bar held sixteen controls (search,
favourite star, workspace badge, Copilot, Create, voice note, chat, bell, theme, focus, shortcuts, tasks, calendar,
integrations, help, account). He asked for only the essentials, one search, and a highly visible working status with
Check in, Break, Resume and Check out that managers and the Super Workspace can see. SampForce had no attendance data
at all: team chat presence only knows online and offline. The full plan is in project files
`sampforce/redesign/PLAN.md` (R1 to R10); this ADR covers R1.

## Decision

**Header.** Left: the page name ("Dashboard" on the home page) and the workspace level. Centre: one search
("Search companies, contacts, deals, tasks...") that opens the existing global search. Right: the status control, the
notification bell and the account menu. Quick create, Copilot, favourites, light/dark, Theme Studio, focus,
shortcuts, calendar, integrations and Help & support moved into the account menu (Ctrl K, keyboard shortcuts and the
command palette still reach them). The chat unread count moved to Team chat in the sidebar; the live chat connection
still runs on every page.

**Working status.** `work_sessions` holds one session per check-in: check-in and check-out times, breaks
(`[{start, end}]`), the status the person chose, when the status last changed and when a page was last open.
`availability_events` is an append-only log (CHECK_IN, BREAK_START, BREAK_END, STATUS, CHECK_OUT, AUTO_CHECK_OUT).
Statuses are Available, Working, On break, Away and Checked out. Break and working minutes are always worked out from
the stored times, never typed in. Rules:

- Away comes by itself when a checked-in person has had no SampForce page open for 10 minutes (the header beats once
  a minute), and can also be chosen. Any page brings them back.
- A session left open for 18 hours is closed at the person's last sign of life (`autoClosed`), so a forgotten check-out
  never counts a whole night as work.
- Who sees whom: the Super Workspace sees the whole organisation, a manager its own branch, an executive only
  themself, or their team mates as well when the manager lets both chat with peers (the same switch as team chat).
- Each change notifies the manager above an executive and the members with `members:manage`, as `team.status`
  notifications linking to the new Team status page (`/app/team-status`). The person is never notified of their own.
- Working status is part of every plan and every workspace level, like notifications, so it has no plan feature key:
  a new feature key would not be in any existing Manager or Executive grant and would lock those people out.

API: `GET /availability/me`, `POST /availability/beat | check-in | break | resume | check-out`,
`PUT /availability/status`, `GET /availability/team?workspaceId=`.

## Consequences

- Live means near-real-time: the header refreshes every minute and the Team status page every 30 seconds; the
  notification itself arrives through the existing live notification channel.
- Browser tests that clicked header buttons (Copilot, Quick create, favourites, theme, Help & support) now open the
  account menu first (`openAccountMenu`, `openCopilot` in `e2e/helpers.ts`).
- `e2e/layout-check.ts` adds `expectCleanLayout`, which fails on overlapping or clipped text and sideways scrolling.
  Every redesigned screen runs it at desktop, tablet and phone widths in light and dark.

# ADR 0041: Personal navigation, Focus Workspace and keyboard shortcuts

- Status: Accepted
- Date: 2026-11-01
- Part of: Frontend design spec (Part 3 navigation and shell, Part 13 long-session comfort, Part 14 mobile)

## Context

The design spec asks for favourites, recently viewed pages, a menu people can reorder and trim, a command palette
that also runs actions and hands questions to the AI copilot, a distraction-free focus mode, keyboard shortcuts and a
mobile bottom bar. Before this change the sidebar was a fixed list of modules, search used plain substring matching
and the only shortcut was Ctrl/⌘ K.

## Decisions

1. **Saved per person per workspace, on the server.** Favourites and recent pages point at records, which differ
   between workspaces, so `workspace_navigation` is keyed by `(tenant_id, user_id)` and protected by a forced RLS
   policy on both columns. A person sees the same favourites on every device; one member never sees another's.
2. **Links are validated as DealFlow paths.** `appPathSchema` accepts only `/app` and `/app/...` with a safe
   character set and rejects `//`, `..` and backslashes, so a stored favourite cannot send anyone off-site. Stored JSON
   is re-validated on read and anything invalid is dropped.
3. **Recent pages are recorded by the shell, after render.** The shell posts a visit 1.5 seconds after a route
   settles, labelled with the page's `h1` (so record pages show the record's name, not its id). The list keeps 15,
   newest first, with repeats moved to the front. Failures are ignored: history is a convenience and must never break
   a page. The endpoint is rate limited (120 per minute).
4. **Adding a favourite happens on the page, removing it in the sidebar.** A star in the top bar pins the current
   page. A star on every sidebar row would add some 30 extra tab stops to the main navigation, so sidebar rows only
   offer "Remove from favourites" inside the Favourites group.
5. **Menu layout is a draft until saved.** The Customize menu dialog reorders within each group (buttons, so it
   works by keyboard and screen reader, with a live status line) and hides modules. Settings can never be hidden, and
   hidden modules remain in search, so nothing becomes unreachable.
6. **Focus Workspace and shortcuts are device settings.** Focus is stored locally (`dealflow:shell`) and sets
   `html[data-focus]`, which CSS uses to hide the sidebar, ambient background and anything marked `data-secondary`.
   Shortcut handling is a pure function (`resolveShortcut`) with unit tests; letter shortcuts are ignored in text
   fields, menus and dialogs, and two-key sequences (`g d`, `n l`) expire after 1.2 seconds.

## Consequences

- One small table and four endpoints under `/me/navigation`. Playwright covers favourites across browsers, recent
  pages, menu order and hiding, shortcuts, Focus Workspace, palette actions, the Copilot hand-off and the mobile bar,
  with axe scans of the new dialogs.
- Saved views per list and drag-and-drop reordering of the menu are left for the data table work (PR 3).

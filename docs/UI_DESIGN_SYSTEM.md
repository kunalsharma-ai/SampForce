# DealFlow UI/UX Design Specification

## 1. Experience principles

1. **Clarity first, spectacle second.** Motion and 3D explain change over time or structure; they are never
   the only way to read information.
2. **Honest interfaces.** No hardcoded numbers in production, no buttons that silently do nothing. Unshipped
   modules say so and say when.
3. **Long-session comfort.** Dark signature theme with restrained gradients; a light theme with AA contrast;
   motion the user controls.
4. **Explain AI.** Every recommendation shows its evidence and the approval it needs.

## 2. Tokens (`packages/ui/src/tokens.css`)

| Token | Dark (signature) | Light | Use |
|---|---|---|---|
| background | Midnight Navy `#070B1A` | `hsl(225 40% 98%)` | Page |
| surface | Deep Space Blue `#10172D` | white | Cards, sidebar |
| primary | Electric Cyan `#00D9FF` | `hsl(191 100% 26%)` | Primary actions, focus ring, active nav |
| accent | Royal Violet `#8057FF` | `hsl(254 100% 60%)` | AI surfaces (Copilot, agents) |
| success | Emerald `#00D49A` | `hsl(163 100% 24%)` | Positive states |
| warning | Amber `#FFB547` | `hsl(32 100% 30%)` | Demo banner, attention |
| critical | Coral Red `#FF6178` | `hsl(351 75% 42%)` | Errors, destructive |
| foreground | Frost White `#F5F8FF` | `hsl(228 45% 10%)` | Text |
| muted-foreground | Cool Slate `#9DAAC8` | `hsl(225 20% 36%)` | Secondary text |

Light-mode values were darkened until every text/background pair passes WCAG AA 4.5:1 (verified by the
axe suite). Tenants can override `primary` with a brand colour (Settings → Workspace); the shell converts it
to the token format at runtime. Phase 6 adds a contrast check on save.

Typography: Inter / system UI stack, tabular numerals for metrics. Radius 12px. Spacing on a 4px grid.

## 3. Layout

- **Top bar:** logo (mobile), global search (Ctrl/⌘ K), Copilot, Create, notifications, tasks, calendar,
  integration status, help, account menu (workspace switcher, settings, sign out).
- **Sidebar:** 26 modules in five groups (Workspace, Engage, Intelligence, Revenue, Organization), collapsible
  to icons with tooltips; planned modules carry a phase badge. On mobile it becomes a drawer.
- **Content:** page header (title, description, actions) then cards. Max widths per page type keep line lengths
  readable.

## 4. Motion system

| Setting | Behaviour |
|---|---|
| System (default) | Follows `prefers-reduced-motion` |
| Full | Page transitions, staggered card entrance, animated KPI counters, spring sidebar indicator, chart animation, ambient drift |
| Reduced | Final values render immediately; no drift or counters; essential fades only |
| Off | All CSS transitions/animations neutralised; Motion configured with `reducedMotion="always"` |
| Low-power (toggle) | Removes ambient background; Phase 7 swaps 3D scenes for 2D |

Preferences persist per device today; Phase 2 stores them on the user profile so they follow the user.

## 5. Accessibility (target WCAG 2.2 AA)

Implemented: skip link, semantic landmarks and headings, labelled icon buttons, form fields wired with
`aria-invalid` / `aria-describedby`, live regions for status, keyboard-operable menus and dialogs (Radix),
visible focus rings, chart ↔ table toggle, screen-reader values for animated numbers, axe checks in CI.

## 6. Component inventory

Phase 1 (`packages/ui`): Button, Input, Label/Field, Card, Badge, Skeleton, Tooltip, DropdownMenu, Dialog/Sheet.
Phase 2: DataTable (TanStack Table with column config, saved views), Kanban board (dnd-kit, keyboard moves),
Select/Combobox, DatePicker, Tabs, Toast, Record timeline, Empty states.
Phase 3: Flow canvas nodes (React Flow), Approval card.
Phase 7: 3D islands (Relationship Galaxy, Revenue Globe, pipeline flow), each lazy-loaded with a fallback.

## 7. Key screens

| Screen | Status | Notes |
|---|---|---|
| Sign up / sign in | **Built** | Shared Zod validation, server errors mapped to fields |
| Command Center | **Built** | 15 KPIs from the API with formula tooltips; pipeline chart/table; audited activity stream; roadmap card |
| Settings | **Built** | Workspace (role-gated), appearance and motion |
| Team Management | **Built** | Members, inline role change (role-gated), role catalogue |
| Administration | **Built** | Paginated audit log |
| Billing | **Built (read-only)** | Current plan; proposed rate card clearly labelled |
| Integrations | **Built (status board)** | All "Not connected" with credential requirements |
| Planned modules | **Built (roadmap pages)** | Phase, capabilities, honest status |
| Leads, Deals (Kanban) … | Phase 2+ | |

## 8. User journeys

1. **First run:** Sign up → workspace provisioned (roles, default pipeline, Free plan) → Command Center with
   empty-state KPIs → (Phase 2) guided import → first deal on the Kanban board.
2. **Daily rep loop (Phase 2–4):** Command Center radar → open at-risk deal → AI brief → log call → Copilot
   drafts follow-up → approve send → deal advances.
3. **Manager review (Phase 4–5):** Forecast view → compare to last week's snapshot → drill into changed deals
   → coaching notes.
4. **Admin setup:** Settings → brand colour, currency, time zone → Team → roles → Integrations → connect
   mailbox (Phase 3) → Automation Studio template (Phase 3).

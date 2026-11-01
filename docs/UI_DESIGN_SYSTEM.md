# DealFlow UI/UX Design Specification

## 1. Experience principles

1. **Clarity first, spectacle second.** Motion and 3D explain change over time or structure; they are never
   the only way to read information.
2. **Honest interfaces.** No hardcoded numbers in production, no buttons that silently do nothing. Unshipped
   modules say so and say when.
3. **Long-session comfort.** Dark signature theme with restrained gradients; a light theme with AA contrast;
   motion the user controls.
4. **Explain AI.** Every recommendation shows its evidence and the approval it needs.

## 2. Tokens and themes (`packages/ui/src/tokens.css`, `packages/types/src/appearance.ts`)

Colours are CSS variables holding HSL triplets, consumed through the Tailwind preset (`bg-surface`, `text-primary`,
`bg-secondary`, `text-info`...). The theme engine (ADR 0040) writes them on `<html>` from the chosen theme:

| Theme | Character |
|---|---|
| DealFlow Signature (default) | Midnight navy, electric cyan, royal violet |
| Obsidian Intelligence | Black, charcoal, electric violet |
| Midnight Sapphire | Navy, royal blue, cyan |
| Aurora Enterprise | Deep indigo, teal, violet |
| Arctic Professional | White, slate, blue |
| Pearl Executive | Pearl white, champagne, graphite |
| Emerald Command | Forest green, mint, charcoal |
| Titanium Silver | Metallic grey, ice blue |
| Solar Horizon | Warm ivory, amber, deep navy |
| Rose Quartz | Soft rose, plum, neutral grey |
| Cyber Graphite | Graphite, electric cyan |
| Oceanic Intelligence | Marine blue, turquoise |
| Custom Brand Studio | The person's own primary, secondary, accent and backgrounds |

Every theme has light and dark variants. Derived tokens: `background`, `surface`, `surface-raised`, `muted`,
`border`, `input`, `ring`, `foreground`, `muted-foreground`, `primary`/`secondary`/`accent` with `-foreground`,
`success`, `warning`, `critical`, `info`, `popover`, `chart-1`..`chart-6`. Text colours are pushed to 4.5:1 against
every surface and their own tint, body text to 7:1, charts to 3:1 (unit-tested for every theme and chart palette).

Layout variables: `--radius`, `--font-scale` (root font size), `--control-h` / `--control-h-sm` (`h-control`,
`h-control-sm`; small floors at 24 px), `--card-pad` (`p-card`), `--cell-py` (table rows), `--layout-gap`
(`gap-layout`), `--shadow-strength`, `--glass`, `--icon-stroke`. Data attributes on `<html>`: `data-theme`,
`data-motion`, `data-density`, `data-card`, `data-sidebar`, `data-background`.

Density: Comfortable 44 px controls, Balanced 40 px (default), Compact 36 px, Ultra compact 32 px.
Glass (`.df-glass`) is only for overlays and the sidebar; cards (`.df-card`) are always opaque.

Settings are saved to the person's account (`GET /me/preferences`, `PUT /me/preferences/appearance`), named themes
at `/me/themes`, and admins can set a workspace default at `PUT /tenants/current/appearance`. The Theme Studio is
at Settings → Theme Studio (`/app/settings/appearance`); the top bar palette button switches mode and theme.

Typography: Inter / system UI stack, tabular numerals for metrics. Spacing on a 4px grid.

## 3. Layout

- **Top bar:** logo (mobile), global search and commands (Ctrl/⌘ K), a star that adds the current page to
  favourites, Copilot, Create, notifications, theme switcher, Focus Workspace, keyboard shortcuts, tasks, calendar,
  integrations, help, account menu (workspace switcher, settings, sign out).
- **Sidebar:** Favourites and Recent (the last five pages, labelled by their heading) above the modules in five
  groups (Workspace, Engage, Intelligence, Revenue, Organization). Collapsible to icons with tooltips (`[`);
  planned modules carry a phase badge. **Customize menu** reorders modules within a group and hides ones the
  person does not use (Settings is always shown; hidden modules stay in search). All of this is saved per person
  per workspace at `/me/navigation` (ADR 0041). On mobile it becomes a drawer.
- **Mobile bottom bar** (below `lg`): Home, Leads, Create, Deals, Tasks. `main` has bottom padding so content is
  never hidden behind it.
- **Command palette:** fuzzy matching (`lib/fuzzy.ts`: substrings and initials such as "qbs"), groups for records,
  Favourites, Recent, Create, Modules (including hidden ones), Actions (Focus Workspace, light/dark, Theme Studio,
  Customize menu, shortcuts) and "Ask Copilot" with the typed question.
- **Focus Workspace** (Ctrl/⌘ .): hides the sidebar, ambient background and secondary top-bar icons, with a
  banner to exit. Kept on this device.
- **Keyboard shortcuts** (`?` opens the sheet): `g` then a letter goes to a page (h, l, c, o, d, q, t, m, r, s);
  `n` then a letter creates (l, c, o, d, t). Letter shortcuts never fire while typing in a field.
- **Content:** page header (title, description, actions) then cards. Max widths per page type keep line lengths
  readable.

## 4. Motion system

| Setting | Behaviour |
|---|---|
| Full | Page transitions, staggered entrances, animated KPI counters, chart animation, ambient drift; ignores the OS setting |
| Balanced (default) | Interface transitions and counters, no ambient drift; follows `prefers-reduced-motion` |
| Minimal | Final values render immediately; keyframe animations stop; essential fades only |
| Off | All CSS transitions/animations neutralised; Motion configured with `reducedMotion="always"` |
| Low-power (toggle) | Removes the ambient background and swaps 3D scenes for 2D |

Motion and every other appearance setting are saved to the person's account and follow them across devices.

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
| Settings | **Built** | Workspace (role-gated), quick appearance, motion and density |
| Shell and navigation | **Built** | Favourites, recent pages, customisable menu, Focus Workspace, shortcuts sheet, fuzzy command palette, mobile bottom bar |
| Theme Studio | **Built** | 13 themes, colour and layout controls, live preview, readability check, saved themes, workspace default |
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

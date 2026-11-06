# ADR 0040: Theme engine, Theme Studio and account-saved appearance

- Status: Accepted
- Date: 2026-11-01
- Part of: Frontend design spec (Part 2 premium theme engine, Part 11 motion settings, Part 13 long-session comfort)

## Context

The frontend design spec asks for at least 12 named themes plus a fully custom brand theme, each in light and dark,
with controls for colours, background tone, surface intensity, radius, text size, density, sidebar and card style,
shadows, glass, motion, chart palette, icon style and workspace background. It asks for live previews, named saved
themes, per-person storage and an optional organisation-wide theme, using tokens instead of hard-coded colours, and
it requires every theme to stay readable.

Before this change SampForce had one dark and one light palette in `tokens.css`, a workspace brand colour that
replaced `--primary` as-is (with no contrast check), and theme and motion settings kept only in the browser.

## Decisions

1. **Themes are data, tokens are derived.** `packages/types/src/appearance.ts` holds the catalogue: SampForce
   Signature (the original look, kept as the default) and the spec's 12 themes. Each has a small base palette per mode
   (background, surface, foreground, primary, secondary, accent, six chart colours). `resolveTheme` derives every
   other token (raised surface, muted, borders, semantic colours, on-colour text) and returns HSL triplets for the
   existing CSS variables, so no component changed how it reads colours.
2. **Readability is enforced, not hoped for.** Every text-bearing colour is moved lighter or darker, keeping its hue,
   until it reaches 4.5:1 against the page, cards, raised and muted surfaces and its own 15% tint (badges, active
   navigation); body text reaches 7:1; chart series reach 3:1 against cards. A custom or brand colour that needed
   moving is reported in plain words in the Theme Studio. Unit tests check all 13 themes, both modes and all four
   chart palettes against twelve WCAG checks, and Playwright runs axe on four themes.
3. **One shared schema.** `appearanceSchema` (strict Zod) is used by the API to validate and by the web app to
   normalise older or partial settings, so stored JSON can never inject CSS: colours are 6-digit hex only and every
   other field is an enum or a bounded integer.
4. **Saved to the person, not the device or the workspace.** `user_preferences` (one row per user) and
   `user_saved_themes` (up to 20 named themes) carry no `tenant_id`, like `password_reset_tokens`, because a person's
   theme follows them across workspaces. The API only reads the caller's own rows. `tenants.default_appearance` holds
   an optional workspace default, set by `tenant:manage` and audited (`tenant.appearance_default_set` / `_cleared`).
   The effective settings are: the person's own, else the workspace default, else SampForce's default.
5. **No flash on load.** The browser caches the last painted variables (`dealflow:appearance-paint`) and an inline
   script applies them before first paint; the account's settings then win on load, unless this device has a change
   that has not reached the server yet, which is uploaded. Changes save half a second after they are made.
6. **Effects stay out of the way of work.** Glass applies only to menus, sheets, the command palette, Copilot and the
   sidebar; cards, forms and tables are opaque. Ambient drift runs only on Full motion. Ultra-compact density keeps
   small controls at 24 px (WCAG 2.2 target size). In-text links are underlined so no theme relies on colour alone.
7. **Motion levels follow the spec.** Full, Balanced (default; follows the OS reduce-motion setting), Minimal
   (essential fades only) and Off. Older device settings migrate: System becomes Balanced, Reduced becomes Minimal.

## Consequences

- The workspace brand colour now goes through the same contrast rules, so a pale brand colour is darkened in light
  mode instead of producing unreadable buttons.
- Text size scales the root font size, so every rem-based measurement scales with it. The studio preview shows text
  size only after Apply.
- Components that hard-coded a colour (one badge did) now use tokens; new components must too.

## Not done here

Per-module layouts, favourites and menu ordering (shell PR), table density beyond row padding (shared data table
PR), and a forced organisation theme that members cannot override.

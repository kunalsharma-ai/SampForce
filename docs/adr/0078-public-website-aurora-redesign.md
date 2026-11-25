# ADR 0078: Public website Aurora redesign, sign-in portal and Help & Support

Status: accepted (2026-11-25)

## Context

The public home page (`/`, `/pricing` and the privacy pages share its frame) was a plain list of modules on the
workspace's own theme, so it showed whatever colours the last signed-in workspace had painted. Kunal asked for a
complete redesign with rich animation, a palette of its own, light and dark modes, a Help & Support button and a more
attractive way to sign up and sign in.

## Decision

- **Ember palette from the logo, scoped.** (First drafted as a violet/cyan "Aurora" palette; changed on review so the
  site carries the SampForce logo's red, ember and amber.) `components/site/site.css` sets the shared design tokens (`--background`, `--primary`…)
  on the site root (`.sfx-root`) and on its dialogs (`.sfx-scope`, since Radix portals render outside the page), so
  shared components (buttons, inputs, the language picker) take the palette without changes. Dark: near-black
  ember ink, logo red, ember orange, amber and a pale spark. Light: warm paper with deeper reds at AA contrast. The logo
  is shown larger, with "Force" in the logo's red-to-amber, and the bolt sits at the centre of the hero orbit.
- **Own light and dark modes.** `useSiteTheme` follows the device until the visitor picks one, keeps the choice in
  `localStorage` (`sampforce:site-theme`), sets `html.dark` while the site is open (shared `dark:` utilities read it)
  and puts the app's theme back on leaving.
- **Animation.** A once-per-tab lightning strike on arrival, a scroll progress bar, a canvas sky (ember ribbons,
  embers rising and sparks thrown off the pointer, a constellation that leans to it, paused when hidden), electric
  arcs off the orbit core, faint drifting bolt watermarks, section headings with a bolt-tipped underline sweep,
  rising headline letters (word by word in Arabic), a kinetic Sell/Close/Grow ticker, the revenue orbit with the eight
  real modules and deals spiralling in, a capability marquee, a self-moving sample pipeline (labelled as sample
  deals), spotlight/tilt bento cards and a drawing AI-steps line. Everything holds still under reduced motion and the
  app's motion "off"/"minimal" settings.
- **Sign-in and sign-up portal.** "Sign in" and "Start free" open a full-screen portal over the page (warp streaks,
  flipping card). Sign-up asks one question per step (constellation progress, live password checklist and strength,
  workspace preview), checks each step with the API's own `registerSchema`, and returns to the step a server error
  belongs to. Sign-in supports two-step verification (reuses `SecondFactor`) and SSO. `#sign-in` and `#start` open it
  directly; the links still point at `/login` and `/signup` for new tabs, invitations, SSO returns and `?next=`.
- **Help & Support for signed-out visitors.** A floating orb opens a panel with searchable answers (accent-insensitive,
  searches the reader's language too) and quick links, plus "Message us". Messages go to
  `POST /api/v1/site/support-requests` (public, 5 per 10 minutes per address, honeypot field) and are stored in the
  global `site_support_requests` collection with a short reference (`SF-XXXXXX`). The Console reads them under
  Support tickets > Website messages (`/operator/support/site-requests`, permission `support.handle`) and marks them
  handled or reopens them; both are in the platform audit log. Replies go out by email from the Console.

## Consequences

- No customer logos, ratings or usage numbers; the illustrations use made-up deals, labelled as such.
- Website messages do not notify anyone yet; the Console list refreshes every minute.
- Translations of the new text were written by Claude and need the same native-speaker review as the rest.

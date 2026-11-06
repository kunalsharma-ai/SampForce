# Editing the SampForce page

Most changes need only **one file: `src/content/site.js`**. Run `npm run dev` and the page reloads as you save.

## Text, links and prices

| What | Where in `site.js` |
|---|---|
| Button and footer links (demo, contact, privacy…) | `links` |
| Menu items | `nav` (each `href` is a section id) |
| Hero headline, sub-heading, buttons, the three proof ticks | `hero` |
| Floating event cards around the hero screen | `hero.pulses` (`tone`: gold, ember, volt, mint; `icon`: any name in `components/Icon.jsx`) |
| Sliding capability words | `marquee` |
| Six journey stages | `journey.stages` (`color`: volt, plasma, gold, mint, ember, rose; `media`: image name) |
| Feature tiles | `features.tiles` (see bento sizes below) |
| AI agents and guardrails | `agents.list`, `agents.guardrails` |
| Flip cards and the price chart | `difference.cards`, `difference.priceChart` |
| Hide the competitor price chart | `showCompetitorPrices: false` |
| Product tour screens | `tour.shots` (`group` creates the filter chips) |
| Counters | `numbers` |
| Plans and allowances | `pricing.plans` (`featured: true` gives the "Most popular" badge) |
| Trust cards, final call to action, footer note | `trust`, `cta`, `footer` |

In section titles, wrap words in `*stars*` to set them in the italic serif with the section's colour gradient,
e.g. `title: 'Everything that powers *the force*'`.

Before adding a number or a claim about competitors, read [CONTENT_SOURCES.md](CONTENT_SOURCES.md).

## Images

Screenshots live in `src/assets/media/` as WebP and are referenced by file name without extension
(`media: 'command'` → `command.webp`).

To add or replace screenshots:

1. Take them at 1440×900 with device scale 2 (2880×1800 PNG). Use a demo workspace; the app shows a
   "synthetic data" banner, keep it.
2. Put the PNGs in any folder and run `npm run images -- /path/to/folder`. Each becomes a 1600 px wide WebP
   (phones 720 px) in `src/assets/media/` with the same name. Re-using a name replaces that image everywhere.
3. Reference the name in `site.js`.

The full-resolution PNGs of the current screens are in the project's shared folder
(`sampforce-showcase/screenshots-hd/`).

The current screens were taken from the real app with the SampForce name and a SampForce brand theme
(Theme Studio → Custom Brand Studio: primary `#FF6A3D`, secondary `#E0245E`, accent `#FFC857`, background
`#0C0A12`). Retake them after the official rebrand ships if anything in the app's look changes.

## Logos

`src/assets/brand/` holds the logos Kunal supplied. `sampforce-logo-dark.svg` is the version **for dark
backgrounds** (light text); `sampforce-logo-light.svg` is for light backgrounds. The favicon and app icon are in
`public/brand/`. Replace the files with the same names to update the brand everywhere.

## Colours and fonts

All colours are CSS variables in `src/styles/tokens.css`:

- Brand, from the logo: `--gold`, `--flare`, `--ember`, `--crimson`, `--blood`, `--slate`.
- Section colour grading: `--volt` (cyan), `--plasma` (violet), `--mint`, `--rose`.
- Gradients: `--grad-bolt` (buttons, headline accents), `--grad-aurora`.
- Surfaces: `--ink` (page), `--paper` (the light comparison section).

Fonts: **Unbounded** (headlines), **Instrument Serif italic** (accent words), **Manrope** (body),
**JetBrains Mono** (labels). They are bundled from npm (Fontsource). To change one, install the Fontsource package,
import it in `src/main.jsx`, and update `--font-*` in `tokens.css`.

The particle colours are in `src/three/heroField.js` (`GALAXY_COLORS`, `boltTop/Mid/Low`); globe colours are in
`src/three/globe.js`.

## Sections

`src/App.jsx` lists the sections in page order. Delete a line to remove a section, move it to reorder. Each section
is one file in `src/sections/` with its styles in `src/styles/sections.css` under a matching heading.

### Feature tile sizes

The feature grid has 6 columns. `size` decides how many a tile spans: `xl` = 4 (two rows), `tall` = 2 (two rows),
`wide` = 3, `md` = 2. Keep each row adding up to 6, e.g. `xl + tall`, `wide + wide`, `md + md + md`.

## Animation settings

| Effect | Where |
|---|---|
| Particle count, size, morph timing | `heroField.js`: `count`, `uSize`, `CYCLE` (seconds for galaxy, converge, hold, scatter) |
| Bolt position in the hero | `heroField.js` → `resize()` |
| Globe cities and routes | `globe.js` → `CITIES`, `ROUTES` |
| Agent orbit speed | `sections.css` → `.orbit__track` (`70s`) |
| Tour ring speed | `Tour.jsx` → `0.08` (degrees per frame) |
| Marquee speed | `sections.css` → `.marquee__track` (`50s`, `58s`) |
| Scroll reveal | `components/ui.jsx` → `Reveal` |

Every animation checks `prefers-reduced-motion`. Keep that when adding new ones: use `useReducedMotion()` from
framer-motion, or put CSS animations where the global rule in `base.css` can stop them.

## Accessibility notes

- Images have `alt` text; decorative ones use `alt=""`.
- Flip cards, agent chips, tour panels and the pricing toggle are real buttons, usable by keyboard.
- The lightbox closes with Escape and pages with the arrow keys.
- An axe-core scan (WCAG 2.0–2.2 A and AA rules) of the whole page found no violations on 6 Nov 2026. Re-run it if you
  change colours: contrast is the easiest thing to break.

# SampForce showcase web page

The product page for **SampForce by Sampledge**, built to sit on the main Sampledge website.
React 19 + Vite, with three.js for the 3D scenes and Framer Motion for the scroll and hover animations.

| You want to… | Read |
|---|---|
| Run it on your laptop | [Quick start](#quick-start) below |
| Put it live, or add it to sampledge.com | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) |
| Change text, prices, links, images, colours or sections | [docs/EDITING_GUIDE.md](docs/EDITING_GUIDE.md) |
| Check where every claim and number comes from | [docs/CONTENT_SOURCES.md](docs/CONTENT_SOURCES.md) |
| Test before a release | [docs/QA_CHECKLIST.md](docs/QA_CHECKLIST.md) |

## Quick start

Needs Node.js 20.19 or newer (22 LTS recommended).

```bash
cd website
npm install
npm run dev          # http://localhost:5173 with live reload
```

## Builds

```bash
npm run build             # dist/             the static site to deploy (about 3.5 MB, images cached for a year)
npm run build:standalone  # dist-standalone/sampforce-showcase.html   one file, everything inlined (about 4.7 MB)
npm run build:all         # both, then npm run check
npm run preview           # serves dist/ on http://localhost:4173
```

The **standalone file** opens straight from disk (double-click), needs no internet and no server. Use it to review
the page or send it round for sign-off. Deploy `dist/` to production: it loads faster because the browser caches
each image separately.

## What is on the page

1. **Hero**: 11,000 particles swirl as a "lead galaxy", then condense into the SampForce bolt and scatter again
   (leads become momentum). The cursor pushes particles away. Below it, the Command Center in 3D perspective that
   flattens as you scroll, with live-event cards floating around it.
2. **Capability marquee**: two rows of capabilities sliding in opposite directions.
3. **Journey**: Capture → Engage → Automate → Predict → Close → Grow. A pinned screen changes as each stage scrolls
   past, and a colour-graded "current" fills the rail.
4. **Features bento**: nine tiles with 3D tilt, cursor spotlight and zoomed product screens.
5. **AI agents**: the ten real SampForce agents orbit the bolt; hover one to read what it does. Guardrails beside it.
6. **Immersive**: an interactive dotted globe (Natural Earth land data) with deal arcs between cities, drag to spin,
   flanked by Relationship Galaxy and Pipeline replay screens on parallax.
7. **Why SampForce**: a light "paper" section with six flip cards (often in the market → the SampForce way) and an
   animated price chart of published entry prices.
8. **Product tour**: 25 real screens on a 3D ring. Drag to spin, filter by area, click to open a full-size lightbox
   (arrow keys and Escape work).
9. **Make it yours**: dark/light split that wipes as you scroll, phones on parallax, Theme Studio.
10. **Numbers**, **Pricing** (monthly/annual toggle), **Trust**, **Final call to action**, **Footer**.

Everything respects the visitor's "reduce motion" setting: the bolt is shown still, loops stop and scroll effects
are switched off. 3D scenes pause when off screen or when the tab is hidden. Without WebGL the hero falls back to the
logo and the globe to a screenshot.

## Folder map

```
website/
├── index.html               page shell, title, meta and social tags
├── src/
│   ├── content/site.js      ALL page text, links, prices, agent list, comparison cards
│   ├── content/media.js     loads every image in src/assets/media by file name
│   ├── assets/media/        product screenshots (WebP)
│   ├── assets/brand/        SampForce logos and icon (SVG + PNG)
│   ├── sections/            one React component per page section
│   ├── components/          shared pieces: Reveal, TiltCard, Magnetic button, CountUp, Icon
│   ├── three/heroField.js   hero particle scene (plain three.js)
│   ├── three/globe.js       globe scene (plain three.js)
│   ├── three/land-dots.json land points for the globe, from world-atlas (Natural Earth, public domain)
│   └── styles/              tokens.css (colours, fonts), base.css, sections.css
├── public/                  favicon, social image (copied as-is)
├── scripts/                 image optimiser, standalone finisher, build check
├── Dockerfile, nginx.conf   container hosting
├── netlify.toml, vercel.json  one-click hosting configs
└── docs/                    deployment, editing, sources, QA
```

## Licences

All runtime libraries are MIT (React, three.js, Framer Motion) or OFL (fonts: Unbounded, Manrope, Instrument
Serif, JetBrains Mono, self-hosted through Fontsource, so no Google Fonts request). Globe land shapes come from
world-atlas (ISC), built from Natural Earth (public domain).

# SampForce product page

The SampForce product page for the Sampledge website: a React 19 + Vite single-page site with a three.js 3D hero,
scroll-driven storytelling (framer-motion) and real product screenshots.

| Path | What it is |
|---|---|
| `preview/index.html` | **One self-contained file** (all code, fonts and images inlined). Double-click to open, or email it. |
| `src/content.ts` | **All copy, numbers, links, plans and screenshots.** Edit this to change words without touching layout. |
| `src/App.tsx` | Section order. Remove or reorder sections here. |
| `src/components/` | `Hero` + `HeroScene` (3D), `ForceLoop` (sticky story), `Sections` (features, AI, 3D carousel, why us, phones and languages, security, integrations, pricing, final call to action, nav, footer), `ui` (reveal, word split, counter, tilt, frame, logo). |
| `src/styles/` | `global.css` (colour tokens, type, buttons) and `sections.css` (each section). Plain CSS, no framework. |
| `src/assets/screens/` | Product screenshots (WebP, 1920×1200; phones 585×1266), captured from a running SampForce build. |
| `src/assets/brand/`, `public/` | SampForce logo files and favicon. |

## Run and build

Needs Node 20.19+ (22 or newer recommended).

```bash
npm install
npm run dev            # http://localhost:5173 with hot reload
npm run build          # type-check, then dist/ for hosting
npm run build:preview  # preview/index.html, one self-contained file
```

## Put it live

`npm run build` writes a static site to `dist/` (an `index.html` plus hashed files in `dist/assets/`). Any static
host works: Nginx, Apache, S3 + CloudFront, Netlify, Vercel, Cloudflare Pages. Cache `assets/*` for a year
(file names change when content changes); do not cache `index.html` for long.

**Under a path of the main site**, e.g. `https://www.sampledge.com/products/sampforce/`:

```bash
VITE_BASE=/products/sampforce/ npm run build
# copy dist/* to that folder on the web server
```

Nginx example:

```nginx
location /products/sampforce/ {
  alias /var/www/sampforce/;
  try_files $uri $uri/ /products/sampforce/index.html;
  location ~* /assets/ { expires 1y; add_header Cache-Control "public, immutable"; }
}
```

**Inside an existing React site:** copy `src/` into the site (for example `src/pages/sampforce/`), install the
dependencies from `package.json`, import the two CSS files once, and render `<App />` on the route. The styles use
plain class names; if they clash with the site's own, wrap the page in a container and prefix the selectors.

**As an embed:** host `dist/` anywhere and use `<iframe src="…" style="width:100%;height:100vh;border:0">`.
Linking to the page is better for SEO than an iframe.

## Before publishing

1. Set the real links in `src/content.ts` → `links` (sign-up, sign-in, pricing, sales contact). They are placeholders.
2. Competitor comparison (`why.comparison`): every line quotes the vendor's own pricing page, accessed 30 October 2026.
   Re-check each page before publishing and have it reviewed by legal; set `showNamedComparison = false` to hide the
   table and keep the rest of the section.
3. Prices in `plans` follow the approved SampForce rate card (USD). Keep them in step with the product's pricing page.
4. Update `og:image` in `index.html` to an absolute URL once you know the final address.

## Replacing screenshots

Drop a new WebP (or PNG/JPG) into `src/assets/screens/`, import it at the top of `src/content.ts`, and use it in the
section you want. Keep 16:10 at 1920×1200 for the browser frames. The current set was captured from a SampForce
workspace filled with fictional sample companies ("Northwind Research"); no real customer data is shown.

## Design notes

- **Colour story:** cool cyan and violet (leads, AI) heat up into coral, ember and amber (deals closing), the same
  journey the hero's particles take into the bolt. Brand colours are the logo's: `#E02424`, `#FF8A8A`, `#FFC857`,
  `#7F1D1D`. One light "paper" section (Why SampForce) breaks the dark rhythm.
- **Type:** Montserrat (display, matches the wordmark), Inter (body), Instrument Serif italic (accent words). All
  self-hosted through Fontsource, so no Google Fonts request at runtime.
- **Motion:** everything respects the visitor's "reduce motion" setting (one still frame of the 3D scene, no auto
  carousels, no parallax). The 3D scene pauses when off screen or in a background tab and falls back to the flat
  logo when WebGL is unavailable.
- **Accessibility:** skip link, landmarks, real headings, alt text on screenshots, keyboard-reachable controls,
  visible focus rings.

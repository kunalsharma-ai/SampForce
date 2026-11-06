# Deploying the SampForce page

The page is a static site: after `npm run build`, everything lives in `dist/` (one `index.html`, plus hashed files in
`dist/assets/`). Any static host works. No server code, database or environment secrets are needed.

## 1. Before you go live

1. **Links.** Set the real demo, sign-up, contact, privacy and terms URLs in `src/content/site.js` → `links`.
   They currently point at `mailto:sales@sampledge.com` and `#` placeholders.
2. **Competitor chart.** Re-check the prices and get the legal sign-off described in
   [CONTENT_SOURCES.md](CONTENT_SOURCES.md), or set `showCompetitorPrices: false`.
3. **Social image.** `index.html` uses `/og-image.jpg`. Social networks need an absolute URL: change it to
   `https://www.sampledge.com/<your path>/og-image.jpg` once you know the final address.
4. **Analytics.** None is included. Add your tag (Google Tag Manager, Plausible, etc.) to `index.html` the same way
   as on the rest of sampledge.com, and add its consent handling.
5. Run the [QA checklist](QA_CHECKLIST.md).

## 2. Choose how it joins sampledge.com

### Option A: its own sub-path (recommended)

Serve the page at, say, `https://www.sampledge.com/products/sampforce/`.

```bash
BASE_PATH=/products/sampforce/ npm run build
```

Upload the contents of `dist/` to that folder on the web server or CDN. `BASE_PATH` must start and end with `/`.
All asset URLs are then prefixed correctly.

### Option B: its own sub-domain

For `https://sampforce.sampledge.com`, build with the default base (`npm run build`) and point the sub-domain at a
static host (Netlify, Vercel, Cloudflare Pages, S3 + CloudFront, or the Docker image below).

### Option C: inside the existing React site

If sampledge.com is itself a React app (Next.js, Vite, CRA):

1. Copy `src/sections`, `src/components`, `src/three`, `src/content`, `src/assets` and `src/styles` into it.
2. `npm install three@0.186.1 framer-motion@14.4.0 @fontsource-variable/unbounded @fontsource-variable/manrope @fontsource-variable/jetbrains-mono @fontsource/instrument-serif`.
3. Render `<App />` from `src/App.jsx` on the route you want, and import the fonts and three CSS files as
   `src/main.jsx` does.
4. In **Next.js**, mark the page `'use client'` (it uses the browser, WebGL and scroll APIs) and load it with
   `dynamic(() => import('./App'), { ssr: false })`. `import.meta.glob` in `src/content/media.js` is Vite-only:
   replace it with explicit `import x from '../assets/media/x.webp'` lines.
5. The styles are global (`body`, `h1`, `.btn`…). If they clash with your site's CSS, wrap the page in a
   container and prefix the selectors, or keep Option A.

### Option D: embed with an iframe

Quickest, but the URL bar and SEO stay on the parent page:

```html
<iframe src="https://sampforce.sampledge.com/" title="SampForce by Sampledge" style="width:100%;height:100vh;border:0" loading="lazy"></iframe>
```

## 3. Hosting recipes

| Host | Steps |
|---|---|
| **Netlify** | New site from the repo, base directory `website`. `netlify.toml` sets the build and cache headers. |
| **Vercel** | Import the repo, root directory `website`. `vercel.json` sets the build and cache headers. |
| **Cloudflare Pages** | Root `website`, build `npm run build`, output `dist`. |
| **AWS S3 + CloudFront** | `aws s3 sync dist/ s3://<bucket>/<path>/ --delete`, then set `Cache-Control: public, max-age=31536000, immutable` on `assets/*` and `no-cache` on `index.html`, and invalidate `/<path>/index.html`. |
| **Any nginx / Apache** | Copy `dist/` to the web root. For nginx use `nginx.conf` from this folder. |
| **Docker** | `docker build -t sampforce-website .` then `docker run -p 8080:8080 sampforce-website`. Add `--build-arg BASE_PATH=/products/sampforce/` for a sub-path. |

Caching rule of thumb: everything in `assets/` has a content hash in its name, so cache it for a year;
`index.html` must be revalidated so a new deploy shows up immediately.

## 4. Content Security Policy

If sampledge.com sends a CSP header, the page needs:

```
default-src 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'
```

`style-src 'unsafe-inline'` is needed because the animation library writes inline `style` attributes. The
standalone single-file build also inlines its script, so it needs `script-src 'unsafe-inline'`: use it for review,
not behind a strict CSP.

## 5. Updating after launch

Edit, then `npm run build` and upload `dist/` again (or push, if the host builds from git). Old hashed assets can
stay in place; they are no longer referenced.

## What was and was not tested

Tested in this build: `npm run build`, `npm run build:standalone`, `npm run check`, and Chromium (Playwright) at
1440×900 and 390×844 against both the built site and the standalone file opened from disk, with and without
"reduce motion", plus an axe-core accessibility scan (WCAG 2.2 A/AA rules, no violations). The 3D scenes were rendered with software WebGL, so real-GPU frame rates were not measured.

Not tested: the Dockerfile (not built here), Safari and Firefox, real phones, and the Netlify/Vercel configs.

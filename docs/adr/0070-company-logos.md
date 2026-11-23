# ADR 0070: Company logos found from the website

- Status: Accepted
- Date: 2026-11-22

## Context

The company profile header showed a large country flag where a company's own mark belongs, and the companies list
had only text. Kunal asked (2026-11-22) for a "function or process" that puts the company's logo there once its
details are entered, presented attractively, with a small country flag kept on the profile.

## Decision

- **The logo is looked up from the company's own website.** When a company is saved with a website or domain (the
  lead form, the API, an edit), a `company_logos` document is queued (status `PENDING`). The worker reads the home
  page (following redirects, `www.` tried too), ranks its icon links (SVG first, then the declared size;
  `apple-touch-icon` counts as 180 px; Safari's one-colour `mask-icon` is skipped) and then `/apple-touch-icon.png`
  and `/favicon.ico`. It keeps the first image of 96 px or more (or an SVG), else the largest of at least 16 px.
  No third-party logo service is used: nobody outside learns which companies a workspace works with, there is no
  key to manage, and it also works for a self-hosted server on an office network.
- **Every byte is checked.** Requests go through `publicFetch` (public addresses only, each redirect re-checked,
  6 s per request, 25 s per look-up, pages cut at 600 KB, images refused over 1 MB). The image type comes from the
  bytes (PNG, JPEG, GIF, WebP, ICO, SVG), never from the server's `Content-Type`, so an HTML error page served as
  `image/png` is not kept.
- **Outcomes.** `FOUND`, `NOT_FOUND` (the site answered but has no usable icon) or, when the site does not answer,
  retried after 5 minutes, 1 hour and 1 day and then `FAILED`. A changed website looks again; a removed website
  drops the automatic logo. Companies saved before this change (or written by an import) are queued the first time
  they are listed.
- **People can choose.** `PUT /companies/:id/logo` uploads a logo (raw body, same rules, up to 1 MB). An upload is
  never replaced automatically, even when the website changes. `DELETE` goes back to the website's logo;
  `POST …/logo/refresh` looks it up again. Uploading and removing need `companies:write` and the right to see the
  company's details (ADR 0060), and are audited (`company.logo_uploaded`, `company.logo_removed`).
- **Serving.** Rows carry only `logo: { url, source, status, width }`; the image is `GET /companies/:id/logo`,
  visible to whoever can see the company. The URL carries a version, so it is cached as immutable. SVGs are served
  with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`, so one opened directly
  cannot run scripts.
- **Look.** The profile header shows the logo on a white tile with a soft glow and a small round country flag on its
  corner, plus a camera button for uploading, removing or looking again. The companies list shows a small logo
  before each name. Without a logo the tile is a monogram (first letters, legal suffixes left out) on a gradient
  whose colour comes from the name, so a company keeps its colour everywhere. Small favicons are drawn at no more
  than twice their size, so they stay sharp. The location column keeps its flag, because it shows the country.
- **Worker.** Look-ups run in the background of the worker tick (six at a time), so a slow website never holds up
  workflow events or sends; the next batch is claimed once one has finished.

## Consequences

- Logos appear a few seconds after a company is saved; the profile checks again while the look-up runs.
- Sites that only have a 16 or 32 px favicon get a small, sharp icon on the white tile rather than a large logo.
  Uploading a better one is one click.
- Look-ups against real websites are not covered by the test suite (a stand-in site server is), and some sites block
  automated requests; those end as `NOT_FOUND` or `FAILED` and keep the monogram.

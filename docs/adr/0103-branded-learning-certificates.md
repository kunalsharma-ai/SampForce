# 0103: Branded learning certificates

Date: 2026-11-28. Status: accepted. Builds on 0097 (Learning & Development) and 0100 (My Organization).

## Decision

- **One design, drawn twice.** `certificateDesign()` in `packages/types/src/learning-certificate-design.ts` returns the
  certificate as a list of shapes, text and images on an A4 landscape page (841.89 × 595.28 points). The API draws it
  with pdfkit into the PDF people download, and the app draws the same list as SVG. What people see on screen is the
  certificate they download.
- **Three looks**, chosen in Learning settings as before: Classic (ivory paper, brand-coloured band, guilloché border,
  foil rules), Modern (layered corner shapes in both brand colours, dot grid, rounded frame) and Executive (dark,
  brand-tinted paper with foil frame). Every look carries the logo, organisation name and tagline, "Certificate of
  completion", the learner, the module, the date, the score, the category or certificate ID, the signatory, a seal,
  a QR code that opens the public check page, the certificate ID and the verification code.
- **Branding comes from My Organization** and is read each time a certificate is drawn, so a new logo or new colours
  show on every certificate, old and new (`apps/api/src/learning/branding.ts`):
  - name: the issuer name in Learning settings, else the brand name in My Organization, else the workspace name;
  - tagline: My Organization's tagline;
  - logo: My Organization's logo, else the logo in the quotes and invoices settings;
  - colours: the first two brand colours in My Organization, unless the new "Use the brand colours from My
    Organization" setting is off (then the accent colour). A missing second colour is derived from the first.
- **Logos never stretch.** Any logo (PNG, JPEG, WebP, SVG) is turned into a trimmed PNG with `sharp` (added to the
  API), its aspect ratio is kept, and the design places it inside a fixed box by that ratio. Converted logos are cached
  by organisation and logo version.
- **Text always fits.** Names and module titles shrink to fit (the PDF measures the real glyphs; the screen uses an
  estimate and `textLength`), long module titles wrap to two lines, and Arabic goes through the Arabic PDF writer
  (ADR 0054).
- **Typefaces:** Playfair Display and Inter, under the SIL Open Font License, embedded and subset in the PDF
  (`apps/api/assets/fonts`) and served to the app (`apps/web/public/fonts/certificate`).
- **API:** `GET /learning/brand` (the branding a certificate uses), `GET /learning/brand/logo` (the logo as PNG),
  and public `GET /learning/verify/:code/logo` (throttled). `GET /learning/verify/:code` and `GET /learning/settings`
  now include the brand. Logos are sent with `nosniff` and a sandboxing Content Security Policy.
- **Database:** one optional field, `LearningSettings.useBrandColors` (missing means on). No migration is needed.

## Not done

- A drawn or uploaded signature image: the signatory's name is set in the script-like italic instead.
- Per-module or per-workspace branding: all certificates of an organisation share its brand.

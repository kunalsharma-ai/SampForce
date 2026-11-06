# ADR 0055: The product is now SampForce

- Status: Accepted
- Date: 2026-11-06

## Context

Sampledge renamed the product from DealFlow to **SampForce** ("Sell. Close. Grow.", by Sampledge) and supplied a new
logo: a two-part lightning bolt with speed streaks and a spark, in a red, coral and amber gradient, plus dark and light
wordmarks. Everything a person reads (the app, public pages, emails, PDFs, notifications, AI prompts, the browser
extension, the OpenAPI document, docs) has to say SampForce, without breaking stored data or running installations.

## Decision

- **Every user-facing "DealFlow" is now "SampForce"**, in all five languages. Page and server text is keyed by its
  English wording (ADR 0048, 0052), so keys and translations were renamed together. German compounds keep their
  hyphen ("SampForce-Konto").
- **Logo.** `components/logo.tsx` draws the new mark as a static SVG and the wordmark as text: "Samp" in slate,
  "Force" in the brand gradient (deep red in light themes, coral to amber in dark ones). The animated original files
  are in `apps/web/public/brand/` (served at `/brand/...`) for marketing use. `app/icon.svg` and `app/apple-icon.png`
  give the app a favicon and home-screen icon; the extension icons are redrawn from the 512 px icon.
- **Tagline.** The sign-in and landing headline now ends "Sell. Close. Grow." (was "Flow beyond limits.").
- **Plan names.** Migration `20261106010000_rebrand_sampforce` renames seeded plans "DealFlow <tier>" to
  "SampForce <tier>". A plan an operator renamed to something else is left alone. Old migrations are untouched,
  because Prisma checksums them.
- **Renamed technical names that people see:** webhook headers `X-SampForce-Signature`, `X-SampForce-Event`,
  `X-SampForce-Delivery` and `X-SampForce-Workflow-Signature`; outbound user agents (`SampForceBot/1.0` for the email
  finder, which now honours robots.txt rules for `SampForceBot`; `SampForce-Webhooks/1.0`; `SampForce-Automation/1.0`);
  the authenticator-app issuer for new two-step enrolments; CSV export and recovery-code file names; Prometheus alert
  names; the extension package name `sampforce-extension-<version>.zip`. The product has not launched, so no
  external receiver depends on the old header names.

## Kept on purpose

These are identifiers, not brand text, and changing them would break data, sessions or installations:

- Package names (`@dealflow/*`), the repository, Docker image and Helm chart names, compose service names.
- Database names and roles (`dealflow`, `dealflow_app`, `dealflow_owner`, `dealflow_backup`) and the
  `DEALFLOW_*_PASSWORD` variables.
- Key-derivation and signing labels (`dealflow-secretbox`, `dealflow-tracking-v1`, `dealflow-proposal-v1`), and the
  JWT issuer and audience: changing them would make stored secrets unreadable and signed links invalid.
- Prometheus metric names (`dealflow_*`), so dashboards and recording rules keep working.
- Browser storage keys (`dealflow:*`), so people keep their theme, language and saved views.
- The website tracker's public names (`window.dealflow(...)`, `data-dealflow-enquiry` and related attributes): sites
  that pasted the snippet keep working.
- Two-step entries people already added to an authenticator app keep their old label until they enrol again.

## Consequences

- Existing installations get the new plan names on their next migration; nothing else needs a data change.
- Extension store screenshots in `apps/extension/store/` must be retaken with the new name before submission.

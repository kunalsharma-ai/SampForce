# 0095. Website Enquiry replaces Website Visitors

Date: 2026-11-27. Status: accepted. Supersedes [ADR 0029](0029-website-visitor-intelligence.md).

## Context

The company website (Frequent Research) has its own super admin with a **Sampforce API** (System > Sampforce (sales)). It
holds every enquiry form, download form, case study and resource download, live chat lead, newsletter sign-up and
review. Sales wanted all of it inside SampForce the moment it arrives, presented so a new enquiry cannot be missed,
and wanted the anonymous Website Visitors tracking (ADR 0029) removed completely.

The website's guide (`docs/integrations/website-enquiries.md`) offers three things: a pull API with a Bearer `sfk_`
key (`/ping`, `/leads`, `/contacts`, `/reviews`, paged oldest first with `updatedSince` and `nextCursor`), a signed
webhook (`X-Sampforce-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`, events `lead.created`, `lead.updated`,
`newsletter.subscribed`, `review.created`, `careers.created`, `ping`, retried until a 2xx), and status write-back
(`PATCH /leads/:id` with status, stage, owner, sampforceId, url and note).

## Decision

A **Website Enquiry** section at `/app/website-enquiries`, first in the Workspace group, behind the opt-in plan
feature `website_enquiries` and the permissions `enquiries:read` and `enquiries:write`.

- **Set up once, in the Console** (ADR 0059). Providers > Website enquiries holds the API address, the `sfk_` key, the
  webhook signing secret and the **receiving workspace** (its web address name). Nothing goes in the environment file
  in production. Saving checks that the workspace exists and switches the feature on for it. Test connection calls
  `/ping` and reports missing rights (`leads:read`, `leads:write`).
- **Two ways in, one row.** `POST /api/v1/hooks/website-enquiries` checks the signature over the raw body (constant
  time, 5-minute window) and upserts by (workspace, record, website id). The worker also pulls every
  `WEBSITE_ENQUIRY_SYNC_MS` (10 minutes): everything the first time (without a notification per old lead), then only
  `updatedSince` the last complete pass minus a minute, at most 50 pages per collection per pass. A lease in
  `platform_settings` lets one worker sync at a time. Sign-ups come from `/contacts?source=newsletter` (form senders
  are already leads). A key without `contacts:read` or `reviews:read` skips that collection. An older copy never
  overwrites a newer one (`updatedAt`).
- **503 until configured.** Without a secret or receiving workspace the webhook answers 503, so the website keeps
  retrying (for up to 12 hours) and nothing is lost while the Console is being set up.
- **Status goes back.** Changing a lead's status, stage, owner or note queues a write-back. It is sent at once and
  retried on the website's own schedule (1 m, 5 m, 15 m, 1 h, 3 h, 6 h, 12 h). 400, 401, 403, 404 and 422 stop it
  with the reason shown in the panel. A change made while one is in flight stays queued. The link back
  ("Open in Sampforce") is sent only when `PUBLIC_WEB_URL` is https, as the website requires. While a SampForce
  change waits, the website's status does not overwrite it; otherwise a newer status from the website is adopted.
- **Convert.** One button turns an enquiry into a company and an employee. It reuses an employee with the same email
  and a company with the same name or email domain (not free-mail domains), and asks for a company name when there is
  nothing to go on. A new or contacted lead becomes qualified, and the website is told.
- **The page** opens with a live status, a glowing count of unopened enquiries, today, this week, all time,
  converted share and average rating, and a "Just in" strip of the newest unopened ones. Below: tiles per type
  (each with its own colour and icon, pressing one filters), the last 14 days, categories, forms, then the list with
  views (all, unread, open, starred, converted), search, status and category filters. Unopened rows glow and carry a
  NEW badge. The panel (`?open=<id>`) shows every field the form asked, follow-up and conversion. Opening marks it
  seen for everyone. New arrivals notify everyone with `enquiries:write` (RFQs at high priority).

## Removing Website Visitors

The menu entry, page, API (`/visitors/*`, `/public/track/*`), tracking script, worker retention job, automation
trigger `visitor.high_intent`, permissions `visitors:*`, plan feature `website_visitors` and their translations are
gone. `db:setup` (`retireWebsiteVisitors`) drops `web_events`, `web_sessions`, `web_visitors` and `visitor_settings`,
moves roles from `visitors:*` to `enquiries:*`, pauses and soft-deletes workflows on the old trigger, removes
unprocessed visitor events and their notifications, and removes the feature from plans, overrides and notification
settings. It is idempotent.

## Consequences

- Only one workspace receives the website's enquiries per server, because the website has one Sampforce connection.
- The website stand-in in `apps/api/test/fixtures/website-fixture.ts` follows the website's guide; it has not been run
  against the real website. The first real connection should be watched in the Console's webhook status.
- Careers applications are accepted (`careers.created`) and listed as job applications, but are not converted.

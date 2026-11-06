# ADR 0029: Website visitor intelligence is first-party, consent-gated and anonymous until an enquiry

- Status: Accepted
- Date: 2026-10-31
- Part of: Enhancement programme, Phase 3 (feature 15)

## Context

Feature 15 asks for a website visitor tracking script, visitor sessions, important page visits (pricing, demo,
product), returning visitors, conversion of known visitors into leads, intent scoring, alerts and campaign
attribution. The rules are: "Do not claim that every anonymous visitor can be identified by name or email", "Do not
use unauthorized fingerprinting or covert identification", "Respect cookie consent, privacy settings and applicable
data protection laws" and "Provide configurable retention and tracking controls".

## Decisions

1. **One first-party script, no identity lookup.** `GET /api/v1/public/track/script.js` is plain JavaScript with no
   dependencies. The visitor id is a random UUID in the website's own `localStorage`; the session id lives in
   `sessionStorage` and ends after 30 minutes idle. There are no cookies, no fingerprinting, no IP-to-company lookup
   and no third-party identity data. The query string is dropped except `utm_` parameters and the referrer is reduced
   to its host. The IP address is never stored; a salted hash is kept only on enquiry events, to limit enquiries to 5
   per address per 10 minutes.
2. **Consent first.** The default mode is "Ask first": nothing is stored or sent until the site's cookie banner calls
   `sampforce('consent', true)`. "Notice only" (recorded unless declined) is offered with a warning that it needs legal
   sign-off. Browsers sending Global Privacy Control or Do Not Track are never recorded in either mode, in the script
   and again on the server (`Sec-GPC`, `DNT`). `sampforce('consent', false)` and `sampforce('forget')` drop the ids.
3. **Workspace controls.** Tracking is off until an admin or manager (`visitors:manage`) turns it on, and turning it on
   needs at least one allowed website. Requests from origins not on the list are refused and get no CORS header. The
   public site key only names the workspace and can be replaced. Retention is 30 to 730 days (default 180); an hourly
   worker sweep deletes older page views and sessions, and anonymous visitors not seen since. Any visitor can be erased
   from the screen; the linked lead or contact is kept. Settings changes and erasures are audited.
4. **Identification only by the visitor's own action.** A visitor becomes known when they send an enquiry (a form
   marked `data-sampforce-enquiry`, or `sampforce('enquiry', {...})`). The email is matched to a contact, then an open
   lead; otherwise a lead is created with source "Website" when the workspace allows it. Marketing consent is recorded
   only when the workspace's consent text was shown and the box was ticked. Everyone else stays "Anonymous visitor",
   and the screens say most visitors will never have a name.
5. **Explained, rule-based intent.** The score (0 to 100) adds points for an enquiry (30), repeat visits (10 or 20),
   each important page viewed (admin-set points; defaults: demo 25, pricing and contact 20, product and case studies 10,
   careers 0) and engaged time (10 or 15), and halves after 30 idle days. Every point is listed on screen. It is not a
   prediction of who will buy. When a known visitor first crosses the workspace threshold, the lead or contact owner
   gets an in-app notification and the `visitor.high_intent` event can start a workflow in the existing automation
   engine.
6. **Attribution** uses the first touch's UTM parameters; a `utm_campaign` matching a SampForce campaign name is linked
   to that campaign, and the dashboard shows visits, visitors and leads per campaign.

## Consequences

- Visitors who block scripts or never consent are invisible. Counts are lower bounds, and the dashboard does not
  extrapolate.
- `localStorage` ids are per browser and per site: one person on two devices is two anonymous visitors until they
  enquire on each.
- The end-to-end test serves the script to a stand-in website through a public-looking host, because Chromium blocks
  public pages from calling `localhost`. A real deployment serves the API from a public host and is unaffected.

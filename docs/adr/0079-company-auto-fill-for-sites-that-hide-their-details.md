# ADR 0079: Company auto-fill for sites that hide their details

- Status: Accepted
- Date: 2026-11-26

## Context

Kunal tried Find details on real companies (frequentresearch.com, pureprofile.com and others) and got one or two
fields back. ADR 0076 read the home page as the server sends it, then only the About, Contact and Offices pages linked
with those exact words. That misses most of what modern sites publish:

- Many sites are built with JavaScript (React, Vue, Wix ...). The server sends an almost empty page and the visitor's
  browser draws it, so reading the HTML finds only the title and description. frequentresearch.com is one; its /about
  even answers 404 to a plain request.
- Some sites keep the company on another page: pureprofile.com is a sign-up page for survey takers, and the company is
  on business.pureprofile.com, linked as "Find out more". Others draw their menu as images, or use other words.
- Phone numbers without a "Phone:" label, and addresses written over several lines or without the country, were
  skipped.
- Find details showed only what had a box on the form; everything else was a list of names "added after you save".

Kunal also asked (2026-11-26) that auto-fill collect the people a company publishes (name, designation, email and
LinkedIn profile, as on a "Meet the team" page), with no AI, and that every request for company information present itself as an ordinary browser, not
as "SampForceBot", because sites block or strip pages for bots.

## Decision

- **A hidden browser for JavaScript sites.** When a page comes back almost empty (under 400 characters of text, or
  few links and little text), auto-fill opens it in a headless Chromium (`playwright-core`, `page-renderer.ts`), waits
  until its network is quiet (at most 15 s a page), and reads the drawn HTML. On such a site every further page is
  drawn the same way, and a 404 that the browser draws into a page counts as found (single-page apps do that).
  The run's time limit is 60 s instead of 45 s.
- **The browser never touches the network itself.** Every request a page makes is intercepted and made by the API
  through `SiteFetcher.raw`, which is `publicFetch`: public https addresses only, checked at connect time, sizes and
  times capped; redirects are followed there, each hop checked. Only GET and HEAD for documents, scripts and data are
  made (no images, fonts, media or style sheets; at most 120 requests a page). Anything not intercepted goes to a dead
  proxy address, WebRTC is held to that proxy, WebSockets and service workers are refused, and each page gets its own
  browser context, closed afterwards. A test proves a page cannot reach a local server by any of these routes.
  Chromium runs with `--no-sandbox` because the container has no user namespaces for its own sandbox; the container
  is the boundary (read-only root, no capabilities, non-root user), and the page can reach only what the API fetched.
- **One browser per process, two pages at a time,** started on first use and closed after a minute idle.
- **Finding pages.** After links on the home page: the sitemap (robots.txt's `Sitemap:` lines, else /sitemap.xml,
  /sitemap_index.xml, /wp-sitemap.xml; an index is followed to at most two page sitemaps), then the usual addresses
  /contact-us, /contact, /about-us, /about on sites that are not built by JavaScript. A link to the company's own
  sub-site (business., corporate., investors., group. ...) stands in for a missing About page, and a Contact page linked
  only from that page is read too. At most seven pages a company (the team page included); a page identical to the home page (a single-page app
  answering every address) is not counted.
- **Looser reading.** International numbers ("+91 120 456 7890") in short blocks and blocks that are only a number are
  phones. An address written over two to eight short elements is joined and read; a first line without digits is the
  office's name. A US state with a ZIP code, an Indian state or city with a PIN code, and a UK postcode with a British
  city give the country when the address leaves it out.
- **Wikidata names** are searched without their legal ending and compared without case, punctuation or endings
  ("Pureprofile Ltd" = "pureprofile", "... Private Limited").
- **Find details shows everything.** Details the form has no place for are shown as cards with their value, source
  and a tick box, ticked. Unticked ones are sent as `autofillSkip` with the new lead and stored as the person's choice
  (`fieldSources[field].source = USER`), so the run after saving never writes them.
- **User agent.** Company websites, logo look-ups, the hidden browser and the email finder send an ordinary desktop
  Chrome user agent (`BROWSER_USER_AGENT` in `site-fetch.ts`; the hidden browser uses its own Chromium version). The
  email finder still honours robots.txt rules for all crawlers (`User-agent: *`). Wikidata's API is the exception: its
  user-agent policy requires automated clients to describe themselves, so it gets `WIKIDATA_USER_AGENT`.
- **People a company publishes.** Auto-fill reads the team, leadership or people page linked from the pages it read
  (one more page; at most seven in all) and finds people by rules, never AI: a card (an element with exactly one
  name in it) whose lines also give a job title, an email or a LinkedIn `/in/` profile. A name alone is not taken, and
  text such as a testimonial with no title is not a person. schema.org `Person` data (`employee`, `founder`, `member`
  ...) and the CEO, founders and leaders already found (the site's data, Wikidata) are added, and Hunter.io's domain
  search when the operator set its key. Emails are kept only when they are a person's own address on the company's
  domain (or a personal mail service) and not a role mailbox (info@, sales@ ...). LinkedIn is never read: its terms
  forbid it, so a profile is only what the company's own page links to. Apollo is not used: its search hides surnames
  and emails, and revealing them spends credits per person.
- **Choosing people.** Find details on Create Company lists the people as tick cards; "Add as employees" puts the
  ticked ones on the Employees step. On a saved company, the Employees section has **Find people**
  (`POST /companies/:id/find-people`, `contacts:write`, the same per-person limit as Find details), which lists them
  and creates a contact for each one ticked. Nothing is stored until the person presses the button. Each employee's
  remarks say where and when they were found ("Found by auto-fill on <page> (date)"), so a request to delete or to
  say where the data came from can be answered (GDPR): the user still tells people on first contact.
- **Switches.** The console card "Company auto-fill" has a second switch, `COMPANY_AUTOFILL_BROWSER` (unset = on).
  `COMPANY_AUTOFILL_BROWSER_PATH` names the Chromium; unset, /usr/bin/chromium (the Docker image installs Debian's
  `chromium`), then other usual places. Without a Chromium, plain reading still works and the card says so.

## Consequences

- The API image grows by about 400 MB (Chromium and its libraries). The Helm chart gives the API and the worker more
  memory (limits 1280 Mi and 1 Gi) and /tmp (512 Mi).
- A JavaScript site takes 5 to 15 s longer to read. Find details waits for it (the button says "Reading the website…").
- Presenting as a browser makes sites answer as they would a visitor, but some sites' terms forbid automated reading;
  that is the operator's call (Kunal decided it for SampForce). Sites behind a challenge page (Cloudflare "under
  attack" mode, CAPTCHAs) are still not read.
- The stand-in sites in `apps/api/test/fixtures/company-sites.ts` copy the patterns seen on real sites; the sandbox
  cannot reach real ones, so a live check on the server with frequentresearch.com and pureprofile.com is needed.

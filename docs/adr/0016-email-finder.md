# ADR 0016: Email finder

**Status:** accepted, 2026-10-31. **Requested by:** Kunal (Sampledge): find email addresses for any company by name,
like Snov.io. Source chosen on 2026-10-31: DealFlow's own finder plus an optional data provider.

**Context.** Commercial finders combine a large database of addresses with pattern guessing and mailbox checks.
DealFlow has no such database, must not invent addresses or present guesses as facts, and must not scrape sites
whose terms forbid it.

**Decision.**

- **Own finder (always on).** For a company name or website:
  1. *Domain*: the website typed in; else the company record in DealFlow; else the provider (if configured); else
     up to 12 likely domains (`kestrelanalytics.com`, `kestrel-analytics.com`, …) whose home page mentions every
     significant word of the name.
  2. *Pages*: the home page plus same-site contact/about/team/people/impressum links and common paths, at most 8
     pages, each under 1 MB and 6 seconds, only what `robots.txt` allows (`User-agent: *` or `DealFlowBot`), only
     public https addresses (the webhook SSRF guard, re-checked on every redirect). User agent `DealFlowBot/1.0`.
  3. *Addresses*: `mailto:` links and visible text (including "name [at] company [dot] com") at that domain or its
     subdomains. Other companies' and personal addresses are dropped.
  4. *Pattern*: from published addresses with a name (`first.last`, `flast`, …), and how many addresses support it.
  5. *Mail server*: an MX lookup says whether the domain receives email at all.
- **A person** gets, in order: the address published on the site; the provider's answer with its score; the address
  built from the company's pattern; or, when nothing is known, three common patterns clearly labelled *Guess, not
  checked*, with a warning that wrong guesses bounce. DealFlow does **not** probe mail servers (SMTP `RCPT`) to test
  single addresses: many providers treat it as abuse, cloud networks block port 25, and catch-all domains make it
  unreliable.
- **Provider (optional).** `HUNTER_API_KEY` turns on Hunter.io Domain Search and Email Finder with the customer's own
  account. Published addresses win over the provider's copy. Built from Hunter's public v2 API and tested against a
  local stand-in only; it has not been run with a real key.
- **Limits and history.** `FINDER_DAILY_LIMIT` lookups per person per rolling 24 hours (default 50), stored in
  `finder_lookups` (tenant-isolated with RLS), which also keeps the person's history.
- **Saving** goes through the same path as the extension (ADR 0015): duplicates are reported, new leads get source
  "Email finder" and tag `email-finder`, and can be enrolled in a sequence.
- **Extension.** "Find more people at <domain>" in the side panel runs the finder for the site being viewed.

**Consequences.** Coverage is limited to what companies publish, plus the provider when a key is added; many
companies publish only shared mailboxes. Whether contacting people found this way is lawful depends on the customer's
country and purpose (for example GDPR legitimate-interest assessments); that is for their legal review. The lookup
history records where each address came from.

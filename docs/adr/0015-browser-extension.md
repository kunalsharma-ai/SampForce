# ADR 0015: Lead-capture browser extension

**Status:** accepted, 2026-10-31. **Requested by:** Kunal (Sampledge): a SampForce extension that people install so
that leads are created from the websites they visit, as part of Phase 9 (see ADR 0014 for sequences).

**Context.** The web app authenticates with HttpOnly SameSite cookies and an Origin allow-list against CSRF. An
extension runs on a `chrome-extension://` origin, its address differs per install, and SampForce is installed at a
different address per customer, so neither the cookie nor the allow-list fits.

**Decision.**

- **Its own connection, not the web session.** People create a connection code (`dfx_…`, 32 random bytes) under
  Integrations → Browser extension and paste it into the extension with their SampForce address. A connection is a row in
  `sessions` with `extension_token_hash` (SHA-256; the code is shown once), so it appears under the person's signed-in
  devices and ends with "sign out other devices", turning on two-step verification, or removing the member. It lasts
  90 days, cannot be refreshed into a web session (its refresh hash is never handed out), and at most five are live.
- **Narrow reach.** `AuthGuard` treats a `Bearer dfx_…` header on its own (the cookie is ignored on that request), keeps
  only `leads:read/write`, `contacts:read`, `companies:read`, `sequences:read/write` from the person's role, and refuses
  every route not marked `@ExtensionAccess()` with `EXTENSION_NOT_ALLOWED`. Only `/extension/me`, `/lookup`, `/capture`
  and `/disconnect` carry it. Connections are created and listed only with the web session.
- **Origin check.** `OriginGuard` lets a request through from any origin when it carries a `dfx_` bearer header. That is
  safe because a cross-site page cannot know the code, and the guard above guarantees such a request never rides on the
  cookie. Cookie requests from the extension origin are still refused.
- **Saving.** `/extension/capture` takes up to 25 addresses from one page. Anyone already a lead or contact (by email,
  case-insensitive) is reported, not duplicated. New people go through `LeadsService.create`, so audit, duplicate
  detection and workflows behave as for any lead: source "Browser extension", tag `browser-extension`, the page's
  company name and domain. When a sequence is chosen, the sequence and the person's mailbox are checked first so nothing
  is half done, then `SequencesService.enroll` applies the usual skip rules.
- **Automatic capture** is off until the person turns it on, needs site access granted in the browser, and only saves
  addresses at the site's own domain (or its subdomains), never personal mailboxes (Gmail, Outlook.com and the like,
  list in `@dealflow/types`), never do-not-email addresses, at most 100 a day and once per page per day. Those leads are
  also tagged `auto-captured`.
- **Reading pages.** `lib/page.js` is injected only when the panel opens or for automatic capture. It reads `mailto:`
  links and visible text (including "name [at] company [dot] com"), skips image names, error-tracker ids and sample
  addresses, and takes the company name from `og:site_name`, JSON-LD Organization, or the title.
- **No LinkedIn or other social-network scraping.** Their terms forbid automated collection; the extension does not
  target them.
- **Packaging.** Plain JavaScript, Manifest V3, no build step beyond copying (`apps/extension/build.mjs` writes `dist/`
  and a zip). Site access is an *optional* host permission requested in the panel; the test build grants it at install
  because automated browsers cannot click the prompt.

**Consequences.** The extension is not in the Chrome Web Store yet; Sampledge needs a developer account and a privacy
policy for the listing. Edge uses the same package. Firefox would need a different side panel API and is not built.
Whether saving people found on public pages is lawful for a given customer and country is for their legal review;
SampForce records the source page in the audit log so customers can answer "where did you get my address?".

**Update, 2026-10-31.** The privacy page is at `/extension-privacy` on the SampForce site, and the store listing kit
(text, permission reasons, privacy-form answers, screenshots, promo tile) is in `apps/extension/store/`. Submission
still needs Sampledge's developer accounts.

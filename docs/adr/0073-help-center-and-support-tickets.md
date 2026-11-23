# ADR 0073: Help Center and support tickets

**Status:** accepted (2026-11-22)

**Context.** Kunal asked for a Help menu in the Console and in every workspace, and in the mobile app. It should
answer frequently asked questions about every feature, include a guide for each feature, and offer "Other" for
raising a query. It also had to be attractive. The "i" buttons from ADR 0056 already explained each page, so the Help
Center builds on them instead of writing a second set of help text.

**Decision.**

- **One help package.** The page and section help from `apps/web/src/lib/help` moves into a new package,
  `@dealflow/help`, so the web app, the API and the mobile app all read the same text. `lib/help` re-exports it. The
  package adds:
  - Help categories, some for workspaces and some for the Console.
  - FAQs for workspaces and for the Console, each a `HelpText` tuple in English, Spanish, French, German and Arabic.
  - A map from every page guide to its category.
  - A single search over answers and guides. In the search box every word must match. The suggestions under
    "Raise a query" use a partial search, which skips short words and needs half of the others to match.
- **Only what you can use.** A `HelpReader` describes the reader's audience, features, workspace level and permissions.
  `faqsFor` and `guidesFor` leave out anything tied to a feature the workspace was not given, a level it is not at, or
  a permission it lacks. For example, a Manager Workspace without Sequences sees no sequence answers or guides, and
  only Super and Manager Workspaces see the Permission Center answer. The web app builds the reader from `/auth/me`.
  `GET /help` applies the same filter on the server using `resolveWorkspaceAccess`, for the mobile app.
- **Support tickets.** The new `SupportTicket` and `SupportTicketMessage` models store:
  - A ticket number per organisation, the subject, topic, optional feature, priority, the page the person came from,
    and the source (web or mobile).
  - The status: open, in progress, answered or closed.
  - A handler level, which ADR 0071's part 5 uses to route tickets through the hierarchy.

  People raise tickets from "Other: raise a query" and follow them in My queries. A raiser can reply, close and reopen.
  The Console's new Support tickets inbox answers them. An answer from the Console notifies the raiser in their own
  language and records audit entries on both sides. To the workspace, Console staff always appear as "SampForce
  support".
- **Where Help lives.**
  - Workspaces: the top bar's help button becomes a Help menu with search, FAQs, feature guide, keyboard shortcuts,
    "Other: raise a query" and My queries. It is the same at every level.
  - The Help Center page (`/app/help`) has search, topic tiles, FAQs, the feature guide and the raise-a-query card.
  - The Console has a Help page with Console FAQs and guides, and no raise-a-query card, because the Console is support.
  - The mobile app reads `GET /help` and the ticket routes. It gets its mobile access through the mobile thread's
    `@MobileAccess()` work.
- **No history lists.** The Help Center shows no recently viewed answers, as with the rest of the product.

**Consequences.** A new feature needs its page guide in `@dealflow/help`, and FAQs where questions are likely. The
package tests fail if any text is missing a language, or if a guide or category has no place. Guide titles returned by
`GET /help` are English only, because title translations live in the web phrase tables.

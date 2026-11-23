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
  - The status: Submitted, Under review, In progress, Awaiting user response, Resolved or Closed (see the full-spec
    section below).
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

## Full Help & Support system (follow-up, 2026-11-22)

Kunal's spec "Complete Help & Support System for All Workspaces" extended this decision as follows.

- **Query tracking.**
  - The six statuses are Submitted, Under review, In progress, Awaiting user response, Resolved and Closed.
  - Status changes happen like this:
    - Opening a submitted query in the Console or as its handler moves it to Under review.
    - A handler's reply moves it to Awaiting user response.
    - The raiser's reply moves it back to Under review.
    - The raiser can mark a query Resolved or Closed, or reopen it.
  - The raiser is notified of every status change.
  - The query form adds:
    - An "Other" topic with the person's own words.
    - A related lead, contact, company or deal. A query raised from a record page links that record automatically.
    - Up to five files of up to 10 MB each, stored as `SupportTicketAttachment`.
    - A contact method (in the app, email or phone).
    - The app version.
  - The server captures the workspace, level, role and email itself.
- **Console-written help.** Built-in help stays in `@dealflow/help`. The Console adds content stored in the database:
  - `HelpArticle` holds Q&As, guides and announcements. English is required and the other languages fall back to
    English. An article can target an audience, plan feature, workspace levels, roles and clients. It can also be
    pinned and can have an https video link.
  - `HelpArticleVersion` takes a snapshot on every save; restoring an old version saves it as a new version.
  - `HelpCategoryEntry` holds topics and subtopics.
  - `HelpMedia` holds pictures, video and PDFs. The first bytes of each upload are checked against its type. Images
    and video are served inline with a sandbox CSP.
  - An article with `builtinKey` (`faq:<id>` or `guide:<page id>`) replaces that built-in item. Archiving it hides the
    built-in item.
  - `GET /help/content` returns what the reader may see.
  - The Console manages it all at `/operator/help/manage`: write, preview, publish, unpublish, archive, versions,
    topics, files and feedback. The page is staff-only and written in English, like the other Console settings
    pages. Every operator can read it; only administrators can write.
- **Reader features.**
  - "Was this helpful?" with an optional comment, stored as `HelpFeedback`: one answer per person and article, which
    they can change. Totals are kept in `HelpArticleStat`, and the Console reviews comments.
  - Views count toward Popular, using totals across everyone.
  - Recently updated lists the Console's articles by update date, not personal history.
  - "Last updated" appears everywhere. Built-in help uses `HELP_CONTENT_UPDATED`.
  - Related articles come from the same topic.
  - Search matches while typing, accepts parts of words, and groups results by topic. With no result, it suggests
    guides.
- **Guides.** Each page guide shows:
  - "Who can use it": the plan feature, role permission and workspace levels, from `guideRequirements`.
  - "If something goes wrong": troubleshooting steps and "Raise a query about this page".
  - A start-here path for each role: Console Admin, Super Admin, Super, Manager and Executive (`ROLE_GUIDES`).

  Every page's "i" button links to its full guide (`?guide=<page id>`). Detailed per-module troubleshooting beyond
  these shared steps is written in the Console as articles, so it can follow the product without a release.
- **Settings and restrictions.**
  - `HelpSettings`, one per organisation, holds:
    - The Console's per-client switch for answers and guides.
    - The Super Workspace administrators' choices: whether to show the Help icon, whether to explain missing
      features, and a note to show in Help.
  - With Help off or the icon hidden, Help & support stays in the account menu, and raising and following queries
    always works.
  - `restrictedGuides` lists the pages a reader cannot use and why: their plan or workspace (ask the Super Workspace),
    their role (ask an administrator) or their workspace level. They are never shown as available.
- **Support reports.** `GET /operator/support/tickets/report` covers the last 7, 30, 90 or 365 days:
  - Queries raised, and how many are still waiting.
  - Counts by status, priority, topic, client, support person and source.
  - Average and median time to first answer and to resolution.
  - A per-day trend.

## Help & support button and Explore SampForce (2026-11-23)

- Every workspace top bar and the Console top bar has a labelled **Help & support** button. It opens a side panel that
  answers as you type (answers open in place; guides and features link into the Help Center), with links to the Help
  Center, Explore SampForce, the FAQs, the feature guide, My queries and "Other: raise a query". In the Console it links
  to Help, Manage Help content (admins) and the support tickets. A Super Workspace that hides the Help menu hides the
  button; Help & support stays in the account menu.
- **Explore SampForce** (`packages/help/src/product.ts`) describes every part of the product (13 feature briefs) and
  its facilities (security, mobile app, languages, help and support, hosting, AI providers) in all five languages. Each
  brief names the catalogue features it covers; a test fails if a catalogue feature is described by no brief. Readers
  see whether each part is in their plan, partly or not, and the plans on offer come from the live catalogue.
  A part the plan leaves out is shown only while the Super Workspace explains missing features.
- The Console writes briefs as articles of kind `FEATURE` and may edit or hide a built-in brief (`feature:<id>`), with
  the same drafts, versions, audiences, feedback and statistics as FAQs and guides. GET /help returns `briefs` for the
  mobile app.

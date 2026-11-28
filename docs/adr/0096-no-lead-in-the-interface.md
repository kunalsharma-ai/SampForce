# 0096: No "Lead" in the interface

Date: 2026-11-27. Status: accepted. Redesign spec section 6 ("Remove the term Lead throughout SampForce").

## Decision

The word "Lead" no longer appears anywhere a person reads it: web app, Console, mobile app, browser extension,
help popovers, notifications, emails, reports and exports, in all five languages (en, es, fr, de, ar).
Each place was given the word that fits what it really is, not a blanket "Company":

| Before | After | Why |
| --- | --- | --- |
| Company lead, Create new lead, Lead details | Company, Create new company, Company details | Since ADR 0060 a "lead" is a company record (FRFS number, status, owner, manager). |
| Lead number, Lead owner, Lead creator, Lead status | Company number, Company owner, Company creator, Company status | Same record. Deal stages stay "Deal status". |
| Lead transfers (requests, approvals, notifications) | Company transfers | They move a company to a new owner. |
| Lead targets, "Leads" counts on dashboards and mobile | Company targets, "Companies" | They count companies created. |
| Leads page (person records, `Lead` model, feature `leads_section`) | Inbound contacts | People who came in through forms, imports or the extension before they belong to a company. |
| Lead follow-up | Contact follow-up | Follow-ups are made with a company's employees (contacts). |
| Lead pipeline | Deals pipeline | The pipeline moves deals. |
| Default company status "New Lead" | "New Company" | See below. |

## What was kept, on purpose

- **Data and code names.** Prisma models (`Lead`, `Company.leadNumber`, `LeadTransfer`), routes (`/app/leads`,
  `/leads`, `/company-leads`), permission scopes (`leads:read`), event names (`lead.created`), feature keys
  (`leads_section`) and export column keys. Renaming them would break integrations, saved links, API keys and
  webhooks for no visible gain. No schema change and no data migration of history.
- **Developer documents.** The OpenAPI reference keeps its resource names, because they match the API paths.
- **AI prompts** sent to the model; the model never shows them to people.
- **Marketing sites** in `website/` are outside the app and were not changed in this PR.

## Old stored text

Notifications and audit lines are stored in English when they happen, so older ones still say "Lead assigned to
you: …" or "Lead transfer request: …". `packages/types/src/i18n/text/renamed.ts` (`RENAMED_TEXT`) maps each old
English sentence pattern to its new one, and `TextCatalogue.localize` rewrites the text before translating it. So
old and new notifications read the same, in every language, without touching stored records.

## The "New Lead" status

New workspaces get "New Company" as the default company status. Existing workspaces have "New Lead" as a stored,
editable status, which people see on every company. On deploy, `upgradeCompanyCrm` renames it in place to
"New Company" (same id, colour, order and default flag, so every company keeps its status and history). It is
skipped when the workspace already has a status called "New Company" or has renamed "New Lead" to something else.

## Changes to earlier work

- The default status name above.
- Report and export headings ("Number of inbound contacts", "Company number" in the company CSV). Export column
  keys used for re-import are unchanged.
- The browser extension button and panel text say "contact" instead of "lead".
- The Console client switch for the Leads page is now "Show the Inbound contacts page".

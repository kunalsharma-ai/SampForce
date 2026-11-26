# ADR 0084: Company to Deal

- Status: Accepted
- Date: 2026-11-26
- Part of: the role and workflow redesign, R4 (plan in `sampforce/redesign/PLAN.md`)

## Context

Section 14 of Kunal's spec covers what happens when a company is won. The company should appear on Deals and on the
Pipeline without anyone typing it again. A won deal should also mark its company as won.

Two building blocks already existed. An RFQ can become a deal (`convertRfq`), and company statuses carry a meaning,
of which `CLIENT` means won. Nothing connected the two directions.

## Decision

**When a company becomes a client.** This happens in either of two ways:

- its status changes to one that means `CLIENT`;
- someone uses the new **Mark as won** action (`POST /companies/:id/won`, which needs `companies:write` and `deals:write`).

`CompanyDealsService.companyWon` then runs in the same transaction:

1. **Choosing the deal.** It reuses, in order of preference:
   - the deal this company was already won with (`Company.wonDealId`);
   - else its most recent open deal, which is moved to the first won stage of its pipeline;
   - else a new deal, placed in the won stage of the default pipeline.

   A new deal is built as follows:
   - **Name:** "Company: RFQ project" for one RFQ, otherwise the company name.
   - **Amount and currency:** the won RFQs' actual revenue (falling back to the quotation, then the expected revenue). If no RFQ is won, the open RFQs are used instead. Lost and cancelled RFQs are never used.
   - **Contact:** the RFQ's contact, else the first employee.
   - **Owner:** the company owner.
2. **Linking RFQs.** Those RFQs are linked to the deal, and revenue records are reconciled.
3. **Telling people.** The deal owner and the company manager get a `deal.won` notification ("Client won: deal DEAL-0007 created for …"), unless they made the change themselves. The win is audited as `company.won`.

The process is idempotent: a second win reuses the same deal and only links new RFQs. If the workspace has no
pipeline with a won stage, the company still becomes a client, but no deal is made.

**When a deal is won.** A deal can become won by moving it to a won stage, by a bulk move, or by being created
already won. In each case `companyWonByDeal` makes its company a client and records the deal as its win. The status
chosen is a `CLIENT` status with "client" in its name (for example "Existing Client"), else the first `CLIENT` status.
This is a plain function, so `DealsService` does not depend on the company services.

**Screens.** The company profile has a **Mark as won** button with a confirmation, and the result links to the deal.
Once the company is won, the button becomes **Won deal** and opens that deal.

## Consequences

- `Company.wonDealId` and `wonAt` are new. They are shown on company rows as `wonDealId` and `wonAt`.
- `DealsService.create` and `move` now have in-transaction versions, `createIn` and `moveIn`.
- There is a circular file import: deals → companies → company-deals → deals. `CompanyDealsService` therefore injects `DealsService` with `forwardRef`.
- Moving a company out of a client status does not reopen or delete its deal.

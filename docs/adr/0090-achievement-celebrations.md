# 0090. Achievement celebrations

Date: 2026-11-26. Status: accepted. Builds on the role and workflow redesign: availability (ADR 0081), company to deal (ADR 0084) and role dashboards (ADR 0086).

## Context

Kunal asked for attractive animations and pop-ups that appear only when someone does something special. Examples: converting a company into a deal, an RFQ sent, every task done, a target or the daily lead quota reached, or a steady working day. Each design should be different. The rules:

- celebrate real achievements only;
- never interrupt work;
- never replay on a refresh;
- never reward skipping breaks;
- never use fake data.

## Decision

### One record per achievement, decided on the server

- An `Achievement` row is written at the end of the business transaction that earned it. A `beforeCommit` hook in `withDbContext` runs after the change itself, revenue reconciling and company status included.
- Because it runs inside that transaction, a failed save records nothing. A pop-up therefore never shows before the work is saved.
- Detection listens to the audit trail (`AuditService.observe`) for these actions, made by a person and not by automation:
  - `company.won`
  - `lead.converted`
  - `deal.stage_changed` to Won
  - `deal.created`
  - `task.completed`
  - `company.created`
- Two direct signals are also used:
  - SampBidx accepting an RFQ send (`rfqDelivered`). A failed send records nothing.
  - A check-out (`checkedOut`).
- Duplicates are impossible: `(tenantId, userId, dedupeKey)` is unique. Examples of keys:
  - `deal-converted:<dealId>`
  - `lead-target:DAY:2026-11-26:4` (the target is in the key, so raising it re-opens the milestones)
  - `consistency:<day>`
- Detection errors are logged and swallowed, so a celebration can never break the person's save.

### What counts

| Achievement | Level | Rule |
| --- | --- | --- |
| Company converted into a deal | Major | The company is marked won, or its deal reaches Won |
| Prospect converted | Daily | A lead is converted |
| RFQ submitted | Daily | SampBidx accepted the send, once per RFQ |
| Important task | Routine | A high-priority task or a client follow-up is done |
| All tasks done | Daily | At least 2 tasks were due today, all are done, and nothing is overdue. Once a day |
| Lead milestones | Routine | 25, 50 and 75% of the daily lead target |
| Lead target | Daily, Major | The daily, weekly or monthly lead target is reached |
| Sales target | Major, Exceptional | A monthly or quarterly revenue or deals-won target is reached |
| Deals-won milestone | Major, Exceptional | 1, 5, 10, 25, 50, 100, 250, 500 or 1000 won deals (100 and over is Exceptional) |
| Major deal | Exceptional | A deal at or above the person's "major deal" amount, or a personal best after at least 3 earlier wins |
| Consistency | Daily | See below |

Notes on the rules:

- A **valid lead** is a company the person added today that has a name plus a website, domain, email, phone or LinkedIn, and is not a repeat (by domain or exact name) of a company already in SampForce.
- **Targets** come from three places:
  - A target the manager assigned on the person's workspace (ADR 0071) overrides the personal one.
  - Otherwise the personal targets in My Achievements are used.
  - Sales targets also read forecast targets.
- **Amounts** in another currency are compared only when exchange rates exist. Nothing is converted with made-up rates.
- **Consistency** never rewards overwork. It needs all of these:
  - a check-out the person made themselves, not an automatic close;
  - between 4 and 10 hours worked;
  - no unplanned interruption, meaning no automatic Away (a new `AWAY_ENDED` availability event) and no switch to Away;
  - no open task due today.

  Breaks never count against the day. The card says "Your breaks were part of a healthy day." It uses only the check-ins people record themselves, and the category can be switched off.

### Handing it to the screen once

- `POST /achievements/claim` returns achievements that have not been shown yet and are at most 30 minutes old.
- It marks each one shown with an atomic `updateMany({ id, shownAt: null })`, so only one tab gets it and a reload never replays it.
- Muted categories, or celebrations switched off, are marked shown silently. They still appear in the history.
- The web app claims at these moments:
  - half a second after any change it saves (a `sampforce:changed` window event from `api()`);
  - on page load;
  - when the tab becomes visible;
  - every 30 seconds.
- One celebration shows at a time:
  - When one change earns several, the event shows first and the biggest milestone last.
  - It waits while a dialog is open.
  - It pauses while hovered or focused.
  - It closes by itself, or with Escape or the close button.
  - It never takes the focus.

### Designs

Every kind has its own scene, tone and colours:

- **Deal converted:** a Lead, Client, Deal journey with a ribbon burst.
- **Prospect converted:** a seed with ripples.
- **RFQ submitted:** a paper plane flying onto a check stamp.
- **Important task:** a small toast with a drawn check.
- **All tasks done:** task cards sweeping away.
- **Lead milestones:** a compact progress ring with 25, 50 and 75 marks.
- **Lead target:** the ring with rays.
- **Sales target:** a gauge with a trophy.
- **Deals-won milestone:** a medal with a sunburst and a count-up.
- **Major deal:** a diamond on the full-screen stage with stars.
- **Consistency:** a calm sunrise and wave, with no confetti.

The layouts also differ by level:

- Routine achievements use a toast or a compact card.
- Daily and Major achievements use a card.
- Exceptional achievements use a full-screen stage with a veil that closes on click.

### Settings and accessibility

- Celebrations can be switched on or off.
- The style can be Subtle (no confetti, no stage) or Expressive.
- Sound is off by default.
- Each category can be switched off.
- Personal daily, weekly and monthly lead targets, a monthly revenue target and a "major deal" amount can be set.
- Reduce motion shows the final frame with no movement or confetti. It is also used when SampForce's Motion setting or the system asks for reduced motion.
- My Achievements shows the history still and never replays a celebration.

### Tests

- API (`apps/api/test/achievements.e2e.test.ts`) covers:
  - success;
  - failed sends;
  - duplicates and re-wins;
  - refresh (claim once);
  - two tabs;
  - muted and disabled celebrations;
  - targets;
  - consistency limits.
- Browser (`apps/web/e2e/achievements.spec.ts`) covers:
  - real flows through the screens;
  - no replay after a reload;
  - waiting while a dialog is open;
  - reduced motion;
  - settings;
  - layout checks in light and dark at desktop, tablet and phone sizes.
- Other browser suites never see celebrations. Under WebDriver they show only when a test sets `sampforce.celebrations.test`.

## Consequences

- The mobile app does not show celebrations yet. The API is ready for it.
- Pipeline-growth milestones and team-wide celebrations are not included.
- When redesign R7 (tasks and targets) lands, its assigned targets are read through the same `WorkspaceTarget` rows. No change is expected.

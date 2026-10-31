# ADR 0027: Churn risk extends customer health; it stays rule-based and explained

- Status: Accepted
- Date: 2026-10-31
- Part of: Enhancement programme, Phase 3 (feature 13)

## Context

Feature 13 asks for customer churn prediction: risk scores, engagement and inactivity, deal and account history,
renewals and contract status, unresolved issues where support data exists, retention recommendations, follow-up
schedules, trends and risk filters. DealFlow already had Customer Success: customers are companies with an active
contract, a stored rule-based health score (`customerHealth`) with explained signals, escalations, and a one-time
"at risk" alert to the owner. A second, separate churn model would show two different answers for the same customer.

## Decisions

1. **One score.** Churn risk is the inverse view of the existing health score: at risk = high churn risk, watch =
   medium, healthy = low. `customerHealth` (now `health-v2`) gains three explained signals:
   - falling engagement (activity plus email both ways, last 30 days against the 30 before, the same rule as the
     record intelligence panel), 15 points;
   - open client portal requests, the support data DealFlow has (5 points each, up to 15);
   - a deal with the company lost in the last 90 days, 10 points.
   Existing signals (inactivity, escalations, renewal within 60 days with none started, overdue tasks) are unchanged.
   There is no trained model and no probability; the page says so.
2. **History.** `company_health_daily` keeps one score per customer per day (RLS, tenant scoped). The trend chart shows
   customers per risk level per day for 30, 90 or 180 days and the biggest falls. History starts when a customer is
   first scored; nothing is back-filled or estimated.
3. **Retention plan.** `retentionPlan` turns each kind of signal into one suggested step with a due window (for example
   "Agree a fix date for the open escalation", "Start the renewal and book a renewal call") and a follow-up cadence by
   risk: weekly for a month (high), every two weeks for six weeks (medium), monthly (low).
4. **Nothing is created without confirmation.** "Plan follow-ups" opens an editable list of steps and cadence dates.
   Tasks are created only for the ticked rows, through `TasksService`, due 09:00 in the manager's time zone, on a
   chosen contact at the customer (or naming the company), high priority when risk is high. Audited as
   `customer.follow_ups_created`.
5. **AI briefing is optional and a draft.** The new `retention_advisor` agent reads the health facts, contracts,
   engagement, deal history, recent activity subjects, and open escalations and portal requests (customer-written text
   marked untrusted). It returns a summary, talking points and steps. It cannot create tasks, contact the customer,
   change the score or offer discounts. Steps can be copied into the follow-up list, which still needs confirmation.
6. **Filters.** Managers filter by churn risk level and account owner (API `band` and `ownerId`, and the counts at the
   top of the page act as filters).

## Consequences

- Workspaces without the client portal get no support-request signal; there is no helpdesk integration (for example
  Zendesk) yet, so "unresolved issues" means escalations and portal requests only.
- Scores change when signals change, so a customer can move bands from one day to the next. The daily history shows that.
- The AI briefing text in tests comes from the fixture, not a real model.

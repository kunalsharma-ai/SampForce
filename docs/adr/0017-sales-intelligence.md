# ADR 0017: Sales intelligence (deal health, next best actions, 360° timeline, insights)

**Status:** accepted, 2026-10-31. **Requested by:** Kunal (Sampledge), enhancement spec features 1–4: deal health
monitoring, next best actions, a Customer 360 timeline, and an insights feed. The spec says to extend what exists,
not rebuild it.

**Context.** SampForce already had rule-based deal scoring (the Deal Intelligence agent, ADR 0008), Deal
Intelligence recommendations, activities, email, meetings, sequences, quotes, contracts and escalations, each with
its own list. Nothing pulled them together, nothing watched deals between visits, and the Command Center had no
ranked "do this next" list.

**Decision.**

- **One scoring function.** The hourly monitor and the Deal Intelligence agent share `scoreDeal` and `loadDealFacts`
  (version `signals-v2`). v2 adds three engagement signals: fewer touches in the last 14 days than the 14 before,
  the buyer silent for 7+ days after our last email, and fewer people involved than the previous 30 days. Bands:
  70+ Healthy, 40–69 At risk, under 40 Critical (stored as low, medium, high).
- **Monitor.** The worker scores every open deal hourly into `deal_health_scores` and keeps one row a day in
  `deal_health_daily` for the trend. When a deal first turns Critical, its owner is notified once and the
  `deal.health_dropped` event is published, so Automation Studio can react (one automation engine, as the spec
  asks). The alert resets when the deal recovers.
- **Next best actions.** Fixed, visible rules with priorities: reply waiting, overdue task, manager review for
  large Critical deals, Critical deal, AI recommendation, close date passed, renewal due, quote unanswered, new lead
  untouched, sequence finished with no reply, deal with no next step. Every item says which rule produced it.
  Accepting creates a task through the normal task service; nothing else changes without a click. Accept, hide and
  snooze are stored per person (`next_action_decisions`, RLS plus a restrictive per-user policy). The card shows what
  accepted suggestions led to over 30 days: tasks finished and records with new activity afterwards. Record pages ask
  for the same list scoped to that record.
- **Timeline.** Read-only merge of the existing tables, newest first, with paging by time and kind filters. A company
  rolls up its contacts and deals. Each source is checked against the caller's permissions; sources they cannot read
  are left out and named in `hidden`, never silently mixed in.
- **Record intelligence.** Engagement trend (30 days against the 30 before), buying signals, senior people at the
  company by job title, and account value. Email opens are always marked as estimates (image loading is not proof of
  reading); replies, clicks, meetings, form submissions and stage moves are confirmed events.
- **Insights.** Ten fixed measures over the last 7 days against the 7 before, for the caller or the team, from
  records only. No forecasts or benchmarks are invented; a measure with too little data is not shown.
- **Copilot.** Four read-only tools (`my_next_actions`, `sales_insights`, `record_intelligence`, `deals_at_risk`)
  that cite the records they used. No new write actions.

**Consequences.** No new AI calls are made for scoring or ranking, so these features work without an AI key and cost
nothing per use. The rules are simple and explainable, which also means they will miss things a trained model might
catch; a learned model can be added later behind the same `scoreDeal` version field. Decision-makers are inferred
from job titles only and say so.

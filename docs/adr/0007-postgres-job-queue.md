# ADR 0007: PostgreSQL outbox and job queue for automation (no separate queue service yet)

**Status:** superseded by [ADR 0058](0058-mongodb.md) (2026-11-09); accepted 2026-10-30

**Decision.** Background work in Phase 3 (event relay, workflow runs, delays, approval expiry, webhook
delivery, mailbox sync) runs on PostgreSQL:

- Business changes write a `domain_events` row in the **same transaction** as the change and its audit
  entry (transactional outbox), from `AuditService.record`.
- A worker process (`apps/api/src/worker.ts`, or the API with `RUN_WORKER_IN_PROCESS=true` in
  development and e2e) polls the queue tables. Claims use `FOR UPDATE SKIP LOCKED` plus a lease column
  (`locked_until` / `next_attempt_at`), so several workers can run safely.
- The worker sees due work across tenants only through a narrow `worker_scan` RLS policy that exists on
  the five queue tables. Each job is then processed inside its own tenant context with the normal
  tenant-isolation policy. Workflows, notifications, mail and every CRM table have no worker policy.
- Delays are rows with `resume_at`; approvals park a run in `AWAITING_APPROVAL` until a decision.

**Why.** It needs no new infrastructure, the outbox gives exactly-once publication with the change, and
tenant isolation stays enforced by the database. Volume at launch fits comfortably in Postgres.

**Consequences.**
- Delivery is at least once. Workflow steps record success as they go and are not repeated after a
  crash; webhook receivers must de-duplicate on the event id.
- Polling adds latency (default 2 s, `WORKER_POLL_MS`).
- When throughput or scheduling needs outgrow this (millions of events per day, cron-style schedules,
  long-running sagas), move the relay behind BullMQ (Redis is already in the stack) or Temporal, keeping
  `domain_events` as the outbox.

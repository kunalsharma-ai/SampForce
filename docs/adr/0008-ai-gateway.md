# ADR 0008: AI gateway inside the API, Claude first, every change confirmed by a person

**Status:** accepted (2026-10-30)

**Decision.**

- All model calls go through one `AiGateway` service in the API. It checks, in order: the workspace kill
  switch, the agent's switch, that a provider key is configured, the workspace's remaining credits and the
  caller's per-minute rate. Then it calls the provider and records tokens and credits in `ai_usage`, a table
  the application role can insert into but not update or delete.
- The first provider is Anthropic, called through the official TypeScript SDK with structured outputs
  (`output_config.format`) for agent results, an effort level per task tier, and server-side model fallbacks.
  The base URL and key are passed explicitly so the container's own environment never leaks into calls.
  Without `ANTHROPIC_API_KEY`, every agent reports "not configured" and rule-based parts keep working.
- Rule-based logic produces every number a person relies on: lead scores and their signals, deal health,
  forecast totals and scenarios. The model writes summaries, next steps, drafts and explanations around
  those numbers and is never the source of a score, an amount or a price.
- Agents cannot change data on their own. Copilot's write tools only create proposals; the person who asked
  confirms each one, and the permission check runs again at that moment. Agent recommendations are accepted
  through the normal CRM services as the person. Tools for sending messages, changing prices, exporting
  data or changing security settings do not exist.
- Background agent work (auto-qualify on new leads) is queued as an `ai_runs` row and processed by the
  existing worker (ADR 0007), which sees due runs through the same narrow `worker_scan` policy.

**Why.** One choke point makes cost limits, kill switches, audit and redaction impossible to bypass.
Keeping numbers rule-based makes them reproducible and testable, and keeps model mistakes out of figures
people act on. Confirm-before-change keeps a person accountable for every write.

**Consequences.** Answers are slower than streaming would feel; streaming is a follow-up. A second provider
needs its own adapter behind `ModelProvider`. Tests use a local fixture that imitates the Messages API, so
answer quality is only measured by running the eval suites with a real key.

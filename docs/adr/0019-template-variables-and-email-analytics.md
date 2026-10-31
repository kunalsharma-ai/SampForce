# ADR 0019: Template categories, custom merge fields, workspace variables and email analytics

- Status: Accepted
- Date: 2026-10-31
- Part of: Enhancement programme, Phase 2b (spec Part 3, sections B and E)

## Context

The spec asks for richer templates (categories, campaign links, duplication, custom fields and variables in merge
tags) and campaign analytics by sequence, mailbox, template and follow-up. The sequence engine, its merge renderer
and its stored messages and events already exist (Phase 9). This change extends them; it adds no second template or
reporting system.

## Decisions

1. **Two new tag namespaces, no free-form tags.** `{{custom.<key>}}` reads a lead or contact custom field and
   `{{var.<key>}}` a workspace email variable. Built-in tags are unchanged. Saving a template or sequence that uses a
   custom field or variable that does not exist is refused (`UNKNOWN_MERGE_FIELD`), so a typo cannot reach a
   recipient. An empty value behaves like any empty merge field: it uses the fallback after `|`, or the sequence
   pauses that person instead of sending a gap.
2. **Variables are a small table (`email_variables`, at most 50 per workspace), not settings JSON,** so they get RLS,
   audit rows and a unique key. Only `marketing:manage` can change them. A variable that a template or live sequence
   uses cannot be deleted (`VARIABLE_IN_USE`); the check parses tags rather than substring-matching.
3. **Category is free text with suggestions,** not a managed list. A template can belong to one marketing campaign
   (`campaign_id`, `ON DELETE SET NULL`). Duplicating makes a private copy named "(copy)".
4. **Analytics are computed from stored sequence messages and email events,** grouped by sequence, sender, step and
   version. Template and follow-up position come from each sequence's current steps, so editing a sequence later
   re-attributes its history to the current step layout; this is documented on the endpoint rather than snapshotted.
5. **Honest numbers.** Replies and bounces come from the synced mailbox and are reliable. Opens are labelled as
   estimates and clicks may include security scanners. There is no "delivered" figure because Gmail and Microsoft 365
   do not report delivery. Reps see their own sends; the whole-team view needs `marketing:manage`.

## Consequences

- Phase 2c (AI-written templates) can reuse the same tag rules and validation.
- Not done here: per-template version history, and analytics snapshots that survive later step edits.

# ADR 0020: Email Assistant on the existing AI layer

- Status: Accepted
- Date: 2026-10-31
- Part of: Enhancement programme, Phase 2c (feature 5; spec Part 3, section F)

## Context

Feature 5 asks for AI drafting, rewriting, subject lines, conversation summaries, suggested replies, intent,
objections and buying signals, follow-up timing, and review before sending. Section F adds optimisation tips:
follow-up timing, quiet steps, disengaged prospects, sequence changes. SampForce already has one AI gateway (metering,
credit caps, per-agent switches, redaction, prompt versions, run log) and a recommendation store. This adds one
agent, `email_assistant`, on that layer. It is not a second AI system.

## Decisions

1. **One agent with four operations.** The operations are draft (compose, follow-up or reply, optionally as a
   template), rewrite (improve, shorten or change tone), subject lines, and analyse a received email. Each is a
   structured-output call with a versioned prompt, recorded as an AI run. Drafts and analyses tied to a record are
   stored as recommendations.
2. **Never sends.** Results are shown as a suggestion. The editor changes only when the person chooses
   "Use this". Sending still goes through the normal send path, which checks permissions, the mailbox and the
   do-not-email list. Nothing in this agent can send, enrol, suppress or change a record.
3. **Merge fields are protected in code, not only by the prompt.**
   - A rewrite whose merge-field set differs from the input is rejected (422 `AI_OUTPUT_UNUSABLE`).
   - A template draft may only use built-in tags, the workspace's lead and contact custom fields, and its variables.
   - Subject suggestions with unknown tags are dropped.
4. **Facts, not invention.** The prompts forbid invented prices, dates, meetings and claims, and ask for
   `[placeholders]` instead, which the screen lists under "Check before sending". Email content is passed as
   untrusted data, as it already is for Copilot.
5. **Intent is a reading, not a fact.**
   - The latest intent is stored on `email_messages.ai_intent` so the mailbox can show it. It is labelled "AI:"
     and the screen says it is not a confirmed fact.
   - For an unsubscribe or not-interested email, the code forces the next step to "stop outreach" and removes any
     reply draft or follow-up. Suppression stays a button the person presses; the AI does not suppress anyone.
6. **Optimisation tips are rules, not AI.** The Results tab shows tips computed from stored messages, each with a
   stated minimum sample:
   - a step with 20 or more sends and no replies
   - a bounce rate of 5% or more on 20 or more sends
   - an A/B leader only when a two-proportion test passes at 95% with 30 or more sends per version
   - median reply time from 10 or more replies
   - people with 3 or more emails and no reply, open, click or bounce

   They work without an AI provider.

## Consequences

- With no provider configured, or with the agent switched off, the buttons explain why and templates, merge
  fields and tips keep working.
- Not done here:
  - automatic intent classification of every reply. This would spend credits without a person asking, and is
    left for an admin opt-in later.
  - an AI-chosen send time per recipient.

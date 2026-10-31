# ADR 0022: The team inbox groups stored email into conversations

- Status: Accepted
- Date: 2026-10-31
- Part of: Enhancement programme, Phase 2d (feature 8)

## Context

Feature 8 asks for one inbox: Gmail and Outlook mailboxes, incoming and outgoing conversations synced with CRM
records, links to leads, accounts and deals, templates and AI replies, assignment, internal notes, search and
filters, history on records, delivery, bounce, click and reply events, categories and statuses, and mailbox sync
logs. DealFlow already syncs Gmail and Microsoft 365, stores only messages that involve a known contact or lead,
sends from the person's own mailbox, tracks sequence emails, and has the Email Assistant. The inbox builds on
those. It is not a second mail store.

## Decisions

1. **Conversations are built in the database.** `email_threads` has one row per provider thread per mailbox.
   A `BEFORE INSERT` trigger on `email_messages` creates or updates the conversation for every stored message,
   whatever stored it: sync, a one-off send or a sequence. A message that `ON CONFLICT DO NOTHING` will skip is not
   counted twice. Existing mail was grouped by the migration.
2. **Status follows the mail.** A new received message sets a conversation to Open. A reply sent from an open
   conversation sets it to "Waiting on them". People can set any status, including Closed. The default view shows
   open and waiting conversations.
3. **Replies stay in the conversation when they can.** `POST /emails/send` takes `conversationId`. When the
   conversation is in the sender's own mailbox, Gmail files the reply in the same thread, and DealFlow stores it in
   the same conversation for both providers. Microsoft Graph's `sendMail` cannot thread, so Outlook may show the
   reply separately. A conversation in someone else's mailbox can be read, assigned and noted by the team, but a
   reply goes from your own mailbox and starts a new conversation. The screen says so.
4. **Assignment, categories, links and notes.** Category is one of sales, support, billing, partnership or
   other, set by a person. Assignment notifies the assignee. Notes are internal, never sent, and notify the assignee
   and the mailbox owner (not the author). Linking to a deal, contact or lead checks the record is in the workspace.
   Each change is audited.
5. **Visibility matches the existing mailbox screen.** Anyone with `activities:read` sees the workspace's stored
   conversations, as they already saw stored emails. Only CRM-related mail is ever stored.
6. **Tracking is stated honestly.** Sequence emails show bounces, replies, clicks and opens, with opens marked as
   estimates and a note that scanners can open and click. Other sent emails say that Gmail and Outlook do not report
   delivery. There is no "delivered" status.
7. **Sync log.** Each sync attempt (manual or scheduled) writes `integration_sync_logs` with counts or the error.
   The last 200 per mailbox are kept. People see their own mailboxes' logs; `integrations:manage` sees all.
8. **Templates and AI in replies.** The compose box can insert a saved template, filled for the linked contact or
   lead with missing fields listed, and keeps "Write with AI" and the AI reading of the latest received email.

## Not built

- Shared team mailboxes such as sales@ connected once for everyone. Each member connects their own mailbox.
- Read and unread state per person, and @mentions in notes.
- Automatic categorisation. The AI intent badge is shown, but the category is set by a person.

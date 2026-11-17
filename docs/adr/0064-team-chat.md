# ADR 0064: Team chat and the support line, served by SampForce itself

- Status: Accepted
- Date: 2026-11-16

## Context

Kunal asked for an internal chat between super admins (the operator console), workspace admins and users: direct
messages, group channels such as "Project updates", unread counts, read receipts, files, search, and optional links to
a company, RFQ or deal. It has to work online **and** with no internet, on an office network where SampForce runs on
a local server. So nothing may depend on an outside chat service, broker or CDN, and a browser that loses its
connection must not lose what its person writes. The super admin decides which workspaces get it (ADR 0057).

## Decision

- **Everything is stored and delivered by the SampForce API.** Five collections: `chat_conversations` (DIRECT,
  CHANNEL or SUPPORT, optional record link), `chat_members` (a workspace user or a super admin, with `lastReadAt`),
  `chat_messages`, `chat_attachments` (file bytes in MongoDB, 10 MB each, like company files) and `chat_signals`
  (live events, kept ten minutes). All are workspace documents under the workspace guard (ADR 0058).
- **Direct messages** have one conversation per pair (`directKey` = the two user ids, sorted, unique per workspace).
  **Channels** have an owner; the owner and workspace admins (`tenant:manage`) rename, link, archive and change
  members; anyone may leave. An archived channel is read-only.
- **The support line** is one SUPPORT conversation per workspace (`directKey` = `support`). Every workspace admin is
  on it automatically and cannot leave; an admin may add other people. Every active operator (super admins and
  support staff) sees every workspace's support line in Operator console → Support chat and can open one for a
  workspace that has not written yet. Operators never see a workspace's other conversations, cannot link workspace
  records, and their messages carry a "Super admin" badge. The console lists support lines through the read-only
  operator scan, which now includes `ChatConversation`, `ChatMember` and `ChatMessage`; writing runs in the
  workspace's own context.
- **Unread and read receipts** come from `lastReadAt`: unread = messages after it not written by you; opening a
  conversation moves it to the latest message; your own message moves yours. The thread shows "Sent", "Seen",
  "Seen by N" or "Seen by everyone" under your last message.
- **Live delivery is Server-Sent Events** (`GET /chat/stream`, `GET /operator/chat/stream`): plain HTTP through the
  same gateway as the rest of the app (`X-Accel-Buffering: no` for nginx, a 20-second heartbeat, closed after five
  minutes so the session is checked again on reconnect). An event names what changed (message, message_changed,
  read, conversation) and carries no message text; the browser re-reads it through the normal, permission-checked
  routes. Each change writes a `chat_signals` document in its own transaction; the server that made it delivers at
  once after commit, and every other API server reads new signals every 1.5 s (`CHAT_RELAY_MS`), so a Helm
  deployment with several API replicas works without Redis or a broker. The relay reads signals through a new,
  narrow `chatRelay` database context (read and prune `ChatSignal` only). On every (re)connect the browser re-reads
  its chat, so a missed signal costs a refresh, never a message.
- **Store-and-forward outbox.** The browser writes every message to an IndexedDB outbox first (files included),
  then sends it. It keeps messages through a lost connection and a closed tab, and sends them in order when the
  stream reconnects, the browser goes online, or every 8 s. Each message has a `clientId` chosen when written; the
  server stores (conversation, clientId) once, so a retry or two racing tries never duplicate it. A refusal (400,
  403, 404) marks the item "Not sent" with the reason and Try again / Discard; network errors, 5xx and 401 keep it
  queued. `writtenAt` records when a queued message was written (kept only if it is more than a minute and less than
  seven days old). `clientId` is built from `crypto.getRandomValues`, because `crypto.randomUUID` is missing on
  plain-http pages such as `http://192.168.1.10`.
- **Search** is a case-insensitive match on message text and link names, only in conversations you are in.
- **Record links** (COMPANY, RFQ, DEAL) are checked against the sender's own access (record visibility of ADR 0060,
  the `rfqs` feature, `deals:read`) and stored with the record's name, so everyone in the conversation sees the name;
  opening it still checks their own access.
- **Plan feature `team_chat`** (group Engage) is on every plan by default and added to stored plans once on
  upgrade (`SHIPPED_FEATURES`); an operator can remove it per plan or per workspace. Without it the workspace's chat
  routes answer `FEATURE_NOT_IN_PLAN` and its support line leaves the console list. Chat routes take signed-in
  sessions only, never API keys.
- Text: page phrases in `lib/i18n/phrases/chat.ts` and server messages in `packages/types/src/i18n/text`, in
  English, Spanish, French, German and Arabic; help topics `page.chat` and `page.operatorChat`.

## Consequences

- An office installation needs nothing extra: the same server and gateway carry chat. If the gateway is not the
  bundled nginx, it must not buffer `text/event-stream` responses.
- Files live in MongoDB, so backups include them; very large files belong in a document store, not chat.
- Messages are deleted softly (text and files removed, a "message deleted" line kept); there is no retention policy
  or export yet, and no typing indicators, reactions or threads.
- Operator writes are not in the workspace audit log per message (chat is not an audit trail); channel creation,
  member changes, archiving and deleting someone else's message are.
- Not tested here: a real office LAN without internet and a multi-node cluster (the relay is tested with two API
  servers on one database).

# ADR 0069: Real-time team chat over WebSocket, with a fallback that works through any gateway

- Status: Accepted
- Date: 2026-11-22
- Builds on: ADR 0064 (team chat and the support line), which it changes where stated

## Context

Kunal reported that team chat did not work reliably between members and asked for a rebuild as a real-time
messaging platform: instant delivery, one-to-one and group chats, sent/delivered/read status, typing and online
indicators, notifications and unread counts everywhere, history on every device, and graceful handling of network
loss, reconnection and duplicates. It had to stay part of SampForce (same sign-in, workspace members, MongoDB) and
keep working on an office network without internet.

An audit of ADR 0064's chat found:

1. Live delivery was one long Server-Sent Events response. A gateway that buffers responses (a hand-written nginx in
   front of the self-hosted stack is the common case) holds the events back: the page stayed on "Connecting…", and
   because the open conversation was never re-read on a timer, other people's messages appeared only after a reload.
2. The stream opened only on the Team chat page. Elsewhere unread counts refreshed every 20 seconds and nothing told
   people a message had arrived.
3. Only the latest 100 messages of a conversation could be read; there was no "delivered", typing or presence.
4. People can chat only within their workspace. Two people who each signed up have two workspaces and cannot see
   each other. Kunal chose to keep it that way (2026-11-22): workspaces are the privacy boundary; invite people to
   chat with them.

## Decision

- **WebSocket first.** Each API server accepts `GET /api/v1/chat/socket` (workspace people) and
  `/api/v1/operator/chat/socket` (super admins) as a WebSocket upgrade on its own HTTP server (`ws` package, no
  extra port, no broker). The browser first asks for a **one-minute ticket** (`POST /chat/socket-ticket`), a normal
  guarded API call, so the session, membership, plan feature, origin check and refresh-on-401 all apply as for any
  route; the ticket (HS256, audience `sampforce-chat-socket`, keyed from `JWT_ACCESS_SECRET`) is then the only thing
  the upgrade accepts. The upgrade also refuses an `Origin` not in `WEB_ORIGINS` (cross-site WebSocket hijacking).
  An open socket re-checks its session, membership and plan every 60 seconds and closes with code 4401 when any is
  gone. The server pings every 25 seconds and drops sockets that stop answering; the browser pings every 20 seconds
  and reconnects when nothing has arrived for 40.
- **Fallback that works through any proxy.** If the socket fails twice before saying "ready" (a gateway that does
  not pass WebSockets on, or strips the Upgrade header), the browser switches to held requests:
  `GET /chat/events?cursor=&seen=&wait=25` answers as soon as there is an event, or after 25 seconds with none. It
  reads stored `chat_signals` from five seconds before the cursor (a signal is stamped just before its change
  commits) and skips the ids the browser lists in `seen`. A first call, or a cursor older than two minutes, answers
  `ready` ("re-read everything"). The browser retries the WebSocket every five minutes. The page shows
  "Live (compatibility mode)" so an operator knows the gateway could be improved.
- **One live connection on every page**, not just the chat page: it drives the unread badge, the tab title
  "(3) …", in-page pop-ups for messages in conversations not on screen, and desktop notifications when the tab is
  hidden and the person turned them on. (A WebSocket does not count as network activity for Playwright's
  `networkidle`, which is why ADR 0064 had kept SSE off other pages.)
- **Events carry their signal id (`sid`)**, so an event heard twice (socket and catch-up, two API servers, a
  reconnect) is acted on once. Events still name what changed and carry no message text; the browser re-reads
  through the permission-checked routes. New event types: `delivered`, `typing`, `presence`.
- **Delivered.** `chat_members.lastDeliveredAt`: the browser confirms delivery (`POST /chat/delivered`, one
  conversation or all) when it connects and when a message event arrives; reading and sending also move it. A
  message of yours shows one tick (sent: stored on the server), two (delivered to every other person's device) or
  two coloured ticks (read by everyone), and the last one says "Delivered", "Seen", "Seen by N" or
  "Seen by everyone".
- **Typing** is sent on the socket (or `POST /chat/conversations/:id/typing`) at most every three seconds while
  writing, checked against membership, relayed like other events and shown for six seconds.
- **Presence.** `chat_presence` holds one document per person and workspace. Every server counts the sockets of
  the people connected to it and refreshes `lastSeenAt` every 30 seconds while any is open; a held request also
  refreshes it. Online means "refreshed in the last 75 seconds and not closed since". Coming online, and going
  offline eight seconds after the last socket closes (so a reload does not flicker), are announced to the
  workspace, whose browsers re-read `/chat/presence`. The people list (`/chat/people`) now includes email, role and
  presence.
- **History.** Messages load 50 at a time; scrolling up loads earlier pages and keeps the reading position. A
  conversation opens at the first unread message with a "New messages" divider, follows new messages while you are
  at the end, and otherwise offers "N new messages ↓". A message you send appears in place as soon as the server
  stores it (the outbox copy is swapped for the stored one, never both shown).
- **Groups** are channels (ADR 0064): "New message" with one person opens the direct message, with several asks for a
  group name and creates a channel with them.
- **Removed:** `GET /chat/stream` and `GET /operator/chat/stream` (SSE). Gateways: Caddy and ingress-nginx pass
  WebSockets on by themselves (the Helm chart sets one-hour read and send timeouts); a hand-written nginx needs the
  `Upgrade`/`Connection` headers (deploy/SERVER_SETUP.md, troubleshooting), and works without them in compatibility
  mode.

## Consequences

- Nothing new to run: the same API servers and MongoDB carry chat, online or on an office LAN. Several API replicas
  work as before through the `chat_signals` relay (1.5 s between servers).
- `chat_signals` gets more writes (typing, presence, delivered). They are small and pruned after ten minutes.
- Tested here: API tests for the socket (tickets, origin, realm, sign-out closing it, typing, relay through a second
  server, operators), catch-up (dedupe, held answer, outsiders), delivered and presence; browser tests with three
  people writing at once, a second device, a reload, a dropped network, a gateway without WebSockets, notifications,
  the offline outbox and the support line; and a real nginx in front of the app with and without the WebSocket
  headers (WebSocket ~140 ms, compatibility mode ~260 ms end to end).
- Not tested: Kunal's own server and nginx, a Kubernetes cluster with several replicas behind ingress-nginx, Caddy
  with the WebSocket, mobile Safari backgrounding a tab, and desktop notifications on real desktops.

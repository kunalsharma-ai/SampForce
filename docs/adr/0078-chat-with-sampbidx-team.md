# ADR 0078: Chat with the SampBidx team

- Status: Accepted (built against the SampBidx stand-in; SampBidx's side is not built yet)
- Date: 2026-11-24

## Context

RFQs reach SampBidx from SampForce (ADR 0061), but questions about them went by email. Kunal asked for chat between
SampForce people and the SampBidx team, as its own section of Team chat (ADR 0069), with the paste-RFQ-email box left
as it is. He also set who decides: the Console Admin allows it for an organisation's Super Workspace, which hands it
down to its Manager Workspaces, and they to Executive Workspaces. SampBidx needs a list of the SampForce people who
can chat.

## Decision

- **A section of Team chat, on the same tables.** A new conversation kind `SAMPBIDX` reuses chat conversations,
  messages, attachments, the WebSocket/long-poll bus, unread counts and mobile pushes. Each workspace has one general
  line (`directKey = "sampbidx"`) and one chat per transfer (`directKey = "sampbidx:<transferId>"`). The web app shows
  them in a "Chat with SampBidx team" block above the team's own chats, with an "RFQ chat" button that lists the
  person's transfers.
- **Permission chain.** A new plan feature `sampbidx_chat` (parent `team_chat`) is `optIn`: no plan includes it by
  default, so the Console Admin switches it on per organisation (override or plan). Below that it follows the
  workspace hierarchy (ADR 0071): a workspace has it only if the workspace above handed it down. The `sampbidx` app
  must be there too. Off at any level hides the section and the server refuses the conversations (FEATURE_NOT_GRANTED).
- **Outbound** messages are stored first (`remoteDelivery = SENDING`), then posted to `POST /v1/messages` after commit,
  keyed by message id. A failure is retried by the worker (30 s, 2 min, 10 min, 30 min, 2 h, six tries); 400/401/403/
  404/413 are final. The sender sees Delivered, Sending, or Not delivered with Try again. Edit and delete are refused
  in these chats, since SampBidx already has the message. Record links are not allowed (they mean nothing outside).
- **Inbound** messages use the existing signed callback (same secret, `/messages` added), dedupe by SampBidx's
  message id, carry base64 attachments (5 files, 10 MB each, 20 MB in all), and store the SampBidx author on the
  message (`externalAuthor`). Status callbacks also put a system line in the RFQ's chat.
- **People list.** `GET …/callbacks/<id>/people`, signed over an empty body, lists active people whose workspace has
  the feature, with name, email, role and workspace only. Who is listed follows the hierarchy, so there is no separate
  "visible to SampBidx" setting.
- **Who is in an RFQ chat.** The sender, the company owner and manager (those who have the feature); if none do,
  everyone who has it, so a SampBidx message is never unseen. Others can be added if they have the feature.

## Consequences

- SampBidx must build `POST /v1/messages`, post to `/messages`, and read `/people` (contract in
  `docs/integrations/sampbidx-api.md`, section "Chat with the SampBidx team").
- The worker sweeps unsent messages each tick (`ChatMessage` is readable by the worker scan).
- Not covered: editing or deleting a message after SampBidx has it, read receipts from SampBidx, and typing
  indicators across the two systems.

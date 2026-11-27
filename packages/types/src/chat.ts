import { z } from 'zod';

/*
 * Team chat (ADR 0064): direct messages, group channels and a support line per workspace between the workspace's
 * people and the deployment's super admins (operator console). Everything is stored by and delivered from the
 * SampForce server itself, so chat keeps working on an office network with no internet. Browsers queue messages
 * written while they cannot reach the server and send them, once, when the connection returns (`clientId`).
 */

/** SAMPBIDX: a conversation with the SampBidx bidding team (the general line, or one RFQ sent to SampBidx). */
export const CHAT_KINDS = ['DIRECT', 'CHANNEL', 'SUPPORT', 'SAMPBIDX'] as const;
export type ChatKind = (typeof CHAT_KINDS)[number];

/** Records a conversation or a message can point at. */
export const CHAT_LINK_TYPES = ['COMPANY', 'RFQ', 'DEAL'] as const;
export type ChatLinkType = (typeof CHAT_LINK_TYPES)[number];

export const CHAT_MESSAGE_MAX = 4000;
export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_ATTACHMENTS_PER_MESSAGE = 5;
/** How far back a queued message may say it was written (older outbox entries are sent as written "now"). */
export const CHAT_WRITTEN_AT_MAX_AGE_MS = 7 * 86_400_000;

const linkSchema = z.object({ type: z.enum(CHAT_LINK_TYPES), id: z.string().uuid() });

export const chatDirectInputSchema = z.object({ kind: z.literal('DIRECT'), userId: z.string().uuid() });
export const chatChannelInputSchema = z.object({
  kind: z.literal('CHANNEL'),
  name: z.string().trim().min(1, 'Give the channel a name.').max(80),
  topic: z.string().trim().max(300).nullable().optional(),
  memberIds: z.array(z.string().uuid()).max(500).default([]),
  link: linkSchema.nullable().optional(),
});
export const chatConversationInputSchema = z.discriminatedUnion('kind', [chatDirectInputSchema, chatChannelInputSchema]);
export type ChatConversationInput = z.input<typeof chatConversationInputSchema>;

export const chatConversationUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Give the channel a name.').max(80).optional(),
  topic: z.string().trim().max(300).nullable().optional(),
  link: linkSchema.nullable().optional(),
  archived: z.boolean().optional(),
});
export type ChatConversationUpdate = z.input<typeof chatConversationUpdateSchema>;

export const chatMembersInputSchema = z.object({ userIds: z.array(z.string().uuid()).min(1).max(500) });

export const chatMessageInputSchema = z
  .object({
    /** Chosen by the browser when the message is written; sending it again returns the stored message. */
    clientId: z.string().uuid(),
    body: z.string().trim().max(CHAT_MESSAGE_MAX).default(''),
    /** When it was written, for messages that waited in the browser's outbox. */
    writtenAt: z.string().datetime({ offset: true }).nullable().optional(),
    link: linkSchema.nullable().optional(),
    attachmentIds: z.array(z.string().uuid()).max(CHAT_ATTACHMENTS_PER_MESSAGE).default([]),
  })
  .refine((m) => m.body.length > 0 || m.attachmentIds.length > 0 || !!m.link, { message: 'Write a message or attach a file.', path: ['body'] });
export type ChatMessageInput = z.input<typeof chatMessageInputSchema>;

export const chatMessageEditSchema = z.object({ body: z.string().trim().min(1, 'Write a message or attach a file.').max(CHAT_MESSAGE_MAX) });

export const chatMessagesQuerySchema = z.object({
  /** Messages older than this message (scrolling back). */
  before: z.string().uuid().optional(),
  /** Messages newer than this time (catching up after a reconnect). */
  after: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const chatSearchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Type at least 2 characters.').max(200),
  conversationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const chatLinkQuerySchema = z.object({ q: z.string().trim().max(100).default('') });

export const chatDeliveredSchema = z.object({ conversationId: z.string().uuid().nullable().optional() });

export const chatReadSchema = z.object({ messageId: z.string().uuid().nullable().optional() });

export interface ChatPerson {
  /** A workspace user's id, or an operator's id when `operator` is true. */
  id: string;
  name: string;
  operator: boolean;
  /** The person's profile photo (ADR 0072, M6), when they have one. */
  photoUrl?: string | null;
}

/** Someone in the workspace who can be messaged, for the people picker and the online dots. */
export interface ChatDirectoryPerson extends ChatPerson {
  email: string | null;
  /** The workspace role's name ("Admin", "Sales rep"). */
  role: string | null;
  online: boolean;
  lastSeenAt: string | null;
}

export interface ChatPresenceRow {
  userId: string;
  online: boolean;
  lastSeenAt: string | null;
}

export interface ChatLink {
  type: ChatLinkType;
  id: string;
  /** The record's name when it was linked ("FRFS0012 Acme Panels", "RFQ-0003 India B2B"). */
  label: string;
  /** Workspace page of the record. Operators see the label only. */
  href: string | null;
}

export interface ChatMemberRow {
  person: ChatPerson;
  role: 'OWNER' | 'MEMBER';
  lastReadAt: string | null;
  /** Everything up to this time has reached one of their devices. */
  lastDeliveredAt: string | null;
}

export interface ChatConversationRow {
  id: string;
  tenantId: string;
  /** The workspace's name, for the operator console. */
  workspace: string;
  kind: ChatKind;
  /** The channel name; for a direct message, the other person's name; for the support line, "SampForce support". */
  title: string;
  topic: string | null;
  link: ChatLink | null;
  archived: boolean;
  members: ChatMemberRow[];
  unread: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  /** Whether the caller may rename it, change members or archive it. */
  canManage: boolean;
  /** SAMPBIDX conversations only: what it is about and who from SampBidx has written in it. */
  sampbidx?: ChatSampbidxInfo | null;
  createdAt: string;
}

/** Someone from the SampBidx team, as SampBidx names them on their messages. */
export interface SampbidxChatPerson {
  /** SampBidx's own id for the person, when it sends one. */
  id: string | null;
  name: string;
  email: string | null;
  /** Their role in SampBidx ("Bid manager"). */
  role: string | null;
}

export interface ChatSampbidxInfo {
  /** The general line to the SampBidx team, or the chat about one RFQ sent to SampBidx. */
  scope: 'general' | 'rfq';
  transfer: {
    id: string;
    title: string;
    rfq: { id: string; number: string; projectName: string } | null;
    company: { id: string; name: string } | null;
    remoteId: string | null;
    remoteUrl: string | null;
    remoteStatus: string | null;
  } | null;
  /** SampBidx people who have written here, most recent first. */
  people: SampbidxChatPerson[];
}

/** Whether SampBidx has a message written in SampForce. */
export const SAMPBIDX_CHAT_DELIVERIES = ['SENDING', 'SENT', 'FAILED'] as const;
export type SampbidxChatDelivery = (typeof SAMPBIDX_CHAT_DELIVERIES)[number];

export interface ChatAttachmentRow {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}

export interface ChatMessageRow {
  id: string;
  conversationId: string;
  clientId: string;
  author: ChatPerson | null;
  body: string;
  link: ChatLink | null;
  attachments: ChatAttachmentRow[];
  createdAt: string;
  /** Set when the message waited in an outbox: when it was written. */
  writtenAt: string | null;
  editedAt: string | null;
  deleted: boolean;
  /** Written by someone in SampBidx (author is then null). */
  external?: SampbidxChatPerson | null;
  /** A line from SampBidx about the RFQ, such as a status change, rather than a person's message. */
  system?: boolean;
  /** Messages written in SampForce in a SampBidx conversation: whether SampBidx has it yet. */
  sampbidxDelivery?: { state: SampbidxChatDelivery; error: string | null; attempts: number } | null;
  /** Emoji reactions (redesign R9), most used first. */
  reactions?: ChatReactionRow[];
}

/** One emoji on a message: how many reacted with it, whether you did and who (first names, for the tooltip). */
export interface ChatReactionRow {
  emoji: string;
  count: number;
  mine: boolean;
  names: string[];
}

/** Most different emoji one message can carry. */
export const CHAT_REACTIONS_MAX = 20;

/** Adds (on) or takes back (off) your reaction: one emoji, no text. */
export const chatReactionSchema = z
  .object({
    emoji: z
      .string()
      .min(1)
      .max(32)
      .refine((e) => /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|\p{Emoji_Component}|\u200d|\ufe0f|[#*0-9]\ufe0f?\u20e3)+$/u.test(e) && /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(e), 'Pick an emoji'),
    on: z.boolean(),
  })
  .strict();
export type ChatReactionInput = z.infer<typeof chatReactionSchema>;

/**
 * Team chat (direct messages and channels) takes text and emoji only since the redesign (R9): no files and no record
 * links. The support line and SampBidx conversations keep them.
 */
export const TEAM_CHAT_KINDS = ['DIRECT', 'CHANNEL'] as const;

export interface ChatSearchHit {
  message: ChatMessageRow;
  conversation: { id: string; title: string; kind: ChatKind };
}

export interface ChatLinkOption {
  type: ChatLinkType;
  id: string;
  label: string;
}

/**
 * What the live connection sends. Clients re-read what changed; events carry no message text. `sid` is the stored
 * signal's id, so a client that hears the same event twice (WebSocket and catch-up, two servers) acts on it once.
 */
export type ChatStreamEvent = { sid?: string } & (
  | { type: 'ready' }
  | { type: 'message'; conversationId: string; messageId: string; authorId: string | null }
  | { type: 'message_changed'; conversationId: string; messageId: string }
  | { type: 'read'; conversationId: string; personId: string; at: string }
  | { type: 'delivered'; conversationId: string; personId: string; at: string }
  | { type: 'conversation'; conversationId: string }
  /** Someone is writing in a conversation; shown for a few seconds unless repeated. */
  | { type: 'typing'; conversationId: string; personId: string; name: string }
  /** Someone in the workspace came online or went offline: re-read presence. */
  | { type: 'presence'; userId: string; online: boolean }
);

/** How often an open client says it is still writing, and how long the indicator stays without another. */
export const CHAT_TYPING_REPEAT_MS = 3000;
export const CHAT_TYPING_SHOW_MS = 6000;
/** A person counts as online while a connection refreshed their presence this recently. */
export const CHAT_ONLINE_WINDOW_MS = 75_000;

/**
 * Catching up without a WebSocket (a gateway that does not pass WebSockets on): the browser asks for events after
 * `cursor`, and the server answers as soon as there is one, or after `wait` seconds with none. `seen` lists the
 * event ids the browser already has from the last few seconds, so nothing is handed out twice.
 */
export const chatEventsQuerySchema = z.object({
  cursor: z.string().datetime({ offset: true }).optional(),
  seen: z
    .string()
    .max(4000)
    .optional()
    .transform((s) => (s ? s.split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 100) : [])),
  wait: z.coerce.number().int().min(0).max(25).default(25),
});

export interface ChatEventsPage {
  events: ChatStreamEvent[];
  /** Send this back as `cursor` on the next request. */
  cursor: string;
}

/** A one-minute pass for opening the WebSocket, issued to a signed-in session. */
export interface ChatSocketTicket {
  ticket: string;
  /** Path of the WebSocket on this server, e.g. /api/v1/chat/socket. */
  path: string;
  expiresAt: string;
}

/** What a browser may send on the WebSocket. */
export type ChatClientFrame = { type: 'ping' } | { type: 'typing'; conversationId: string };

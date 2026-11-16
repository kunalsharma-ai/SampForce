import { z } from 'zod';

/*
 * Team chat (ADR 0061): direct messages, group channels and a support line per workspace between the workspace's
 * people and the deployment's super admins (operator console). Everything is stored by and delivered from the
 * SampForce server itself, so chat keeps working on an office network with no internet. Browsers queue messages
 * written while they cannot reach the server and send them, once, when the connection returns (`clientId`).
 */

export const CHAT_KINDS = ['DIRECT', 'CHANNEL', 'SUPPORT'] as const;
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

export const chatReadSchema = z.object({ messageId: z.string().uuid().nullable().optional() });

export interface ChatPerson {
  /** A workspace user's id, or an operator's id when `operator` is true. */
  id: string;
  name: string;
  operator: boolean;
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
  createdAt: string;
}

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
}

export interface ChatSearchHit {
  message: ChatMessageRow;
  conversation: { id: string; title: string; kind: ChatKind };
}

export interface ChatLinkOption {
  type: ChatLinkType;
  id: string;
  label: string;
}

/** What the live stream sends. Clients re-read what changed; the stream itself carries no message text. */
export type ChatStreamEvent =
  | { type: 'ready' }
  | { type: 'message'; conversationId: string; messageId: string; authorId: string | null }
  | { type: 'message_changed'; conversationId: string; messageId: string }
  | { type: 'read'; conversationId: string; personId: string; at: string }
  | { type: 'conversation'; conversationId: string };

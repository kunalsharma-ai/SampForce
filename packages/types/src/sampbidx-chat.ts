import { z } from 'zod';
import { CHAT_MESSAGE_MAX } from './chat';

/*
 * Chat with the SampBidx team (ADR 0077). SampForce people write in Team chat; each message is posted to SampBidx
 * (POST /v1/messages), and SampBidx posts its team's messages back as signed callbacks. The contract SampBidx builds
 * to is in docs/integrations/sampbidx-api.md, "Chat with the SampBidx team".
 */

/** Files SampBidx may attach to one message, and their total size once decoded. */
export const SAMPBIDX_CHAT_MAX_FILES = 5;
export const SAMPBIDX_CHAT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

const person = z.object({
  id: z.union([z.string(), z.number()]).transform(String).pipe(z.string().max(200)).optional().nullable(),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320).optional().nullable(),
  role: z.string().trim().max(120).optional().nullable(),
});

/** A message from someone in SampBidx: a signed POST to …/callbacks/<id>/messages. */
export const sampbidxInboundMessageSchema = z
  .object({
    /** SampBidx's own message id; a message sent twice with the same id is stored once. */
    id: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1).max(200)),
    /** The RFQ it is about: the transfer id SampForce sent, or SampBidx's own RFQ id. Neither = the general line. */
    transferId: z.string().max(100).optional().nullable(),
    sampbidxId: z.string().max(200).optional().nullable(),
    author: person,
    text: z.string().max(CHAT_MESSAGE_MAX).default(''),
    sentAt: z.string().datetime({ offset: true }).optional().nullable(),
    attachments: z
      .array(z.object({ name: z.string().trim().min(1).max(200), contentType: z.string().max(200).optional().nullable(), data: z.string().min(1) }))
      .max(SAMPBIDX_CHAT_MAX_FILES)
      .default([]),
  })
  .refine((m) => m.text.trim().length > 0 || m.attachments.length > 0, { message: 'Write a message or attach a file.', path: ['text'] });
export type SampbidxInboundMessage = z.infer<typeof sampbidxInboundMessageSchema>;

/** Opens (or starts) the chat about one transfer. */
export const sampbidxOpenChatSchema = z.object({ transferId: z.string().uuid() });

/** SampForce people SampBidx can show in its chat: GET …/callbacks/<id>/people, signed. */
export interface SampbidxChatPeopleResponse {
  workspace: string;
  people: { id: string; name: string; email: string; role: string | null; workspace: string; level: 'SUPER' | 'MANAGER' | 'EXECUTIVE' }[];
}

/** A transfer the person can start a SampBidx chat about. */
export interface SampbidxChatTransferOption {
  id: string;
  title: string;
  rfq: { id: string; number: string; projectName: string } | null;
  company: { id: string; name: string } | null;
  remoteId: string | null;
  remoteStatus: string | null;
  sentAt: string | null;
  /** The chat about it, once someone started one. */
  conversationId: string | null;
}

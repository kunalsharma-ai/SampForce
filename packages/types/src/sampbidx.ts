import { z } from 'zod';

/**
 * SampBidx (ADR 0061): the workspace's own SampBidx bidding tool. RFQs go there in two ways: a filled-in RFQ with its
 * attachments, or the RFQ email itself (from the synced mailbox, or an .eml/.msg file). The wire format SampBidx must
 * accept is in docs/integrations/sampbidx-api.md.
 */

/** Settings shown on the Integrations page; the API key and the callback signing secret are sealed separately. */
export interface SampbidxSettings {
  /** Where SampBidx's API lives, for example https://sampbidx.example.com/api. SampForce appends /v1/... */
  baseUrl: string;
  /** The account name SampBidx reported when the key was checked. */
  accountName: string;
  /** URL SampBidx posts status updates to (signed with the callback secret). */
  callbackUrl: string;
  /** When the first correctly signed status update arrived. */
  lastCallbackAt: string | null;
}

export const sampbidxConnectSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .url('Enter the SampBidx API address, for example https://sampbidx.example.com/api')
    .max(500)
    .refine((u) => /^https?:\/\//i.test(u), 'Enter the SampBidx API address, for example https://sampbidx.example.com/api'),
  apiKey: z.string().trim().min(8, 'Paste the API key from SampBidx').max(500),
});
export type SampbidxConnectInput = z.infer<typeof sampbidxConnectSchema>;

/** How a transfer started: a filled-in RFQ, an email from the synced mailbox, or an uploaded email file. */
export const SAMPBIDX_TRANSFER_KINDS = ['RFQ', 'MAILBOX_EMAIL', 'EMAIL_FILE'] as const;
export type SampbidxTransferKind = (typeof SAMPBIDX_TRANSFER_KINDS)[number];

/** SampForce's side: is it with SampBidx yet. SENT means SampBidx accepted it and returned its id. */
export const SAMPBIDX_DELIVERY = ['SENDING', 'SENT', 'FAILED'] as const;
export type SampbidxDelivery = (typeof SAMPBIDX_DELIVERY)[number];

/** What SampBidx reports afterwards through its signed status callback. */
export const SAMPBIDX_REMOTE_STATUSES = ['RECEIVED', 'IN_REVIEW', 'BIDDING', 'QUOTED', 'WON', 'LOST', 'REJECTED', 'CANCELLED'] as const;
export type SampbidxRemoteStatus = (typeof SAMPBIDX_REMOTE_STATUSES)[number];

/** RFQ fields SampBidx needs before an RFQ can be sent (step 1 of "Send to SampBidx"). */
export const SAMPBIDX_REQUIRED_RFQ_FIELDS = ['projectName', 'methodology', 'market', 'sampleSize', 'deadlineAt'] as const;
export type SampbidxRequiredField = (typeof SAMPBIDX_REQUIRED_RFQ_FIELDS)[number];

/** At most this many files go with one transfer, and at most this many bytes in all (SampBidx may accept less). */
export const SAMPBIDX_MAX_FILES = 20;
export const SAMPBIDX_MAX_TOTAL_BYTES = 40 * 1024 * 1024;
/** An uploaded RFQ email (.eml or Outlook .msg) can be up to 10 MB, attachments included (it is kept for retries). */
export const SAMPBIDX_EMAIL_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const SAMPBIDX_EMAIL_FILE_TYPES = ['message/rfc822', 'application/vnd.ms-outlook'] as const;

export const sampbidxSendRfqSchema = z.object({
  rfqId: z.string().uuid(),
  /** Which of the RFQ's files go with it; left out, all of them. */
  fileIds: z.array(z.string().uuid()).max(SAMPBIDX_MAX_FILES).optional(),
  note: z.string().trim().max(2000).optional().nullable(),
  /** Send again although SampBidx already has this RFQ (it gets a new record there). */
  resend: z.boolean().optional(),
});
export type SampbidxSendRfqInput = z.infer<typeof sampbidxSendRfqSchema>;

export const sampbidxSendMailboxEmailSchema = z.object({
  emailMessageId: z.string().uuid(),
  /** Optional links so the transfer shows on the company page and the RFQ. */
  companyId: z.string().uuid().optional().nullable(),
  rfqId: z.string().uuid().optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
  resend: z.boolean().optional(),
});
export type SampbidxSendMailboxEmailInput = z.infer<typeof sampbidxSendMailboxEmailSchema>;

/** Query of POST /sampbidx/transfers/email-file (the body is the file itself). */
export const sampbidxEmailFileQuerySchema = z.object({
  name: z.string().trim().min(1).max(200),
  companyId: z.string().uuid().optional(),
  rfqId: z.string().uuid().optional(),
  note: z.string().trim().max(2000).optional(),
});
export type SampbidxEmailFileQuery = z.infer<typeof sampbidxEmailFileQuerySchema>;

export const sampbidxTransferListQuerySchema = z.object({
  rfqId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  delivery: z.enum(SAMPBIDX_DELIVERY).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type SampbidxTransferListQuery = z.infer<typeof sampbidxTransferListQuerySchema>;

export const sampbidxMailboxQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export interface SampbidxTransferRow {
  id: string;
  kind: SampbidxTransferKind;
  /** Subject of the email, or "RFQ-0001 Project name". */
  title: string;
  rfq: { id: string; number: string; projectName: string } | null;
  company: { id: string; name: string } | null;
  /** Sender and date of the email, for email transfers. */
  emailFrom: string | null;
  emailDate: string | null;
  files: { name: string; sizeBytes: number }[];
  note: string | null;
  delivery: SampbidxDelivery;
  attempts: number;
  lastError: string | null;
  /** SampBidx's id and link for it, once accepted. */
  remoteId: string | null;
  remoteUrl: string | null;
  remoteStatus: SampbidxRemoteStatus | null;
  remoteNote: string | null;
  remoteUpdatedAt: string | null;
  sentBy: string | null;
  sentAt: string | null;
  createdAt: string;
}

/** What step 1 of "Send to SampBidx" checks, for one RFQ. */
export interface SampbidxRfqReadiness {
  connected: boolean;
  /** Required fields still empty on the saved RFQ. */
  missing: SampbidxRequiredField[];
  files: { id: string; name: string; sizeBytes: number; contentType: string }[];
  transfers: SampbidxTransferRow[];
}

/** A synced email that can be transferred. */
export interface SampbidxMailboxEmail {
  id: string;
  subject: string;
  fromAddress: string;
  toAddresses: string[];
  sentAt: string;
  snippet: string | null;
  direction: 'INBOUND' | 'OUTBOUND';
  /** Already sent to SampBidx (latest transfer). */
  transferredAt: string | null;
  contact: { id: string; name: string; companyId: string | null; companyName: string | null } | null;
}

/** Body SampBidx posts to the callback URL. Signed: X-SampBidx-Signature: sha256=HMAC(secret, `${timestamp}.${body}`). */
export const sampbidxCallbackSchema = z.object({
  /** The transfer id SampForce sent as X-SampForce-Transfer-Id (or SampBidx's own id). */
  transferId: z.string().max(100).optional(),
  sampbidxId: z.string().max(200).optional(),
  status: z.preprocess((v) => (typeof v === 'string' ? v.toUpperCase() : v), z.enum(SAMPBIDX_REMOTE_STATUSES)),
  note: z.string().max(2000).optional().nullable(),
  url: z.string().url().max(1000).optional().nullable(),
});
export type SampbidxCallback = z.infer<typeof sampbidxCallbackSchema>;

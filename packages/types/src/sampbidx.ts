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
  /** The last "Test connection" of the saved connection (ADR 0095): when, and the failed step's message if it failed. */
  lastCheck?: { at: string; ok: boolean; message: string | null } | null;
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

/** How a transfer started: a filled-in RFQ, an email from the synced mailbox, an uploaded email file, or email text pasted on a company. */
export const SAMPBIDX_TRANSFER_KINDS = ['RFQ', 'MAILBOX_EMAIL', 'EMAIL_FILE', 'PASTED_EMAIL', 'CLIENT', 'DEAL'] as const;
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

/** Pasted RFQ email text can be up to this many characters (a long thread with quoted replies still fits). */
export const SAMPBIDX_PASTED_EMAIL_MAX_CHARS = 100_000;

/**
 * Option 2c: the text of an RFQ email a client sent, copied from any mail program and pasted on the company page.
 * Subject, sender and date are read from the text (parsePastedEmail); the person can correct them before sending.
 */
/** Where in SampForce the RFQ email was captured, kept on the transfer and sent to SampBidx as the source reference. */
export const SAMPBIDX_CAPTURE_SOURCES = ['company', 'contact', 'lead', 'deal', 'email', 'rfqs'] as const;
export type SampbidxCaptureSource = (typeof SAMPBIDX_CAPTURE_SOURCES)[number];

export const sampbidxCaptureSourceSchema = z.object({
  type: z.enum(SAMPBIDX_CAPTURE_SOURCES),
  /** The record's id (the email message for "email"); none for the RFQs page. */
  id: z.string().uuid().optional().nullable(),
});
export type SampbidxCaptureSourceRef = z.infer<typeof sampbidxCaptureSourceSchema>;

/** Attachment files added next to pasted email text: at most this many, within SAMPBIDX_MAX_TOTAL_BYTES. */
export const SAMPBIDX_PASTED_MAX_FILES = 10;
export const SAMPBIDX_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

export const sampbidxSendPastedEmailSchema = z.object({
  /** The client company. Left out, the company of the matched employee (or the email's domain) is used if certain. */
  companyId: z.string().uuid().optional().nullable(),
  /** The employee who sent it. Left out, SampForce matches the sender's address to an employee. */
  contactId: z.string().uuid().optional().nullable(),
  /** Attachments uploaded first with POST /apps/sampbidx/attachments; sent to SampBidx as files with the email. */
  attachmentIds: z.array(z.string().uuid()).max(SAMPBIDX_PASTED_MAX_FILES).optional(),
  source: sampbidxCaptureSourceSchema.optional().nullable(),
  rfqId: z.string().uuid().optional().nullable(),
  text: z.string().trim().min(20, 'Paste the whole RFQ email').max(SAMPBIDX_PASTED_EMAIL_MAX_CHARS, 'The pasted email is too long. Leave out older quoted replies.'),
  subject: z.string().trim().max(300).optional().nullable(),
  from: z.string().trim().max(300).optional().nullable(),
  date: z.string().datetime({ offset: true }).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
  /** Also log the email on the company as an "RFQ received" interaction. */
  logInteraction: z.boolean().default(true),
  resend: z.boolean().optional(),
});
/** What the browser sends (logInteraction may be left out). */
export type SampbidxSendPastedEmailInput = z.input<typeof sampbidxSendPastedEmailSchema>;
/** The same after validation, as the API reads it. */
export type SampbidxPastedEmail = z.output<typeof sampbidxSendPastedEmailSchema>;

/** POST /apps/sampbidx/pasted-email/check: what SampForce reads from the text and who it would link it to, before sending. */
export const sampbidxPastedCheckSchema = z.object({
  text: z.string().max(SAMPBIDX_PASTED_EMAIL_MAX_CHARS),
  companyId: z.string().uuid().optional().nullable(),
  contactId: z.string().uuid().optional().nullable(),
});
export type SampbidxPastedCheckInput = z.infer<typeof sampbidxPastedCheckSchema>;

/**
 * How sure the link to the client is. "given": the person is on that company or employee's page; "contact": the
 * sender's address belongs to an employee; "domain": only the address's domain matches a company; "none": no match.
 * Anything below "contact" (or a sender who belongs to another company) is shown for the person to check.
 */
export type SampbidxMatchConfidence = 'given' | 'contact' | 'domain' | 'none';

export interface SampbidxPastedCheck {
  subject: string | null;
  from: string | null;
  fromEmail: string | null;
  to: string[];
  cc: string[];
  date: string | null;
  company: { id: string; name: string } | null;
  contact: { id: string; name: string; email: string | null; companyId: string | null } | null;
  confidence: SampbidxMatchConfidence;
  /** A sentence for the person when the match needs checking, for example the sender works at another company. */
  review: string | null;
  /** Other companies the email's domain matches, to choose from. */
  candidates: { id: string; name: string }[];
  /** The text says something is attached, but pasted text cannot carry files. */
  mentionsAttachments: boolean;
  /** The same email text was already sent to SampBidx. */
  duplicate: { transferId: string; remoteId: string | null; sentAt: string | null; sentBy: string | null; company: string | null } | null;
}

/** "Please find attached", "see the attachment", "questionnaire attached", "enclosed"… */
export function mentionsAttachments(text: string): boolean {
  return /\b(attached|attachments?|enclosed|please find (the )?(attached|enclosed)|see (the )?(attached|attachment)|PFA)\b/i.test(text);
}

/** The same email pasted twice, whatever the spacing or line endings, gives the same key. */
export function pastedEmailKey(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** What parsePastedEmail reads from pasted email text. Anything it cannot find is null or empty. */
export interface PastedEmail {
  subject: string | null;
  /** The sender as written, for example "Jonas Weber <jonas@bluehill.example>". */
  from: string | null;
  fromEmail: string | null;
  to: string[];
  cc: string[];
  date: Date | null;
}

const EMAIL_RE = /[^\s<>"'(),;:[\]]+@[^\s<>"'(),;:[\]]+\.[a-z]{2,}/gi;
const HEADER_RE = /^\s*\**\s*(from|sent|date|to|cc|subject)\s*\**\s*:\s*(.*?)\s*$/i;
const SEPARATOR_RE = /^\s*(-{2,}.*-{2,}|_{5,}|begin forwarded message:?|forwarded message)\s*$/i;

function emailsIn(v: string): string[] {
  return [...new Set((v.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))];
}

/**
 * Reads subject, sender, recipients and date from email text pasted out of a mail program. Understands the header
 * block that Outlook, Gmail and Apple Mail put at the top of a copied or forwarded email ("From: … Sent: … To: …
 * Subject: …"), and the Gmail screen layout (subject line, then "Name <address>"). The text itself is never changed:
 * SampBidx always gets all of it.
 */
export function parsePastedEmail(raw: string): PastedEmail {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n');
  const out: PastedEmail = { subject: null, from: null, fromEmail: null, to: [], cc: [], date: null };
  let i = 0;
  // Skip blank lines and "---------- Forwarded message ---------" before the header block.
  while (i < lines.length && i < 15 && (!lines[i]!.trim() || SEPARATOR_RE.test(lines[i]!))) i++;
  let headers = 0;
  for (; i < lines.length; i++) {
    const m = HEADER_RE.exec(lines[i]!);
    if (!m) break;
    headers++;
    const name = m[1]!.toLowerCase();
    const value = m[2]!;
    if (name === 'from' && !out.from) out.from = value || null;
    else if (name === 'subject' && !out.subject) out.subject = value || null;
    else if (name === 'to') out.to = emailsIn(value);
    else if (name === 'cc') out.cc = emailsIn(value);
    else if ((name === 'sent' || name === 'date') && !out.date) out.date = readDate(value);
  }
  if (!headers) {
    // Gmail's open-email layout: the subject, perhaps "Inbox", then "Name <address>" on its own line.
    const top = lines.map((l) => l.trim()).slice(0, 10);
    const at = top.findIndex((l) => /^[^<>]{0,120}<[^<>\s]+@[^<>\s]+>/.test(l));
    if (at >= 0) {
      out.from = top[at]!.replace(/\s+(\d{1,2}:\d{2}.*|\(.*\))$/, '').trim();
      const subject = top.slice(0, at).find((l) => l && !/^(inbox|external|important)$/i.test(l) && l.length <= 300);
      if (subject) out.subject = subject;
      const when = top.slice(at + 1, at + 3).find((l) => readDate(l.replace(/\s*\(.*\)\s*$/, '')));
      if (when) out.date = readDate(when.replace(/\s*\(.*\)\s*$/, ''));
    }
  }
  out.fromEmail = out.from ? (emailsIn(out.from)[0] ?? null) : null;
  return out;
}

/** "Monday, November 24, 2026 8:12 AM", "Mon, 24 Nov 2026 08:12:00 +0000", "24 November 2026 at 08:12" and the like. */
function readDate(v: string): Date | null {
  const cleaned = v.replace(/\s+at\s+/i, ' ').replace(/(\d)(st|nd|rd|th)\b/gi, '$1').trim();
  if (!/\d{4}/.test(cleaned)) return null;
  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? null : d;
}

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
  /** The client's point of contact in the team (or its owner when no POC is set), by name. */
  clientPoc: string | null;
  /** Sender and date of the email, for email transfers. */
  emailFrom: string | null;
  emailDate: string | null;
  /** The employee it came from, for pasted emails. */
  contact: { id: string; name: string } | null;
  /** Where it was captured in SampForce. */
  source: SampbidxCaptureSourceRef | null;
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

// ───────────── Send a company to SampBidx (ADR 0080) ─────────────

/*
 * A SampForce company goes to SampBidx as a client (PUT /v1/clients/{externalId}), with only the employees the person
 * ticks, and optionally one RFQ from the employee who shared it (POST /v1/rfqs, now carrying the client and that
 * employee). Fields follow SampBidx's Clients screen: company name; offices; contacts with name, email, job title,
 * phone, country, time zone and the two consent ticks.
 */

/** Mandatory on SampBidx's Clients screen (marked * there). */
export const SAMPBIDX_CLIENT_REQUIRED = ['name'] as const;
export const SAMPBIDX_CONTACT_REQUIRED = ['name', 'email', 'country', 'timeZone'] as const;
export type SampbidxContactField = (typeof SAMPBIDX_CONTACT_REQUIRED)[number] | 'jobTitle' | 'phone';

const countryCode = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'Pick a country');
const timeZone = z.string().trim().min(3).max(64).regex(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/, 'Pick a time zone');
const blankToNull = (max: number) => z.string().trim().max(max).nullable().optional().or(z.literal('').transform(() => null));

/** Details typed on the preview to fill gaps. They are saved to the SampForce records too, so they are typed once. */
export const sampbidxCompanyCompletionSchema = z.object({
  company: z.object({ website: blankToNull(500), industry: blankToNull(120), country: countryCode.nullable().optional(), city: blankToNull(120) }).partial().optional(),
  contacts: z
    .record(
      z.string().uuid(),
      z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email').optional(), jobTitle: blankToNull(200), phone: blankToNull(50), country: countryCode.optional(), timeZone: timeZone.optional() }).partial(),
    )
    .optional(),
});
export type SampbidxCompanyCompletion = z.infer<typeof sampbidxCompanyCompletionSchema>;

export const sampbidxCompanyPreviewQuerySchema = z.object({
  /** The employee who shared the RFQ. */
  contactId: z.string().uuid().optional(),
  rfqId: z.string().uuid().optional(),
  /** Further employees to send as client contacts, comma-separated. */
  contactIds: z.string().optional(),
});

export const sampbidxSendCompanySchema = z.object({
  companyId: z.string().uuid(),
  /** The employee who shared the RFQ, always sent as a client contact. */
  contactId: z.string().uuid(),
  /** Other employees to send as client contacts (only those the person ticked). */
  extraContactIds: z.array(z.string().uuid()).max(20).default([]),
  /** The RFQ to send with the client; none sends the client only. */
  rfqId: z.string().uuid().nullable().optional(),
  fileIds: z.array(z.string().uuid()).max(SAMPBIDX_MAX_FILES).optional(),
  mayReceiveQuotes: z.boolean().default(true),
  completion: sampbidxCompanyCompletionSchema.optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  /** Send the RFQ again although SampBidx already has it. */
  resend: z.boolean().optional(),
});
export type SampbidxSendCompanyInput = z.input<typeof sampbidxSendCompanySchema>;

export interface SampbidxPreviewValue {
  /** What will be sent; null when SampForce has nothing. */
  value: string | number | boolean | null;
  required: boolean;
  /** Required and empty: must be filled on the preview before sending. */
  missing: boolean;
  /** Where the value comes from when it is not the record's own field (e.g. the company's country for a contact). */
  from: 'record' | 'company' | 'rfq' | null;
}

export interface SampbidxPreviewContact {
  id: string;
  name: SampbidxPreviewValue;
  email: SampbidxPreviewValue;
  jobTitle: SampbidxPreviewValue;
  phone: SampbidxPreviewValue;
  country: SampbidxPreviewValue;
  timeZone: SampbidxPreviewValue;
  marketingConsent: boolean;
  /** SampBidx's id for this person after an earlier send. */
  remoteId: string | null;
}

export interface SampbidxPreviewEmployee {
  id: string;
  name: string;
  jobTitle: string | null;
  email: string | null;
  contributor: 'ACTIVE' | 'CONTRIBUTOR' | 'NONE';
  rfqCount: number;
  stage: { name: string; color: string; key: string | null; phase: string } | null;
}

export interface SampbidxPreviewRfq {
  id: string;
  number: string;
  projectName: string;
  status: string;
  receivedAt: string;
  contact: { id: string; name: string } | null;
  /** SampBidx already has it (a confirmed send). */
  alreadySent: boolean;
}

export interface SampbidxCompanyPreview {
  connected: boolean;
  company: {
    id: string;
    name: SampbidxPreviewValue;
    website: SampbidxPreviewValue;
    industry: SampbidxPreviewValue;
    leadNumber: string | null;
    logoUrl: string | null;
    office: { label: string; country: SampbidxPreviewValue; city: SampbidxPreviewValue; address: SampbidxPreviewValue };
  };
  /** The client in SampBidx after an earlier send. */
  client: { remoteId: string | null; remoteUrl: string | null; lastSyncedAt: string | null } | null;
  /** Every employee to pick from, RFQ contributors first. */
  employees: SampbidxPreviewEmployee[];
  /** The chosen employee and the ticked extra ones, as they will be sent. */
  contacts: SampbidxPreviewContact[];
  /** The company's RFQs, the chosen employee's first. */
  rfqs: SampbidxPreviewRfq[];
  rfq: {
    id: string;
    number: string;
    projectName: string;
    description: string | null;
    serviceCategory: string | null;
    service: string | null;
    methodology: string | null;
    currency: string;
    receivedAt: string;
    deadlineAt: string | null;
    /** One row per country and target group, as sent. */
    lines: { country: string; targetGroup: string | null; quota: number | null; loi: number | null; ir: number | null; cpi: number | null; description: string | null }[];
    totalQuotation: number | null;
    /** Required RFQ details still empty (they are edited on the RFQ itself). */
    missing: SampbidxRequiredField[];
    files: { id: string; name: string; sizeBytes: number }[];
    contactMismatch: { id: string; name: string } | null;
  } | null;
  /** Everything that blocks sending, as readable sentences. */
  blockers: string[];
  transfers: SampbidxTransferRow[];
}

export interface SampbidxCompanySendResult {
  client: SampbidxTransferRow;
  rfq: SampbidxTransferRow | null;
}

// ─── Connection check, settings page and bulk transfers (ADR 0095) ───

/** The steps of "Test connection", in order. Each passes, fails with the real reason, or is not reached. */
export const SAMPBIDX_CHECK_STEPS = ['address', 'network', 'reachable', 'api', 'key', 'callback'] as const;
export type SampbidxCheckStepKey = (typeof SAMPBIDX_CHECK_STEPS)[number];

export interface SampbidxCheckStep {
  key: SampbidxCheckStepKey;
  /** true passed, false failed, null not reached (an earlier step failed) or only advice. */
  ok: boolean | null;
  /** What was found, in plain words. */
  message: string;
  /** What to do about it, when it failed. */
  hint: string | null;
}

export interface SampbidxDiagnosis {
  ok: boolean;
  steps: SampbidxCheckStep[];
  /** The account SampBidx named in its answer to the ping, when it answered. */
  accountName: string | null;
  /** Milliseconds SampBidx took to answer the ping. */
  latencyMs: number | null;
  checkedAt: string;
  /** Whether the saved connection was checked (its state was updated) or typed-in values were tried without saving. */
  saved: boolean;
}

/** Test typed-in values (nothing is saved) or, with both left out, the saved connection. */
export const sampbidxDiagnoseSchema = z.object({
  baseUrl: z.string().trim().max(500).optional(),
  apiKey: z.string().trim().max(500).optional(),
});
export type SampbidxDiagnoseInput = z.infer<typeof sampbidxDiagnoseSchema>;

export const SAMPBIDX_BATCH_KINDS = ['DEALS', 'WON_COMPANIES'] as const;
export type SampbidxBatchKind = (typeof SAMPBIDX_BATCH_KINDS)[number];
export const SAMPBIDX_BATCH_MAX = 200;

export const sampbidxBatchInputSchema = z
  .object({
    kind: z.enum(SAMPBIDX_BATCH_KINDS),
    ids: z.array(z.string().uuid()).max(SAMPBIDX_BATCH_MAX).default([]),
    /** Every won company the person can see (WON_COMPANIES only), instead of a list of ids. */
    allWon: z.boolean().default(false),
    /** Send again even when SampBidx already has the record and nothing changed since. */
    resend: z.boolean().default(false),
    /** Details typed on the check screen. They are saved to the SampForce records first (audited), so they are typed once. */
    completion: z
      .object({
        companies: z.record(z.string().uuid(), z.object({ country: countryCode.optional(), timeZone: timeZone.optional() }).partial()).optional(),
        contacts: z.record(z.string().uuid(), z.object({ email: z.string().trim().toLowerCase().email('Enter a valid email').optional(), country: countryCode.optional(), timeZone: timeZone.optional() }).partial()).optional(),
        deals: z.record(z.string().uuid(), z.object({ amount: z.number().positive('Enter an amount above 0').max(1e12).optional() }).partial()).optional(),
      })
      .optional(),
  })
  .refine((v) => v.ids.length > 0 || (v.kind === 'WON_COMPANIES' && v.allWon), { message: 'Pick at least one record', path: ['ids'] });
export type SampbidxBatchInput = z.input<typeof sampbidxBatchInputSchema>;
export type SampbidxBatchCompletion = NonNullable<z.output<typeof sampbidxBatchInputSchema>['completion']>;

/** A detail the check screen asks for before an item can go. It is saved to the record it belongs to. */
export interface SampbidxBulkFix {
  record: 'company' | 'contact' | 'deal';
  recordId: string;
  /** Whose detail it is, such as the employee's name. */
  recordLabel: string;
  field: 'email' | 'country' | 'timeZone' | 'amount';
}

/** READY goes as it is; NEEDS_FIX goes once the fixes are typed; SKIP will not go (the reason says why). */
export interface SampbidxBulkPreviewItem {
  recordId: string;
  label: string;
  sub: string | null;
  status: 'READY' | 'NEEDS_FIX' | 'SKIP';
  reason: string | null;
  warnings: string[];
  fixes: SampbidxBulkFix[];
  /** SampBidx already has it (it goes again only when it changed, or with "send again"). */
  inSampbidx: boolean;
}

export interface SampbidxBulkPreview {
  kind: SampbidxBatchKind;
  items: SampbidxBulkPreviewItem[];
  counts: Record<'ready' | 'needsFix' | 'skip', number>;
  /** Null when SampBidx is connected and usable; otherwise the real reason nothing can be sent. */
  connectionProblem: string | null;
}

/** PENDING waits its turn; SKIPPED was not sent (the reason says why); SENT and FAILED are SampBidx's real answer. */
export const SAMPBIDX_ITEM_OUTCOMES = ['PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED'] as const;
export type SampbidxItemOutcome = (typeof SAMPBIDX_ITEM_OUTCOMES)[number];

export interface SampbidxBatchItem {
  /** The deal or company. */
  recordId: string;
  label: string;
  /** Deal number and company, or the company's lead number. */
  sub: string | null;
  outcome: SampbidxItemOutcome;
  reason: string | null;
  /** Things that went but are worth knowing, such as an employee left out for missing details. */
  warnings: string[];
  remoteId: string | null;
  remoteUrl: string | null;
  /** The transfers made for it (the client, then the deal). */
  transferIds: string[];
}

export interface SampbidxBatchRow {
  id: string;
  kind: SampbidxBatchKind;
  /** RUNNING while items are being sent; DONE when every item has an answer. */
  status: 'RUNNING' | 'DONE';
  resend: boolean;
  total: number;
  counts: Record<'pending' | 'sent' | 'failed' | 'skipped', number>;
  items: SampbidxBatchItem[];
  createdBy: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** Everything the SampBidx settings page shows. The state is the saved connection's, never assumed. */
export interface SampbidxOverview {
  state: 'NOT_CONNECTED' | 'CONNECTED' | 'ERROR';
  baseUrl: string | null;
  accountName: string | null;
  /** The last four characters of the saved key; the key itself never leaves the server. */
  keyHint: string | null;
  connectedAt: string | null;
  connectedBy: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  callbackUrl: string | null;
  lastCallbackAt: string | null;
  /** Per transfer kind: how many SampBidx accepted, how many failed and how many are on their way. */
  sync: { kind: SampbidxTransferKind; sent: number; failed: number; sending: number; lastSentAt: string | null }[];
  /** Recent failed sends with SampBidx's reason, newest first. */
  errors: SampbidxTransferRow[];
  /** Recent bulk sends, newest first. */
  batches: SampbidxBatchRow[];
  /** Whether the person can change the connection (integrations:manage). */
  canManage: boolean;
}

/** What goes where: each SampForce field and the SampBidx field it fills. Shown on the settings page and in the API doc. */
export const SAMPBIDX_FIELD_MAP: { object: 'Client' | 'Contact' | 'RFQ' | 'Deal'; sampforce: string; sampbidx: string; required: boolean }[] = [
  { object: 'Client', sampforce: 'Company id', sampbidx: 'externalId', required: true },
  { object: 'Client', sampforce: 'Company name', sampbidx: 'company.name', required: true },
  { object: 'Client', sampforce: 'Website', sampbidx: 'company.website', required: false },
  { object: 'Client', sampforce: 'Industry', sampbidx: 'company.industry', required: false },
  { object: 'Client', sampforce: 'Lead number', sampbidx: 'company.leadNumber', required: false },
  { object: 'Client', sampforce: 'Head office country, city, address', sampbidx: 'offices[0]', required: false },
  { object: 'Client', sampforce: 'Won date and won deal', sampbidx: 'relationship', required: false },
  { object: 'Contact', sampforce: 'Employee id', sampbidx: 'contacts[].externalId', required: true },
  { object: 'Contact', sampforce: 'Name', sampbidx: 'contacts[].name', required: true },
  { object: 'Contact', sampforce: 'Email', sampbidx: 'contacts[].email', required: true },
  { object: 'Contact', sampforce: 'Country (else the company’s)', sampbidx: 'contacts[].country', required: true },
  { object: 'Contact', sampforce: 'Time zone (else the company’s)', sampbidx: 'contacts[].timeZone', required: true },
  { object: 'Contact', sampforce: 'Designation', sampbidx: 'contacts[].jobTitle', required: false },
  { object: 'Contact', sampforce: 'Phone', sampbidx: 'contacts[].phone', required: false },
  { object: 'RFQ', sampforce: 'RFQ number and project name', sampbidx: 'rfq.number, rfq.projectName', required: true },
  { object: 'RFQ', sampforce: 'Methodology, market, sample size, deadline', sampbidx: 'rfq.methodology, rfq.market, rfq.sampleSize, rfq.deadlineAt', required: true },
  { object: 'RFQ', sampforce: 'Country rows', sampbidx: 'rfq.lines[]', required: false },
  { object: 'Deal', sampforce: 'Deal id', sampbidx: 'externalId', required: true },
  { object: 'Deal', sampforce: 'Deal number and name', sampbidx: 'deal.number, deal.name', required: true },
  { object: 'Deal', sampforce: 'Amount and currency', sampbidx: 'deal.amount, deal.currency', required: true },
  { object: 'Deal', sampforce: 'Status, pipeline and stage', sampbidx: 'deal.status, deal.pipeline, deal.stage', required: true },
  { object: 'Deal', sampforce: 'Expected close, closed date, loss reason', sampbidx: 'deal.expectedCloseDate, deal.closedAt, deal.lossReason', required: false },
  { object: 'Deal', sampforce: 'Company (sent as the client first)', sampbidx: 'client.id, client.externalId', required: true },
  { object: 'Deal', sampforce: 'Deal contact', sampbidx: 'contact', required: false },
];

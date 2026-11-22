import { z } from 'zod';
import { featureKeySchema } from './features';

/*
 * Help Center support tickets (ADR 0073): "Other: raise a query" in Help, on the web and in the mobile app. With the
 * workspace hierarchy (ADR 0071 part 5) a ticket goes to the level above the person who raised it: an executive's to
 * its manager, a manager's to the Super Workspace, and the Super Workspace's to the SampForce Console. Whoever handles
 * it answers or escalates it one level up.
 */

/**
 * Submitted: new, nobody has looked yet. Under review: read by support, or the raiser answered. In progress: being
 * worked on. Awaiting user: support answered or asked something. Resolved: solved, can still be reopened by writing.
 * Closed: finished.
 */
export const SUPPORT_TICKET_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'IN_PROGRESS', 'AWAITING_USER', 'RESOLVED', 'CLOSED'] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];
/** The statuses the person who raised a query may set: mark it resolved, close it, or open it again. */
export const SUPPORT_RAISER_STATUSES: readonly SupportTicketStatus[] = ['RESOLVED', 'CLOSED', 'SUBMITTED'];
/** Statuses that still need someone on the support side. */
export const SUPPORT_WAITING_STATUSES: readonly SupportTicketStatus[] = ['SUBMITTED', 'UNDER_REVIEW', 'IN_PROGRESS'];
export const SUPPORT_CONTACT_METHODS = ['IN_APP', 'EMAIL', 'PHONE'] as const;
export type SupportContactMethod = (typeof SUPPORT_CONTACT_METHODS)[number];
/** Records a query can be about; the server checks the record exists in the workspace and stores its name. */
export const SUPPORT_RECORD_TYPES = ['lead', 'contact', 'company', 'deal'] as const;
export type SupportRecordType = (typeof SUPPORT_RECORD_TYPES)[number];
export const SUPPORT_ATTACHMENTS_MAX = 5;
export const SUPPORT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const SUPPORT_TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
export type SupportTicketPriority = (typeof SUPPORT_TICKET_PRIORITIES)[number];
export const SUPPORT_HANDLER_LEVELS = ['MANAGER', 'SUPER', 'CONSOLE'] as const;
export type SupportHandlerLevel = (typeof SUPPORT_HANDLER_LEVELS)[number];
export type SupportAuthorKind = 'USER' | 'WORKSPACE' | 'OPERATOR';

export const SUPPORT_SUBJECT_MAX = 160;
export const SUPPORT_BODY_MAX = 5000;

/** Help Center category ids a ticket may be filed under (packages/help categories), plus "other". */
export const SUPPORT_CATEGORY_PATTERN = /^[a-z][a-z-]{1,39}$/;

export const supportTicketCreateSchema = z.object({
  subject: z.string().trim().min(3).max(SUPPORT_SUBJECT_MAX),
  body: z.string().trim().min(5).max(SUPPORT_BODY_MAX),
  category: z.string().trim().regex(SUPPORT_CATEGORY_PATTERN).default('other'),
  featureKey: featureKeySchema.nullable().optional(),
  priority: z.enum(SUPPORT_TICKET_PRIORITIES).default('NORMAL'),
  /** The page the person was on, so support sees where the question came from. */
  pagePath: z
    .string()
    .trim()
    .max(300)
    .regex(/^\/[\w\-/.[\]]*$/)
    .nullable()
    .optional(),
  /** With category "other": the person's own name for the kind of problem. */
  categoryOther: z.string().trim().max(80).nullable().optional(),
  relatedRecord: z.object({ type: z.enum(SUPPORT_RECORD_TYPES), id: z.string().uuid() }).nullable().optional(),
  contactMethod: z.enum(SUPPORT_CONTACT_METHODS).default('IN_APP'),
  /** Only with contactMethod PHONE. */
  contactPhone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[+\d][\d\s\-().]{5,}$/)
    .nullable()
    .optional(),
  /** The app's version, sent by the web or mobile app. */
  appVersion: z.string().trim().max(40).nullable().optional(),
  /** Files uploaded first with POST /support/attachments. */
  attachmentIds: z.array(z.string().uuid()).max(SUPPORT_ATTACHMENTS_MAX).default([]),
}).superRefine((v, ctx) => {
  if (v.contactMethod === 'PHONE' && !v.contactPhone) ctx.addIssue({ code: 'custom', path: ['contactPhone'], message: 'Give a phone number to be called on.' });
});
export type SupportTicketCreateInput = z.input<typeof supportTicketCreateSchema>;

export const supportMessageSchema = z.object({
  body: z.string().trim().min(1).max(SUPPORT_BODY_MAX),
  attachmentIds: z.array(z.string().uuid()).max(SUPPORT_ATTACHMENTS_MAX).default([]),
});
export type SupportMessageInput = z.input<typeof supportMessageSchema>;

export const SUPPORT_NOTE_MAX = 2000;
const resolutionNote = z.string().trim().max(SUPPORT_NOTE_MAX).nullable().optional();

/** The raiser may only resolve, close or reopen (SUPPORT_RAISER_STATUSES); whoever handles the ticket sets any status and the resolution note. */
export const supportStatusSchema = z.object({ status: z.enum(SUPPORT_TICKET_STATUSES), resolutionNote });

/** Passes a ticket one level up the hierarchy, with an optional note for the next handler. */
export const supportEscalateSchema = z.object({ note: z.string().trim().max(SUPPORT_NOTE_MAX).optional() });
export type SupportEscalateInput = z.input<typeof supportEscalateSchema>;

/** The Console: status, the operator looking after it, and the resolution note. */
export const operatorSupportUpdateSchema = z
  .object({ status: z.enum(SUPPORT_TICKET_STATUSES).optional(), assignedOperatorId: z.string().uuid().nullable().optional(), resolutionNote })
  .refine((v) => Object.values(v).some((x) => x !== undefined), 'Change at least one thing');
export type OperatorSupportUpdateInput = z.input<typeof operatorSupportUpdateSchema>;

export const supportListQuerySchema = z.object({
  /**
   * mine: tickets I raised. team: also my branch's (managers) or the whole organisation's (Super administrators).
   * handling: the tickets waiting on my workspace to answer.
   */
  scope: z.enum(['mine', 'team', 'handling']).default('mine'),
  status: z.enum(SUPPORT_TICKET_STATUSES).optional(),
});

export const operatorSupportQuerySchema = z.object({
  status: z.enum(SUPPORT_TICKET_STATUSES).optional(),
  q: z.string().trim().max(120).optional(),
  tenantId: z.string().uuid().optional(),
});

export interface SupportPerson {
  id: string;
  name: string;
}

export interface SupportTicketMessageRow {
  id: string;
  authorKind: SupportAuthorKind;
  /** The person or operator who wrote it; operators show as "SampForce support" to workspaces. */
  author: SupportPerson | null;
  mine: boolean;
  body: string;
  attachments: SupportAttachmentRow[];
  createdAt: string;
}

export interface SupportAttachmentRow {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
}

/** Captured by the server when the query is raised, so nobody types what the app already knows. */
export interface SupportTicketContext {
  workspaceName: string;
  workspaceLevel: string;
  roleName: string;
  email: string;
}

export interface SupportTicketRow {
  id: string;
  number: number;
  subject: string;
  category: string;
  featureKey: string | null;
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  handlerLevel: SupportHandlerLevel;
  /** Who answers it now: a Manager Workspace, the Super Workspace, or SampForce support (CONSOLE). */
  handler: { level: SupportHandlerLevel; name: string };
  /** The SampForce support representative looking after it, once the Console assigns one. */
  assignedTo: SupportPerson | null;
  resolutionNote: string | null;
  /** True when the reader's workspace is the one answering it. */
  handling: boolean;
  /** Whether the reader may pass it one level up. */
  canEscalate: boolean;
  escalatedAt: string | null;
  source: string;
  pagePath: string | null;
  categoryOther: string | null;
  relatedRecord: { type: SupportRecordType; id: string; label: string } | null;
  contactMethod: SupportContactMethod;
  contactPhone: string | null;
  appVersion: string | null;
  context: SupportTicketContext | null;
  resolvedAt: string | null;
  raisedBy: SupportPerson | null;
  /** True when the reader raised it. */
  mine: boolean;
  messageCount: number;
  lastMessageAt: string;
  /** Who wrote last, so lists can show "Support replied". */
  lastAuthorKind: SupportAuthorKind | null;
  createdAt: string;
}

export interface SupportTicketDetail extends SupportTicketRow {
  messages: SupportTicketMessageRow[];
  /** Whether the reader may write in it (the raiser, whoever handles it, or an operator). */
  canReply: boolean;
}

/** The Console's view adds the client organisation and the raiser's workspace. */
export interface OperatorSupportTicketRow extends SupportTicketRow {
  tenant: { id: string; name: string };
  workspace: { level: string; name: string } | null;
}

export interface OperatorSupportTicketDetail extends OperatorSupportTicketRow {
  messages: SupportTicketMessageRow[];
}

export type SupportCounts = Record<SupportTicketStatus, number>;

export const SUPPORT_REPORT_DAYS = [7, 30, 90, 365] as const;
export const supportReportQuerySchema = z.object({ days: z.coerce.number().int().refine((d) => (SUPPORT_REPORT_DAYS as readonly number[]).includes(d)).default(30) });

/** The Console's support report: queries raised in the last `days`, how fast they were answered and closed. */
export interface SupportReport {
  days: number;
  raised: number;
  /** Still waiting for support now, of those raised in the period. */
  open: number;
  byStatus: Record<SupportTicketStatus, number>;
  byPriority: Record<SupportTicketPriority, number>;
  byCategory: { category: string; count: number }[];
  bySource: { source: string; count: number }[];
  byClient: { tenantId: string; name: string; count: number }[];
  byOperator: { operatorId: string | null; name: string; assigned: number; resolved: number }[];
  /** Hours from raising to the first answer, and to resolved or closed; null with nothing to measure. */
  firstAnswerHours: { average: number | null; median: number | null };
  resolutionHours: { average: number | null; median: number | null };
  /** Raised per day, oldest first, for the trend chart. */
  perDay: { date: string; count: number }[];
}

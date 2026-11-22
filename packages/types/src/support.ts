import { z } from 'zod';
import { featureKeySchema } from './features';

/*
 * Help Center support tickets (ADR 0073): "Other: raise a query" in Help, on the web and in the mobile app. Every
 * ticket goes to the SampForce Console today; the workspace hierarchy (ADR 0071 part 5) adds routing through managers
 * and the Super Workspace with `handlerLevel`.
 */

export const SUPPORT_TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'ANSWERED', 'CLOSED'] as const;
export type SupportTicketStatus = (typeof SUPPORT_TICKET_STATUSES)[number];
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
});
export type SupportTicketCreateInput = z.input<typeof supportTicketCreateSchema>;

export const supportMessageSchema = z.object({ body: z.string().trim().min(1).max(SUPPORT_BODY_MAX) });
export type SupportMessageInput = z.input<typeof supportMessageSchema>;

/** The raiser may only close or reopen; operators set any status. */
export const supportStatusSchema = z.object({ status: z.enum(SUPPORT_TICKET_STATUSES) });

export const supportListQuerySchema = z.object({
  /** mine: tickets I raised. team: also my branch's (managers) or the whole organisation's (Super administrators). */
  scope: z.enum(['mine', 'team']).default('mine'),
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
  createdAt: string;
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
  source: string;
  pagePath: string | null;
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
  /** Whether the reader may write in it (the raiser, or an operator). */
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

export interface SupportCounts {
  open: number;
  inProgress: number;
  answered: number;
  closed: number;
}

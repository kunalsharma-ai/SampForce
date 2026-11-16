import { z } from 'zod';
import type { PersonRef } from './crm';

/*
 * Company work (ADR 0060, Phase 3): the company dashboard, logged interactions, follow-ups and RFQs.
 * Interactions are activities with a kind; follow-ups are tasks with a follow-up type and a company; RFQs are their
 * own records. Every number on the company dashboard is counted from these records.
 */

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().or(z.literal('').transform(() => null));
const uuidRef = z.string().uuid().nullable().optional();
const isoDateTime = z.string().datetime({ offset: true });
const optionalDateTime = isoDateTime.nullable().optional().or(z.literal('').transform(() => null));
const optionalNumber = (min: number, max: number) =>
  z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().min(min).max(max).nullable()).optional();

// ───────────── Interactions ─────────────

export const INTERACTION_KINDS = [
  'EMAIL_SENT',
  'EMAIL_RECEIVED',
  'CALL_OUTGOING',
  'CALL_INCOMING',
  'MEETING',
  'LINKEDIN',
  'WHATSAPP',
  'RFQ_RECEIVED',
  'RFQ_SUBMITTED',
  'NEGOTIATION',
  'OTHER',
] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

/** The activity type each interaction kind is stored as, so older reports and timelines keep counting it. */
export const INTERACTION_ACTIVITY_TYPE: Record<InteractionKind, 'CALL' | 'EMAIL' | 'MEETING' | 'NOTE'> = {
  EMAIL_SENT: 'EMAIL',
  EMAIL_RECEIVED: 'EMAIL',
  CALL_OUTGOING: 'CALL',
  CALL_INCOMING: 'CALL',
  MEETING: 'MEETING',
  LINKEDIN: 'NOTE',
  WHATSAPP: 'NOTE',
  RFQ_RECEIVED: 'NOTE',
  RFQ_SUBMITTED: 'NOTE',
  NEGOTIATION: 'NOTE',
  OTHER: 'NOTE',
};

export const interactionInputSchema = z.object({
  companyId: z.string().uuid(),
  contactId: uuidRef,
  kind: z.enum(INTERACTION_KINDS),
  subject: z.string().trim().min(1, 'Enter a subject').max(200),
  occurredAt: isoDateTime.optional(),
  sender: optionalText(200),
  recipient: optionalText(200),
  outcome: optionalText(500),
  remarks: optionalText(10_000),
  nextAction: optionalText(500),
  /** When set, a follow-up is also scheduled for that time. */
  followUpAt: optionalDateTime,
  fileId: uuidRef,
  rfqId: uuidRef,
});
export type InteractionInput = z.infer<typeof interactionInputSchema>;

export const interactionListQuerySchema = z.object({
  kind: z.enum(INTERACTION_KINDS).optional(),
  contactId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export interface InteractionRow {
  id: string;
  /** LOGGED: entered by a person. SYNCED: an email read from a connected mailbox. */
  source: 'LOGGED' | 'SYNCED';
  kind: InteractionKind;
  subject: string;
  occurredAt: string;
  companyId: string | null;
  contact: { id: string; name: string } | null;
  sender: string | null;
  recipient: string | null;
  outcome: string | null;
  remarks: string | null;
  nextAction: string | null;
  followUpAt: string | null;
  file: { id: string; name: string } | null;
  rfq: { id: string; number: string } | null;
  createdBy: PersonRef | null;
  aiAssisted: boolean;
}

// ───────────── Follow-ups ─────────────

export const FOLLOW_UP_TYPES = ['CALL', 'EMAIL', 'MEETING', 'LINKEDIN', 'WHATSAPP', 'RFQ', 'VISIT', 'OTHER'] as const;
export type FollowUpType = (typeof FOLLOW_UP_TYPES)[number];
export const FOLLOW_UP_PRIORITIES = ['LOW', 'NORMAL', 'HIGH'] as const;
export const FOLLOW_UP_BUCKETS = ['today', 'upcoming', 'overdue', 'completed', 'rescheduled', 'cancelled'] as const;
export type FollowUpBucket = (typeof FOLLOW_UP_BUCKETS)[number];
/** How a follow-up's date looks to the person, worked out in their time zone. */
export type FollowUpDue = 'OVERDUE' | 'TODAY' | 'TOMORROW' | 'UPCOMING' | 'NO_DATE' | 'COMPLETED' | 'CANCELLED';

export const followUpInputSchema = z.object({
  companyId: z.string().uuid(),
  contactId: uuidRef,
  type: z.enum(FOLLOW_UP_TYPES),
  title: z.string().trim().min(1, 'Enter what the follow-up is about').max(200),
  dueAt: isoDateTime,
  priority: z.enum(FOLLOW_UP_PRIORITIES).default('NORMAL'),
  assigneeId: uuidRef,
  managerId: uuidRef,
  summary: optionalText(5_000),
  nextAction: optionalText(500),
  remarks: optionalText(5_000),
  rfqId: uuidRef,
});
export type FollowUpInput = z.infer<typeof followUpInputSchema>;
export const followUpUpdateSchema = followUpInputSchema.omit({ companyId: true }).partial();

export const followUpCompleteSchema = z.object({ outcome: optionalText(500) });
export const followUpRescheduleSchema = z.object({ dueAt: isoDateTime, reason: optionalText(500) });

const timeZone = z
  .string()
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone');

export const followUpListQuerySchema = z.object({
  bucket: z.enum(FOLLOW_UP_BUCKETS).optional(),
  /** mine: assigned to me. team: me and everyone reporting to me. all: everyone (roles that see every record). */
  scope: z.enum(['mine', 'team', 'all']).default('mine'),
  companyId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  tz: timeZone.default('UTC'),
});

export interface FollowUpRow {
  id: string;
  type: FollowUpType;
  title: string;
  dueAt: string | null;
  due: FollowUpDue;
  status: 'OPEN' | 'DONE' | 'CANCELED';
  priority: (typeof FOLLOW_UP_PRIORITIES)[number];
  company: { id: string; name: string; leadNumber: string | null } | null;
  contact: { id: string; name: string } | null;
  assignee: PersonRef | null;
  manager: PersonRef | null;
  summary: string | null;
  nextAction: string | null;
  remarks: string | null;
  outcome: string | null;
  rescheduleCount: number;
  completedAt: string | null;
  createdAt: string;
}

export type FollowUpCounts = Record<FollowUpBucket, number>;

// ───────────── RFQs ─────────────

export const RFQ_STATUSES = [
  'RECEIVED',
  'UNDER_EVALUATION',
  'PRICING',
  'QUOTATION_SUBMITTED',
  'NEGOTIATION',
  'WON',
  'LOST',
  'CANCELLED',
  'ON_HOLD',
] as const;
export type RfqStatus = (typeof RFQ_STATUSES)[number];
/** RFQs still being worked on. */
export const RFQ_OPEN_STATUSES: readonly RfqStatus[] = ['RECEIVED', 'UNDER_EVALUATION', 'PRICING', 'QUOTATION_SUBMITTED', 'NEGOTIATION', 'ON_HOLD'];
/** Statuses that mean a quotation went to the client. */
export const RFQ_SUBMITTED_STATUSES: readonly RfqStatus[] = ['QUOTATION_SUBMITTED', 'NEGOTIATION', 'WON', 'LOST'];

const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code');

export const rfqInputSchema = z.object({
  companyId: z.string().uuid(),
  contactId: uuidRef,
  projectName: z.string().trim().min(1, 'Enter the project name').max(200),
  description: optionalText(10_000),
  methodology: optionalText(200),
  market: optionalText(100),
  industry: optionalText(120),
  targetAudience: optionalText(500),
  sampleSize: optionalNumber(0, 100_000_000).transform((v) => (v == null ? v : Math.round(v))),
  loi: optionalNumber(0, 10_000),
  ir: optionalNumber(0, 100),
  cpi: optionalNumber(0, 1e9),
  /** Left empty, the total is the sample size times the CPI. */
  totalQuotation: optionalNumber(0, 1e13),
  currency: currency.default('USD'),
  receivedAt: isoDateTime.optional(),
  submittedAt: optionalDateTime,
  deadlineAt: optionalDateTime,
  status: z.enum(RFQ_STATUSES).default('RECEIVED'),
  ownerId: uuidRef,
  managerId: uuidRef,
  expectedRevenue: optionalNumber(0, 1e13),
  actualRevenue: optionalNumber(0, 1e13),
  outcomeReason: optionalText(1_000),
});
export type RfqInput = z.infer<typeof rfqInputSchema>;
export const rfqUpdateSchema = rfqInputSchema.omit({ companyId: true }).partial();

export const rfqListQuerySchema = z.object({
  companyId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  status: z.enum(RFQ_STATUSES).optional(),
  open: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export interface RfqRow {
  id: string;
  number: string;
  company: { id: string; name: string; leadNumber: string | null };
  contact: { id: string; name: string } | null;
  projectName: string;
  description: string | null;
  methodology: string | null;
  market: string | null;
  industry: string | null;
  targetAudience: string | null;
  sampleSize: number | null;
  loi: number | null;
  ir: number | null;
  cpi: number | null;
  totalQuotation: number | null;
  currency: string;
  receivedAt: string;
  submittedAt: string | null;
  deadlineAt: string | null;
  status: RfqStatus;
  statusChangedAt: string | null;
  owner: PersonRef | null;
  manager: PersonRef | null;
  createdBy: PersonRef | null;
  expectedRevenue: number | null;
  actualRevenue: number | null;
  outcomeReason: string | null;
  deal: { id: string; name: string } | null;
  files: { id: string; name: string; sizeBytes: number }[];
  createdAt: string;
  updatedAt: string;
}

export const rfqConvertSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  amount: optionalNumber(0, 1e13),
});

export const RFQ_REPORT_GROUPS = ['company', 'employee', 'owner'] as const;
export const rfqReportQuerySchema = z.object({ by: z.enum(RFQ_REPORT_GROUPS).default('company') });

/** Sums of money kept apart by currency: amounts in different currencies are never added together. */
export type MoneyByCurrency = { currency: string; amount: number }[];

export interface RfqReportRow {
  key: string | null;
  label: string;
  received: number;
  submitted: number;
  won: number;
  lost: number;
  open: number;
  quoted: MoneyByCurrency;
  wonValue: MoneyByCurrency;
}

// ───────────── Company dashboard ─────────────

export interface CompanyDashboard {
  kpis: {
    employees: number;
    employeesContacted: number;
    emailsSent: number;
    responsesReceived: number;
    calls: number;
    meetings: number;
    followUpsPending: number;
    followUpsOverdue: number;
    rfqsReceived: number;
    rfqsSubmitted: number;
    rfqsWon: number;
    rfqsLost: number;
    businessGenerated: MoneyByCurrency;
  };
  business: {
    opportunities: number;
    open: number;
    won: number;
    lost: number;
    quotedValue: MoneyByCurrency;
    wonRevenue: MoneyByCurrency;
    outstanding: MoneyByCurrency;
  };
  /** Emails counted from a connected mailbox, apart from those people logged. */
  syncedEmails: { sent: number; received: number };
  latestUpdate: { kind: InteractionKind | 'EMAIL_SYNCED' | 'NOTE'; subject: string; at: string; by: string | null } | null;
  nextAction: { kind: 'FOLLOW_UP' | 'RFQ_DEADLINE'; title: string; at: string; id: string } | null;
}

export interface CompanyEmployeeRow {
  id: string;
  name: string;
  jobTitle: string | null;
  linkedinUrl: string | null;
  email: string | null;
  phone: string | null;
  status: { id: string; name: string; color: string } | null;
  emailsSent: number;
  responsesReceived: number;
  lastUpdateAt: string | null;
  nextFollowUpAt: string | null;
  owner: PersonRef | null;
  remarks: string | null;
  /** False when the caller's role may not see this employee's details. */
  details: boolean;
}

/** Adds up amounts per currency, largest first. */
export function sumByCurrency(rows: { currency: string | null | undefined; amount: number | null | undefined }[]): MoneyByCurrency {
  const m = new Map<string, number>();
  for (const r of rows) if (r.amount) m.set(r.currency || 'USD', (m.get(r.currency || 'USD') ?? 0) + r.amount);
  return [...m.entries()].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount);
}

/** Start of the calendar day containing `at` in `tz`, as a UTC instant. */
export function startOfDayIn(at: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  // Wall-clock time in tz, read as if it were UTC; the difference to `at` is the zone offset.
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offset = wall - Math.floor(at.getTime() / 1000) * 1000;
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')) - offset);
}

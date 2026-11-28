import { z } from 'zod';
import { timeZone } from './company-work';
import type { PersonRef } from './crm';

/*
 * The follow-up cadence (redesign R3, ADR 0083). Every new employee of a company starts in Fresh Email Pending. When the
 * first email reaches them (sent from SampForce, synced from the mailbox, logged as an interaction, or marked by hand)
 * they move to Initial Email Sent and follow-up 1 is planned. Completing a follow-up plans the next one, until the
 * Super Workspace's number of follow-ups is reached. A reply, a call, an RFQ or any later stage stops the cadence.
 */

export const CADENCE_MAX_FOLLOW_UPS = 20;
export const CADENCE_MAX_INTERVAL_DAYS = 90;

/**
 * How the follow-ups after the first email are made (First Email Pending, ADR 0096): by email, by call, and so on.
 * Each follow-up of the cadence is a follow-up task of this type.
 */
export const CADENCE_CHANNELS = ['EMAIL', 'CALL', 'WHATSAPP', 'LINKEDIN', 'MEETING'] as const;
export type CadenceChannel = (typeof CADENCE_CHANNELS)[number];
export const CADENCE_MAX_RULES = 100;

/**
 * A different follow-up period for one company or one team (a Manager Workspace and the Executive Workspaces below it).
 * A company rule wins over a team rule, and a team rule over the organisation's setting.
 */
export interface CadenceRule {
  scope: 'COMPANY' | 'TEAM';
  /** The company, or the Manager Workspace. */
  targetId: string;
  /** Days after the first email before follow-up 1 is created and the contact moves into Follow-ups. */
  firstFollowUpDays: number;
  intervalDays: number;
  followUps: number;
  channel: CadenceChannel;
}

export interface FollowUpCadence {
  /** How many follow-ups after the initial email. */
  followUps: number;
  /** Days between follow-ups. */
  intervalDays: number;
  /**
   * Days after the first email before follow-up 1 is created and the contact moves into the Follow-ups section
   * (First Email Pending, ADR 0096). Null: the same as `intervalDays`, as before ADR 0096.
   */
  firstFollowUpDays: number | null;
  /** How the follow-ups are made: an email, a call, a WhatsApp message… */
  channel: CadenceChannel;
  /** Different periods for some companies or teams. */
  rules: CadenceRule[];
}

export const DEFAULT_FOLLOW_UP_CADENCE: FollowUpCadence = { followUps: 5, intervalDays: 7, firstFollowUpDays: null, channel: 'EMAIL', rules: [] };

const days = z.number().int().min(1).max(CADENCE_MAX_INTERVAL_DAYS);
const count = z.number().int().min(1).max(CADENCE_MAX_FOLLOW_UPS);

export const cadenceRuleSchema = z
  .object({
    scope: z.enum(['COMPANY', 'TEAM']),
    targetId: z.string().uuid(),
    firstFollowUpDays: days,
    intervalDays: days,
    followUps: count,
    channel: z.enum(CADENCE_CHANNELS),
  })
  .strict();

/** What the Super Workspace saves. The fields added by ADR 0096 are optional, so older clients keep working. */
export const followUpCadenceSchema = z
  .object({
    followUps: count,
    intervalDays: days,
    firstFollowUpDays: days.nullable().optional(),
    channel: z.enum(CADENCE_CHANNELS).optional(),
    rules: z
      .array(cadenceRuleSchema)
      .max(CADENCE_MAX_RULES)
      .refine((rs) => new Set(rs.map((r) => `${r.scope}:${r.targetId}`)).size === rs.length, 'Each company or team can have one rule.')
      .optional(),
  })
  .strict();
export type FollowUpCadenceInput = z.input<typeof followUpCadenceSchema>;

/** Reads a stored value, falling back to the default for anything missing or out of range. */
export function parseFollowUpCadence(stored: unknown): FollowUpCadence {
  const o = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>;
  const base = z.object({ followUps: count, intervalDays: days }).safeParse({ followUps: o.followUps, intervalDays: o.intervalDays });
  const first = days.safeParse(o.firstFollowUpDays);
  const channel = z.enum(CADENCE_CHANNELS).safeParse(o.channel);
  const rules = Array.isArray(o.rules) ? o.rules.flatMap((r) => { const p = cadenceRuleSchema.safeParse(r); return p.success ? [p.data] : []; }) : [];
  return {
    ...(base.success ? base.data : { followUps: DEFAULT_FOLLOW_UP_CADENCE.followUps, intervalDays: DEFAULT_FOLLOW_UP_CADENCE.intervalDays }),
    firstFollowUpDays: first.success ? first.data : null,
    channel: channel.success ? channel.data : 'EMAIL',
    rules,
  };
}

/** The cadence one contact follows: its company's rule, else its team's, else the organisation's. */
export interface ResolvedCadence {
  followUps: number;
  intervalDays: number;
  firstFollowUpDays: number;
  channel: CadenceChannel;
  /** Where it came from, for people reading the list. */
  source: 'ORGANISATION' | 'COMPANY' | 'TEAM';
}

export function resolveCadence(c: FollowUpCadence, companyId: string | null | undefined, teamId: string | null | undefined): ResolvedCadence {
  const rule = (companyId ? c.rules.find((r) => r.scope === 'COMPANY' && r.targetId === companyId) : undefined) ?? (teamId ? c.rules.find((r) => r.scope === 'TEAM' && r.targetId === teamId) : undefined);
  if (rule) return { followUps: rule.followUps, intervalDays: rule.intervalDays, firstFollowUpDays: rule.firstFollowUpDays, channel: rule.channel, source: rule.scope };
  return { followUps: c.followUps, intervalDays: c.intervalDays, firstFollowUpDays: c.firstFollowUpDays ?? c.intervalDays, channel: c.channel, source: 'ORGANISATION' };
}

export interface FollowUpCadenceSettings extends FollowUpCadence {
  /** Only the Super Workspace's administrators change it; everyone else reads it. */
  canEdit: boolean;
  /** Names of the companies and teams the rules name (a deleted one shows as null). */
  ruleTargets: Record<string, string | null>;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

export const CADENCE_STATES = ['FRESH', 'ACTIVE', 'COMPLETE', 'STOPPED', 'NONE'] as const;
export type CadenceState = (typeof CADENCE_STATES)[number];

/** Where one employee is in the cadence. */
export interface ContactCadence {
  state: CadenceState;
  /** When the initial email went out, if it did. */
  initialEmailAt: string | null;
  /** Follow-ups completed in this cadence, and how many it has. */
  completed: number;
  total: number;
  /** The open follow-up of the cadence, if one is planned. */
  next: { taskId: string; step: number; dueAt: string; overdue: boolean } | null;
  /** Why it stopped (a reply, a call, an RFQ, a later stage), when it did. */
  stoppedReason: string | null;
  /** How the first email was confirmed (ADR 0096), when it went out. */
  initialEmailSource?: InitialEmailSource | null;
  /** When follow-up 1 is created and the contact moves into Follow-ups, while it waits (ADR 0096). */
  movesAt?: string | null;
}

/**
 * How SampForce knows the first email went out (ADR 0096). SENT: SampForce sent it and the mail provider accepted it.
 * MAILBOX: mailbox sync saw it in the sender's Sent mail. LOGGED: someone logged it as an interaction. MANUAL: someone
 * marked it as sent (an email sent outside SampForce). A send that fails records nothing, so the contact stays pending.
 */
export const INITIAL_EMAIL_SOURCES = ['SENT', 'MAILBOX', 'LOGGED', 'MANUAL'] as const;
export type InitialEmailSource = (typeof INITIAL_EMAIL_SOURCES)[number];

// ───────────── First Email Pending (ADR 0096) ─────────────

/**
 * PENDING: no first email yet, and the contact has an email address. NO_EMAIL: no address, so the record needs
 * completing (not a failed send). INVALID_EMAIL: the address bounced or was found invalid. SENT: the first email went
 * out and the contact waits for follow-up 1 (it moves into Follow-ups when that is created).
 */
export const FIRST_EMAIL_STATUSES = ['PENDING', 'NO_EMAIL', 'INVALID_EMAIL', 'SENT'] as const;
export type FirstEmailStatus = (typeof FIRST_EMAIL_STATUSES)[number];
export const FIRST_EMAIL_PERIODS = ['today', 'yesterday', 'week', 'month', 'all'] as const;
export type FirstEmailPeriod = (typeof FIRST_EMAIL_PERIODS)[number];

export const firstEmailQuerySchema = z.object({
  scope: z.enum(['mine', 'team', 'all']).default('mine'),
  /** Created today, yesterday, this week (from Monday), this month, or any time; in `tz`. */
  period: z.enum(FIRST_EMAIL_PERIODS).default('all'),
  /** Created on or after / before these days (YYYY-MM-DD in `tz`), for a date range. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(FIRST_EMAIL_STATUSES).optional(),
  ownerId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  tz: timeZone.default('UTC'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type FirstEmailQuery = z.input<typeof firstEmailQuerySchema>;

export interface FirstEmailRow {
  contactId: string;
  name: string;
  designation: string | null;
  email: string | null;
  company: { id: string; name: string } | null;
  createdAt: string;
  owner: PersonRef | null;
  status: FirstEmailStatus;
  /** When the first email went out and how it was confirmed (SENT rows). */
  sentAt: string | null;
  sentSource: InitialEmailSource | null;
  /** The latest activity, email, call or meeting with the contact, if any. */
  lastActivityAt: string | null;
  /** Follow-up 1: when it will be created (SENT rows waiting) or is due. */
  nextFollowUpAt: string | null;
  /** The period this contact follows and where it came from. */
  cadence: { firstFollowUpDays: number; channel: CadenceChannel; source: ResolvedCadence['source'] };
}

export interface FirstEmailList {
  rows: FirstEmailRow[];
  /** Rows matching the filters, past the limit. */
  total: number;
  /** Counts for the same people and dates, whatever the status filter. */
  counts: Record<FirstEmailStatus, number> & { createdToday: number };
}

export const initialEmailSchema = z.object({
  /** When the email was sent, if not now (an email sent outside SampForce). Not in the future. */
  sentAt: z.string().datetime().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type InitialEmailInput = z.infer<typeof initialEmailSchema>;

const DAY = 86_400_000;

/** The due date of the follow-up after `from`: the interval later, at the same time of day. */
export function nextFollowUpDue(from: Date | string, intervalDays: number): Date {
  return new Date(new Date(from).getTime() + intervalDays * DAY);
}

/** "Follow-up 2 of 5: Priya Shah" */
export function cadenceTaskTitle(step: number, total: number, name: string): string {
  return `Follow-up ${step} of ${total}: ${name}`.slice(0, 200);
}

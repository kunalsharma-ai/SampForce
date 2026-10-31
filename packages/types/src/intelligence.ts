import { z } from 'zod';
import type { Signal } from './ai';

/**
 * Sales intelligence built on existing CRM data (enhancement spec, Phase 1): the deal health monitor, the next best
 * action list, the merged customer timeline and the sales insights feed. Everything here is computed from records the
 * workspace already holds; nothing is estimated from outside data.
 */

// ───────────── Deal health monitor ─────────────

export const DEAL_RISKS = ['low', 'medium', 'high'] as const;
/** What people see for each band. */
export const DEAL_RISK_LABELS = { low: 'Healthy', medium: 'At risk', high: 'Critical' } as const;
export type DealRisk = (typeof DEAL_RISKS)[number];

export interface DealHealthRow {
  deal: { id: string; name: string; amount: number; currency: string; stage: string; expectedCloseDate: string | null };
  owner: { id: string; name: string } | null;
  health: number;
  risk: DealRisk;
  signals: Signal[];
  /** Change against the score recorded seven days earlier; null when there is no score from then. */
  change7d: number | null;
  computedAt: string;
}

export interface DealHealthSummary {
  counts: Record<DealRisk, number>;
  /** Open deals not scored yet (created since the last sweep). */
  unscored: number;
  lastSweepAt: string | null;
}

export interface DealHealthHistoryPoint {
  day: string;
  health: number;
  risk: DealRisk;
}

export interface DealHealthDetail {
  current: Omit<DealHealthRow, 'deal' | 'owner'> | null;
  history: DealHealthHistoryPoint[];
}

export const dealHealthQuerySchema = z.object({
  risk: z.enum(DEAL_RISKS).optional(),
  mine: z.coerce.boolean().optional(),
});
export type DealHealthQuery = z.infer<typeof dealHealthQuerySchema>;

/** A deal at or below this score is high risk; at or above 70 it is low. Same bands as the deal intelligence agent. */
export function dealRisk(health: number): DealRisk {
  return health >= 70 ? 'low' : health >= 40 ? 'medium' : 'high';
}

// ───────────── Next best actions ─────────────

export const NEXT_ACTION_KINDS = [
  'escalate_deal',
  'prospect_silent',
  'engaged_no_reply',
  'overdue_task',
  'reply_waiting',
  'deal_at_risk',
  'deal_no_next_step',
  'close_date_passed',
  'new_lead_untouched',
  'quote_awaiting_answer',
  'renewal_due',
  'ai_recommendation',
] as const;
export type NextActionKind = (typeof NEXT_ACTION_KINDS)[number];

export const NEXT_ACTION_LABELS: Record<NextActionKind, string> = {
  escalate_deal: 'Manager review',
  prospect_silent: 'No reply to sequence',
  engaged_no_reply: 'Engaged, no reply',
  overdue_task: 'Overdue task',
  reply_waiting: 'Reply waiting',
  deal_at_risk: 'Deal at risk',
  deal_no_next_step: 'No next step',
  close_date_passed: 'Close date passed',
  new_lead_untouched: 'New lead',
  quote_awaiting_answer: 'Quote follow-up',
  renewal_due: 'Renewal due',
  ai_recommendation: 'AI suggestion',
};

export type NextActionRecordType = 'lead' | 'contact' | 'company' | 'deal' | 'task' | 'quote' | 'contract';

export interface NextAction {
  /** Stable for the same situation, so a dismissal sticks until the situation changes. */
  key: string;
  kind: NextActionKind;
  /** Higher comes first. Explained by `reason`; the weights are in the API's next-actions rules. */
  priority: number;
  title: string;
  reason: string;
  record: { type: NextActionRecordType; id: string; name: string };
  /** Link to open in the app. */
  href: string;
  /** What "Do it" creates. `null` when the action is to open the record (for example an existing task). */
  suggestedTask: { title: string; dueInDays: number } | null;
  /** Set for AI suggestions: the stored recommendation it came from. */
  recommendationId: string | null;
}

export interface NextActionList {
  items: NextAction[];
  /** How many were left out because the person accepted, dismissed or snoozed them. */
  dismissed: number;
  /** For the personal list: what came of the suggestions the person accepted in the last 30 days. */
  outcomes: { accepted30: number; tasksDone: number; engaged: number; dismissed30: number } | null;
  generatedAt: string;
}

export const NEXT_ACTION_FOCUS_TYPES = ['lead', 'contact', 'company', 'deal'] as const;
export const nextActionFocusSchema = z.object({ type: z.enum(NEXT_ACTION_FOCUS_TYPES), id: z.string().uuid() });
export type NextActionFocus = z.infer<typeof nextActionFocusSchema>;
export const nextActionQuerySchema = z.object({ recordType: z.enum(NEXT_ACTION_FOCUS_TYPES).optional(), recordId: z.string().uuid().optional() });
export type NextActionQuery = z.infer<typeof nextActionQuerySchema>;

export const nextActionDismissSchema = z.object({
  key: z.string().min(3).max(200),
  /** Set when the item came from a record page's list. */
  focus: nextActionFocusSchema.optional(),
  /** Snooze for this many days; omitted means until the situation changes. */
  days: z.number().int().min(1).max(30).optional(),
});
export type NextActionDismissInput = z.infer<typeof nextActionDismissSchema>;

export const nextActionAcceptSchema = z.object({
  key: z.string().min(3).max(200),
  focus: nextActionFocusSchema.optional(),
  title: z.string().trim().min(1).max(200),
  dueInDays: z.number().int().min(0).max(60),
});
export type NextActionAcceptInput = z.infer<typeof nextActionAcceptSchema>;

// ───────────── Customer 360 timeline ─────────────

export const TIMELINE_KINDS = [
  'created',
  'activity',
  'email',
  'meeting',
  'sequence_email',
  'email_event',
  'stage_change',
  'task_done',
  'quote',
  'contract',
  'form',
  'escalation',
] as const;
export type TimelineKind = (typeof TIMELINE_KINDS)[number];

export const TIMELINE_KIND_LABELS: Record<TimelineKind, string> = {
  created: 'Added',
  activity: 'Calls, notes and meetings logged',
  email: 'Emails',
  meeting: 'Calendar meetings',
  sequence_email: 'Sequence emails',
  email_event: 'Opens, clicks, bounces, unsubscribes',
  stage_change: 'Deal stage changes',
  task_done: 'Completed tasks',
  quote: 'Quotes',
  contract: 'Contracts',
  form: 'Form submissions',
  escalation: 'Escalations',
};

export const TIMELINE_ENTITIES = ['lead', 'contact', 'company', 'deal'] as const;
export type TimelineEntity = (typeof TIMELINE_ENTITIES)[number];

export interface TimelineItem {
  /** `<kind>:<source id>`, unique within a timeline. */
  id: string;
  kind: TimelineKind;
  at: string;
  title: string;
  detail: string | null;
  /** Inbound or outbound, for emails. */
  direction?: 'in' | 'out';
  actor: { id: string; name: string } | null;
  /** On company and deal timelines: the person or deal the item belongs to. */
  about: { type: 'lead' | 'contact' | 'deal'; id: string; name: string } | null;
  href: string | null;
}

export interface TimelinePage {
  items: TimelineItem[];
  /** Pass as `before` for the next page; null at the end. */
  nextBefore: string | null;
  /** Sources left out because the viewer lacks the permission to read them. */
  hidden: TimelineKind[];
}

export const timelineQuerySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  /** Comma-separated kinds; all readable kinds when omitted. */
  kinds: z.preprocess((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(z.enum(TIMELINE_KINDS)).max(TIMELINE_KINDS.length).optional()),
});
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;

// ───────────── Sales insights ─────────────

export const INSIGHT_SCOPES = ['mine', 'team'] as const;
export type InsightScope = (typeof INSIGHT_SCOPES)[number];

export interface Insight {
  key: string;
  /** `attention` needs action, `good` is progress worth knowing, `info` is context. */
  tone: 'attention' | 'good' | 'info';
  title: string;
  detail: string;
  /** This week against the week before, where the insight compares periods. */
  metric: { current: number; previous: number | null; unit: 'count' | 'money' | 'percent' } | null;
  href: string | null;
}

export interface InsightFeed {
  scope: InsightScope;
  /** Start of the current period: the last seven days, compared with the seven before. */
  periodStart: string;
  currency: string;
  items: Insight[];
  generatedAt: string;
}

export const insightQuerySchema = z.object({ scope: z.enum(INSIGHT_SCOPES).default('mine') });
export type InsightQuery = z.infer<typeof insightQuerySchema>;

// ───────────── Record intelligence (AI Sales Intelligence and Customer 360, on each record) ─────────────

export interface BuyingSignal {
  key: string;
  label: string;
  detail: string;
  at: string;
  /** Opens are estimates (image loading); everything else is a recorded event. */
  confirmed: boolean;
}

export interface DecisionMaker {
  id: string;
  name: string;
  jobTitle: string;
  lastEngagedAt: string | null;
}

export interface RecordIntelligence {
  engagement: {
    last30: number;
    previous30: number;
    trend: 'none' | 'rising' | 'steady' | 'declining';
    lastInboundAt: string | null;
    lastOutboundAt: string | null;
  };
  /** Things the buyer did recently that suggest interest, newest first. */
  buyingSignals: BuyingSignal[];
  /** Senior people at the company (by job title), for company, contact and deal records. */
  decisionMakers: DecisionMaker[] | null;
  /** The company's value to the business; null for leads and records without a company. */
  account: {
    companyId: string;
    companyName: string;
    currency: string;
    wonTotal: number;
    wonDeals: number;
    openPipeline: number;
    activeContractValue: number;
    /** Deals or contracts in other currencies, left out of the totals above. */
    otherCurrency: number;
    customerSince: string | null;
    /** Catalogue products this company has not had on an accepted quote yet (cross-sell ideas). */
    notYetBought: string[];
    renewalWithin60Days: boolean;
  } | null;
  flags: { key: 'inactive' | 'declining' | 'high_intent' | 'no_decision_maker'; label: string }[];
}

import { z } from 'zod';

// ───────────── Sales gamification (enhancement feature 14) ─────────────
//
// Points are computed from CRM records (activities, tasks, leads, deals) with the workspace's rules, not stored as a
// separate ledger, so an admin can see and change exactly how they are earned. Competitions keep a copy of the rules
// they started with, so changing the rules mid-competition does not change its standings.

export const SCORING_RULE_KEYS = ['call_logged', 'meeting_logged', 'email_logged', 'note_logged', 'task_completed', 'lead_created', 'lead_converted', 'deal_created', 'deal_won', 'revenue_won'] as const;
export type ScoringRuleKey = (typeof SCORING_RULE_KEYS)[number];

export const SCORING_RULE_LABELS: Record<ScoringRuleKey, { label: string; unit: string }> = {
  call_logged: { label: 'Call logged', unit: 'per call' },
  meeting_logged: { label: 'Meeting logged', unit: 'per meeting' },
  email_logged: { label: 'Email logged', unit: 'per logged email' },
  note_logged: { label: 'Note added', unit: 'per note' },
  task_completed: { label: 'Task completed', unit: 'per task' },
  lead_created: { label: 'Lead added', unit: 'per lead' },
  lead_converted: { label: 'Lead converted', unit: 'per conversion' },
  deal_created: { label: 'Deal created', unit: 'per deal' },
  deal_won: { label: 'Deal won', unit: 'per won deal' },
  revenue_won: { label: 'Revenue won', unit: 'per 1,000 in the base currency' },
};

const ruleSchema = z.object({
  enabled: z.boolean(),
  points: z.number().int().min(0).max(1000),
  /** Most times a person can score this rule in one day (UTC); null for no limit. Stops point farming. */
  dailyCap: z.number().int().min(1).max(500).nullable(),
});
export type ScoringRule = z.infer<typeof ruleSchema>;
export type ScoringRules = Record<ScoringRuleKey, ScoringRule>;

export const scoringRulesSchema = z.object(Object.fromEntries(SCORING_RULE_KEYS.map((k) => [k, ruleSchema])) as Record<ScoringRuleKey, typeof ruleSchema>);

export const DEFAULT_SCORING_RULES: ScoringRules = {
  call_logged: { enabled: true, points: 5, dailyCap: 20 },
  meeting_logged: { enabled: true, points: 10, dailyCap: 10 },
  email_logged: { enabled: true, points: 2, dailyCap: 25 },
  note_logged: { enabled: false, points: 1, dailyCap: 10 },
  task_completed: { enabled: true, points: 2, dailyCap: 20 },
  lead_created: { enabled: true, points: 3, dailyCap: 20 },
  lead_converted: { enabled: true, points: 15, dailyCap: null },
  deal_created: { enabled: true, points: 5, dailyCap: 10 },
  deal_won: { enabled: true, points: 50, dailyCap: null },
  revenue_won: { enabled: true, points: 1, dailyCap: null },
};

export const GAMIFICATION_VISIBILITY = ['everyone', 'managers'] as const;
export type GamificationVisibility = (typeof GAMIFICATION_VISIBILITY)[number];

export const gamificationSettingsSchema = z.object({
  enabled: z.boolean(),
  /** "managers": only people who manage gamification see everyone's standing; others see their own. */
  visibility: z.enum(GAMIFICATION_VISIBILITY),
  rules: scoringRulesSchema,
});
export type GamificationSettingsInput = z.infer<typeof gamificationSettingsSchema>;

export interface GamificationSettings extends GamificationSettingsInput {
  baseCurrency: string;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

/** Points for counted events, applying each enabled rule and its daily cap. `perDay` holds each day's count. */
export function pointsFor(rules: ScoringRules, key: ScoringRuleKey, perDay: number[]): { count: number; scored: number; points: number } {
  const r = rules[key];
  const count = perDay.reduce((a, n) => a + n, 0);
  if (!r.enabled) return { count, scored: 0, points: 0 };
  const scored = r.dailyCap === null ? count : perDay.reduce((a, n) => a + Math.min(n, r.dailyCap!), 0);
  return { count, scored, points: scored * r.points };
}

/** Revenue points: whole thousands of won revenue in the base currency. */
export function revenuePoints(rules: ScoringRules, revenue: number): number {
  const r = rules.revenue_won;
  return r.enabled ? Math.floor(Math.max(0, revenue) / 1000) * r.points : 0;
}

// Badges

export const BADGE_METRICS = ['points', 'deals_won', 'revenue_won', 'calls', 'meetings', 'activities', 'target_attainment'] as const;
export type BadgeMetric = (typeof BADGE_METRICS)[number];
export const BADGE_METRIC_LABELS: Record<BadgeMetric, string> = {
  points: 'Points',
  deals_won: 'Deals won',
  revenue_won: 'Revenue won (base currency)',
  calls: 'Calls logged',
  meetings: 'Meetings logged',
  activities: 'Calls, meetings and emails logged',
  target_attainment: 'Percent of personal sales target',
};
export const BADGE_WINDOWS = ['month', 'quarter', 'year', 'all_time'] as const;
export type BadgeWindow = (typeof BADGE_WINDOWS)[number];
export const BADGE_ICONS = ['trophy', 'medal', 'star', 'flame', 'target', 'rocket', 'crown', 'phone'] as const;

export const badgeInputSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(200).nullable().optional(),
    icon: z.enum(BADGE_ICONS).default('medal'),
    metric: z.enum(BADGE_METRICS),
    threshold: z.number().positive().max(1_000_000_000),
    window: z.enum(BADGE_WINDOWS),
    active: z.boolean().default(true),
  })
  .refine((b) => b.metric !== 'target_attainment' || b.window !== 'all_time', { message: 'Target attainment needs a month, quarter or year.', path: ['window'] });
export type BadgeInput = z.infer<typeof badgeInputSchema>;

export interface BadgeRow extends BadgeInput {
  id: string;
  description: string | null;
  awardedCount: number;
}

export const DEFAULT_BADGES: BadgeInput[] = [
  { name: 'First win', description: 'Won a first deal.', icon: 'star', metric: 'deals_won', threshold: 1, window: 'all_time', active: true },
  { name: 'Closer', description: 'Won 10 deals.', icon: 'trophy', metric: 'deals_won', threshold: 10, window: 'all_time', active: true },
  { name: '100k club', description: 'Won 100,000 in revenue.', icon: 'crown', metric: 'revenue_won', threshold: 100_000, window: 'all_time', active: true },
  { name: 'Call champion', description: 'Logged 50 calls in a month.', icon: 'phone', metric: 'calls', threshold: 50, window: 'month', active: true },
  { name: 'Target hit', description: 'Reached the monthly sales target.', icon: 'target', metric: 'target_attainment', threshold: 100, window: 'month', active: true },
  { name: 'Quarter crusher', description: 'Reached the quarterly sales target.', icon: 'rocket', metric: 'target_attainment', threshold: 100, window: 'quarter', active: true },
];

export interface AwardRow {
  id: string;
  badge: { id: string; name: string; icon: string; description: string | null };
  user: { id: string; name: string };
  /** "all" for all-time badges, otherwise the period label (2026-10, 2026-Q4, 2026). */
  period: string;
  value: number;
  awardedAt: string;
}

// Leaderboards and dashboards

export interface ScoreBreakdownItem {
  key: ScoringRuleKey;
  /** Events in the period. */
  count: number;
  /** Events that earned points after the daily cap. */
  scored: number;
  points: number;
}

export interface PersonScore {
  user: { id: string; name: string };
  rank: number;
  points: number;
  breakdown: ScoreBreakdownItem[];
  dealsWon: number;
  revenueWon: number;
  activities: number;
  target: number | null;
  /** Percent of the personal target for this period, from won revenue. */
  attainment: number | null;
  badges: number;
}

export interface TeamScore {
  team: { id: string; name: string };
  rank: number;
  points: number;
  members: number;
  /** Points per member, so small and large teams compare fairly. */
  perMember: number;
  dealsWon: number;
  revenueWon: number;
  activities: number;
}

export interface Leaderboard {
  period: { label: string; start: string; end: string; granularity: 'month' | 'quarter' | 'year' };
  currency: string;
  /** False when the workspace shows leaderboards to managers only and you only see yourself. */
  full: boolean;
  /** Won deals left out of revenue because their currency has no exchange rate yet. */
  missingRates: number;
  people: PersonScore[];
  teams: TeamScore[];
}

export const COMPETITION_METRICS = ['points', 'revenue_won', 'deals_won', 'activities'] as const;
export type CompetitionMetric = (typeof COMPETITION_METRICS)[number];
export const COMPETITION_METRIC_LABELS: Record<CompetitionMetric, string> = { points: 'Points', revenue_won: 'Revenue won', deals_won: 'Deals won', activities: 'Calls, meetings and emails' };

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-01');
export const competitionInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).nullable().optional(),
    kind: z.enum(['individual', 'team']),
    metric: z.enum(COMPETITION_METRICS),
    /** A month, quarter or year label, or null with custom dates. */
    period: z.string().regex(/^\d{4}(-Q[1-4]|-(0[1-9]|1[0-2]))?$/).nullable(),
    startDate: ymd.nullable().optional(),
    endDate: ymd.nullable().optional(),
    /** Team challenge: a shared goal for each team (or everyone together for an individual competition). */
    goal: z.number().positive().max(1_000_000_000).nullable().optional(),
    reward: z.string().trim().max(200).nullable().optional(),
    teamIds: z.array(z.string().uuid()).max(50).default([]),
  })
  .refine((c) => c.period || (c.startDate && c.endDate && c.startDate < c.endDate), { message: 'Choose a period, or a start date before the end date.', path: ['period'] });
export type CompetitionInput = z.infer<typeof competitionInputSchema>;

export interface CompetitionStanding {
  id: string;
  name: string;
  /** Points for "points" competitions, otherwise the metric's value. */
  value: number;
  rank: number;
  /** Percent of the goal, when there is one. */
  progress: number | null;
}

export interface CompetitionRow {
  id: string;
  name: string;
  description: string | null;
  kind: 'individual' | 'team';
  metric: CompetitionMetric;
  start: string;
  /** Inclusive last day. */
  end: string;
  goal: number | null;
  reward: string | null;
  status: 'upcoming' | 'running' | 'finished' | 'cancelled';
  teams: { id: string; name: string }[];
  createdBy: { id: string; name: string } | null;
  /** Rules copied when the competition was created. */
  rules: ScoringRules;
  standings: CompetitionStanding[];
  /** Your own position, when you take part. */
  mine: CompetitionStanding | null;
}

export const leaderboardQuerySchema = z.object({ period: z.string().regex(/^\d{4}(-Q[1-4]|-(0[1-9]|1[0-2]))?$/, 'Use a period like 2026, 2026-Q4 or 2026-11').optional() });

export interface GamificationMe {
  enabled: boolean;
  canManage: boolean;
  user: { id: string; name: string };
  period: Leaderboard['period'];
  currency: string;
  score: PersonScore | null;
  /** Personal target progress for the month, quarter and year containing today. */
  targets: { period: string; granularity: 'month' | 'quarter' | 'year'; target: number | null; won: number; attainment: number | null }[];
  badges: AwardRow[];
  competitions: CompetitionRow[];
}

// Sales teams (the existing teams table, now with a way to manage it): used by team leaderboards and challenges.

export const teamInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).nullable().optional(),
  memberUserIds: z.array(z.string().uuid()).max(500).default([]),
});
export type TeamInput = z.infer<typeof teamInputSchema>;

export interface TeamRow {
  id: string;
  name: string;
  description: string | null;
  members: { id: string; name: string }[];
}

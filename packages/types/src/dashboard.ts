import { z } from 'zod';

/** KPI identifiers rendered on the Command Center. Every value is computed server-side. */
export const KPI_KEYS = [
  'totalLeads',
  'newLeads',
  'qualifiedLeads',
  'activeOpportunities',
  'pipelineValue',
  'weightedPipelineValue',
  'closedWonRevenue',
  'conversionRate',
  'averageDealSize',
  'averageSalesCycleDays',
  'forecastRevenue',
  'revenueGrowth',
  'activitiesCompleted',
  'aiAssistedActivities',
  'automationSuccessRate',
  'winRate',
  'salesVelocity',
  'overdueTasks',
  'upcomingTasks',
] as const;
export type KpiKey = (typeof KPI_KEYS)[number];

export type KpiFormat = 'number' | 'currency' | 'percent' | 'days';

export interface KpiValue {
  key: KpiKey;
  label: string;
  /** null means "not enough data yet" and is rendered as an empty state, never as zero. */
  value: number | null;
  format: KpiFormat;
  /** Optional explanation of how the metric was computed, shown in a tooltip. */
  definition: string;
  /** Module that must ship before the KPI can be populated, if any. */
  availableFrom?: string;
}

export interface StageSummary {
  stageId: string;
  name: string;
  probability: number;
  dealCount: number;
  value: number;
}

export interface ActivityItem {
  id: string;
  action: string;
  summary: string;
  actorName: string | null;
  createdAt: string;
}

export interface DashboardSummary {
  generatedAt: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  kpis: KpiValue[];
  pipeline: { pipelineId: string; name: string; stages: StageSummary[] } | null;
  recentActivity: ActivityItem[];
}

// ───────────── Command Center filters, charts and layout (design spec Part 4) ─────────────

export const DASHBOARD_PERIODS = ['7d', '30d', '90d', '365d'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];
export const PERIOD_DAYS: Record<DashboardPeriod, number> = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 };

export const dashboardFilterSchema = z
  .object({
    period: z.enum(DASHBOARD_PERIODS).default('30d'),
    /** "me" means the person looking at the dashboard. */
    ownerId: z.union([z.literal('me'), z.string().uuid()]).optional(),
    pipelineId: z.string().uuid().optional(),
  })
  .strict();
export type DashboardFilter = z.infer<typeof dashboardFilterSchema>;

export interface TrendPoint {
  /** Start of the bucket (ISO date). */
  start: string;
  label: string;
  won: number;
  wonCount: number;
}

export interface StageConversion {
  stageId: string;
  name: string;
  /** Deals created in the period that reached this stage or a later one (or were won). */
  reached: number;
  /** reached ÷ reached at the previous stage; null for the first stage. */
  conversion: number | null;
}

export interface TeamPerformanceRow {
  userId: string | null;
  name: string;
  won: number;
  wonCount: number;
  openValue: number;
  openCount: number;
  activities: number;
}

export interface DashboardCharts {
  currency: string;
  periodStart: string;
  periodEnd: string;
  /** Week buckets up to 90 days, month buckets beyond. */
  revenueTrend: TrendPoint[];
  stageConversion: { pipelineId: string; name: string; stages: StageConversion[] } | null;
  winLoss: { won: number; wonCount: number; lost: number; lostCount: number; winRate: number | null; lossReasons: { reason: string; count: number }[] };
  team: TeamPerformanceRow[];
  /** Open deals by computed health risk; "unscored" until deal health has run for them. */
  risk: { risk: 'low' | 'medium' | 'high' | 'unscored'; count: number; value: number }[];
  /** This quarter's target (the owner's when filtered by owner, else the team's). null when none is set. */
  goal: { period: string; target: number; won: number; attainment: number } | null;
}

export const DASHBOARD_WIDGETS = [
  'kpis',
  'nextActions',
  'insights',
  'pipeline',
  'revenueTrend',
  'stageConversion',
  'winLoss',
  'team',
  'risk',
  'goal',
  'activity',
] as const;
export type DashboardWidget = (typeof DASHBOARD_WIDGETS)[number];

export const dashboardLayoutSchema = z
  .object({
    preset: z.enum(['executive', 'salesperson', 'custom']).default('custom'),
    widgets: z
      .array(z.object({ id: z.enum(DASHBOARD_WIDGETS), size: z.enum(['half', 'full']), hidden: z.boolean().default(false) }).strict())
      .max(DASHBOARD_WIDGETS.length)
      .refine((w) => new Set(w.map((x) => x.id)).size === w.length, 'Each widget can appear once'),
    filters: dashboardFilterSchema.default({ period: '30d' }),
  })
  .strict();
export type DashboardLayout = z.infer<typeof dashboardLayoutSchema>;

const W = (id: DashboardWidget, size: 'half' | 'full', hidden = false) => ({ id, size, hidden });

/** Two starting points: the executive view leads with revenue and team; the salesperson view with today's work. */
export const DASHBOARD_PRESETS: Record<'executive' | 'salesperson', DashboardLayout> = {
  executive: {
    preset: 'executive',
    widgets: [
      W('kpis', 'full'),
      W('revenueTrend', 'half'),
      W('goal', 'half'),
      W('stageConversion', 'half'),
      W('winLoss', 'half'),
      W('team', 'half'),
      W('risk', 'half'),
      W('pipeline', 'full'),
      W('insights', 'half'),
      W('activity', 'half'),
      W('nextActions', 'full', true),
    ],
    filters: { period: '90d' },
  },
  salesperson: {
    preset: 'salesperson',
    widgets: [
      W('nextActions', 'half'),
      W('insights', 'half'),
      W('kpis', 'full'),
      W('pipeline', 'half'),
      W('risk', 'half'),
      W('goal', 'half'),
      W('revenueTrend', 'half'),
      W('activity', 'full'),
      W('stageConversion', 'half', true),
      W('winLoss', 'half', true),
      W('team', 'half', true),
    ],
    filters: { period: '30d', ownerId: 'me' },
  },
};

/** Fills in widgets a stored layout does not mention (added in later versions) as hidden, at the end. */
export function completeLayout(l: DashboardLayout): DashboardLayout {
  const seen = new Set(l.widgets.map((w) => w.id));
  return { ...l, widgets: [...l.widgets, ...DASHBOARD_WIDGETS.filter((id) => !seen.has(id)).map((id) => W(id, 'half', true))] };
}

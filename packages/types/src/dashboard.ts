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

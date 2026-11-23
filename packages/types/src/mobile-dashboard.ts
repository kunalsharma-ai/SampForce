import { z } from 'zod';
import type { MobileDashboardCard } from './mobile-config';
import type { TargetMetric, TargetPeriod } from './workspace-work';
import { WORKSPACE_DASHBOARD_PERIODS, type WorkspaceDashboardPeriod } from './workspace-dashboard';

/*
 * The phone's home screen with figures (ADR 0072, M5). The cards are the ones the Super Workspace chose for the
 * person's level; every figure comes from the web's own dashboards and lists, counted on each request. No recent list.
 */

export const mobileDashboardQuerySchema = z.object({ period: z.enum(WORKSPACE_DASHBOARD_PERIODS).default('MONTH') });
export type MobileDashboardQuery = z.infer<typeof mobileDashboardQuerySchema>;

/** One bar of a card's chart, or one line of its list. */
export interface MobileFigure {
  label: string;
  value: number;
  /** Shown instead of the value when set (money, percentages). */
  display?: string;
  /** 0 to 100, for progress bars. */
  percent?: number | null;
  /** Money shown beside a bar (pipeline stages). */
  amount?: string;
  /** Follow-ups and tasks listed on a card. */
  dueAt?: string;
  overdue?: boolean;
}

export interface MobileTargetFigure {
  metric: TargetMetric;
  amount: number;
  achieved: number;
  percent: number;
}

/** A dashboard card with its figures: headline numbers, then an optional chart or list. */
export interface MobileDashboardCardData {
  card: MobileDashboardCard;
  showChart: boolean;
  /** Headline numbers in order. */
  stats: MobileFigure[];
  /** Bars (performance, pipeline) or list lines (follow-ups, ranking). */
  bars: MobileFigure[];
  targets: MobileTargetFigure[];
  /** Where a tap goes on the phone, when the person can open it there. */
  opens: 'companies' | 'follow_ups' | 'tasks' | 'targets' | 'deals' | null;
  /** A plain sentence when the card has nothing to count yet (no target set, no pipeline); one of MOBILE_CARD_EMPTY. */
  empty: MobileCardEmpty | null;
}

export interface MobileDashboard {
  period: WorkspaceDashboardPeriod;
  currency: string;
  cards: MobileDashboardCardData[];
}

/** One target as the phone lists it. */
export interface MobileTargetRow {
  id: string;
  metric: TargetMetric;
  period: TargetPeriod;
  startsOn: string;
  endsOn: string;
  amount: number;
  achieved: number;
  percent: number;
  currency: string | null;
  workspace: string;
  note: string | null;
}

/** The headline labels a card can carry; the phone translates them (data such as names and stages is shown as is). */
export const MOBILE_STAT_LABELS = [
  'Leads today',
  'Target',
  'Still needed',
  'Calls today',
  'Due today',
  'Overdue',
  'Open',
  'Leads',
  'Calls',
  'Deals won',
  'Revenue',
  'Open tasks',
  'Overdue tasks',
  'Pending follow-ups',
  'Overdue follow-ups',
  'Manager Workspaces',
  'Executive Workspaces',
  'Open deals',
  'Pipeline value',
  'Monthly revenue target',
] as const;
export type MobileStatLabel = (typeof MOBILE_STAT_LABELS)[number];

/** Sentences a card shows when it has nothing to count; the phone translates them. */
export const MOBILE_CARD_EMPTY = [
  'No daily lead target is set for you.',
  'No daily lead target is set for your team.',
  'No targets are running for you.',
  'No targets are running.',
  'No Executive Workspaces yet.',
  'No Manager Workspaces yet.',
  'No pipeline yet.',
  'Announcements from your organisation will show here.',
] as const;
export type MobileCardEmpty = (typeof MOBILE_CARD_EMPTY)[number];

import { z } from 'zod';
import type { WorkspaceLevel } from './workspaces';
import type { TargetMetric } from './workspace-work';

/*
 * One dashboard per workspace level (ADR 0071, part 6): the Super Workspace runs the organisation, a manager runs a
 * team, an executive runs their own day. Every figure is counted from the records on each request; nothing is typed in
 * or cached. There is no recent-activity list on any of them.
 */

export const WORKSPACE_DASHBOARD_PERIODS = ['TODAY', 'WEEK', 'MONTH', 'QUARTER'] as const;
export type WorkspaceDashboardPeriod = (typeof WORKSPACE_DASHBOARD_PERIODS)[number];
export const WORKSPACE_DASHBOARD_PERIOD_LABEL: Record<WorkspaceDashboardPeriod, string> = {
  TODAY: 'Today',
  WEEK: 'This week',
  MONTH: 'This month',
  QUARTER: 'This quarter',
};

export const workspaceDashboardQuerySchema = z.object({ period: z.enum(WORKSPACE_DASHBOARD_PERIODS).default('MONTH') });
export type WorkspaceDashboardQuery = z.input<typeof workspaceDashboardQuerySchema>;

export interface DashboardWorkspace {
  id: string;
  name: string;
  level: WorkspaceLevel;
}

/** What a workspace (and everything below it) did in the period. */
export interface WorkspacePerformance {
  workspace: DashboardWorkspace;
  /** The manager it reports to, for executives. */
  manager: DashboardWorkspace | null;
  people: number;
  leads: number;
  calls: number;
  dealsWon: number;
  revenue: number;
  /** Revenue target for the period, when one is set, and how far it got. */
  revenueTarget: number | null;
  leadTarget: number | null;
  /** Share of its revenue target reached, else of its lead target; null with no target. */
  targetPercent: number | null;
}

/** Targets that are running now, added up per metric. */
export interface TargetTotal {
  metric: TargetMetric;
  amount: number;
  achieved: number;
  percent: number;
}

export interface WorkCounts {
  openTasks: number;
  overdueTasks: number;
  pendingFollowUps: number;
  overdueFollowUps: number;
}

interface DashboardBase {
  period: WorkspaceDashboardPeriod;
  start: string;
  /** Exclusive. */
  end: string;
  currency: string;
}

export interface SuperDashboard extends DashboardBase {
  level: 'SUPER';
  workspaces: {
    managers: { used: number; max: number | null };
    executives: { used: number; max: number | null };
  };
  totals: { leads: number; calls: number; dealsWon: number; revenue: number };
  targets: TargetTotal[];
  managers: WorkspacePerformance[];
  executives: WorkspacePerformance[];
  topManager: WorkspacePerformance | null;
  topExecutive: WorkspacePerformance | null;
  work: WorkCounts;
}

/** Leads, calls, deals and revenue for today, this week and this month: the manager's daily, weekly, monthly report. */
export interface PeriodReport {
  period: 'TODAY' | 'WEEK' | 'MONTH';
  leads: number;
  calls: number;
  dealsWon: number;
  revenue: number;
}

export interface TrendPoint {
  /** Monday of the week (UTC). */
  week: string;
  leads: number;
  revenue: number;
}

export interface ManagerDashboardView extends DashboardBase {
  level: 'MANAGER';
  team: DashboardWorkspace;
  executiveCount: number;
  totals: { leads: number; calls: number; dealsWon: number; revenue: number };
  targets: TargetTotal[];
  executives: WorkspacePerformance[];
  best: WorkspacePerformance | null;
  lowest: WorkspacePerformance | null;
  work: WorkCounts;
  reports: PeriodReport[];
  trend: TrendPoint[];
  /** Other Manager Workspaces' figures, only when the Super Workspace allows it (never their records). */
  otherManagers: WorkspacePerformance[] | null;
}

export interface UpcomingFollowUp {
  id: string;
  title: string;
  dueAt: string;
  overdue: boolean;
  company: { id: string; name: string } | null;
}

export interface ExecutiveDay extends DashboardBase {
  level: 'EXECUTIVE';
  today: {
    leadTarget: number | null;
    leads: number;
    /** Leads still needed for today's target; null without one. */
    remaining: number | null;
    calls: number;
    callTarget: number | null;
    revenue: number;
  };
  /** The revenue target running this month (or the one covering today), and how far it got. */
  monthly: { amount: number; achieved: number; percent: number; endsOn: string } | null;
  targets: TargetTotal[];
  work: WorkCounts;
  upcoming: UpcomingFollowUp[];
}

export type WorkspaceDashboard = SuperDashboard | ManagerDashboardView | ExecutiveDay;

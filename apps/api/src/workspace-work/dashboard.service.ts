import type { TenantTx } from '@dealflow/database';
import { ForbiddenException, Injectable } from '@nestjs/common';
import type {
  DashboardWorkspace,
  ExecutiveDay,
  ManagerDashboardView,
  PeriodReport,
  SuperDashboard,
  TargetMetric,
  TargetRow,
  TargetTotal,
  WorkspaceTrendPoint,
  UpcomingFollowUp,
  WorkCounts,
  WorkspaceDashboard,
  WorkspaceDashboardPeriod,
  WorkspacePerformance,
} from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { Metrics, r2 } from '../command-center/metrics';
import { loadRates } from '../revenue/fx';
import { RevenueRecordsService } from '../crm/revenue-records.service';
import { branchIds, type NodeAccess, resolveOrganisation } from '../workspaces/access';
import { WorkspacesService } from '../workspaces/workspaces.service';
import { callerOf, type Org, refOf } from './hierarchy';
import { TargetsService } from './targets.service';

const DAY = 86_400_000;
type Rates = Awaited<ReturnType<typeof loadRates>>;

/** [start, end) of a period around `now`, in UTC days; weeks start on Monday. */
export function periodRange(period: WorkspaceDashboardPeriod | 'TODAY' | 'WEEK' | 'MONTH', now: Date): { start: Date; end: Date } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const today = Date.UTC(y, m, now.getUTCDate());
  if (period === 'TODAY') return { start: new Date(today), end: new Date(today + DAY) };
  if (period === 'WEEK') {
    const monday = today - ((now.getUTCDay() + 6) % 7) * DAY;
    return { start: new Date(monday), end: new Date(monday + 7 * DAY) };
  }
  if (period === 'MONTH') return { start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 1)) };
  const q = Math.floor(m / 3) * 3;
  return { start: new Date(Date.UTC(y, q, 1)), end: new Date(Date.UTC(y, q + 3, 1)) };
}

/**
 * The dashboard of the caller's workspace level (ADR 0071, part 6): the organisation for the Super Workspace, the team
 * for a manager, the day for an executive. Every figure is counted from records on each request, through the same
 * Metrics as the Command Center, so the numbers agree with it and with the targets page.
 */
@Injectable()
export class WorkspaceDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly targets: TargetsService,
    private readonly workspaces: WorkspacesService,
    private readonly revenue: RevenueRecordsService,
  ) {}

  async dashboard(auth: AuthContext, period: WorkspaceDashboardPeriod): Promise<WorkspaceDashboard> {
    // Targets come from the targets page's own rules, so a workspace without the feature simply has none.
    const targetRows = await this.targets.list(auth).then((v) => v.targets).catch(() => [] as TargetRow[]);
    return this.prisma.run(auth, async (tx) => {
      await this.revenue.reconcile(tx, auth.tenantId);
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { name: true, defaultCurrency: true } });
      const now = new Date();
      const range = periodRange(period, now);
      const c = new Counter(tx, auth.tenantId, tenant.defaultCurrency, await loadRates(tx, auth.tenantId), now);
      const running = targetRows.filter((t) => new Date(`${t.startsOn}T00:00:00Z`) <= now && now < new Date(new Date(`${t.endsOn}T00:00:00Z`).getTime() + DAY));
      const base = { period, start: range.start.toISOString(), end: range.end.toISOString(), currency: tenant.defaultCurrency };
      const ref = (a: NodeAccess): DashboardWorkspace => refOf(a, org, tenant.name);
      const live = (level: 'MANAGER' | 'EXECUTIVE', parent?: string) =>
        [...org.byId.values()].filter((a) => a.level === level && !a.node.archivedAt && (parent === undefined || a.node.parentId === parent)).sort((x, y) => x.node.name.localeCompare(y.node.name));
      const perf = async (a: NodeAccess): Promise<WorkspacePerformance> => {
        const users = await c.branchUsers(org, a.node.id);
        const fig = await c.figures(users, range.start, range.end);
        const mine = running.filter((t) => t.workspace.id === a.node.id);
        const revenueTarget = sumOf(mine, 'REVENUE');
        const leadTarget = sumOf(mine, 'LEADS');
        const parent = a.node.parentId ? org.byId.get(a.node.parentId) : undefined;
        return {
          workspace: ref(a),
          manager: a.level === 'EXECUTIVE' && parent && parent.level === 'MANAGER' ? ref(parent) : null,
          people: users.length,
          ...fig,
          revenueTarget,
          leadTarget,
          targetPercent: percentOf(mine),
        };
      };

      if (me.level === 'SUPER') {
        // The organisation's figures are for its administrators; other Super Workspace members keep their own dashboards.
        if (!auth.permissions.includes('members:manage')) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have permission to perform this action.' });
        const [usage, totals, managers, executives, work] = await Promise.all([
          this.workspaces.usage(tx, auth.tenantId),
          c.figures(null, range.start, range.end),
          Promise.all(live('MANAGER').map(perf)),
          Promise.all(live('EXECUTIVE').map(perf)),
          c.work(null, null),
        ]);
        const view: SuperDashboard = {
          ...base,
          level: 'SUPER',
          workspaces: usage,
          totals,
          targets: totals_(running.filter((t) => t.source === 'SUPER' && !t.parentTargetId)),
          managers,
          executives,
          topManager: best(managers),
          topExecutive: best(executives),
          work,
        };
        return view;
      }

      if (me.level === 'MANAGER') {
        const users = await c.branchUsers(org, me.node.id);
        const branch = branchIds([...org.byId.values()].map((a) => a.node), me.node.id);
        const executives = await Promise.all(live('EXECUTIVE', me.node.id).map(perf));
        const reports: PeriodReport[] = [];
        for (const p of ['TODAY', 'WEEK', 'MONTH'] as const) {
          const r = periodRange(p, now);
          reports.push({ period: p, ...(await c.figures(users, r.start, r.end)) });
        }
        const others = me.node.canViewOtherManagers ? await Promise.all(live('MANAGER').filter((a) => a.node.id !== me.node.id).map(perf)) : null;
        const ranked = executives.filter((e) => e.people > 0);
        const view: ManagerDashboardView = {
          ...base,
          level: 'MANAGER',
          team: ref(me),
          executiveCount: executives.length,
          totals: await c.figures(users, range.start, range.end),
          targets: totals_(running.filter((t) => t.workspace.id === me.node.id)),
          executives,
          best: best(ranked),
          lowest: ranked.length > 1 ? worst(ranked) : null,
          work: await c.work(users, [...branch]),
          reports,
          trend: await c.trend(users, now),
          // Figures only: other managers' records stay behind record visibility.
          otherManagers: others,
        };
        return view;
      }

      const users = [auth.userId];
      const today = periodRange('TODAY', now);
      const mine = running.filter((t) => t.workspace.id === me.node.id);
      const daily = (metric: TargetMetric) => sumOf(mine.filter((t) => t.period === 'DAILY'), metric);
      const day = await c.figures(users, today.start, today.end);
      const leadTarget = daily('LEADS');
      const revenueTargets = mine.filter((t) => t.metric === 'REVENUE');
      const monthly = revenueTargets.find((t) => t.period === 'MONTHLY') ?? revenueTargets[0] ?? null;
      const view: ExecutiveDay = {
        ...base,
        level: 'EXECUTIVE',
        today: { leadTarget, leads: day.leads, remaining: leadTarget === null ? null : Math.max(0, leadTarget - day.leads), calls: day.calls, callTarget: daily('CALLS'), revenue: day.revenue },
        monthly: monthly ? { amount: monthly.amount, achieved: monthly.achieved, percent: monthly.percent, endsOn: monthly.endsOn } : null,
        targets: totals_(mine),
        work: await c.work(users, [me.node.id]),
        upcoming: await c.upcoming(auth.userId, now),
      };
      return view;
    });
  }
}

/** Counts for a set of people (null = the whole organisation) through the Command Center's Metrics. */
class Counter {
  private readonly branchCache = new Map<string, string[]>();

  constructor(
    private readonly tx: TenantTx,
    private readonly tenantId: string,
    private readonly currency: string,
    private readonly rates: Rates,
    private readonly now: Date,
  ) {}

  /** People working in a workspace and everything below it. */
  async branchUsers(org: Org, nodeId: string): Promise<string[]> {
    if (!this.branchCache.has(nodeId)) {
      const ids = [...branchIds([...org.byId.values()].map((a) => a.node), nodeId)];
      const rows = await this.tx.membership.findMany({ where: { tenantId: this.tenantId, status: 'ACTIVE', workspaceNodeId: { in: ids } }, select: { userId: true } });
      this.branchCache.set(nodeId, [...new Set(rows.map((r) => r.userId))]);
    }
    return this.branchCache.get(nodeId)!;
  }

  private metrics(users: string[] | null, start: Date, end: Date): Metrics {
    const t = periodRange('TODAY', this.now);
    return new Metrics(this.tx, { tenantId: this.tenantId, users, start, end, now: this.now, todayStart: t.start, tomorrowStart: t.end }, this.currency, this.rates);
  }

  async figures(users: string[] | null, start: Date, end: Date): Promise<{ leads: number; calls: number; dealsWon: number; revenue: number }> {
    if (users && !users.length) return { leads: 0, calls: 0, dealsWon: 0, revenue: 0 };
    const m = this.metrics(users, start, end);
    const [leads, rev, calls] = await Promise.all([m.leadsGenerated(), m.revenue(), this.calls(users, start, end)]);
    return { leads: leads.length, calls, dealsWon: rev.deals, revenue: r2(rev.amount) };
  }

  /** Logged calls, counted as the targets page counts them. */
  private calls(users: string[] | null, start: Date, end: Date): Promise<number> {
    return this.tx.activity.count({
      where: {
        tenantId: this.tenantId, deletedAt: null, occurredAt: { gte: start, lt: end }, ...(users ? { ownerId: { in: users } } : {}),
        OR: [{ interaction: { in: ['CALL_OUTGOING', 'CALL_INCOMING'] } }, { AND: [{ OR: [{ interaction: null }, { interaction: { isSet: false } }] }, { type: 'CALL' }] }],
      },
    });
  }

  /** Open and overdue tasks handed down to these workspaces (null = all), and the people's follow-ups. */
  async work(users: string[] | null, nodeIds: string[] | null): Promise<WorkCounts> {
    const m = this.metrics(users, this.now, this.now);
    const taskWhere = { tenantId: this.tenantId, deletedAt: null, status: 'OPEN' as const, workspaceNodeId: nodeIds ? { in: nodeIds } : { not: null } };
    const [openTasks, overdueTasks, pending, overdue] = await Promise.all([
      this.tx.task.count({ where: taskWhere }),
      this.tx.task.count({ where: { ...taskWhere, dueAt: { lt: this.now } } }),
      users && !users.length ? Promise.resolve([]) : m.followUpsPending(),
      users && !users.length ? Promise.resolve([]) : m.followUpsOverdue(),
    ]);
    return { openTasks, overdueTasks, pendingFollowUps: pending.length, overdueFollowUps: overdue.length };
  }

  /** Leads and revenue for each of the last eight weeks, oldest first. */
  async trend(users: string[], now: Date): Promise<WorkspaceTrendPoint[]> {
    const thisWeek = periodRange('WEEK', now).start.getTime();
    const out: WorkspaceTrendPoint[] = [];
    for (let i = 7; i >= 0; i--) {
      const start = new Date(thisWeek - i * 7 * DAY);
      const end = new Date(start.getTime() + 7 * DAY);
      const f = users.length ? await this.figures(users, start, end) : { leads: 0, revenue: 0 };
      out.push({ week: start.toISOString().slice(0, 10), leads: f.leads, revenue: f.revenue });
    }
    return out;
  }

  /** The executive's next open follow-ups, overdue ones first. */
  async upcoming(userId: string, now: Date): Promise<UpcomingFollowUp[]> {
    const rows = await this.tx.task.findMany({
      where: { tenantId: this.tenantId, deletedAt: null, status: 'OPEN', followUpType: { not: null }, assigneeId: userId, dueAt: { not: null } },
      orderBy: { dueAt: 'asc' },
      take: 8,
      select: { id: true, title: true, dueAt: true, companyId: true },
    });
    const companyIds = [...new Set(rows.map((r) => r.companyId).filter((x): x is string => !!x))];
    const companies = companyIds.length ? await this.tx.company.findMany({ where: { tenantId: this.tenantId, id: { in: companyIds } }, select: { id: true, name: true } }) : [];
    const name = new Map(companies.map((c) => [c.id, c.name]));
    return rows.map((r) => ({ id: r.id, title: r.title, dueAt: r.dueAt!.toISOString(), overdue: r.dueAt! < now, company: r.companyId && name.has(r.companyId) ? { id: r.companyId, name: name.get(r.companyId)! } : null }));
  }
}

function sumOf(rows: TargetRow[], metric: TargetMetric): number | null {
  const list = rows.filter((t) => t.metric === metric);
  return list.length ? r2(list.reduce((a, t) => a + t.amount, 0)) : null;
}

/** Share of the revenue target reached, else of the lead target. */
function percentOf(rows: TargetRow[]): number | null {
  for (const metric of ['REVENUE', 'LEADS'] as const) {
    const list = rows.filter((t) => t.metric === metric);
    const amount = list.reduce((a, t) => a + t.amount, 0);
    if (amount > 0) return Math.round((list.reduce((a, t) => a + t.achieved, 0) / amount) * 1000) / 10;
  }
  return null;
}

function totals_(rows: TargetRow[]): TargetTotal[] {
  const out: TargetTotal[] = [];
  for (const metric of ['LEADS', 'CALLS', 'DEALS_WON', 'REVENUE'] as const) {
    const list = rows.filter((t) => t.metric === metric);
    if (!list.length) continue;
    const amount = r2(list.reduce((a, t) => a + t.amount, 0));
    const achieved = r2(list.reduce((a, t) => a + t.achieved, 0));
    out.push({ metric, amount, achieved, percent: amount > 0 ? Math.round((achieved / amount) * 1000) / 10 : 0 });
  }
  return out;
}

/** Ranks by share of target where targets exist, then revenue, then leads. */
function rank(a: WorkspacePerformance, b: WorkspacePerformance): number {
  return (b.targetPercent ?? -1) - (a.targetPercent ?? -1) || b.revenue - a.revenue || b.leads - a.leads || b.calls - a.calls;
}

function best(list: WorkspacePerformance[]): WorkspacePerformance | null {
  const active = list.filter((p) => p.revenue > 0 || p.leads > 0 || p.calls > 0 || (p.targetPercent ?? 0) > 0);
  return active.length ? [...active].sort(rank)[0]! : null;
}

function worst(list: WorkspacePerformance[]): WorkspacePerformance | null {
  return list.length ? [...list].sort(rank).at(-1)! : null;
}

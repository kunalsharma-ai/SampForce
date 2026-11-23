import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  type ExecutiveDay,
  type ManagerDashboardView,
  MOBILE_DASHBOARD_CARD_DEFS,
  type MobileDashboard,
  type MobileDashboardCard,
  type MobileDashboardCardData,
  type MobileFigure,
  type MobileResolvedConfig,
  type MobileStatLabel,
  type MobileTargetRow,
  type SuperDashboard,
  type TargetRow,
  type WorkspaceDashboardPeriod,
  type WorkspacePerformance,
} from '@dealflow/types';
import type { AuthContext } from '../../common/auth-context';
import { PrismaService } from '../../common/prisma.service';
import { DealsService } from '../../crm/deals.service';
import { TasksService } from '../../crm/tasks.service';
import { WorkspaceDashboardService } from '../../workspace-work/dashboard.service';
import { TargetsService } from '../../workspace-work/targets.service';
import { MobileConfigService } from '../mobile-config.service';

const DAY = 86_400_000;
const stat = (label: MobileStatLabel, value: number, display?: string): MobileFigure => ({ label, value, ...(display !== undefined ? { display } : {}) });
const pct = (n: number | null) => (n === null ? null : Math.max(0, Math.min(100, Math.round(n))));

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount)}`;
  }
}

const running = (t: TargetRow, now: Date) => new Date(`${t.startsOn}T00:00:00Z`) <= now && now.getTime() < new Date(`${t.endsOn}T00:00:00Z`).getTime() + DAY;

/**
 * The phone's home screen with figures (ADR 0072, M5). It reuses the web's level dashboard (ADR 0071 part 6), the
 * targets page and the CRM lists, so every number matches the web; the phone only picks the cards its configuration
 * chose and shapes them for a small screen.
 */
@Injectable()
export class MobileDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configs: MobileConfigService,
    private readonly dashboards: WorkspaceDashboardService,
    private readonly targetsService: TargetsService,
    private readonly tasks: TasksService,
    private readonly deals: DealsService,
  ) {}

  private config(auth: AuthContext): Promise<MobileResolvedConfig> {
    return this.prisma.run(auth, (tx) => this.configs.resolvedFor(tx, auth));
  }

  async dashboard(auth: AuthContext, period: WorkspaceDashboardPeriod, now = new Date()): Promise<MobileDashboard> {
    const config = await this.config(auth);
    const chosen = config.dashboard;
    const wants = (...cards: MobileDashboardCard[]) => chosen.some((c) => cards.includes(c.card));
    const can = (m: MobileDashboardCardData['opens']) => (m && config.modules.some((x) => x.key === m) ? m : null);

    // Only what the chosen cards need is loaded.
    const [main, today, targetRows, myTasks, board] = await Promise.all([
      this.dashboards.dashboard(auth, period),
      wants('leads_today', 'todays_target') && period !== 'TODAY' ? this.dashboards.dashboard(auth, 'TODAY') : null,
      wants('todays_target') && config.level === 'MANAGER' ? this.targetsService.list(auth).then((v) => v.targets).catch(() => [] as TargetRow[]) : ([] as TargetRow[]),
      wants('my_tasks') ? this.tasks.list(auth, { scope: 'mine', status: 'OPEN' }, { withoutFollowUps: true }) : [],
      wants('pipeline_summary') ? this.deals.board(auth, undefined, 1).catch(() => null) : null,
    ]);
    const day = today ?? main;
    const currency = main.currency;
    const showAmounts = !!config.fields.deals?.amount;

    const cards: MobileDashboardCardData[] = [];
    for (const { card, showChart } of chosen) {
      const out: MobileDashboardCardData = { card, showChart, stats: [], bars: [], targets: [], opens: null, empty: null };
      const def = MOBILE_DASHBOARD_CARD_DEFS[card];
      switch (card) {
        case 'todays_target': {
          out.opens = can('targets');
          if (main.level === 'EXECUTIVE') {
            const d = (day as ExecutiveDay).today;
            out.stats = [stat('Leads today', d.leads), ...(d.leadTarget !== null ? [stat('Target', d.leadTarget), stat('Still needed', d.remaining ?? 0)] : []), stat('Calls today', d.calls)];
            if (d.leadTarget !== null) out.bars = [{ label: 'Leads', value: d.leads, percent: pct(d.leadTarget ? (d.leads / d.leadTarget) * 100 : 100) }];
            else out.empty = 'No daily lead target is set for you.';
          } else if (main.level === 'MANAGER') {
            const team = (main as ManagerDashboardView).team.id;
            const daily = targetRows.filter((t) => t.workspace.id === team && t.period === 'DAILY' && t.metric === 'LEADS' && running(t, now));
            const leads = (day as ManagerDashboardView).totals.leads;
            const target = daily.reduce((s, t) => s + t.amount, 0);
            out.stats = [stat('Leads today', leads), ...(daily.length ? [stat('Target', target), stat('Still needed', Math.max(0, target - leads))] : [])];
            if (daily.length) out.bars = [{ label: 'Leads', value: leads, percent: pct(target ? (leads / target) * 100 : 100) }];
            else out.empty = 'No daily lead target is set for your team.';
          }
          break;
        }
        case 'leads_today': {
          out.opens = can('companies');
          const leads = day.level === 'EXECUTIVE' ? day.today.leads : day.totals.leads;
          out.stats = [stat('Leads today', leads)];
          break;
        }
        case 'pending_follow_ups': {
          out.opens = can('follow_ups');
          out.stats = [stat('Pending follow-ups', main.work.pendingFollowUps), stat('Overdue', main.work.overdueFollowUps)];
          if (main.level === 'EXECUTIVE') out.bars = main.upcoming.slice(0, 5).map((f) => ({ label: f.title, value: 0, dueAt: f.dueAt, overdue: f.overdue }));
          break;
        }
        case 'my_tasks': {
          out.opens = can('tasks');
          const overdue = myTasks.filter((x) => x.overdue).length;
          out.stats = [stat('Open', myTasks.length), stat('Overdue', overdue)];
          out.bars = myTasks
            .filter((x) => x.dueAt)
            .sort((a, b) => a.dueAt!.localeCompare(b.dueAt!))
            .slice(0, 5)
            .map((x) => ({ label: x.title, value: 0, dueAt: x.dueAt!, overdue: x.overdue }));
          break;
        }
        case 'personal_performance': {
          if (main.level !== 'EXECUTIVE') break;
          out.stats = [stat('Leads today', main.today.leads), stat('Calls today', main.today.calls)];
          if (main.monthly) out.stats.push(stat('Monthly revenue target', main.monthly.amount, money(main.monthly.amount, currency)));
          out.targets = main.targets;
          if (!main.targets.length) out.empty = 'No targets are running for you.';
          break;
        }
        case 'team_performance': {
          if (main.level !== 'MANAGER') break;
          out.stats = totals(main.totals, currency);
          out.bars = main.reports.map((r) => ({ label: r.period, value: r.leads }));
          break;
        }
        case 'organisation_performance': {
          if (main.level !== 'SUPER') break;
          out.stats = [...totals(main.totals, currency), stat('Manager Workspaces', main.workspaces.managers.used), stat('Executive Workspaces', main.workspaces.executives.used)];
          break;
        }
        case 'executive_ranking': {
          const people = main.level === 'MANAGER' || main.level === 'SUPER' ? (main as ManagerDashboardView | SuperDashboard).executives : [];
          out.bars = rank(people, currency).slice(0, 5);
          if (!out.bars.length) out.empty = 'No Executive Workspaces yet.';
          break;
        }
        case 'workspace_performance': {
          if (main.level !== 'SUPER') break;
          out.bars = rank(main.managers, currency);
          if (!out.bars.length) out.empty = 'No Manager Workspaces yet.';
          break;
        }
        case 'team_tasks': {
          out.opens = can('tasks');
          out.stats = [stat('Open tasks', main.work.openTasks), stat('Overdue tasks', main.work.overdueTasks), stat('Pending follow-ups', main.work.pendingFollowUps), stat('Overdue follow-ups', main.work.overdueFollowUps)];
          break;
        }
        case 'targets_achievement': {
          out.opens = can('targets');
          out.targets = main.targets;
          if (!main.targets.length) out.empty = 'No targets are running.';
          break;
        }
        case 'pipeline_summary': {
          out.opens = can('deals');
          if (!board) {
            out.empty = 'No pipeline yet.';
            break;
          }
          const open = board.columns.filter((c) => c.stage.category === 'OPEN');
          const count = open.reduce((s, c) => s + c.total, 0);
          const value = open.reduce((s, c) => s + Number(c.value ?? 0), 0);
          out.stats = [stat('Open deals', count), ...(showAmounts ? [stat('Pipeline value', value, money(value, currency))] : [])];
          out.bars = open.map((c) => ({ label: c.stage.name, value: c.total, ...(showAmounts ? { amount: money(Number(c.value ?? 0), currency) } : {}) }));
          break;
        }
        case 'announcements':
          // SampForce has no announcements yet; they arrive with notifications (M8). The card says so plainly.
          out.empty = 'Announcements from your organisation will show here.';
          break;
      }
      if (def.levels.includes(config.level)) cards.push(out);
    }
    return { period, currency, cards };
  }

  /** The targets this person can see, for the phone's Sales targets screen. */
  async targets(auth: AuthContext): Promise<MobileTargetRow[]> {
    if (!(await this.config(auth)).modules.some((m) => m.key === 'targets')) throw new ForbiddenException({ code: 'MOBILE_MODULE_OFF', message: 'This part of SampForce is not available in your mobile app.' });
    const view = await this.targetsService.list(auth);
    return view.targets.map((t) => ({
      id: t.id,
      metric: t.metric,
      period: t.period,
      startsOn: t.startsOn,
      endsOn: t.endsOn,
      amount: t.amount,
      achieved: t.achieved,
      percent: t.percent,
      currency: t.currency,
      workspace: t.workspace.name,
      note: t.note,
    }));
  }
}

function totals(t: { leads: number; calls: number; dealsWon: number; revenue: number }, currency: string): MobileFigure[] {
  return [stat('Leads', t.leads), stat('Calls', t.calls), stat('Deals won', t.dealsWon), stat('Revenue', t.revenue, money(t.revenue, currency))];
}

/** Workspaces best first: by share of target, then revenue, then leads. */
function rank(rows: WorkspacePerformance[], currency: string): MobileFigure[] {
  return [...rows]
    .sort((a, b) => (b.targetPercent ?? -1) - (a.targetPercent ?? -1) || b.revenue - a.revenue || b.leads - a.leads)
    .map((w) => ({ label: w.workspace.name, value: w.revenue, display: money(w.revenue, currency), percent: pct(w.targetPercent) }));
}


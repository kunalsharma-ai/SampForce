import { ForbiddenException, Injectable } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import {
  DEFAULT_RANKING_WEIGHTS,
  PERCENT_RANKING_METRICS,
  type PerformancePeriod,
  type PerformanceQuery,
  performanceQuerySchema,
  type PerformanceSettings,
  type PerformanceSettingsInput,
  type PerformanceView,
  RANKING_METRICS,
  type RankingMetric,
  type RankingRow,
  type SuperTaskNotices,
  type TargetMetric,
  type WorkPerson,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { RevenueRecordsService } from '../crm/revenue-records.service';
import { branchUserIds, type NodeAccess, resolveOrganisation } from '../workspaces/access';
import { assertAction, callerOf, peopleIn, refOf } from '../workspace-work/hierarchy';
import { Measures } from '../workspace-work/measures';
import { addDays, dayStart, localDay, weekday } from './calendar';

const FEATURE = 'sales_target_management' as const;
const r1 = (n: number) => Math.round(n * 10) / 10;

interface Window {
  start: Date;
  end: Date;
  first: string;
  last: string;
}

interface Entrant {
  kind: 'MANAGER' | 'EXECUTIVE';
  node: NodeAccess;
  people: WorkPerson[];
  users: string[];
}

/** The period `offset` steps back from the one holding `today`, in the organisation's time zone. */
export function windowOf(kind: PerformancePeriod, offset: number, today: string, tz: string): Window {
  let first: string;
  let last: string;
  if (kind === 'WEEK') {
    first = addDays(addDays(today, 1 - weekday(today)), 7 * offset);
    last = addDays(first, 6);
  } else {
    const [y, m] = today.split('-').map(Number) as [number, number];
    const span = kind === 'MONTH' ? 1 : 3;
    const startMonth = kind === 'MONTH' ? m - 1 : Math.floor((m - 1) / 3) * 3;
    const s = new Date(Date.UTC(y, startMonth + span * offset, 1));
    const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + span, 0));
    first = s.toISOString().slice(0, 10);
    last = e.toISOString().slice(0, 10);
  }
  return { first, last, start: dayStart(first, tz), end: dayStart(addDays(last, 1), tz) };
}

/** Standard competition ranking: equal scores share a rank, the next rank skips. */
function rankOf<T extends { score: number; name: string }>(rows: T[]): Map<T, number> {
  const sorted = [...rows].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const out = new Map<T, number>();
  let last = Number.NaN;
  let rank = 0;
  sorted.forEach((r, i) => {
    if (r.score !== last) rank = i + 1;
    last = r.score;
    out.set(r, rank);
  });
  return out;
}

/**
 * Performance ranking (ADR 0096): the Super Workspace ranks its managers (each with its whole team) and every
 * executive; a manager ranks its own executives and sees its own standing, and the other managers when the Super
 * Workspace allows it; an executive sees their own figures and, when allowed, their place in the team.
 */
@Injectable()
export class PerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly revenue: RevenueRecordsService,
  ) {}

  private async load(tx: TenantTx, tenantId: string) {
    const row = await tx.performanceSettings.findUnique({ where: { tenantId } });
    const stored = (row?.weights ?? {}) as Partial<Record<RankingMetric, number>>;
    const weights = Object.fromEntries(RANKING_METRICS.map((m) => [m, typeof stored[m] === 'number' ? stored[m]! : row ? 0 : DEFAULT_RANKING_WEIGHTS[m]])) as Record<RankingMetric, number>;
    return { row, weights, showTeamPosition: row?.showTeamPosition ?? true, superTaskNotices: (row?.superTaskNotices ?? 'ALL') as SuperTaskNotices };
  }

  settings(auth: AuthContext): Promise<PerformanceSettings> {
    return this.prisma.run(auth, async (tx) => {
      const s = await this.load(tx, auth.tenantId);
      const by = s.row?.updatedById ? await tx.user.findUnique({ where: { id: s.row.updatedById }, select: { id: true, name: true } }) : null;
      return { weights: s.weights, showTeamPosition: s.showTeamPosition, superTaskNotices: s.superTaskNotices, updatedAt: s.row?.updatedAt.toISOString() ?? null, updatedBy: by };
    });
  }

  async save(auth: AuthContext, input: PerformanceSettingsInput, meta: RequestMeta): Promise<PerformanceSettings> {
    await this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      if (me.level !== 'SUPER') throw new ForbiddenException({ code: 'WORKSPACE_ADMIN_FORBIDDEN', message: 'Only the Super Workspace sets how rankings are worked out.' });
      const before = await this.load(tx, auth.tenantId);
      const weights = Object.fromEntries(RANKING_METRICS.map((m) => [m, input.weights[m] ?? 0]));
      const data = { weights, showTeamPosition: input.showTeamPosition, superTaskNotices: input.superTaskNotices, updatedById: auth.userId };
      await tx.performanceSettings.upsert({ where: { tenantId: auth.tenantId }, create: { tenantId: auth.tenantId, ...data }, update: data });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'performance.settings_updated', entityType: 'performance_settings', entityId: auth.tenantId,
        metadata: { weightsFrom: before.weights, weightsTo: weights, showTeamPosition: input.showTeamPosition, superTaskNotices: input.superTaskNotices }, meta,
      });
    });
    return this.settings(auth);
  }

  view(auth: AuthContext, query: PerformanceQuery): Promise<PerformanceView> {
    const q = performanceQuerySchema.parse(query);
    return this.prisma.run(auth, async (tx) => {
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      assertAction(me, FEATURE, 'view');
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { name: true, defaultTimezone: true, defaultCurrency: true } });
      const tz = tenant.defaultTimezone || 'UTC';
      const today = localDay(new Date(), tz);
      const now = windowOf(q.period, q.offset, today, tz);
      const before = windowOf(q.period, q.offset - 1, today, tz);
      const s = await this.load(tx, auth.tenantId);
      const method = RANKING_METRICS.filter((m) => s.weights[m] > 0).map((m) => ({ metric: m, weight: s.weights[m], relative: !PERCENT_RANKING_METRICS.has(m) }));
      if (method.some((m) => m.metric === 'REVENUE' || m.metric === 'DEALS_WON')) await this.revenue.reconcile(tx, auth.tenantId);

      // Who is ranked: every live Manager Workspace (with its whole team) and every live Executive Workspace.
      const live = [...org.byId.values()].filter((a) => !a.node.archivedAt && a !== org.root);
      const entrants: Entrant[] = [];
      for (const a of live) {
        if (a.level !== 'MANAGER' && a.level !== 'EXECUTIVE') continue;
        const users = await branchUserIds(tx, auth.tenantId, a.node.id, { below: a.level === 'MANAGER' });
        entrants.push({ kind: a.level, node: a, people: await peopleIn(tx, auth.tenantId, a, org), users });
      }
      const measures = new Measures(tx, auth.tenantId);
      const managers = entrants.filter((e) => e.kind === 'MANAGER');
      const myExecs = me.level === 'SUPER' ? entrants.filter((e) => e.kind === 'EXECUTIVE') : entrants.filter((e) => e.kind === 'EXECUTIVE' && e.node.node.parentId === (me.level === 'MANAGER' ? me.node.id : me.node.parentId));

      const score = async (group: Entrant[], w: Window) => {
        const values = new Map<Entrant, Partial<Record<RankingMetric, number | null>>>();
        for (const e of group) values.set(e, await this.values(tx, auth.tenantId, measures, e, w, method.map((m) => m.metric)));
        const best = new Map<RankingMetric, number>();
        for (const m of method) best.set(m.metric, Math.max(0, ...group.map((e) => values.get(e)![m.metric] ?? 0)));
        const rows = group.map((e) => {
          const v = values.get(e)!;
          const shares: Partial<Record<RankingMetric, number | null>> = {};
          let sum = 0;
          let weight = 0;
          for (const m of method) {
            const value = v[m.metric];
            if (value === null || value === undefined) {
              shares[m.metric] = null;
              continue;
            }
            const share = m.relative ? (best.get(m.metric)! > 0 ? value / best.get(m.metric)! : 0) : Math.min(1, value / 100);
            shares[m.metric] = Math.round(share * 1000) / 1000;
            sum += share * m.weight;
            weight += m.weight;
          }
          return { e, values: v, shares, score: weight > 0 ? r1((sum / weight) * 100) : 0, name: e.node.node.name };
        });
        return { rows, ranks: rankOf(rows) };
      };

      const rowsFor = async (group: Entrant[], keep: (e: Entrant) => boolean): Promise<RankingRow[]> => {
        if (!group.length) return [];
        const cur = await score(group, now);
        const prev = await score(group, before);
        // A previous period where nobody scored anything is not a ranking: no place to compare with.
        const prevOf = prev.rows.some((r) => r.score > 0) ? new Map(prev.rows.map((r) => [r.e, r])) : new Map<Entrant, (typeof prev.rows)[number]>();
        return cur.rows
          .filter((r) => keep(r.e))
          .map((r) => ({
            rank: cur.ranks.get(r)!,
            previousRank: prevOf.has(r.e) ? (prev.ranks.get(prevOf.get(r.e)!) ?? null) : null,
            kind: r.e.kind,
            people: r.e.people,
            workspace: refOf(r.e.node, org, tenant.name),
            teamSize: r.e.users.length,
            values: r.values,
            shares: r.shares,
            score: r.score,
            previousScore: prevOf.get(r.e)?.score ?? null,
            me: r.e.node.node.id === me.node.id,
          }))
          .sort((a, b) => a.rank - b.rank || a.workspace.name.localeCompare(b.workspace.name));
      };

      const seeManagers = me.level === 'SUPER' || (me.level === 'MANAGER' && me.node.canViewOtherManagers);
      const isMe = (e: Entrant) => e.node.node.id === me.node.id;
      const managerRows = me.level === 'EXECUTIVE' ? [] : await rowsFor(managers, (e) => seeManagers || isMe(e));
      // An executive sees only their own row; with the Super setting on, its rank among the team is real.
      const execRows = me.level === 'EXECUTIVE' ? await rowsFor(s.showTeamPosition ? myExecs : myExecs.filter(isMe), isMe) : await rowsFor(myExecs, () => true);
      return {
        period: { kind: q.period, offset: q.offset, startsOn: now.first, endsOn: now.last, previousStartsOn: before.first, previousEndsOn: before.last },
        rankedAmong: { managers: managers.length, executives: me.level === 'EXECUTIVE' && !s.showTeamPosition ? 1 : myExecs.length },
        method,
        managers: managerRows,
        executives: execRows,
        scope: me.level === 'SUPER' ? 'ORGANISATION' : me.level === 'MANAGER' ? 'TEAM' : 'SELF',
        currency: tenant.defaultCurrency,
        canConfigure: me.level === 'SUPER',
        showTeamPosition: s.showTeamPosition,
      };
    });
  }

  /** The figures of one entrant in one window: counts and money from the records, target achievement and task completion. */
  private async values(tx: TenantTx, tenantId: string, measures: Measures, e: Entrant, w: Window, metrics: RankingMetric[]): Promise<Partial<Record<RankingMetric, number | null>>> {
    const out: Partial<Record<RankingMetric, number | null>> = {};
    for (const m of metrics) {
      if (m === 'TARGET_ACHIEVEMENT') {
        // Targets of the entrant's own workspace that overlap the window, each counted over its own period.
        const targets = await tx.workspaceTarget.findMany({ where: { tenantId, workspaceNodeId: e.node.node.id, archivedAt: null, startsAt: { lt: w.end }, endsAt: { gt: w.start } }, take: 50 });
        if (!targets.length) {
          out[m] = null;
          continue;
        }
        let sum = 0;
        for (const t of targets) sum += Math.min(100, t.amount > 0 ? ((await measures.count(t.metric as TargetMetric, e.users, t.startsAt, t.endsAt)) / t.amount) * 100 : 0);
        out[m] = r1(sum / targets.length);
      } else if (m === 'TASK_COMPLETION') {
        const finished = await tx.taskPlanInstance.groupBy({
          by: ['status'],
          where: { tenantId, userId: { in: e.users }, endsAt: { gt: w.start, lte: w.end }, status: { in: ['COMPLETED', 'PARTIALLY_COMPLETED', 'NOT_COMPLETED'] } },
          _count: { _all: true },
        });
        const total = finished.reduce((a, f) => a + f._count._all, 0);
        const done = finished.find((f) => f.status === 'COMPLETED')?._count._all ?? 0;
        out[m] = total ? r1((done / total) * 100) : null;
      } else {
        out[m] = await measures.count(m, e.users, w.start, w.end);
      }
    }
    return out;
  }
}

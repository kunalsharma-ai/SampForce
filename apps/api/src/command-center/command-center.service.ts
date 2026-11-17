import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma, TenantTx } from '@dealflow/database';
import {
  type CommandCenterContext,
  type CommandCenterLayout,
  commandCenterLayoutSchema,
  type CommandCenterQuery,
  type CommandCenterView,
  type DashboardTier,
  type DrillQuery,
  type DrillResult,
  type ExecutiveDashboard,
  type KpiCard,
  localToday,
  monthsOf,
  type PeriodRange,
  periodRange,
  type PeriodRevenue,
  type PersonRef,
  type ReportPeriod,
  type RevenueLine,
  safeZone,
  targetFor,
  type WorkBucket,
  type WorkItem,
  WORK_SECTIONS,
  zonedMidnight,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { entitlementsFor } from '../billing/entitlements';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { managementChain } from '../crm/lead-transfers.service';
import { RevenueRecordsService } from '../crm/revenue-records.service';
import { personRefs, reportingTree, scopeOf, visibility } from '../crm/visibility';
import { loadRates } from '../revenue/fx';
import { Metrics, r2, type Scope } from './metrics';

const REVENUE_PERIODS: ReportPeriod[] = ['this_month', 'last_month', 'this_quarter', 'last_quarter', 'h1', 'h2', 'this_year', 'last_year'];
const WORK_TAKE = 8;

export interface Ctx {
  tx: TenantTx;
  auth: AuthContext;
  tz: string;
  now: Date;
  range: PeriodRange;
  base: string;
  metrics: (users: string[] | null, range?: PeriodRange) => Metrics;
  features: Set<string>;
}

/**
 * The role-based Command Center (ADR 0063): which dashboards a person sees, the Executive dashboard, the records
 * behind each number, and each person's own layout. The Manager and Senior dashboards build on the same metrics.
 */
@Injectable()
export class CommandCenterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly revenue: RevenueRecordsService,
  ) {}

  /** Opens a read with everything the dashboards share: the period, the currency and rates, and fresh revenue records. */
  async withCtx<T>(auth: AuthContext, q: CommandCenterQuery, fn: (c: Ctx) => Promise<T>): Promise<T> {
    return this.prisma.run(auth, async (tx) => {
      await this.revenue.reconcile(tx, auth.tenantId);
      const tz = safeZone(q.tz);
      const now = new Date();
      const range = periodRange(q.period, { tz, now, from: q.from, to: q.to, fyStart: q.fyStart });
      const [tenant, rates, ent] = await Promise.all([
        tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { defaultCurrency: true } }),
        loadRates(tx, auth.tenantId),
        entitlementsFor(tx, auth.tenantId),
      ]);
      const today = localToday(now, tz);
      const todayStart = zonedMidnight(today.y, today.m, today.d, tz);
      const tomorrowStart = zonedMidnight(today.y, today.m, today.d + 1, tz);
      const metrics = (users: string[] | null, r: PeriodRange = range) => {
        const s: Scope = { tenantId: auth.tenantId, users, start: new Date(r.start), end: new Date(r.end), now, todayStart, tomorrowStart };
        return new Metrics(tx, s, tenant.defaultCurrency, rates);
      };
      return fn({ tx, auth, tz, now, range, base: tenant.defaultCurrency, metrics, features: new Set(ent.features) });
    });
  }

  // ─── Who sees what ───

  async tierOf(tx: TenantTx, auth: AuthContext): Promise<{ tier: DashboardTier; source: 'designation' | 'role'; designation: string | null; departmentId: string | null; reportingManagerId: string | null }> {
    const m = await tx.membership.findFirst({ where: { tenantId: auth.tenantId, userId: auth.userId }, select: { designationId: true, departmentId: true, reportingManagerId: true } });
    const d = m?.designationId ? await tx.designation.findFirst({ where: { tenantId: auth.tenantId, id: m.designationId }, select: { name: true, tier: true } }) : null;
    if (d && ['EXECUTIVE', 'MANAGER', 'SENIOR'].includes(d.tier)) return { tier: d.tier as DashboardTier, source: 'designation', designation: d.name, departmentId: m?.departmentId ?? null, reportingManagerId: m?.reportingManagerId ?? null };
    const tier: DashboardTier = auth.roleKey === 'owner' || auth.roleKey === 'admin' ? 'SENIOR' : auth.roleKey === 'manager' ? 'MANAGER' : 'EXECUTIVE';
    return { tier, source: 'role', designation: d?.name ?? null, departmentId: m?.departmentId ?? null, reportingManagerId: m?.reportingManagerId ?? null };
  }

  context(auth: AuthContext): Promise<CommandCenterContext> {
    return this.prisma.run(auth, async (tx) => {
      const t = await this.tierOf(tx, auth);
      const [ent, tenant, dept, people, reports] = await Promise.all([
        entitlementsFor(tx, auth.tenantId),
        tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { defaultCurrency: true } }),
        t.departmentId ? tx.department.findFirst({ where: { tenantId: auth.tenantId, id: t.departmentId }, select: { name: true } }) : Promise.resolve(null),
        personRefs(tx, auth.tenantId, [t.reportingManagerId]),
        this.reportsOf(tx, auth),
      ]);
      const features = new Set<string>(ent.features);
      const views: CommandCenterView[] = [];
      if (t.tier === 'SENIOR' && features.has('senior_dashboard')) views.push('senior');
      if (t.tier !== 'EXECUTIVE' && features.has('manager_dashboard')) views.push('manager');
      views.push('executive', 'analytics');
      const reportRefs = await personRefs(tx, auth.tenantId, reports);
      return {
        tier: t.tier,
        tierSource: t.source,
        designation: t.designation,
        department: dept?.name ?? null,
        reportingManager: t.reportingManagerId ? (people.get(t.reportingManagerId) ?? null) : null,
        views,
        defaultView: views[0]!,
        recordScope: scopeOf(auth),
        reports: [...reportRefs.values()].sort((a, b) => a.name.localeCompare(b.name)),
        currency: tenant.defaultCurrency,
        canSetTargets: auth.permissions.includes('pipelines:manage'),
      };
    });
  }

  /** Everyone below the caller in the reporting lines that their record visibility reaches (none for OWN). */
  async reportsOf(tx: TenantTx, auth: AuthContext): Promise<string[]> {
    const scope = scopeOf(auth);
    if (scope === 'OWN') return [];
    return reportingTree(tx, auth.tenantId, auth.userId);
  }

  /**
   * A manager's team: the manager and everyone reporting to them, directly or further down, limited to the people
   * the caller's record visibility reaches (the caller alone when their role shows only their own records).
   */
  async teamOf(tx: TenantTx, auth: AuthContext, managerId: string): Promise<string[]> {
    if (scopeOf(auth) === 'OWN') return managerId === auth.userId ? [auth.userId] : [managerId];
    const v = await visibility(tx, auth);
    const tree = await reportingTree(tx, auth.tenantId, managerId);
    return [managerId, ...(v.all ? tree : tree.filter((u) => v.userIds.includes(u)))];
  }

  /** The person whose Executive dashboard is asked for: the caller, or someone their visibility reaches. */
  async subject(tx: TenantTx, auth: AuthContext, userId: string | undefined): Promise<string> {
    if (!userId || userId === auth.userId) return auth.userId;
    const v = await visibility(tx, auth);
    if (!v.all && !v.userIds.includes(userId)) throw new ForbiddenException({ code: 'NOT_YOUR_REPORT', message: 'You can open the dashboards of people who report to you only.' });
    if (!(await tx.membership.findFirst({ where: { tenantId: auth.tenantId, userId }, select: { id: true } }))) throw new ForbiddenException({ code: 'NOT_YOUR_REPORT', message: 'You can open the dashboards of people who report to you only.' });
    return userId;
  }

  /** The people a scope covers: one person, the caller's team (reports), or the organisation (null = everyone). */
  async usersFor(tx: TenantTx, auth: AuthContext, scope: 'me' | 'team' | 'org', userId?: string, departmentId?: string): Promise<string[] | null> {
    if (scope === 'me') return [await this.subject(tx, auth, userId)];
    if (scope === 'team') return this.teamOf(tx, auth, await this.subject(tx, auth, userId));
    const v = await visibility(tx, auth);
    let users: string[] | null = v.all ? null : v.userIds;
    if (departmentId) {
      const inDept = (await tx.membership.findMany({ where: { tenantId: auth.tenantId, departmentId }, select: { userId: true } })).map((m) => m.userId);
      users = users ? users.filter((u) => inDept.includes(u)) : inDept;
    }
    if (userId) users = [await this.subject(tx, auth, userId)];
    return users;
  }

  // ─── Executive dashboard ───

  executive(auth: AuthContext, q: CommandCenterQuery): Promise<ExecutiveDashboard> {
    return this.withCtx(auth, q, async (c) => {
      const { tx } = c;
      const me = await this.subject(tx, auth, q.userId);
      const m = c.metrics([me]);
      const [person, membership, layout] = await Promise.all([
        personRefs(tx, auth.tenantId, [me]),
        tx.membership.findFirst({ where: { tenantId: auth.tenantId, userId: me }, select: { departmentId: true, reportingManagerId: true } }),
        this.layoutRow(tx, auth.tenantId, me, 'EXECUTIVE'),
      ]);
      const [dept, managerRef] = await Promise.all([
        membership?.departmentId ? tx.department.findFirst({ where: { tenantId: auth.tenantId, id: membership.departmentId }, select: { name: true } }) : Promise.resolve(null),
        personRefs(tx, auth.tenantId, [membership?.reportingManagerId]),
      ]);
      const revenueOn = c.features.has('revenue_attribution');
      const transfersOn = c.features.has('lead_transfers');

      const kpis = await this.personKpis(c, m, { transfers: transfersOn, revenue: revenueOn });
      const work = await this.work(c, me, layout);
      const funnel = (await m.funnel()).rows;

      // Business performance: leads by calendar period, RFQs and revenue in the chosen period, target achievement.
      const p = (period: ReportPeriod) => periodRange(period, { tz: c.tz, now: c.now });
      const leadCount = (period: ReportPeriod) => { const r = p(period); return m.leadsBetween(new Date(r.start), new Date(r.end)); };
      const half = c.now.getUTCMonth() < 6 ? 'h1' : 'h2';
      const [lm, lq, lh, ly] = await Promise.all([leadCount('this_month'), leadCount('this_quarter'), leadCount(half), leadCount('this_year')]);
      const rev = await m.revenue();
      const targets = await this.targetMap(tx, auth.tenantId, me);
      const target = targetFor(monthsOf(c.range), targets);
      const monthRange = p('this_month');
      const monthRevenue = c.range.period === 'this_month' ? rev.amount : (await c.metrics([me], monthRange).revenue()).amount;
      const monthTarget = targetFor(monthsOf(monthRange), targets);
      const [won, lost, created] = await Promise.all([m.rfqsDecided('WON'), m.rfqsDecided('LOST'), m.leadsGenerated()]);
      const converted = created.length
        ? await tx.revenueRecord.findMany({ where: { tenantId: auth.tenantId, voidedAt: null, companyId: { in: created } }, select: { companyId: true }, distinct: ['companyId'] })
        : [];

      let revenue: ExecutiveDashboard['revenue'] = null;
      if (revenueOn) {
        const periods: PeriodRevenue[] = [];
        for (const period of [...REVENUE_PERIODS, ...(REVENUE_PERIODS.includes(c.range.period) ? [] : [c.range.period])]) {
          const r = period === c.range.period ? rev : await c.metrics([me], period === 'custom' ? c.range : p(period)).revenue();
          periods.push({ period, amount: r.amount, dealValue: r.dealValue, deals: r.deals });
        }
        const lines = (await this.revenue.rows(tx, auth.tenantId, rev.records, null, [me])).map(({ credits: _c, manual: _m, paymentStatus: _p, ...line }) => line as RevenueLine);
        revenue = { periods, lines: lines.sort((a, b) => b.closedAt.localeCompare(a.closedAt)), unconverted: rev.unconverted };
      }

      const pr = person.get(me)!;
      return {
        person: { ...pr, department: dept?.name ?? null, reportingManager: membership?.reportingManagerId ? (managerRef.get(membership.reportingManagerId) ?? null) : null, avatarUrl: null },
        range: c.range,
        currency: c.base,
        month: { target: monthTarget, achieved: monthRevenue, percent: monthTarget ? Math.round((monthRevenue / monthTarget) * 1000) / 10 : null },
        kpis,
        work,
        funnel,
        performance: {
          leads: { month: lm, quarter: lq, half: lh, year: ly },
          rfqsReceived: (await m.rfqsReceived()).length,
          rfqsSubmitted: (await m.rfqsSubmitted()).length,
          rfqsWon: won.length,
          revenue: rev.amount,
          target,
          achievement: target ? Math.round((rev.amount / target) * 1000) / 10 : null,
          rfqWinRate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 1000) / 10 : null,
          leadConversion: created.length ? Math.round((converted.length / created.length) * 1000) / 10 : null,
          averageDealValue: rev.deals ? r2(rev.dealValue / rev.deals) : null,
        },
        revenue,
        features: { revenueAttribution: revenueOn, leadTransfers: transfersOn, instructions: c.features.has('instructions'), clientConcerns: c.features.has('client_concerns') },
        layout,
        generatedAt: c.now.toISOString(),
      };
    });
  }

  /** The fifteen cards of section 11.2, for one person or a group (team, organisation). */
  async personKpis(c: Ctx, m: Metrics, on: { transfers: boolean; revenue: boolean }): Promise<KpiCard[]> {
    const [leads, active, contacted, sent, responses, positive, today, overdue, rfqIn, rfqOut, converted, rejected, concerns, transfers, rev] = await Promise.all([
      m.leadsGenerated(), m.activeCompanies(), m.employeesContacted(), m.emailsSent(), m.responses(), m.positiveResponses(), m.followUpsToday(), m.followUpsOverdue(),
      m.rfqsReceived(), m.rfqsSubmitted(), m.clientsConverted(), m.clientsRejected(), m.clientConcerns(), on.transfers ? m.transfersToSenior() : Promise.resolve([]), on.revenue ? m.revenue() : Promise.resolve(null),
    ]);
    const k = (key: KpiCard['key'], value: number, format: KpiCard['format'] = 'number'): KpiCard => ({ key, value, format });
    return [
      k('leadsGenerated', leads.length),
      k('activeCompanies', active.length),
      k('employeesContacted', contacted.length),
      k('emailsSent', sent.logged.length + sent.synced.length),
      k('responses', responses.logged.length + responses.synced.length),
      k('positiveResponses', positive.length),
      k('followUpsToday', today.length),
      k('followUpsOverdue', overdue.length),
      k('rfqsReceived', rfqIn.length),
      k('rfqsSubmitted', rfqOut.length),
      k('clientsConverted', converted.length),
      k('clientsRejected', rejected.length),
      k('clientConcerns', concerns.length),
      ...(on.transfers ? [k('transfersToSenior', transfers.length)] : []),
      ...(rev ? [k('revenue', rev.amount, 'currency')] : []),
    ];
  }

  private async work(c: Ctx, me: string, layout: CommandCenterLayout | null): Promise<WorkBucket[]> {
    const { tx } = c;
    const t = c.auth.tenantId;
    const s = c.metrics([me]).s;
    const open = { tenantId: t, deletedAt: null, status: 'OPEN' as const, assigneeId: me };
    const week = new Date(c.now.getTime() + 7 * 86_400_000);
    const fortnight = new Date(c.now.getTime() + 14 * 86_400_000);
    const chain = await managementChain(tx, t, me);
    const taskSel = { id: true, title: true, dueAt: true, priority: true, companyId: true, followUpType: true, createdById: true, reassignedFromId: true } as const;
    type T = Prisma.TaskGetPayload<{ select: typeof taskSel }>;
    const taskBucket = async (id: string, where: Prisma.TaskWhereInput, from?: (x: T) => string | null): Promise<WorkBucket> => {
      const [rows, total] = await Promise.all([tx.task.findMany({ where, select: taskSel, orderBy: [{ dueAt: 'asc' }], take: WORK_TAKE }), tx.task.count({ where })]);
      const people = await personRefs(tx, t, rows.map((r) => from?.(r)));
      return {
        id, label: null, total,
        items: rows.map((r): WorkItem => ({
          kind: r.followUpType ? 'followUp' : 'task', id: r.id, title: r.title, subtitle: r.followUpType, href: r.companyId ? `/app/companies/${r.companyId}?tab=follow-ups` : '/app/follow-ups',
          at: r.dueAt?.toISOString() ?? null, priority: r.priority, overdue: !!r.dueAt && r.dueAt < c.now, from: from?.(r) ? (people.get(from(r)!) ?? null) : null,
        })),
      };
    };
    const buckets: Record<string, () => Promise<WorkBucket>> = {
      today: () => taskBucket('today', { ...open, dueAt: { gte: s.todayStart, lt: s.tomorrowStart } }),
      pending: () => taskBucket('pending', { ...open, followUpType: { not: null }, OR: [{ dueAt: { gte: c.now } }, { dueAt: null }, { dueAt: { isSet: false } }] }),
      overdue: () => taskBucket('overdue', { ...open, dueAt: { lt: c.now } }),
      calls: () => taskBucket('calls', { ...open, followUpType: 'CALL', dueAt: { gte: c.now, lt: week } }),
      meetings: () => taskBucket('meetings', { ...open, followUpType: 'MEETING', dueAt: { gte: c.now, lt: fortnight } }),
      fromManager: () => taskBucket('fromManager', { ...open, createdById: { in: chain.length ? chain : ['-'] } }, (x) => x.createdById),
      reassigned: () => taskBucket('reassigned', { ...open, reassignedFromId: { not: null }, NOT: { reassignedFromId: me } }, (x) => x.reassignedFromId),
      rfqDeadlines: async () => {
        const where: Prisma.RfqWhereInput = { tenantId: t, deletedAt: null, ownerId: me, status: { in: ['RECEIVED', 'UNDER_EVALUATION', 'PRICING', 'ON_HOLD'] }, deadlineAt: { lt: fortnight, not: null } };
        const [rows, total] = await Promise.all([tx.rfq.findMany({ where, orderBy: { deadlineAt: 'asc' }, take: WORK_TAKE, select: { id: true, number: true, projectName: true, deadlineAt: true } }), tx.rfq.count({ where })]);
        return { id: 'rfqDeadlines', label: null, total, items: rows.map((r): WorkItem => ({ kind: 'rfq', id: r.id, title: `${r.number} ${r.projectName}`, subtitle: null, href: `/app/rfqs?open=${r.id}`, at: r.deadlineAt?.toISOString() ?? null, priority: null, overdue: !!r.deadlineAt && r.deadlineAt < c.now, from: null })) };
      },
      concerns: async () => {
        const mine = (await tx.company.findMany({ where: { tenantId: t, deletedAt: null, ownerId: me }, select: { id: true } })).map((x) => x.id);
        const where: Prisma.EscalationWhereInput = { tenantId: t, status: { not: 'RESOLVED' }, OR: [{ ownerId: me }, ...(mine.length ? [{ companyId: { in: mine } }] : [])] };
        const [rows, total] = await Promise.all([tx.escalation.findMany({ where, orderBy: { createdAt: 'asc' }, take: WORK_TAKE, select: { id: true, title: true, severity: true, companyId: true, createdAt: true } }), tx.escalation.count({ where })]);
        return { id: 'concerns', label: null, total, items: rows.map((r): WorkItem => ({ kind: 'concern', id: r.id, title: r.title, subtitle: r.severity, href: `/app/companies/${r.companyId}`, at: r.createdAt.toISOString(), priority: r.severity, overdue: false, from: null })) };
      },
      awaiting: async () => {
        // Employees whose latest logged interaction from this person is an email sent, with no reply logged or synced since.
        const since = new Date(c.now.getTime() - 60 * 86_400_000);
        const acts = await tx.activity.findMany({ where: { tenantId: t, deletedAt: null, ownerId: me, contactId: { not: null }, occurredAt: { gte: since } }, select: { contactId: true, interaction: true, type: true, occurredAt: true, subject: true, companyId: true }, orderBy: { occurredAt: 'desc' }, take: 5000 });
        const latest = new Map<string, (typeof acts)[number]>();
        for (const a of acts) if (!latest.has(a.contactId!)) latest.set(a.contactId!, a);
        const waiting = [...latest.values()].filter((a) => a.interaction === 'EMAIL_SENT' || (!a.interaction && a.type === 'EMAIL'));
        const replied = waiting.length
          ? new Set((await tx.emailMessage.findMany({ where: { tenantId: t, direction: 'INBOUND', contactId: { in: waiting.map((w) => w.contactId!) }, sentAt: { gte: since } }, select: { contactId: true, sentAt: true } })).filter((e) => e.sentAt > (latest.get(e.contactId!)?.occurredAt ?? c.now)).map((e) => e.contactId))
          : new Set<string | null>();
        const rows = waiting.filter((w) => !replied.has(w.contactId)).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
        const contacts = new Map((await tx.contact.findMany({ where: { tenantId: t, id: { in: rows.slice(0, WORK_TAKE).map((r) => r.contactId!) } }, select: { id: true, firstName: true, lastName: true } })).map((x) => [x.id, [x.firstName, x.lastName].filter(Boolean).join(' ')]));
        return {
          id: 'awaiting', label: null, total: rows.length,
          items: rows.slice(0, WORK_TAKE).map((r): WorkItem => ({ kind: 'contact', id: r.contactId!, title: contacts.get(r.contactId!) ?? '', subtitle: r.subject, href: `/app/contacts/${r.contactId}`, at: r.occurredAt.toISOString(), priority: null, overdue: false, from: null })),
        };
      },
    };
    const out: WorkBucket[] = [];
    const order = layout?.workSections?.length ? [...layout.workSections.map((w) => w.id), ...WORK_SECTIONS.filter((id) => !layout.workSections.some((w) => w.id === id))] : [...WORK_SECTIONS];
    const hidden = new Set((layout?.workSections ?? []).filter((w) => w.hidden).map((w) => w.id));
    for (const id of order) {
      if (hidden.has(id)) continue;
      if (buckets[id]) out.push(await buckets[id]());
      const cat = layout?.categories.find((x) => `cat:${x.id}` === id);
      if (cat) {
        const b = await taskBucket(id, { ...open, followUpType: cat.followUpType ? cat.followUpType : { not: null }, ...(cat.priority ? { priority: cat.priority } : {}) });
        out.push({ ...b, label: cat.label });
      }
    }
    // Categories never placed in the order yet go last.
    for (const cat of layout?.categories ?? []) {
      const id = `cat:${cat.id}`;
      if (order.includes(id) || hidden.has(id)) continue;
      const b = await taskBucket(id, { ...open, followUpType: cat.followUpType ? cat.followUpType : { not: null }, ...(cat.priority ? { priority: cat.priority } : {}) });
      out.push({ ...b, label: cat.label });
    }
    return out;
  }

  // ─── Drill-down ───

  drill(auth: AuthContext, q: DrillQuery): Promise<DrillResult> {
    return this.withCtx(auth, q, async (c) => {
      if (q.scope === 'team' && !c.features.has('manager_dashboard')) throw new ForbiddenException({ code: 'FEATURE_NOT_IN_PLAN', message: 'Your plan does not include the manager dashboard.' });
      if (q.scope === 'org' && !c.features.has('senior_dashboard')) throw new ForbiddenException({ code: 'FEATURE_NOT_IN_PLAN', message: 'Your plan does not include the senior management dashboard.' });
      const users = await this.usersFor(c.tx, auth, q.scope, q.userId, q.departmentId);
      const r = await c.metrics(users).rows(q.metric);
      return { metric: q.metric, rows: r.rows, total: r.total };
    });
  }

  // ─── Layouts and targets ───

  async layoutRow(tx: TenantTx, tenantId: string, userId: string, tier: DashboardTier): Promise<CommandCenterLayout | null> {
    const row = await tx.commandCenterLayout.findFirst({ where: { tenantId, userId, tier } });
    const parsed = row ? commandCenterLayoutSchema.safeParse(row.layout) : null;
    return parsed?.success ? parsed.data : null;
  }

  layout(auth: AuthContext, tier: DashboardTier): Promise<CommandCenterLayout | null> {
    return this.prisma.run(auth, (tx) => this.layoutRow(tx, auth.tenantId, auth.userId, tier));
  }

  saveLayout(auth: AuthContext, tier: DashboardTier, layout: CommandCenterLayout | null): Promise<CommandCenterLayout | null> {
    return this.prisma.run(auth, async (tx) => {
      const existing = await tx.commandCenterLayout.findFirst({ where: { tenantId: auth.tenantId, userId: auth.userId, tier } });
      if (!layout) {
        if (existing) await tx.commandCenterLayout.delete({ where: { id: existing.id } });
        return null;
      }
      const data = layout as unknown as Prisma.InputJsonValue;
      if (existing) await tx.commandCenterLayout.update({ where: { id: existing.id }, data: { layout: data } });
      else await tx.commandCenterLayout.create({ data: { tenantId: auth.tenantId, userId: auth.userId, tier, layout: data } });
      return layout;
    });
  }

  async targetMap(tx: TenantTx, tenantId: string, userId: string | null): Promise<Map<string, number>> {
    const rows = await tx.salesTarget.findMany({ where: { tenantId, userId }, select: { period: true, amount: true } });
    return new Map(rows.map((r) => [r.period, Number(r.amount)]));
  }

  /** Sets a person's (or the workspace's, userId null) target for a month, quarter or year. */
  setTarget(auth: AuthContext, input: { period: string; userId: string | null; amount: number }, meta: RequestMeta): Promise<{ id: string }> {
    return this.prisma.run(auth, async (tx) => {
      if (input.userId) {
        const v = await visibility(tx, auth);
        if (!v.all && !v.userIds.includes(input.userId)) throw new ForbiddenException({ code: 'NOT_YOUR_REPORT', message: 'You can open the dashboards of people who report to you only.' });
      } else if (scopeOf(auth) !== 'ALL') throw new ForbiddenException({ code: 'NOT_YOUR_REPORT', message: 'You can open the dashboards of people who report to you only.' });
      const existing = await tx.salesTarget.findFirst({ where: { tenantId: auth.tenantId, period: input.period, userId: input.userId } });
      const row = existing
        ? await tx.salesTarget.update({ where: { id: existing.id }, data: { amount: input.amount } })
        : await tx.salesTarget.create({ data: { tenantId: auth.tenantId, period: input.period, userId: input.userId, amount: input.amount } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'sales_target.set', entityType: 'sales_target', entityId: row.id, metadata: { ...input, from: existing?.amount ?? null }, meta });
      return { id: row.id };
    });
  }
}

export type { PersonRef };

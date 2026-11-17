import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@dealflow/database';
import {
  type OrgInsight,
  type OrgInsightItem,
  type KpiCard,
  monthsOf,
  type OrgDepartmentRow,
  type OrgGroupTotals,
  type OrgManagerRow,
  type OrgPersonRow,
  type PersonRef,
  performanceStatus,
  periodRange,
  RANKING_MINIMUMS,
  type RankingLeader,
  ratio,
  type ReportPeriod,
  type RevenueSlice,
  type RevenueTrendPoint,
  type SeniorDashboard,
  type SeniorQuery,
  targetFor,
} from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { personRefs, visibility } from '../crm/visibility';
import { type Ctx, CommandCenterService } from './command-center.service';
import { CAP, OUTREACH_KINDS, r2, RESPONSE_KINDS } from './metrics';

const DAY = 86_400_000;
const TAKE = 8;
/** OrgInsight thresholds (ADR 0063, Phase 6). */
export const INSIGHT_RULES = {
  /** Overdue follow-ups a person holds before they are flagged. */
  overdue: 5,
  /** Leads generated in the period before a low conversion is flagged, and the share of the organisation's rate below which it is. */
  lowConversionLeads: 5,
  lowConversionShare: 0.5,
  /** RFQs from one company in the last 180 days. */
  repeatRfqs: 2,
  /** Days a deal or RFQ may sit in negotiation. */
  stuckDays: 14,
  /** Days ahead an RFQ deadline is shown. */
  deadlineDays: 7,
  /** A company with at least this many interactions in days 31-60 and under half of them in the last 30. */
  engagementBase: 3,
  /** Revenue share of the largest client, and of the three largest, that counts as concentrated. */
  topClient: 30,
  topThree: 60,
} as const;

type Ref = { id: string; name: string };
const unset = (f: string) => [{ [f]: null }, { [f]: { isSet: false } }];
const none = (id: string): PersonRef => ({ id, name: '', designation: null });

/**
 * The Senior Management dashboard (ADR 0063, spec section 13): the organisation (or the part of it the caller's
 * record visibility reaches, optionally one department) for a period. People's figures come from one pass over the
 * period's records; departments and teams add up their members, counting each company once and each person's revenue
 * share once, so no total is ever larger than the deals behind it.
 */
@Injectable()
export class SeniorDashboardService {
  constructor(private readonly cc: CommandCenterService) {}

  dashboard(auth: AuthContext, q: SeniorQuery): Promise<SeniorDashboard> {
    return this.cc.withCtx(auth, q, async (c) => {
      if (!c.features.has('senior_dashboard')) throw new ForbiddenException({ code: 'FEATURE_NOT_IN_PLAN', message: 'Your plan does not include the senior management dashboard.' });
      const { tx } = c;
      const t = auth.tenantId;
      if ((await this.cc.tierOf(tx, auth)).tier !== 'SENIOR') throw new ForbiddenException({ code: 'NOT_SENIOR', message: 'The senior management dashboard is for people with a senior management designation.' });
      const v = await visibility(tx, auth);
      const members = await tx.membership.findMany({ where: { tenantId: t, status: 'ACTIVE' }, select: { userId: true, departmentId: true, reportingManagerId: true } });
      const deptIds = [...new Set(members.map((m) => m.departmentId).filter((d): d is string => !!d))];
      const depts = await tx.department.findMany({ where: { tenantId: t, OR: [{ archivedAt: null }, { id: { in: deptIds } }] }, select: { id: true, name: true, position: true }, orderBy: [{ position: 'asc' }, { name: 'asc' }] });
      const deptOf = new Map(depts.map((d) => [d.id, { id: d.id, name: d.name }]));
      const departmentId = q.departmentId && deptOf.has(q.departmentId) ? q.departmentId : null;

      // Who the dashboard covers. `users: null` (everyone) only for the whole organisation of someone who sees it all.
      let scoped = members.filter((m) => v.all || v.userIds.includes(m.userId));
      if (departmentId) scoped = scoped.filter((m) => m.departmentId === departmentId);
      const ids = scoped.map((m) => m.userId);
      const users: string[] | null = v.all && !departmentId ? null : ids;
      const inScope = new Set(ids);
      const byUser = new Map(scoped.map((m) => [m.userId, m]));

      const [people, layout] = await Promise.all([personRefs(tx, t, [...ids, ...scoped.map((m) => m.reportingManagerId)]), this.cc.layoutRow(tx, t, auth.userId, 'SENIOR')]);
      const ref = (id: string | null | undefined) => (id ? (people.get(id) ?? none(id)) : null);
      const revenueOn = c.features.has('revenue_attribution');
      const m = c.metrics(users);

      // ─── Organisation KPIs (13.1) ───
      const [conv, companies, active, clients, converted, rfqIn, rfqOut, won, lost, open, rev, pipeline, outstanding] = await Promise.all([
        m.leadsConverted(), m.companies(), m.activeCompanies(), m.existingClients(), m.clientsConverted(), m.rfqsReceived(), m.rfqsSubmitted(),
        m.rfqsDecided('WON'), m.rfqsDecided('LOST'), m.openDeals(), m.revenue(), m.pipelineValue(), m.outstanding(),
      ]);
      const months = monthsOf(c.range);
      const orgTarget = await this.targetOf(c, ids, months, users === null);
      const achieved = revenueOn ? rev.amount : 0;
      const k = (key: KpiCard['key'], value: number | null, format: KpiCard['format'] = 'number'): KpiCard => ({ key, value, format });
      const kpis: KpiCard[] = [
        k('leadsGenerated', conv.leads.length), k('companies', companies.length), k('activeCompanies', active.length), k('existingClients', clients.length),
        k('clientsConverted', converted.length), k('rfqsReceived', rfqIn.length), k('rfqsSubmitted', rfqOut.length), k('rfqsWon', won.length), k('rfqsLost', lost.length),
        k('openOpportunities', open.length), ...(revenueOn ? [k('revenue', rev.amount, 'currency')] : []), k('pipelineValue', pipeline, 'currency'),
        ...(revenueOn ? [k('outstanding', outstanding.amount, 'currency')] : []), k('conversionRate', ratio(conv.converted.length, conv.leads.length), 'percent'),
        ...(revenueOn ? [k('targetAchievement', orgTarget ? ratio(achieved, orgTarget) : null, 'percent')] : []),
      ];

      // ─── Each person's figures, in one pass ───
      const rows = await this.personRows(c, ids, revenueOn ? rev.byUser : new Map(), conv.converted, months);
      const elapsed = this.elapsed(c);
      for (const r of rows.values()) {
        const m0 = byUser.get(r.person.id);
        r.person = ref(r.person.id) ?? r.person;
        r.department = m0?.departmentId ? (deptOf.get(m0.departmentId) ?? null) : null;
        r.manager = m0?.reportingManagerId ? ref(m0.reportingManagerId) : null;
        r.status = performanceStatus(r.achievement, elapsed, r.leads + r.touches + r.rfqsReceived + r.followUpsDone > 0 || r.business > 0);
      }
      scoreRows([...rows.values()]);

      // ─── Departments and teams (13.2) ───
      const children = new Map<string, string[]>();
      for (const mm of scoped) if (mm.reportingManagerId && inScope.has(mm.reportingManagerId)) children.set(mm.reportingManagerId, [...(children.get(mm.reportingManagerId) ?? []), mm.userId]);
      const below = (u: string) => {
        const seen = new Set<string>([u]);
        const queue = [u];
        while (queue.length) for (const n of children.get(queue.shift()!) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
        seen.delete(u);
        return [...seen];
      };
      const totals = (group: string[], target: number | null): OrgGroupTotals => {
        const rs = group.map((u) => rows.get(u)!).filter(Boolean);
        const clientsSet = new Set<string>();
        for (const r of rs) for (const id of rows.converted.get(r.person.id) ?? []) clientsSet.add(id);
        const business = r2(rs.reduce((a, r) => a + r.business, 0));
        const achievement = target ? ratio(business, target) : null;
        const touches = rs.reduce((a, r) => a + r.touches, 0);
        return {
          people: rs.length,
          leads: rs.reduce((a, r) => a + r.leads, 0),
          rfqsReceived: rs.reduce((a, r) => a + r.rfqsReceived, 0),
          rfqsWon: rs.reduce((a, r) => a + r.rfqsWon, 0),
          clientsConverted: clientsSet.size,
          business,
          target,
          achievement,
          status: performanceStatus(achievement, elapsed, rs.some((r) => r.status !== 'INACTIVE')),
          productivity: rs.length ? Math.round((touches / rs.length) * 10) / 10 : null,
        };
      };
      const sumTargets = (group: string[]) => {
        let total: number | null = null;
        for (const u of group) {
          const x = rows.get(u)?.target;
          if (x !== null && x !== undefined) total = (total ?? 0) + x;
        }
        return total === null ? null : r2(total);
      };
      const managers: OrgManagerRow[] = [...children.keys()].map((u) => {
        const team = [u, ...below(u)];
        const mm = byUser.get(u);
        return { person: ref(u)!, department: mm?.departmentId ? (deptOf.get(mm.departmentId) ?? null) : null, reports: team.length - 1, ...totals(team, sumTargets(team)) };
      });
      managers.sort((a, b) => b.business - a.business || a.person.name.localeCompare(b.person.name));
      const groups = new Map<string | null, string[]>();
      for (const mm of scoped) groups.set(mm.departmentId && deptOf.has(mm.departmentId) ? mm.departmentId : null, [...(groups.get(mm.departmentId && deptOf.has(mm.departmentId) ? mm.departmentId : null) ?? []), mm.userId]);
      const departmentRows: OrgDepartmentRow[] = [...groups.entries()]
        .map(([id, group]) => ({ department: id ? deptOf.get(id)! : null, managers: managers.filter((x) => (x.department?.id ?? null) === id), ...totals(group, sumTargets(group)) }))
        .sort((a, b) => (a.department ? 0 : 1) - (b.department ? 0 : 1) || b.business - a.business || (a.department?.name ?? '').localeCompare(b.department?.name ?? ''));

      // ─── Rankings (13.3) ───
      const list = [...rows.values()].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.business - a.business || a.person.name.localeCompare(b.person.name));
      const leaders = rankingLeaders(list);

      // ─── Revenue (13.4) ───
      const revenue = revenueOn ? await this.revenue(c, users, rows, managers, below, deptOf, byUser, ids) : null;

      // ─── Insights (13.5) ───
      const insights = await this.insights(c, users, list, conv, managers, ref, revenue?.byClient ?? null);

      return {
        range: c.range,
        currency: c.base,
        coverage: users === null ? 'ORG' : 'VISIBLE',
        departments: depts.map((d) => ({ id: d.id, name: d.name })),
        departmentId,
        people: ids.length,
        kpis,
        target: { target: orgTarget === null ? null : r2(orgTarget), achieved, percent: orgTarget ? ratio(achieved, orgTarget) : null },
        departmentRows,
        ranking: { people: list, leaders },
        revenue,
        insights,
        features: { revenueAttribution: revenueOn },
        layout,
        generatedAt: c.now.toISOString(),
      };
    });
  }

  private elapsed(c: Ctx): number {
    const start = new Date(c.range.start).getTime();
    const end = new Date(c.range.end).getTime();
    return end > start ? Math.min(1, Math.max(0, (c.now.getTime() - start) / (end - start))) : 1;
  }

  /** The organisation's target for these months: the workspace target when one is set, else the sum of people's. */
  private async targetOf(c: Ctx, ids: string[], months: string[], wholeOrg: boolean): Promise<number | null> {
    if (wholeOrg) {
      const org = targetFor(months, await this.cc.targetMap(c.tx, c.auth.tenantId, null));
      if (org !== null) return org;
    }
    const rows = await c.tx.salesTarget.findMany({ where: { tenantId: c.auth.tenantId, userId: { in: ids } }, select: { userId: true, period: true, amount: true } });
    const by = new Map<string, Map<string, number>>();
    for (const r of rows) by.set(r.userId!, (by.get(r.userId!) ?? new Map()).set(r.period, Number(r.amount)));
    let total: number | null = null;
    for (const u of ids) {
      const v = targetFor(months, by.get(u) ?? new Map());
      if (v !== null) total = (total ?? 0) + v;
    }
    return total;
  }

  /**
   * Each person's figures for the period, from a handful of queries over everyone at once. The same definitions as the
   * executive dashboard's cards (metrics.ts), grouped by person.
   */
  private async personRows(c: Ctx, ids: string[], business: Map<string, number>, convertedLeads: string[], months: string[]) {
    const { tx } = c;
    const t = c.auth.tenantId;
    const start = new Date(c.range.start);
    const end = new Date(c.range.end);
    const upTo = end < c.now ? end : c.now;
    const range = { gte: start, lt: end };
    const actRange = { gte: start, lt: upTo };
    const who = { in: ids };
    const kind = (kinds: string[], legacy: Prisma.ActivityWhereInput[]): Prisma.ActivityWhereInput => ({ OR: [{ interaction: { in: kinds } }, ...legacy.map((l) => ({ AND: [{ OR: unset('interaction') }, l] }))] });
    const conns = await tx.integrationConnection.findMany({ where: { tenantId: t, userId: who }, select: { id: true, userId: true } });
    const connUser = new Map(conns.map((x) => [x.id, x.userId]));
    const convertedSet = new Set(convertedLeads);

    const [leads, sent, replies, touches, mailsOut, mailsIn, fu, overdue, rfqs, targets, records] = await Promise.all([
      tx.company.findMany({ where: { tenantId: t, deletedAt: null, createdById: who, createdAt: range }, select: { id: true, createdById: true }, take: CAP }),
      tx.activity.findMany({ where: { tenantId: t, deletedAt: null, ownerId: who, occurredAt: actRange, ...kind(['EMAIL_SENT'], [{ type: 'EMAIL' }]) }, select: { ownerId: true }, take: CAP }),
      tx.activity.findMany({ where: { tenantId: t, deletedAt: null, ownerId: who, occurredAt: actRange, ...kind(RESPONSE_KINDS, []) }, select: { ownerId: true }, take: CAP }),
      tx.activity.findMany({ where: { tenantId: t, deletedAt: null, ownerId: who, occurredAt: actRange, ...kind(OUTREACH_KINDS, [{ type: { in: ['EMAIL', 'CALL', 'MEETING'] } }]) }, select: { ownerId: true }, take: CAP }),
      conns.length ? tx.emailMessage.findMany({ where: { tenantId: t, connectionId: { in: conns.map((x) => x.id) }, direction: 'OUTBOUND', sentAt: range }, select: { connectionId: true }, take: CAP }) : Promise.resolve([]),
      conns.length ? tx.emailMessage.findMany({ where: { tenantId: t, connectionId: { in: conns.map((x) => x.id) }, direction: 'INBOUND', contactId: { not: null }, sentAt: range }, select: { connectionId: true }, take: CAP }) : Promise.resolve([]),
      tx.task.findMany({ where: { tenantId: t, deletedAt: null, followUpType: { not: null }, assigneeId: who, dueAt: actRange, status: { in: ['OPEN', 'DONE'] } }, select: { assigneeId: true, status: true }, take: CAP }),
      tx.task.findMany({ where: { tenantId: t, deletedAt: null, followUpType: { not: null }, assigneeId: who, status: 'OPEN', dueAt: { lt: c.now } }, select: { assigneeId: true }, take: CAP }),
      tx.rfq.findMany({ where: { tenantId: t, deletedAt: null, ownerId: who, OR: [{ receivedAt: range }, { statusChangedAt: range, status: { in: ['WON', 'LOST'] } }] }, select: { ownerId: true, receivedAt: true, status: true, statusChangedAt: true }, take: CAP }),
      tx.salesTarget.findMany({ where: { tenantId: t, userId: who }, select: { userId: true, period: true, amount: true } }),
      tx.revenueRecord.findMany({ where: { tenantId: t, voidedAt: null, closedAt: range, companyId: { not: null } }, select: { id: true, companyId: true }, take: CAP }),
    ]);

    // Clients converted: companies whose first record ever closed in the period, credited to each person with a share.
    const companyIds = [...new Set(records.map((r) => r.companyId!))];
    const earlier = companyIds.length ? new Set((await tx.revenueRecord.findMany({ where: { tenantId: t, voidedAt: null, companyId: { in: companyIds }, closedAt: { lt: start } }, select: { companyId: true } })).map((e) => e.companyId)) : new Set<string | null>();
    const firsts = records.filter((r) => !earlier.has(r.companyId));
    const credits = firsts.length ? await tx.revenueCredit.findMany({ where: { tenantId: t, voided: false, recordId: { in: firsts.map((r) => r.id) }, userId: who, percent: { gt: 0 } }, select: { recordId: true, userId: true } }) : [];
    const companyOf = new Map(firsts.map((r) => [r.id, r.companyId!]));
    const converted = new Map<string, Set<string>>();
    for (const cr of credits) converted.set(cr.userId!, (converted.get(cr.userId!) ?? new Set()).add(companyOf.get(cr.recordId)!));

    const tally = (list: (string | null | undefined)[]) => {
      const out = new Map<string, number>();
      for (const u of list) if (u) out.set(u, (out.get(u) ?? 0) + 1);
      return out;
    };
    const leadsBy = tally(leads.map((l) => l.createdById));
    const convBy = tally(leads.filter((l) => convertedSet.has(l.id)).map((l) => l.createdById));
    const sentBy = tally([...sent.map((a) => a.ownerId), ...mailsOut.map((e) => connUser.get(e.connectionId))]);
    const repliesBy = tally([...replies.map((a) => a.ownerId), ...mailsIn.map((e) => connUser.get(e.connectionId))]);
    const touchesBy = tally([...touches.map((a) => a.ownerId), ...mailsOut.map((e) => connUser.get(e.connectionId))]);
    const dueBy = tally(fu.map((x) => x.assigneeId));
    const doneBy = tally(fu.filter((x) => x.status === 'DONE').map((x) => x.assigneeId));
    const overdueBy = tally(overdue.map((x) => x.assigneeId));
    const inRange = (d: Date | null) => !!d && d >= start && d < end;
    const rfqInBy = tally(rfqs.filter((r) => inRange(r.receivedAt)).map((r) => r.ownerId));
    const rfqWonBy = tally(rfqs.filter((r) => r.status === 'WON' && inRange(r.statusChangedAt)).map((r) => r.ownerId));
    const rfqLostBy = tally(rfqs.filter((r) => r.status === 'LOST' && inRange(r.statusChangedAt)).map((r) => r.ownerId));
    const targetBy = new Map<string, Map<string, number>>();
    for (const r of targets) targetBy.set(r.userId!, (targetBy.get(r.userId!) ?? new Map()).set(r.period, Number(r.amount)));

    const out = new Map<string, OrgPersonRow>() as Map<string, OrgPersonRow> & { converted: Map<string, Set<string>> };
    out.converted = converted;
    for (const u of ids) {
      const n = (m: Map<string, number>) => m.get(u) ?? 0;
      const biz = r2(business.get(u) ?? 0);
      const target = targetFor(months, targetBy.get(u) ?? new Map());
      const rw = n(rfqWonBy);
      const rl = n(rfqLostBy);
      out.set(u, {
        person: none(u), department: null, manager: null,
        leads: n(leadsBy), leadsConverted: n(convBy), emailsSent: n(sentBy), responses: n(repliesBy), touches: n(touchesBy),
        followUpsDue: n(dueBy), followUpsDone: n(doneBy), followUpsOverdue: n(overdueBy),
        rfqsReceived: n(rfqInBy), rfqsWon: rw, rfqsLost: rl, clientsConverted: converted.get(u)?.size ?? 0,
        business: biz, target: target === null ? null : r2(target), achievement: target ? ratio(biz, target) : null, status: 'INACTIVE',
        responseRate: ratio(n(repliesBy), n(sentBy)), leadConversion: ratio(n(convBy), n(leadsBy)), rfqWinRate: ratio(rw, rw + rl), followUpCompletion: ratio(n(doneBy), n(dueBy)),
        score: null,
      });
    }
    return out;
  }

  /** Revenue by period, by person, team, department, client, country, industry and service, each deal counted once. */
  private async revenue(
    c: Ctx,
    users: string[] | null,
    rows: Map<string, OrgPersonRow>,
    managers: OrgManagerRow[],
    below: (u: string) => string[],
    deptOf: Map<string, Ref>,
    byUser: Map<string, { departmentId: string | null }>,
    ids: string[],
  ): Promise<NonNullable<SeniorDashboard['revenue']>> {
    const { tx } = c;
    const t = c.auth.tenantId;
    const p = (period: ReportPeriod) => periodRange(period, { tz: c.tz, now: c.now });
    const half = new Date(c.now.toLocaleString('en-US', { timeZone: c.tz })).getMonth() < 6 ? 'h1' : 'h2';
    const periods = await Promise.all(
      (
        [
          ['month', 'this_month'],
          ['quarter', 'this_quarter'],
          ['half', half],
          ['year', 'this_year'],
        ] as const
      ).map(async ([key, period]) => {
        const r = p(period);
        return { key, amount: (await c.metrics(users, r).revenue()).amount, target: await this.targetOf(c, ids, monthsOf(r), users === null).then((x) => (x === null ? null : r2(x))) };
      }),
    );

    // Target against achievement, month by month through this year.
    const year = p('this_year');
    const yearRev = await c.metrics(users, year).revenue();
    const trend: RevenueTrendPoint[] = monthsOf(year).map((month) => ({ month, revenue: 0, target: null }));
    const monthOf = new Map<string, number>();
    const yearShare = await this.shares(c, users, yearRev.records);
    for (const r of yearRev.records) {
      const v = yearShare.get(r.id);
      if (v === undefined) continue;
      const key = monthKey(r.closedAt, c.tz);
      monthOf.set(key, (monthOf.get(key) ?? 0) + v);
    }
    const now = monthKey(c.now, c.tz);
    for (const pt of trend) {
      pt.revenue = r2(monthOf.get(pt.month) ?? 0);
      pt.target = await this.targetOf(c, ids, [pt.month], users === null).then((x) => (x === null ? null : r2(x)));
      if (pt.month > now) pt.revenue = 0;
    }

    // The period's breakdowns.
    const rev = await c.metrics(users).revenue();
    const share = await this.shares(c, users, rev.records);
    const total = r2([...share.values()].reduce((a, x) => a + x, 0));
    const slice = (key: string, label: string, amount: number, deals: number, link: RevenueSlice['link']): RevenueSlice => ({ key, label, amount: r2(amount), share: ratio(amount, total) ?? 0, deals, link });
    const sorted = (list: RevenueSlice[]) => list.filter((x) => x.amount > 0.004).sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));

    const people = [...rows.values()];
    const credited = r2(people.reduce((a, r) => a + r.business, 0));
    const byEmployee = sorted(people.map((r) => slice(r.person.id, r.person.name, r.business, rev.dealsByUser.get(r.person.id) ?? 0, { kind: 'person', id: r.person.id })));
    // Shares held by people outside the dashboard (or by no one) keep the slices adding up to the total.
    const rest = r2(total - credited);
    if (rest > 0.004) byEmployee.push(slice('other', '', rest, 0, null));

    const byManager = sorted(managers.map((mr) => slice(mr.person.id, mr.person.name, [mr.person.id, ...below(mr.person.id)].reduce((a, u) => a + (rows.get(u)?.business ?? 0), 0), 0, { kind: 'team', id: mr.person.id })));

    const deptTotals = new Map<string | null, number>();
    for (const r of people) {
      const d = byUser.get(r.person.id)?.departmentId ?? null;
      const k = d && deptOf.has(d) ? d : null;
      deptTotals.set(k, (deptTotals.get(k) ?? 0) + r.business);
    }
    const byDepartment = sorted([...deptTotals.entries()].map(([d, amount]) => slice(d ?? 'none', d ? deptOf.get(d)!.name : '', amount, 0, d ? { kind: 'department', id: d } : null)));
    if (rest > 0.004) byDepartment.push(slice('other', '', rest, 0, null));

    // Client, country, industry and service: each record's in-scope value, grouped by its company or RFQ.
    const companyIds = [...new Set(rev.records.map((r) => r.companyId).filter((x): x is string => !!x))];
    const rfqIds = [...new Set(rev.records.map((r) => r.rfqId).filter((x): x is string => !!x))];
    const [cos, rfqList] = await Promise.all([
      companyIds.length ? tx.company.findMany({ where: { tenantId: t, id: { in: companyIds } }, select: { id: true, name: true, country: true, industry: true } }) : Promise.resolve([]),
      rfqIds.length ? tx.rfq.findMany({ where: { tenantId: t, id: { in: rfqIds } }, select: { id: true, methodology: true } }) : Promise.resolve([]),
    ]);
    const co = new Map(cos.map((x) => [x.id, x]));
    const method = new Map(rfqList.map((x) => [x.id, x.methodology?.trim() || null]));
    const group = (keyOf: (r: (typeof rev.records)[number]) => { key: string; label: string; link: RevenueSlice['link'] }) => {
      const acc = new Map<string, { label: string; amount: number; deals: number; link: RevenueSlice['link'] }>();
      for (const r of rev.records) {
        const v = share.get(r.id);
        if (v === undefined) continue;
        const g = keyOf(r);
        const cur = acc.get(g.key) ?? { label: g.label, amount: 0, deals: 0, link: g.link };
        cur.amount += v;
        cur.deals += 1;
        acc.set(g.key, cur);
      }
      return sorted([...acc.entries()].map(([key, x]) => slice(key, x.label, x.amount, x.deals, x.link)));
    };
    const byClient = group((r) => (r.companyId && co.get(r.companyId) ? { key: r.companyId, label: co.get(r.companyId)!.name, link: { kind: 'company', id: r.companyId } } : { key: 'none', label: '', link: null }));
    const byCountry = group((r) => {
      const x = r.companyId ? co.get(r.companyId)?.country : null;
      return x ? { key: x, label: x, link: null } : { key: 'none', label: '', link: null };
    });
    const byIndustry = group((r) => {
      const x = r.companyId ? co.get(r.companyId)?.industry?.trim() : null;
      return x ? { key: x.toLowerCase(), label: x, link: null } : { key: 'none', label: '', link: null };
    });
    const byService = group((r) => {
      const x = r.rfqId ? method.get(r.rfqId) : null;
      return x ? { key: x.toLowerCase(), label: x, link: null } : { key: 'none', label: '', link: null };
    });

    return { periods, trend, byEmployee, byManager, byDepartment, byClient, byCountry, byIndustry, byService, total, unconverted: rev.unconverted };
  }

  /** Each record's value in the workspace currency that the dashboard counts: all of it for the organisation, else the in-scope shares. */
  private async shares(c: Ctx, users: string[] | null, records: { id: string; amount: number; currency: string }[]): Promise<Map<string, number>> {
    const m = c.metrics(users);
    const out = new Map<string, number>();
    const credits = users && records.length ? await c.tx.revenueCredit.findMany({ where: { tenantId: c.auth.tenantId, voided: false, recordId: { in: records.map((r) => r.id) } }, select: { recordId: true, userId: true, percent: true } }) : [];
    const mine = users ? new Set(users) : null;
    for (const r of records) {
      const v = m.money({ amount: r.amount, currency: r.currency });
      if (v === null) continue;
      const pct = mine ? credits.filter((x) => x.recordId === r.id && x.userId && mine.has(x.userId)).reduce((a, x) => a + x.percent, 0) : 100;
      if (pct > 0) out.set(r.id, (v * pct) / 100);
    }
    return out;
  }

  private async insights(
    c: Ctx,
    users: string[] | null,
    people: OrgPersonRow[],
    conv: { leads: string[]; converted: string[] },
    managers: OrgManagerRow[],
    ref: (id: string | null | undefined) => PersonRef | null,
    byClient: RevenueSlice[] | null,
  ): Promise<OrgInsight[]> {
    const { tx } = c;
    const t = c.auth.tenantId;
    const R = INSIGHT_RULES;
    const owned = (f: string) => (users ? { [f]: { in: users } } : {});
    const out: OrgInsight[] = [];
    const take = (kind: OrgInsight['kind'], items: OrgInsightItem[], count = items.length) => out.push({ kind, count, items: items.slice(0, TAKE) });

    // People with too many overdue follow-ups.
    take('overdueFollowUps', people.filter((p) => p.followUpsOverdue >= R.overdue).sort((a, b) => b.followUpsOverdue - a.followUpsOverdue).map((p) => ({ id: p.person.id, title: p.person.name, value: p.followUpsOverdue, extra: null, href: `/app/follow-ups?assignee=${p.person.id}&when=overdue`, person: p.person })));

    // Many leads, few of them converted, against the organisation's own rate.
    const orgRate = conv.leads.length ? conv.converted.length / conv.leads.length : 0;
    take('lowConversion', orgRate > 0 ? people.filter((p) => p.leads >= R.lowConversionLeads && p.leadsConverted / p.leads < orgRate * R.lowConversionShare).sort((a, b) => b.leads - a.leads).map((p) => ({ id: p.person.id, title: p.person.name, value: p.leads, extra: p.leadConversion ?? 0, href: `/app?view=executive&person=${p.person.id}`, person: p.person })) : []);

    // Companies sending RFQ after RFQ.
    const since = new Date(c.now.getTime() - 180 * DAY);
    const rfqs = await tx.rfq.findMany({ where: { tenantId: t, deletedAt: null, receivedAt: { gte: since }, ...owned('ownerId') }, select: { companyId: true }, take: CAP });
    const perCo = new Map<string, number>();
    for (const r of rfqs) perCo.set(r.companyId, (perCo.get(r.companyId) ?? 0) + 1);
    const repeat = [...perCo.entries()].filter(([, n]) => n >= R.repeatRfqs).sort((a, b) => b[1] - a[1]);
    const names = await this.companyNames(c, [...repeat.slice(0, TAKE).map(([id]) => id)]);
    take('repeatRfqs', repeat.map(([id, n]) => ({ id, title: names.get(id)?.name ?? '', value: n, extra: null, href: `/app/companies/${id}?tab=rfqs`, person: ref(names.get(id)?.ownerId) })));

    // Companies whose interactions fell away: busy 31-60 days ago, under half of that in the last 30.
    const acts = await tx.activity.findMany({ where: { tenantId: t, deletedAt: null, companyId: { not: null }, occurredAt: { gte: new Date(c.now.getTime() - 60 * DAY), lt: c.now }, ...owned('ownerId') }, select: { companyId: true, occurredAt: true }, take: CAP });
    const cut = c.now.getTime() - 30 * DAY;
    const eng = new Map<string, { before: number; after: number }>();
    for (const a of acts) {
      const e = eng.get(a.companyId!) ?? { before: 0, after: 0 };
      if (a.occurredAt.getTime() < cut) e.before += 1;
      else e.after += 1;
      eng.set(a.companyId!, e);
    }
    const falling = [...eng.entries()].filter(([, e]) => e.before >= R.engagementBase && e.after * 2 < e.before).sort((a, b) => b[1].before - b[1].after - (a[1].before - a[1].after));
    const fnames = await this.companyNames(c, falling.slice(0, TAKE).map(([id]) => id));
    take('decliningEngagement', falling.map(([id, e]) => ({ id, title: fnames.get(id)?.name ?? '', value: e.after, extra: e.before, href: `/app/companies/${id}?tab=interactions`, person: ref(fnames.get(id)?.ownerId) })));

    // Deals and RFQs sitting in negotiation.
    const stale = new Date(c.now.getTime() - R.stuckDays * DAY);
    const deals = await tx.opportunity.findMany({ where: { tenantId: t, deletedAt: null, status: 'OPEN', ...owned('ownerId') }, select: { id: true, name: true, dealNumber: true, ownerId: true, createdAt: true, stageId: true, stage: { select: { name: true } } }, take: CAP });
    const negotiating = deals.filter((d) => /negotiat/i.test(d.stage.name));
    const entered = negotiating.length ? await tx.dealStageEvent.findMany({ where: { tenantId: t, opportunityId: { in: negotiating.map((d) => d.id) } }, select: { opportunityId: true, toStageId: true, occurredAt: true }, orderBy: { occurredAt: 'desc' } }) : [];
    const since0 = (d: (typeof negotiating)[number]) => entered.find((e) => e.opportunityId === d.id && e.toStageId === d.stageId)?.occurredAt ?? d.createdAt;
    const stuckRfqs = await tx.rfq.findMany({ where: { tenantId: t, deletedAt: null, status: 'NEGOTIATION', statusChangedAt: { lt: stale, not: null }, ...owned('ownerId') }, select: { id: true, number: true, projectName: true, ownerId: true, statusChangedAt: true }, take: CAP });
    const stuck: (OrgInsightItem & { at: number })[] = [
      ...negotiating.filter((d) => since0(d) < stale).map((d) => ({ id: d.id, title: d.dealNumber ? `${d.dealNumber} ${d.name}` : d.name, value: Math.floor((c.now.getTime() - since0(d).getTime()) / DAY), extra: null, href: `/app/deals/${d.id}`, person: ref(d.ownerId), at: since0(d).getTime() })),
      ...stuckRfqs.filter((r) => r.statusChangedAt).map((r) => ({ id: r.id, title: `${r.number} ${r.projectName}`, value: Math.floor((c.now.getTime() - r.statusChangedAt!.getTime()) / DAY), extra: null, href: `/app/rfqs?open=${r.id}`, person: ref(r.ownerId), at: r.statusChangedAt!.getTime() })),
    ].sort((a, b) => a.at - b.at);
    take('stuckNegotiation', stuck.map(({ at: _at, ...x }) => x));

    // RFQs due soon (or already past) and not yet submitted.
    const soon = new Date(c.now.getTime() + R.deadlineDays * DAY);
    const dueWhere: Prisma.RfqWhereInput = { tenantId: t, deletedAt: null, status: { in: ['RECEIVED', 'UNDER_EVALUATION', 'PRICING', 'ON_HOLD'] }, deadlineAt: { lt: soon, not: null }, ...owned('ownerId') };
    const [due, dueCount] = await Promise.all([tx.rfq.findMany({ where: dueWhere, select: { id: true, number: true, projectName: true, ownerId: true, deadlineAt: true }, orderBy: { deadlineAt: 'asc' }, take: TAKE }), tx.rfq.count({ where: dueWhere })]);
    take('rfqDeadlines', due.filter((r) => r.deadlineAt).map((r) => ({ id: r.id, title: `${r.number} ${r.projectName}`, value: Math.ceil((r.deadlineAt!.getTime() - c.now.getTime()) / DAY), extra: null, href: `/app/rfqs?open=${r.id}`, person: ref(r.ownerId) })), dueCount);

    // Clients with concerns still open.
    const companyIds = users ? (await tx.company.findMany({ where: { tenantId: t, deletedAt: null, ownerId: { in: users } }, select: { id: true }, take: CAP })).map((x) => x.id) : null;
    const concerns = await tx.escalation.findMany({ where: { tenantId: t, status: { not: 'RESOLVED' }, ...(companyIds ? { OR: [{ companyId: { in: companyIds } }, { ownerId: { in: users! } }] } : {}) }, select: { companyId: true }, take: CAP });
    const perConcern = new Map<string, number>();
    for (const x of concerns) perConcern.set(x.companyId, (perConcern.get(x.companyId) ?? 0) + 1);
    const cl = [...perConcern.entries()].sort((a, b) => b[1] - a[1]);
    const cnames = await this.companyNames(c, cl.slice(0, TAKE).map(([id]) => id));
    take('unresolvedConcerns', cl.map(([id, n]) => ({ id, title: cnames.get(id)?.name ?? '', value: n, extra: null, href: `/app/companies/${id}?tab=concerns`, person: ref(cnames.get(id)?.ownerId) })));

    // Teams behind their targets for the time gone.
    take('teamsBehind', managers.filter((x) => x.status === 'BEHIND' || x.status === 'AT_RISK').sort((a, b) => (a.achievement ?? 0) - (b.achievement ?? 0)).map((x) => ({ id: x.person.id, title: x.person.name, value: x.achievement, extra: x.reports, href: `/app?view=manager&person=${x.person.id}`, person: x.person })));

    // Leads nobody owns.
    const unWhere: Prisma.CompanyWhereInput = { tenantId: t, deletedAt: null, OR: unset('ownerId') };
    const [un, unCount] = await Promise.all([tx.company.findMany({ where: unWhere, select: { id: true, name: true, leadNumber: true }, orderBy: { createdAt: 'desc' }, take: TAKE }), tx.company.count({ where: unWhere })]);
    take('unassignedLeads', un.map((x) => ({ id: x.id, title: x.leadNumber ? `${x.leadNumber} ${x.name}` : x.name, value: null, extra: null, href: `/app/companies/${x.id}`, person: null })), unCount);

    // Revenue concentration: the largest client, and the three largest, against the period's revenue.
    if (byClient) {
      const top = byClient.filter((x) => x.link);
      const top1 = top[0]?.share ?? 0;
      const top3 = top.slice(0, 3).reduce((a, x) => a + x.share, 0);
      const concentrated = top.length > 1 && (top1 >= R.topClient || (top.length > 3 && top3 >= R.topThree));
      take('revenueConcentration', concentrated ? top.slice(0, 3).map((x) => ({ id: x.key, title: x.label, value: x.share, extra: x.amount, href: `/app/companies/${x.key}`, person: null })) : []);
    }
    return out;
  }

  private async companyNames(c: Ctx, ids: string[]) {
    if (!ids.length) return new Map<string, { name: string; ownerId: string | null }>();
    const rows = await c.tx.company.findMany({ where: { tenantId: c.auth.tenantId, id: { in: ids } }, select: { id: true, name: true, leadNumber: true, ownerId: true } });
    return new Map(rows.map((r) => [r.id, { name: r.leadNumber ? `${r.leadNumber} ${r.name}` : r.name, ownerId: r.ownerId }]));
  }
}

function monthKey(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(d);
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}`;
}

/** Percentile (0-100) of each value among the others; ties share the middle. */
function percentiles(values: number[]): number[] {
  if (values.length === 1) return [100];
  return values.map((v) => {
    const less = values.filter((x) => x < v).length;
    const same = values.filter((x) => x === v).length - 1;
    return ((less + same / 2) / (values.length - 1)) * 100;
  });
}

/**
 * The balanced score (ADR 0063): for everyone with something to rank, the average of their percentiles on seven
 * measures, five of them about quality (target achievement, lead conversion, RFQ win rate, response rate, follow-up
 * completion) and two about volume (revenue, leads). Rates count only past their minimum volume.
 */
export function scoreRows(rows: OrgPersonRow[]): void {
  const ranked = rows.filter((r) => r.leads + r.touches + r.rfqsReceived + r.followUpsDue > 0 || r.business > 0);
  const scores = new Map<OrgPersonRow, number[]>();
  const measure = (pick: (r: OrgPersonRow) => number | null) => {
    const eligible = ranked.filter((r) => pick(r) !== null);
    const p = percentiles(eligible.map((r) => pick(r)!));
    eligible.forEach((r, i) => scores.set(r, [...(scores.get(r) ?? []), p[i]!]));
  };
  measure((r) => r.business);
  measure((r) => r.leads);
  measure((r) => r.achievement);
  measure((r) => (r.leads >= RANKING_MINIMUMS.leadConversion ? r.leadConversion : null));
  measure((r) => (r.rfqsWon + r.rfqsLost >= RANKING_MINIMUMS.rfqWinRate ? r.rfqWinRate : null));
  measure((r) => (r.emailsSent >= RANKING_MINIMUMS.responseRate ? r.responseRate : null));
  measure((r) => (r.followUpsDue >= RANKING_MINIMUMS.followUpCompletion ? r.followUpCompletion : null));
  for (const r of rows) {
    const s = scores.get(r);
    r.score = s?.length ? Math.round(s.reduce((a, x) => a + x, 0) / s.length) : null;
  }
}

/** The leader of each ranking category, with a quality figure beside each volume one. Ties go to the better score. */
export function rankingLeaders(rows: OrgPersonRow[]): RankingLeader[] {
  const best = (pick: (r: OrgPersonRow) => number | null) =>
    rows.filter((r) => (pick(r) ?? 0) > 0).sort((a, b) => pick(b)! - pick(a)! || (b.score ?? 0) - (a.score ?? 0) || a.person.name.localeCompare(b.person.name))[0] ?? null;
  const lead = (category: RankingLeader['category'], pick: (r: OrgPersonRow) => number | null, detail: (r: OrgPersonRow) => RankingLeader['detail']): RankingLeader => {
    const r = best(pick);
    return { category, person: r?.person ?? null, value: r ? pick(r) : null, detail: r ? detail(r) : null };
  };
  return [
    lead('revenue', (r) => r.business, (r) => ({ label: 'target', value: r.achievement })),
    lead('leads', (r) => r.leads, (r) => ({ label: 'leadConversion', value: r.leadConversion })),
    lead('rfqs', (r) => r.rfqsReceived, (r) => ({ label: 'rfqWinRate', value: r.rfqWinRate })),
    lead('conversions', (r) => r.clientsConverted, (r) => ({ label: 'business', value: r.business })),
    lead('responseRate', (r) => (r.emailsSent >= RANKING_MINIMUMS.responseRate ? r.responseRate : null), (r) => ({ label: 'emailsSent', value: r.emailsSent })),
    lead('followUpCompletion', (r) => (r.followUpsDue >= RANKING_MINIMUMS.followUpCompletion ? r.followUpCompletion : null), (r) => ({ label: 'followUpsDue', value: r.followUpsDue })),
    lead('targetAchievement', (r) => r.achievement, (r) => ({ label: 'business', value: r.business })),
  ];
}

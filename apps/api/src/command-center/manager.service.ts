import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma } from '@dealflow/database';
import {
  type CommandCenterLayout,
  type CommandCenterQuery,
  type FunnelRow,
  type KpiCard,
  type ManagerDashboard,
  type ManagerRevenueRow,
  MONITOR_SECTIONS,
  monthsOf,
  type PersonRef,
  performanceStatus,
  periodRange,
  ratio,
  type ReportPeriod,
  targetFor,
  type TeamMemberRow,
  type WorkBucket,
  type WorkItem,
} from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { personRefs, reportingTree } from '../crm/visibility';
import { type Ctx, CommandCenterService } from './command-center.service';
import { r2 } from './metrics';

const TAKE = 8;
const DAY = 86_400_000;

/**
 * The Manager dashboard (ADR 0063, spec section 12): a manager's team (themselves and everyone reporting to them,
 * within their record visibility) for a period. Team totals count each revenue record once at the team's combined
 * share; each person's business is their own share, so the rows add up to the team total.
 */
@Injectable()
export class ManagerDashboardService {
  constructor(private readonly cc: CommandCenterService) {}

  dashboard(auth: AuthContext, q: CommandCenterQuery): Promise<ManagerDashboard> {
    return this.cc.withCtx(auth, q, async (c) => {
      if (!c.features.has('manager_dashboard')) throw new ForbiddenException({ code: 'FEATURE_NOT_IN_PLAN', message: 'Your plan does not include the manager dashboard.' });
      const { tx } = c;
      const t = auth.tenantId;
      const managerId = await this.cc.subject(tx, auth, q.userId);
      const team = await this.cc.teamOf(tx, auth, managerId);
      const direct = new Set((await tx.membership.findMany({ where: { tenantId: t, status: 'ACTIVE', reportingManagerId: managerId }, select: { userId: true } })).map((m) => m.userId));
      const [people, membership, layout] = await Promise.all([
        personRefs(tx, t, team),
        tx.membership.findFirst({ where: { tenantId: t, userId: managerId }, select: { departmentId: true, reportingManagerId: true } }),
        // Each person's own arrangement, whichever manager's dashboard they open.
        this.cc.layoutRow(tx, t, auth.userId, 'MANAGER'),
      ]);
      const [dept, up] = await Promise.all([
        membership?.departmentId ? tx.department.findFirst({ where: { tenantId: t, id: membership.departmentId }, select: { name: true } }) : Promise.resolve(null),
        personRefs(tx, t, [membership?.reportingManagerId]),
      ]);
      const revenueOn = c.features.has('revenue_attribution');
      const m = c.metrics(team);

      // Team KPIs (12.2).
      const [leads, active, contacted, responses, positive, pending, overdue, rfqIn, rfqOut, won, lost, converted, rejected, concerns, rev, pipeline] = await Promise.all([
        m.leadsGenerated(), m.activeCompanies(), m.employeesContacted(), m.responses(), m.positiveResponses(), m.followUpsPending(), m.followUpsOverdue(),
        m.rfqsReceived(), m.rfqsSubmitted(), m.rfqsDecided('WON'), m.rfqsDecided('LOST'), m.clientsConverted(), m.clientsRejected(), m.clientConcerns(), m.revenue(), m.pipelineValue(),
      ]);
      const k = (key: KpiCard['key'], value: number, format: KpiCard['format'] = 'number'): KpiCard => ({ key, value, format });
      const kpis: KpiCard[] = [
        k('leadsGenerated', leads.length), k('activeCompanies', active.length), k('employeesContacted', contacted.length),
        k('responses', responses.logged.length + responses.synced.length), k('positiveResponses', positive.length),
        k('followUpsPending', pending.length), k('followUpsOverdue', overdue.length), k('rfqsReceived', rfqIn.length), k('rfqsSubmitted', rfqOut.length),
        k('rfqsWon', won.length), k('rfqsLost', lost.length), k('clientsConverted', converted.length), k('clientsRejected', rejected.length),
        k('clientConcerns', concerns.length), ...(revenueOn ? [k('revenue', rev.amount, 'currency')] : []), k('openOpportunities', pipeline, 'currency'),
      ];

      // The employee performance table (12.3) and the comparisons (12.4) come from the same per-person numbers.
      const start = new Date(c.range.start).getTime();
      const end = new Date(c.range.end).getTime();
      const elapsed = end > start ? Math.min(1, Math.max(0, (c.now.getTime() - start) / (end - start))) : 1;
      const months = monthsOf(c.range);
      const rows: TeamMemberRow[] = [];
      for (const u of team) {
        const pm = c.metrics([u]);
        const [l, a, sent, resp, pos, pend, over, ri, ro, rw, rl, conv, fu, targets] = await Promise.all([
          pm.leadsGenerated(), pm.activeCompanies(), pm.emailsSent(), pm.responses(), pm.positiveResponses(), pm.followUpsPending(), pm.followUpsOverdue(),
          pm.rfqsReceived(), pm.rfqsSubmitted(), pm.rfqsDecided('WON'), pm.rfqsDecided('LOST'), pm.clientsConverted(), pm.followUpCompletion(), this.cc.targetMap(tx, t, u),
        ]);
        const business = revenueOn ? (rev.byUser.get(u) ?? 0) : 0;
        const target = targetFor(months, targets);
        const achievement = target ? ratio(business, target) : null;
        const emails = sent.logged.length + sent.synced.length;
        const replies = resp.logged.length + resp.synced.length;
        rows.push({
          person: people.get(u) ?? { id: u, name: '', designation: null },
          direct: direct.has(u),
          leads: l.length, activeCompanies: a.length, emailsSent: emails, responses: replies, positiveResponses: pos.length,
          followUpsPending: pend.length, followUpsOverdue: over.length, rfqsReceived: ri.length, rfqsSubmitted: ro.length, rfqsWon: rw.length, rfqsLost: rl.length,
          clientsConverted: conv.length, business: r2(business), wonDeals: rev.dealsByUser.get(u) ?? 0, target, achievement,
          status: performanceStatus(achievement, elapsed, l.length + emails + replies + ri.length + fu.done > 0 || business > 0),
          responseRate: ratio(replies, emails), rfqConversion: ratio(rw.length, rw.length + rl.length), followUpCompletion: ratio(fu.done, fu.due),
        });
      }
      // The manager first, then their people by business, then by name.
      rows.sort((a, b) => (a.person.id === managerId ? -1 : b.person.id === managerId ? 1 : b.business - a.business || a.person.name.localeCompare(b.person.name)));

      // This month's team target: the sum of each member's.
      const monthRange = periodRange('this_month', { tz: c.tz, now: c.now });
      const monthRev = c.range.period === 'this_month' ? rev : await c.metrics(team, monthRange).revenue();
      let monthTarget: number | null = null;
      for (const u of team) {
        const v = targetFor(monthsOf(monthRange), await this.cc.targetMap(tx, t, u));
        if (v !== null) monthTarget = (monthTarget ?? 0) + v;
      }
      const monthAchieved = revenueOn ? monthRev.amount : 0;

      // The team pipeline (12.5): people handling each stage and the revenue won.
      const f = await m.funnel();
      const ownersAt = new Map<string, Set<string>>();
      for (const [companyId, stage] of f.stages) {
        const owner = f.owners.get(companyId);
        if (!owner) continue;
        ownersAt.set(stage, (ownersAt.get(stage) ?? new Set()).add(owner));
      }
      const funnel: FunnelRow[] = f.rows.map((r) => ({ ...r, people: ownersAt.get(r.stage)?.size ?? 0, wonRevenue: r.stage === 'WON' && revenueOn ? rev.amount : 0 }));

      const monitor = await this.monitor(c, team, managerId, layout);

      let revenue: ManagerDashboard['revenue'] = null;
      if (revenueOn) {
        const p = (period: ReportPeriod) => periodRange(period, { tz: c.tz, now: c.now });
        const [rm, rq, ry] = await Promise.all([c.metrics(team, p('this_month')).revenue(), c.metrics(team, p('this_quarter')).revenue(), c.metrics(team, p('this_year')).revenue()]);
        const share = (r: typeof rm, users: string[]) => r2(users.reduce((a, u) => a + (r.byUser.get(u) ?? 0), 0));
        const managers: ManagerRevenueRow[] = [];
        const inTeam = new Set(team);
        for (const u of team) {
          const below = (await reportingTree(tx, t, u)).filter((x) => inTeam.has(x));
          if (!below.length) continue;
          const sub = [u, ...below];
          managers.push({ person: people.get(u) ?? { id: u, name: '', designation: null }, teamSize: sub.length, month: share(rm, sub), quarter: share(rq, sub), year: share(ry, sub) });
        }
        revenue = {
          people: team.map((u) => ({ person: people.get(u) ?? { id: u, name: '', designation: null }, month: share(rm, [u]), quarter: share(rq, [u]), year: share(ry, [u]) })).sort((a, b) => b.year - a.year || a.person.name.localeCompare(b.person.name)),
          managers: managers.sort((a, b) => b.year - a.year),
          team: { month: rm.amount, quarter: rq.amount, year: ry.amount },
          unconverted: rev.unconverted,
        };
      }

      const pr = people.get(managerId) ?? { id: managerId, name: '', designation: null };
      return {
        person: { ...pr, department: dept?.name ?? null, reportingManager: membership?.reportingManagerId ? (up.get(membership.reportingManagerId) ?? null) : null },
        teamSize: team.length - 1,
        range: c.range,
        currency: c.base,
        month: { target: monthTarget === null ? null : r2(monthTarget), achieved: monthAchieved, percent: monthTarget ? ratio(monthAchieved, monthTarget) : null },
        kpis,
        team: rows,
        funnel,
        monitor,
        revenue,
        features: { revenueAttribution: revenueOn, leadTransfers: c.features.has('lead_transfers'), instructions: c.features.has('instructions'), clientConcerns: c.features.has('client_concerns') },
        layout,
        generatedAt: c.now.toISOString(),
      };
    });
  }

  /** Follow-up monitoring (12.6): the team's open work that needs a manager's eye, each with who it is with. */
  private async monitor(c: Ctx, team: string[], managerId: string, layout: CommandCenterLayout | null): Promise<WorkBucket[]> {
    const { tx } = c;
    const t = c.auth.tenantId;
    const s = c.metrics(team).s;
    const fortnight = new Date(c.now.getTime() + 14 * DAY);
    const open = { tenantId: t, deletedAt: null, status: 'OPEN' as const, followUpType: { not: null }, assigneeId: { in: team } };
    const taskSel = { id: true, title: true, dueAt: true, priority: true, companyId: true, followUpType: true, assigneeId: true } as const;
    const refs = async (ids: (string | null | undefined)[]) => personRefs(tx, t, ids);
    const who = (m: Map<string, PersonRef>, id: string | null | undefined) => (id ? (m.get(id) ?? null) : null);

    const tasks = async (id: string, where: Prisma.TaskWhereInput): Promise<WorkBucket> => {
      const [rows, total] = await Promise.all([tx.task.findMany({ where, select: taskSel, orderBy: [{ dueAt: 'asc' }], take: TAKE }), tx.task.count({ where })]);
      const p = await refs(rows.map((r) => r.assigneeId));
      return {
        id, label: null, total,
        items: rows.map((r): WorkItem => ({
          kind: 'followUp', id: r.id, title: r.title, subtitle: r.followUpType, href: r.companyId ? `/app/companies/${r.companyId}?tab=follow-ups` : '/app/follow-ups',
          at: r.dueAt?.toISOString() ?? null, priority: r.priority, overdue: !!r.dueAt && r.dueAt < c.now, from: null, assignee: who(p, r.assigneeId), companyId: r.companyId,
        })),
      };
    };

    const buckets: Record<string, () => Promise<WorkBucket>> = {
      teamToday: () => tasks('teamToday', { ...open, dueAt: { gte: s.todayStart, lt: s.tomorrowStart } }),
      teamOverdue: () => tasks('teamOverdue', { ...open, dueAt: { lt: c.now } }),
      teamMeetings: () => tasks('teamMeetings', { ...open, followUpType: 'MEETING', dueAt: { gte: c.now, lt: fortnight } }),
      teamAwaiting: async () => {
        // Employees whose latest logged interaction from the team is an email sent, with no reply since.
        const since = new Date(c.now.getTime() - 60 * DAY);
        const acts = await tx.activity.findMany({ where: { tenantId: t, deletedAt: null, ownerId: { in: team }, contactId: { not: null }, occurredAt: { gte: since } }, select: { contactId: true, interaction: true, type: true, occurredAt: true, subject: true, companyId: true, ownerId: true }, orderBy: { occurredAt: 'desc' }, take: 5000 });
        const latest = new Map<string, (typeof acts)[number]>();
        for (const a of acts) if (!latest.has(a.contactId!)) latest.set(a.contactId!, a);
        const waiting = [...latest.values()].filter((a) => a.interaction === 'EMAIL_SENT' || (!a.interaction && a.type === 'EMAIL'));
        const replied = waiting.length
          ? new Set((await tx.emailMessage.findMany({ where: { tenantId: t, direction: 'INBOUND', contactId: { in: waiting.map((w) => w.contactId!) }, sentAt: { gte: since } }, select: { contactId: true, sentAt: true } })).filter((e) => e.sentAt > (latest.get(e.contactId!)?.occurredAt ?? c.now)).map((e) => e.contactId))
          : new Set<string | null>();
        const rows = waiting.filter((w) => !replied.has(w.contactId)).sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
        const shown = rows.slice(0, TAKE);
        const [contacts, p] = await Promise.all([
          tx.contact.findMany({ where: { tenantId: t, id: { in: shown.map((r) => r.contactId!) } }, select: { id: true, firstName: true, lastName: true } }),
          refs(shown.map((r) => r.ownerId)),
        ]);
        const name = new Map(contacts.map((x) => [x.id, [x.firstName, x.lastName].filter(Boolean).join(' ')]));
        return {
          id: 'teamAwaiting', label: null, total: rows.length,
          items: shown.map((r): WorkItem => ({ kind: 'contact', id: r.contactId!, title: name.get(r.contactId!) ?? '', subtitle: r.subject, href: `/app/contacts/${r.contactId}`, at: r.occurredAt.toISOString(), priority: null, overdue: false, from: null, assignee: who(p, r.ownerId), companyId: r.companyId })),
        };
      },
      teamRfqDeadlines: async () => {
        const where: Prisma.RfqWhereInput = { tenantId: t, deletedAt: null, ownerId: { in: team }, status: { in: ['RECEIVED', 'UNDER_EVALUATION', 'PRICING', 'ON_HOLD'] }, deadlineAt: { lt: fortnight, not: null } };
        const [rows, total] = await Promise.all([tx.rfq.findMany({ where, orderBy: { deadlineAt: 'asc' }, take: TAKE, select: { id: true, number: true, projectName: true, deadlineAt: true, ownerId: true, companyId: true } }), tx.rfq.count({ where })]);
        const p = await refs(rows.map((r) => r.ownerId));
        return { id: 'teamRfqDeadlines', label: null, total, items: rows.map((r): WorkItem => ({ kind: 'rfq', id: r.id, title: `${r.number} ${r.projectName}`, subtitle: null, href: `/app/rfqs?open=${r.id}`, at: r.deadlineAt?.toISOString() ?? null, priority: null, overdue: !!r.deadlineAt && r.deadlineAt < c.now, from: null, assignee: who(p, r.ownerId), companyId: r.companyId })) };
      },
      teamConcerns: async () => {
        const owned = (await tx.company.findMany({ where: { tenantId: t, deletedAt: null, ownerId: { in: team } }, select: { id: true } })).map((x) => x.id);
        const where: Prisma.EscalationWhereInput = { tenantId: t, status: 'OPEN', OR: [{ ownerId: { in: team } }, { managerId: { in: team } }, ...(owned.length ? [{ companyId: { in: owned } }] : [])] };
        const [rows, total] = await Promise.all([tx.escalation.findMany({ where, orderBy: [{ deadlineAt: 'asc' }, { createdAt: 'asc' }], take: TAKE, select: { id: true, title: true, severity: true, category: true, companyId: true, createdAt: true, deadlineAt: true, ownerId: true } }), tx.escalation.count({ where })]);
        const p = await refs(rows.map((r) => r.ownerId));
        return { id: 'teamConcerns', label: null, total, items: rows.map((r): WorkItem => ({ kind: 'concern', id: r.id, title: r.title, subtitle: r.category ?? r.severity, href: `/app/companies/${r.companyId}?concern=${r.id}`, at: (r.deadlineAt ?? r.createdAt).toISOString(), priority: r.severity, overdue: !!r.deadlineAt && r.deadlineAt < c.now, from: null, assignee: who(p, r.ownerId), companyId: r.companyId })) };
      },
      unassigned: async () => {
        const where: Prisma.CompanyWhereInput = { tenantId: t, deletedAt: null, OR: [{ ownerId: null }, { ownerId: { isSet: false } }] };
        const [rows, total] = await Promise.all([tx.company.findMany({ where, orderBy: { createdAt: 'desc' }, take: TAKE, select: { id: true, name: true, leadNumber: true, country: true, createdAt: true } }), tx.company.count({ where })]);
        return { id: 'unassigned', label: null, total, items: rows.map((r): WorkItem => ({ kind: 'company', id: r.id, title: r.leadNumber ? `${r.leadNumber} ${r.name}` : r.name, subtitle: r.country, href: `/app/companies/${r.id}`, at: r.createdAt.toISOString(), priority: null, overdue: false, from: null, assignee: null, companyId: r.id })) };
      },
      intervention: async () => {
        // Transfer requests from the team waiting on a decision, and concerns escalated to the manager.
        const others = team.filter((u) => u !== managerId);
        const [transfers, escalated] = await Promise.all([
          others.length && c.features.has('lead_transfers') ? tx.leadTransfer.findMany({ where: { tenantId: t, status: 'PENDING', requestedById: { in: others } }, orderBy: { createdAt: 'asc' }, take: 50 }) : Promise.resolve([]),
          tx.escalation.findMany({ where: { tenantId: t, status: 'OPEN', escalatedToId: managerId }, orderBy: { escalatedAt: 'asc' }, take: 50, select: { id: true, title: true, severity: true, companyId: true, escalatedAt: true, escalatedById: true, deadlineAt: true } }),
        ]);
        const companies = new Map((await tx.company.findMany({ where: { tenantId: t, id: { in: transfers.map((x) => x.companyId) } }, select: { id: true, name: true, leadNumber: true } })).map((x) => [x.id, x]));
        const p = await refs([...transfers.map((x) => x.requestedById), ...escalated.map((x) => x.escalatedById)]);
        const items: WorkItem[] = [
          ...transfers.map((x): WorkItem => {
            const co = companies.get(x.companyId);
            return { kind: 'transfer', id: x.id, title: co ? (co.leadNumber ? `${co.leadNumber} ${co.name}` : co.name) : '', subtitle: x.reason, href: `/app?view=manager&transfer=${x.id}`, at: x.createdAt.toISOString(), priority: null, overdue: false, from: who(p, x.requestedById), assignee: who(p, x.requestedById), companyId: x.companyId };
          }),
          ...escalated.map((x): WorkItem => ({ kind: 'concern', id: x.id, title: x.title, subtitle: x.severity, href: `/app/companies/${x.companyId}?concern=${x.id}`, at: x.escalatedAt?.toISOString() ?? null, priority: x.severity, overdue: !!x.deadlineAt && x.deadlineAt < c.now, from: who(p, x.escalatedById), assignee: null, companyId: x.companyId })),
        ];
        return { id: 'intervention', label: null, total: items.length, items: items.slice(0, TAKE) };
      },
    };
    const saved = layout?.workSections ?? [];
    const order = [...saved.map((w) => w.id).filter((id) => id in buckets), ...MONITOR_SECTIONS.filter((id) => !saved.some((w) => w.id === id))];
    const hidden = new Set(saved.filter((w) => w.hidden).map((w) => w.id));
    const out: WorkBucket[] = [];
    for (const id of order) if (!hidden.has(id)) out.push(await buckets[id]!());
    return out;
  }
}

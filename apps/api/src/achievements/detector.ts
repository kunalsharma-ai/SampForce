import type { Prisma, TenantTx } from '@dealflow/database';
import {
  type AchievementDetails,
  type AchievementKind,
  type AchievementLevel,
  type AchievementPeriod,
  type AchievementTargetSource,
  ACHIEVEMENT_CATEGORY_OF,
  CONSISTENCY_MAX_MINUTES,
  CONSISTENCY_MIN_MINUTES,
  DEALS_WON_MILESTONES,
  LEAD_MILESTONES,
  type LeadProgress,
  type RateTable,
  type SalesProgress,
  sessionMinutes,
  startOfDayIn,
  toBase,
} from '@dealflow/types';
import { Metrics, r2 } from '../command-center/metrics';
import { loadRates } from '../revenue/fx';
import { branchUserIds } from '../workspaces/access';

/** An achievement about to be recorded. The dedupe key makes the second attempt a no-op. */
export interface Candidate {
  userId: string;
  kind: AchievementKind;
  level: AchievementLevel;
  dedupeKey: string;
  details: AchievementDetails;
  entityType: string | null;
  entityId: string | null;
  link: string | null;
}

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const candidate = (c: Omit<Candidate, 'entityType' | 'entityId' | 'link'> & Partial<Candidate>): Candidate => ({ entityType: null, entityId: null, link: null, ...c });

/** The calendar day, week (from Monday) and month around `now`, in the workspace time zone. */
export function personalRange(period: Exclude<AchievementPeriod, 'QUARTER'>, now: Date, tz: string): { start: Date; end: Date; label: string } {
  const dayStart = startOfDayIn(now, tz);
  const local = new Date(dayStart.getTime() + 12 * 3_600_000); // a moment safely inside the local day
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(local);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const y = Number(get('year'));
  const m = Number(get('month'));
  const d = Number(get('day'));
  if (period === 'DAY') return { start: dayStart, end: startOfDayIn(new Date(dayStart.getTime() + DAY + 3 * 3_600_000), tz), label: `${y}-${pad(m)}-${pad(d)}` };
  if (period === 'WEEK') {
    const back = (['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 7) % 7;
    const start = startOfDayIn(new Date(dayStart.getTime() - back * DAY + 12 * 3_600_000), tz);
    const end = startOfDayIn(new Date(start.getTime() + 7 * DAY + 12 * 3_600_000), tz);
    const s = new Date(start.getTime() + 12 * 3_600_000);
    return { start, end, label: new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(s) };
  }
  const start = startOfDayIn(new Date(Date.UTC(y, m - 1, 1, 12)), tz);
  const end = startOfDayIn(new Date(Date.UTC(y, m, 1, 12)), tz);
  return { start, end, label: `${y}-${pad(m)}` };
}

const LEAD_PERIOD = { DAY: 'DAILY', WEEK: 'WEEKLY', MONTH: 'MONTHLY' } as const;

/**
 * Works out which achievements the changes of one transaction earned (ADR 0090). It runs at the end of that
 * transaction, so it sees every change (the deal's revenue record, the company's won deal) and commits with them.
 * Every figure is read from the stored records.
 */
export class Detector {
  private tenant: { tz: string; currency: string } | null = null;
  private rates: RateTable | null = null;
  private readonly settingsCache = new Map<string, Prisma.AchievementSettingsGetPayload<object> | null>();
  readonly now = new Date();

  constructor(
    readonly tx: TenantTx,
    readonly tenantId: string,
  ) {}

  async info(): Promise<{ tz: string; currency: string }> {
    if (!this.tenant) {
      const t = await this.tx.tenant.findUniqueOrThrow({ where: { id: this.tenantId }, select: { defaultTimezone: true, defaultCurrency: true } });
      this.tenant = { tz: t.defaultTimezone || 'UTC', currency: t.defaultCurrency };
    }
    return this.tenant;
  }

  private async rateTable(): Promise<RateTable> {
    this.rates ??= await loadRates(this.tx, this.tenantId);
    return this.rates;
  }

  async settingsOf(userId: string): Promise<Prisma.AchievementSettingsGetPayload<object> | null> {
    if (this.settingsCache.has(userId)) return this.settingsCache.get(userId)!;
    const s = await this.tx.achievementSettings.findUnique({ where: { tenantId_userId: { tenantId: this.tenantId, userId } } });
    this.settingsCache.set(userId, s);
    return s;
  }

  private async nodeOf(userId: string): Promise<string | null> {
    const m = await this.tx.membership.findFirst({ where: { tenantId: this.tenantId, userId, status: 'ACTIVE' }, select: { workspaceNodeId: true } });
    return m?.workspaceNodeId ?? null;
  }

  // ─── Deals ───

  /** A company was converted into a won deal with its Won action (ADR 0084). */
  async dealConverted(userId: string, companyId: string, dealId: string | undefined): Promise<Candidate | null> {
    const company = await this.tx.company.findFirst({ where: { id: companyId, tenantId: this.tenantId, deletedAt: null }, select: { id: true, name: true, wonDealId: true } });
    const id = dealId ?? company?.wonDealId;
    if (!company || !id) return null;
    const deal = await this.tx.opportunity.findFirst({ where: { id, tenantId: this.tenantId, deletedAt: null }, select: { id: true, name: true, dealNumber: true, amount: true, currency: true, stage: { select: { name: true } } } });
    if (!deal) return null;
    return candidate({
      userId, kind: 'DEAL_CONVERTED', level: 'MAJOR', dedupeKey: `company-won:${company.id}`,
      details: { companyId: company.id, companyName: company.name, dealId: deal.id, dealName: deal.name, dealNumber: deal.dealNumber, amount: Number(deal.amount), currency: deal.currency, stage: deal.stage?.name ?? null },
      entityType: 'deal', entityId: deal.id, link: `/app/deals/${deal.id}`,
    });
  }

  /** A lead was converted and a deal made from it. */
  async prospectConverted(userId: string, leadId: string, dealId: string | undefined): Promise<Candidate | null> {
    if (!dealId) return null;
    const [lead, deal] = await Promise.all([
      this.tx.lead.findFirst({ where: { id: leadId, tenantId: this.tenantId }, select: { fullName: true, companyName: true } }),
      this.tx.opportunity.findFirst({ where: { id: dealId, tenantId: this.tenantId, deletedAt: null }, select: { id: true, name: true, dealNumber: true, amount: true, currency: true, stage: { select: { name: true } }, company: { select: { id: true, name: true } } } }),
    ]);
    if (!lead || !deal) return null;
    return candidate({
      userId, kind: 'PROSPECT_CONVERTED', level: 'DAILY', dedupeKey: `lead-converted:${leadId}`,
      details: { companyId: deal.company?.id, companyName: deal.company?.name ?? lead.companyName ?? lead.fullName, dealId: deal.id, dealName: deal.name, dealNumber: deal.dealNumber, amount: Number(deal.amount), currency: deal.currency, stage: deal.stage?.name ?? null },
      entityType: 'deal', entityId: deal.id, link: `/app/deals/${deal.id}`,
    });
  }

  /** A deal was won: won-deal milestones, a major deal and sales targets of its owner. */
  async dealWon(dealId: string, actorId: string): Promise<Candidate[]> {
    const deal = await this.tx.opportunity.findFirst({ where: { id: dealId, tenantId: this.tenantId, deletedAt: null, status: 'WON' }, select: { id: true, name: true, dealNumber: true, amount: true, currency: true, ownerId: true, company: { select: { id: true, name: true } } } });
    if (!deal) return [];
    const owner = deal.ownerId ?? actorId;
    const out: Candidate[] = [];
    const { currency } = await this.info();
    const rates = await this.rateTable();
    const base = { dealId: deal.id, dealName: deal.name, dealNumber: deal.dealNumber, companyId: deal.company?.id, companyName: deal.company?.name };

    const won = await this.tx.opportunity.findMany({ where: { tenantId: this.tenantId, ownerId: owner, status: 'WON', deletedAt: null }, select: { id: true, amount: true, currency: true }, take: 5000 });
    const n = won.length;
    if ((DEALS_WON_MILESTONES as readonly number[]).includes(n)) {
      out.push(candidate({ userId: owner, kind: 'DEALS_WON_MILESTONE', level: n >= 100 ? 'EXCEPTIONAL' : 'MAJOR', dedupeKey: `deals-won:${n}`, details: { ...base, count: n, amount: Number(deal.amount), currency: deal.currency }, entityType: 'deal', entityId: deal.id, link: `/app/deals/${deal.id}` }));
    }

    const value = toBase(Number(deal.amount), deal.currency, currency, rates);
    if (value !== null && value > 0) {
      const settings = await this.settingsOf(owner);
      const others = won.filter((w) => w.id !== deal.id).map((w) => toBase(Number(w.amount), w.currency, currency, rates)).filter((v): v is number => v !== null);
      const best = others.length ? Math.max(...others) : null;
      const bigEnough = !!settings?.majorDealAmount && value >= settings.majorDealAmount;
      const personalBest = others.length >= 3 && best !== null && value > best;
      if (bigEnough || personalBest) {
        out.push(candidate({ userId: owner, kind: 'MAJOR_DEAL', level: 'EXCEPTIONAL', dedupeKey: `major-deal:${deal.id}`, details: { ...base, amount: r2(value), currency, previousBest: best === null ? null : r2(best), target: settings?.majorDealAmount ?? undefined }, entityType: 'deal', entityId: deal.id, link: `/app/deals/${deal.id}` }));
      }
    }

    for (const p of await this.salesProgress(owner)) {
      if (p.actual < p.target) continue;
      out.push(candidate({
        userId: owner, kind: 'SALES_TARGET', level: p.period === 'QUARTER' ? 'EXCEPTIONAL' : 'MAJOR', dedupeKey: `sales-target:${p.key}`,
        details: { ...base, metric: p.metric, period: p.period, periodLabel: p.periodLabel, target: p.target, actual: p.actual, percent: p.percent, targetSource: p.targetSource, currency: p.currency },
        entityType: 'deal', entityId: deal.id, link: '/app/achievements',
      }));
    }
    return out;
  }

  /**
   * The person's running monthly and quarterly sales targets with what they reached: targets a manager or the Super
   * Workspace set for their workspace, forecast targets for them (ADR 0024), and their personal monthly revenue target
   * when no assigned revenue target covers the month.
   */
  async salesProgress(userId: string): Promise<(SalesProgress & { key: string })[]> {
    const { currency } = await this.info();
    const rates = await this.rateTable();
    const now = this.now;
    const metrics = (users: string[], start: Date, end: Date) => new Metrics(this.tx, { tenantId: this.tenantId, users, start, end, now, todayStart: now, tomorrowStart: now }, currency, rates);
    const pct = (a: number, t: number) => (t > 0 ? Math.floor((a / t) * 1000) / 10 : 0);
    const out: (SalesProgress & { key: string })[] = [];

    const node = await this.nodeOf(userId);
    let assignedMonthlyRevenue = false;
    if (node) {
      const targets = await this.tx.workspaceTarget.findMany({
        where: { tenantId: this.tenantId, workspaceNodeId: node, archivedAt: null, metric: { in: ['REVENUE', 'DEALS_WON'] }, period: { in: ['MONTHLY', 'QUARTERLY'] }, startsAt: { lte: now }, endsAt: { gt: now } },
      });
      const users = targets.length ? await branchUserIds(this.tx, this.tenantId, node) : [];
      for (const t of targets) {
        const rev = await metrics(users, t.startsAt, t.endsAt).revenue();
        const actual = t.metric === 'REVENUE' ? r2(rev.amount) : rev.deals;
        if (t.metric === 'REVENUE' && t.period === 'MONTHLY') assignedMonthlyRevenue = true;
        out.push({ key: `ws:${t.id}`, metric: t.metric as 'REVENUE' | 'DEALS_WON', period: t.period === 'QUARTERLY' ? 'QUARTER' : 'MONTH', periodLabel: t.startsAt.toISOString().slice(0, 10), target: t.amount, targetSource: 'ASSIGNED', actual, percent: pct(actual, t.amount), currency: t.metric === 'REVENUE' ? currency : null });
      }
    }

    // Forecast targets are kept per calendar month and quarter (UTC), labelled 2026-11 and 2026-Q4.
    const y = now.getUTCFullYear();
    const mo = now.getUTCMonth();
    const q = Math.floor(mo / 3);
    const monthLabel = `${y}-${pad(mo + 1)}`;
    const quarterLabel = `${y}-Q${q + 1}`;
    const forecast = await this.tx.salesTarget.findMany({ where: { tenantId: this.tenantId, userId, period: { in: [monthLabel, quarterLabel] } } });
    for (const f of forecast) {
      const quarter = f.period === quarterLabel;
      const start = new Date(Date.UTC(y, quarter ? q * 3 : mo, 1));
      const end = new Date(Date.UTC(y, quarter ? q * 3 + 3 : mo + 1, 1));
      const actual = r2((await metrics([userId], start, end).revenue()).amount);
      out.push({ key: `forecast:${f.period}`, metric: 'REVENUE', period: quarter ? 'QUARTER' : 'MONTH', periodLabel: f.period, target: f.amount, targetSource: 'FORECAST', actual, percent: pct(actual, f.amount), currency });
    }

    const settings = await this.settingsOf(userId);
    if (settings?.monthlyRevenueTarget && !assignedMonthlyRevenue) {
      const { tz } = await this.info();
      const r = personalRange('MONTH', now, tz);
      const actual = r2((await metrics([userId], r.start, r.end).revenue()).amount);
      out.push({ key: `personal:${r.label}:${settings.monthlyRevenueTarget}`, metric: 'REVENUE', period: 'MONTH', periodLabel: r.label, target: settings.monthlyRevenueTarget, targetSource: 'PERSONAL', actual, percent: pct(actual, settings.monthlyRevenueTarget), currency });
    }
    return out;
  }

  // ─── RFQs ───

  /** SampBidx confirmed it has the RFQ (called only after it accepted the send). */
  async rfqSubmitted(userId: string, transferId: string): Promise<Candidate | null> {
    const t = await this.tx.sampbidxTransfer.findFirst({ where: { id: transferId, tenantId: this.tenantId, delivery: 'SENT' }, select: { id: true, kind: true, title: true, rfqId: true, companyId: true, remoteId: true, sentAt: true } });
    if (!t || t.kind === 'CLIENT') return null;
    const [rfq, company] = await Promise.all([
      t.rfqId ? this.tx.rfq.findFirst({ where: { id: t.rfqId, tenantId: this.tenantId }, select: { number: true, projectName: true, companyId: true } }) : null,
      t.companyId ? this.tx.company.findFirst({ where: { id: t.companyId, tenantId: this.tenantId }, select: { id: true, name: true } }) : null,
    ]);
    const companyRow = company ?? (rfq?.companyId ? await this.tx.company.findFirst({ where: { id: rfq.companyId, tenantId: this.tenantId }, select: { id: true, name: true } }) : null);
    return candidate({
      userId, kind: 'RFQ_SUBMITTED', level: 'DAILY', dedupeKey: t.rfqId ? `rfq:${t.rfqId}` : `rfq-transfer:${t.id}`,
      details: { rfqId: t.rfqId, rfqNumber: rfq?.number ?? null, rfqTitle: rfq?.projectName ?? t.title, reference: t.remoteId, destination: 'SampBidx', companyId: companyRow?.id, companyName: companyRow?.name },
      entityType: t.rfqId ? 'rfq' : 'sampbidx_transfer', entityId: t.rfqId ?? t.id, link: t.rfqId ? `/app/rfqs?open=${t.rfqId}` : '/app/rfqs?tab=sampbidx',
    });
  }

  // ─── Tasks ───

  /** A high-priority task or a client follow-up was completed. Ordinary tasks get no celebration. */
  async taskImportant(userId: string, taskId: string): Promise<Candidate | null> {
    const task = await this.tx.task.findFirst({ where: { id: taskId, tenantId: this.tenantId, deletedAt: null, status: 'DONE' }, select: { id: true, title: true, priority: true, followUpType: true, companyId: true } });
    if (!task) return null;
    const followUp = !!task.followUpType;
    if (task.priority !== 'HIGH' && !followUp) return null;
    const company = task.companyId ? await this.tx.company.findFirst({ where: { id: task.companyId, tenantId: this.tenantId }, select: { id: true, name: true } }) : null;
    return candidate({
      userId, kind: 'TASK_IMPORTANT', level: 'ROUTINE', dedupeKey: `task:${task.id}`,
      details: { taskId: task.id, taskTitle: task.title, priority: task.priority, followUp, companyId: company?.id, companyName: company?.name },
      entityType: 'task', entityId: task.id, link: followUp ? '/app/follow-ups' : '/app/tasks',
    });
  }

  /** What is due for the person today: done, still open (with anything overdue), and whether all were done in time. */
  async todaysTasks(userId: string) {
    const { tz } = await this.info();
    const day = personalRange('DAY', this.now, tz);
    const [due, open] = await Promise.all([
      this.tx.task.findMany({ where: { tenantId: this.tenantId, assigneeId: userId, deletedAt: null, status: { not: 'CANCELED' }, dueAt: { gte: day.start, lt: day.end } }, select: { status: true, dueAt: true, completedAt: true }, take: 2000 }),
      this.tx.task.count({ where: { tenantId: this.tenantId, assigneeId: userId, deletedAt: null, status: 'OPEN', dueAt: { lt: day.end } } }),
    ]);
    const done = due.filter((t) => t.status === 'DONE');
    // A task due at midnight (a due date without a time) is on time when finished that day.
    const onTime = done.every((t) => !!t.completedAt && t.dueAt && (t.completedAt <= t.dueAt || (t.dueAt.getTime() === startOfDayIn(t.dueAt, tz).getTime() && t.completedAt < day.end)));
    return { day, due: due.length, done: done.length, open, onTime };
  }

  /** Every task due today is done (at least two of them), and nothing overdue is left. Once a day. */
  async allTasksDone(userId: string): Promise<Candidate | null> {
    const t = await this.todaysTasks(userId);
    if (t.due < 2 || t.done !== t.due || t.open > 0) return null;
    return candidate({ userId, kind: 'ALL_TASKS_DONE', level: 'DAILY', dedupeKey: `all-tasks:${t.day.label}`, details: { tasksDone: t.done, onTime: t.onTime, periodLabel: t.day.label, period: 'DAY' }, link: '/app/tasks' });
  }

  // ─── Leads ───

  /**
   * Valid leads (companies) the people added in [start, end): a name and at least one way to reach or identify the
   * company (website, email, phone or LinkedIn), and not a repeat of a company already in SampForce.
   */
  async validLeads(users: string[], start: Date, end: Date): Promise<{ counted: number; notCounted: number }> {
    if (!users.length) return { counted: 0, notCounted: 0 };
    const rows = await this.tx.company.findMany({
      where: { tenantId: this.tenantId, deletedAt: null, createdById: { in: users }, createdAt: { gte: start, lt: end } },
      select: { id: true, name: true, domain: true, website: true, primaryEmail: true, primaryPhone: true, linkedinUrl: true, createdAt: true },
      take: 20_000,
    });
    const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
    const complete = rows.filter((r) => norm(r.name) && (norm(r.domain) || norm(r.website) || norm(r.primaryEmail) || norm(r.primaryPhone) || norm(r.linkedinUrl)));
    const domains = [...new Set(complete.map((r) => r.domain).filter((d): d is string => !!d))];
    const names = [...new Set(complete.map((r) => r.name))];
    const others = complete.length
      ? await this.tx.company.findMany({ where: { tenantId: this.tenantId, deletedAt: null, OR: [...(domains.length ? [{ domain: { in: domains } }] : []), { name: { in: names } }] }, select: { id: true, name: true, domain: true, createdAt: true }, take: 20_000 })
      : [];
    const earlier = (a: { id: string; createdAt: Date }, b: { id: string; createdAt: Date }) => a.createdAt < b.createdAt || (a.createdAt.getTime() === b.createdAt.getTime() && a.id < b.id);
    const counted = complete.filter((c) => !others.some((o) => o.id !== c.id && earlier(o, c) && ((!!c.domain && norm(o.domain) === norm(c.domain)) || norm(o.name) === norm(c.name)))).length;
    return { counted, notCounted: rows.length - counted };
  }

  /** The lead target for one period, the leads counted against it and the progress. */
  async leadProgress(userId: string, period: Exclude<AchievementPeriod, 'QUARTER'>): Promise<LeadProgress & { key: string }> {
    const { tz } = await this.info();
    const node = await this.nodeOf(userId);
    const assigned = node
      ? await this.tx.workspaceTarget.findFirst({ where: { tenantId: this.tenantId, workspaceNodeId: node, archivedAt: null, metric: 'LEADS', period: LEAD_PERIOD[period], startsAt: { lte: this.now }, endsAt: { gt: this.now } }, orderBy: { createdAt: 'desc' } })
      : null;
    let target: number | null = null;
    let source: AchievementTargetSource | null = null;
    let range = personalRange(period, this.now, tz);
    let users = [userId];
    let key = `${period}:${range.label}`;
    if (assigned) {
      target = assigned.amount;
      source = 'ASSIGNED';
      // An assigned target counts everyone in the workspace, as the Targets page does.
      range = { start: assigned.startsAt, end: assigned.endsAt, label: assigned.startsAt.toISOString().slice(0, 10) };
      users = await branchUserIds(this.tx, this.tenantId, node!);
      if (!users.includes(userId)) users.push(userId);
      key = `${period}:${range.label}:ws:${assigned.id}`;
    } else {
      const s = await this.settingsOf(userId);
      const personal = period === 'DAY' ? s?.dailyLeadTarget : period === 'WEEK' ? s?.weeklyLeadTarget : s?.monthlyLeadTarget;
      if (personal) {
        target = personal;
        source = 'PERSONAL';
      }
    }
    const { counted, notCounted } = await this.validLeads(users, range.start, range.end);
    const percent = target ? Math.floor((counted / target) * 100) : 0;
    return { key: `${key}:${target ?? 0}`, period, periodLabel: range.label, target, targetSource: source, actual: counted, percent, remaining: target ? Math.max(0, target - counted) : 0, notCounted };
  }

  /** Daily milestones (25, 50, 75 percent), and the daily, weekly and monthly targets themselves. */
  async leadTargets(userId: string): Promise<Candidate[]> {
    const out: Candidate[] = [];
    for (const period of ['DAY', 'WEEK', 'MONTH'] as const) {
      const p = await this.leadProgress(userId, period);
      if (!p.target) continue;
      const details: AchievementDetails = { metric: 'LEADS', period, periodLabel: p.periodLabel, target: p.target, actual: p.actual, percent: Math.min(p.percent, 100), remaining: p.remaining, targetSource: p.targetSource ?? undefined };
      if (p.percent >= 100) {
        out.push(candidate({ userId, kind: 'LEAD_TARGET', level: period === 'DAY' ? 'DAILY' : 'MAJOR', dedupeKey: `leads:${p.key}:100`, details, link: '/app/achievements' }));
        continue;
      }
      if (period !== 'DAY') continue;
      // Only the highest milestone reached: jumping from 20% to 80% gives one celebration, not three.
      const m = [...LEAD_MILESTONES].reverse().find((x) => p.percent >= x);
      if (m) out.push(candidate({ userId, kind: 'LEAD_MILESTONE', level: 'ROUTINE', dedupeKey: `leads:${p.key}:${m}`, details: { ...details, percent: m }, link: '/app/achievements' }));
    }
    return out;
  }

  // ─── Consistency ───

  /**
   * A steady working day, recognised responsibly: a check-out the person made (not a forgotten session SampForce
   * closed), between 4 and 10 working hours (longer days are never rewarded), no unplanned interruption (Away, chosen
   * or automatic), and every task due today done. Breaks are planned time off: they never count against the day.
   */
  async consistency(userId: string, sessionId: string): Promise<Candidate | null> {
    const s = await this.tx.workSession.findFirst({ where: { id: sessionId, tenantId: this.tenantId, userId } });
    if (!s || !s.checkedOutAt || s.autoClosed) return null;
    const breaks = (Array.isArray(s.breaks) ? (s.breaks as { start: string; end: string | null }[]) : []).map((b) => ({ start: new Date(b.start), end: b.end ? new Date(b.end) : null }));
    const m = sessionMinutes({ checkedInAt: s.checkedInAt, checkedOutAt: s.checkedOutAt, breaks }, this.now);
    if (m.workedMinutes < CONSISTENCY_MIN_MINUTES || m.workedMinutes > CONSISTENCY_MAX_MINUTES) return null;
    const interruptions = await this.tx.availabilityEvent.count({ where: { tenantId: this.tenantId, sessionId, OR: [{ kind: 'AWAY_ENDED' }, { kind: 'STATUS', status: 'AWAY' }] } });
    if (interruptions > 0) return null;
    const t = await this.todaysTasks(userId);
    if (t.open > 0) return null;
    return candidate({
      userId, kind: 'CONSISTENCY', level: 'DAILY', dedupeKey: `consistency:${t.day.label}`,
      details: { workedMinutes: m.workedMinutes, breakMinutes: m.breakMinutes, breaks: breaks.length, tasksDone: t.done, period: 'DAY', periodLabel: t.day.label },
      link: '/app/achievements',
    });
  }
}

export const categoryOf = (kind: AchievementKind) => ACHIEVEMENT_CATEGORY_OF[kind];

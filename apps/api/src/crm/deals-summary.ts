import type { Prisma, TenantTx } from '@dealflow/database';
import type { DealsBreakdownRow, DealsMetric, DealsSummary } from '@dealflow/types';
import { ownerRefs } from './crm-helpers';

const DAY = 86_400_000;
/** At most this many deals are read for each part of the summary; far more than any real workspace's dashboard needs. */
const CAP = 20_000;
const round = (v: number) => Math.round(v * 100) / 100;
const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const metric = (): DealsMetric => ({ count: 0, value: 0 });
const add = (m: DealsMetric, value: number) => {
  m.count += 1;
  m.value += value;
};

interface Row {
  id: string;
  name: string;
  amount: number;
  currency: string;
  probability: number | null;
  stageId: string;
  pipelineId: string;
  status: 'OPEN' | 'WON' | 'LOST';
  expectedCloseDate: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | null;
  ownerId: string | null;
  managerId: string | null;
  companyId: string | null;
}

/**
 * The numbers behind the Deals dashboard (ADR 0096), from the deals `where` reaches (record visibility and the
 * dashboard's pipeline and owner filters); archived and deleted deals are left out. `from`/`to` bound the created,
 * won and lost figures (UTC days, inclusive). Calendar months are UTC, like the forecast view.
 */
export async function dealsSummary(
  tx: TenantTx,
  tenantId: string,
  where: Prisma.OpportunityWhereInput,
  f: { pipelineId?: string; from?: string; to?: string },
  now = new Date(),
): Promise<DealsSummary> {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { defaultCurrency: true } });
  const currency = tenant.defaultCurrency;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const trendStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const in30 = new Date(today.getTime() + 31 * DAY);
  const stalledBefore = new Date(now.getTime() - 14 * DAY);
  const from = f.from ? new Date(`${f.from}T00:00:00.000Z`) : null;
  const to = f.to ? new Date(new Date(`${f.to}T00:00:00.000Z`).getTime() + DAY) : null;
  const inRange = (d: Date | null) => !!d && (!from || d >= from) && (!to || d < to);

  const [rows, stages] = await Promise.all([
    tx.opportunity.findMany({
      where: { ...where, tenantId, deletedAt: null, archivedAt: null },
      select: {
        id: true, name: true, amount: true, currency: true, probability: true, stageId: true, pipelineId: true, status: true, expectedCloseDate: true,
        closedAt: true, createdAt: true, updatedAt: true, priority: true, ownerId: true, managerId: true, companyId: true,
      },
      take: CAP,
    }) as Promise<Row[]>,
    tx.pipelineStage.findMany({ where: { tenantId }, select: { id: true, name: true, probability: true } }),
  ]);
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const amountOf = (r: Row) => (r.currency === currency ? r.amount : 0);

  const s: DealsSummary = {
    currency,
    otherCurrencyCount: rows.filter((r) => r.currency !== currency).length,
    range: { from: f.from ?? null, to: f.to ?? null },
    total: metric(),
    open: { ...metric(), weighted: 0 },
    created: metric(),
    won: metric(),
    lost: metric(),
    conversionRate: null,
    averageWon: null,
    averageOpen: null,
    averageCycleDays: null,
    createdThisMonth: metric(),
    closedThisMonth: metric(),
    overdue: metric(),
    closingNext30Days: metric(),
    noCloseDate: 0,
    stalled: 0,
    priorities: { HIGH: 0, MEDIUM: 0, LOW: 0, NONE: 0 },
    trend: [],
    pipeline: null,
    stages: [],
    byOwner: [],
    byManager: [],
    byCompany: [],
    upcoming: [],
  };

  const groups = { owner: new Map<string, DealsBreakdownRow>(), manager: new Map<string, DealsBreakdownRow>(), company: new Map<string, DealsBreakdownRow>() };
  const group = (map: Map<string, DealsBreakdownRow>, id: string | null) => {
    const key = id ?? '';
    let row = map.get(key);
    if (!row) map.set(key, (row = { ref: id ? { id, name: '' } : null, open: metric(), won: metric(), lost: 0 }));
    return row;
  };
  const trend = new Map(
    Array.from({ length: 6 }, (_, i) => {
      const m = monthKey(new Date(Date.UTC(trendStart.getUTCFullYear(), trendStart.getUTCMonth() + i, 1)));
      return [m, { month: m, created: 0, won: 0, wonValue: 0, lost: 0 }];
    }),
  );
  let cycleDays = 0;
  const upcoming: Row[] = [];

  for (const r of rows) {
    const amount = amountOf(r);
    const touched = [group(groups.owner, r.ownerId), group(groups.manager, r.managerId), group(groups.company, r.companyId)];
    add(s.total, amount);
    if (inRange(r.createdAt)) add(s.created, amount);
    if (r.createdAt >= monthStart) add(s.createdThisMonth, amount);
    const createdMonth = trend.get(monthKey(r.createdAt));
    if (createdMonth) createdMonth.created += 1;

    if (r.status === 'OPEN') {
      add(s.open, amount);
      s.open.weighted += (amount * (r.probability ?? stageById.get(r.stageId)?.probability ?? 0)) / 100;
      for (const g of touched) add(g.open, amount);
      if (!r.expectedCloseDate) s.noCloseDate += 1;
      else if (r.expectedCloseDate < today) add(s.overdue, amount);
      else if (r.expectedCloseDate < in30) {
        add(s.closingNext30Days, amount);
        upcoming.push(r);
      }
      if (r.updatedAt < stalledBefore) s.stalled += 1;
      s.priorities[r.priority ?? 'NONE'] += 1;
      continue;
    }
    const closedAt = r.closedAt ?? r.updatedAt;
    if (closedAt >= monthStart) add(s.closedThisMonth, amount);
    const closedMonth = trend.get(monthKey(closedAt));
    if (r.status === 'WON') {
      if (closedMonth) {
        closedMonth.won += 1;
        closedMonth.wonValue += amount;
      }
      if (inRange(closedAt)) {
        add(s.won, amount);
        for (const g of touched) add(g.won, amount);
        cycleDays += Math.max(0, (closedAt.getTime() - r.createdAt.getTime()) / DAY);
      }
    } else {
      if (closedMonth) closedMonth.lost += 1;
      if (inRange(closedAt)) {
        add(s.lost, amount);
        for (const g of touched) g.lost += 1;
      }
    }
  }

  const decided = s.won.count + s.lost.count;
  s.conversionRate = decided ? Math.round((s.won.count / decided) * 100) : null;
  s.averageWon = s.won.count ? round(s.won.value / s.won.count) : null;
  s.averageOpen = s.open.count ? round(s.open.value / s.open.count) : null;
  s.averageCycleDays = s.won.count ? Math.round(cycleDays / s.won.count) : null;
  s.trend = [...trend.values()].map((t) => ({ ...t, wonValue: round(t.wonValue) }));

  // Stage funnel: the chosen pipeline, else the default one.
  const pipeline = await tx.pipeline.findFirst({
    where: { tenantId, deletedAt: null, ...(f.pipelineId ? { id: f.pipelineId } : {}) },
    orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
    include: { stages: { orderBy: { position: 'asc' } } },
  });
  if (pipeline) {
    s.pipeline = { id: pipeline.id, name: pipeline.name };
    const perStage = new Map<string, DealsMetric>();
    for (const r of rows) {
      if (r.pipelineId !== pipeline.id) continue;
      if (r.status !== 'OPEN' && !inRange(r.closedAt)) continue;
      const m = perStage.get(r.stageId) ?? metric();
      add(m, amountOf(r));
      perStage.set(r.stageId, m);
    }
    s.stages = pipeline.stages.map((st) => ({
      id: st.id, name: st.name, category: st.category, probability: st.probability,
      count: perStage.get(st.id)?.count ?? 0, value: round(perStage.get(st.id)?.value ?? 0),
    }));
  }

  // Names for the breakdowns: people for owners and managers, companies for companies.
  const top = (map: Map<string, DealsBreakdownRow>) =>
    [...map.values()].sort((a, b) => b.open.value - a.open.value || b.won.value - a.won.value || b.open.count - a.open.count).slice(0, 8);
  const owners = top(groups.owner);
  const managers = top(groups.manager);
  const companies = top(groups.company);
  upcoming.sort((a, b) => a.expectedCloseDate!.getTime() - b.expectedCloseDate!.getTime() || b.amount - a.amount);
  const soon = upcoming.slice(0, 8);
  const [people, companyNames] = await Promise.all([
    ownerRefs(tx, [...[...owners, ...managers].map((r) => r.ref?.id ?? null), ...soon.map((r) => r.ownerId)]),
    tx.company.findMany({ where: { tenantId, id: { in: [...new Set([...companies.map((r) => r.ref?.id), ...soon.map((r) => r.companyId)].filter((v): v is string => !!v))] } }, select: { id: true, name: true } }),
  ]);
  const companyName = new Map(companyNames.map((c) => [c.id, c.name]));
  const named = (rowsIn: DealsBreakdownRow[], name: (id: string) => string | undefined) =>
    rowsIn.map((r) => ({
      ref: r.ref ? { id: r.ref.id, name: name(r.ref.id) ?? '' } : null,
      open: { count: r.open.count, value: round(r.open.value) },
      won: { count: r.won.count, value: round(r.won.value) },
      lost: r.lost,
    }));
  s.byOwner = named(owners, (id) => people.get(id)?.name);
  s.byManager = named(managers, (id) => people.get(id)?.name);
  s.byCompany = named(companies, (id) => companyName.get(id));
  s.upcoming = soon.map((r) => ({
    id: r.id, name: r.name, amount: r.amount, currency: r.currency, expectedCloseDate: ymd(r.expectedCloseDate!),
    company: r.companyId && companyName.has(r.companyId) ? { id: r.companyId, name: companyName.get(r.companyId)! } : null,
    owner: r.ownerId ? (people.get(r.ownerId) ?? null) : null,
    stage: stageById.get(r.stageId)?.name ?? '',
  }));

  for (const m of [s.total, s.open, s.created, s.won, s.lost, s.createdThisMonth, s.closedThisMonth, s.overdue, s.closingNext30Days]) m.value = round(m.value);
  s.open.weighted = round(s.open.weighted);
  return s;
}

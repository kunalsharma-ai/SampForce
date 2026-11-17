import type { Prisma, TenantTx } from '@dealflow/database';
import {
  type DrillMetric,
  type DrillRow,
  type FunnelRow,
  FUNNEL_STAGES,
  type FunnelStage,
  funnelStageOf,
  type PersonRef,
  RFQ_OPEN_STATUSES,
  type RateTable,
  type RfqStatus,
  toBase,
} from '@dealflow/types';
import { personRefs } from '../crm/visibility';

/**
 * The numbers behind every Command Center card (ADR 0063), each counted from stored records for a set of people over
 * a period. `users: null` means everyone in the workspace (the organisation dashboard of someone who sees every
 * record); otherwise only records those people own, created, were assigned, or hold a revenue share of count.
 *
 * Each metric returns the ids of the records it counts, so a card's number and the list it opens always agree.
 */
export interface Scope {
  tenantId: string;
  users: string[] | null;
  start: Date;
  end: Date;
  now: Date;
  todayStart: Date;
  tomorrowStart: Date;
}

export const CAP = 20_000;
const DAY = 86_400_000;
const unset = (f: string) => [{ [f]: null }, { [f]: { isSet: false } }];
const inUsers = (s: Scope, field: string) => (s.users ? { [field]: { in: s.users } } : {});
const inRange = (s: Scope) => ({ gte: s.start, lt: s.end });

/** Logged interactions that reach out to a client, and the ones that are the client answering. */
export const OUTREACH_KINDS = ['EMAIL_SENT', 'CALL_OUTGOING', 'MEETING', 'LINKEDIN', 'WHATSAPP', 'RFQ_SUBMITTED', 'NEGOTIATION'];
export const RESPONSE_KINDS = ['EMAIL_RECEIVED', 'CALL_INCOMING'];

interface Money {
  amount: number;
  currency: string;
}

export class Metrics {
  private statusCache: Map<string, { name: string; color: string; meaning: string | null }> | null = null;
  private connCache: string[] | null = null;

  constructor(
    private readonly tx: TenantTx,
    readonly s: Scope,
    readonly base: string,
    readonly rates: RateTable,
  ) {}

  money(m: Money): number | null {
    return toBase(m.amount, m.currency, this.base, this.rates);
  }

  async statuses() {
    if (!this.statusCache) {
      const rows = await this.tx.crmStatus.findMany({ where: { tenantId: this.s.tenantId, kind: 'COMPANY' }, select: { id: true, name: true, color: true, meaning: true } });
      this.statusCache = new Map(rows.map((r) => [r.id, r]));
    }
    return this.statusCache;
  }

  private async statusIds(meanings: string[]): Promise<string[]> {
    return [...(await this.statuses()).entries()].filter(([, v]) => meanings.includes(v.meaning ?? 'ACTIVE')).map(([k]) => k);
  }

  /** Mailbox connections of the people in scope (synced email counts are theirs). */
  async connections(): Promise<string[]> {
    if (!this.connCache) {
      const rows = await this.tx.integrationConnection.findMany({ where: { tenantId: this.s.tenantId, ...inUsers(this.s, 'userId') }, select: { id: true } });
      this.connCache = rows.map((r) => r.id);
    }
    return this.connCache;
  }

  private companyBase(): Prisma.CompanyWhereInput {
    return { tenantId: this.s.tenantId, deletedAt: null };
  }

  // ─── Companies ───

  async leadsGenerated(range = true): Promise<string[]> {
    const rows = await this.tx.company.findMany({ where: { ...this.companyBase(), ...inUsers(this.s, 'createdById'), ...(range ? { createdAt: inRange(this.s) } : {}) }, select: { id: true }, take: CAP });
    return rows.map((r) => r.id);
  }

  async leadsBetween(start: Date, end: Date): Promise<number> {
    return this.tx.company.count({ where: { ...this.companyBase(), ...inUsers(this.s, 'createdById'), createdAt: { gte: start, lt: end } } });
  }

  async companies(): Promise<string[]> {
    const rows = await this.tx.company.findMany({ where: { ...this.companyBase(), ...inUsers(this.s, 'ownerId') }, select: { id: true }, take: CAP });
    return rows.map((r) => r.id);
  }

  /** Companies in a status that is not lost or on hold. */
  async activeCompanies(): Promise<string[]> {
    const idle = await this.statusIds(['LOST', 'ON_HOLD']);
    const rows = await this.tx.company.findMany({ where: { ...this.companyBase(), ...inUsers(this.s, 'ownerId'), ...(idle.length ? { statusId: { notIn: idle } } : {}) }, select: { id: true }, take: CAP });
    return rows.map((r) => r.id);
  }

  /** Clients: a client status, or a won deal or RFQ on record. */
  async existingClients(): Promise<string[]> {
    const client = await this.statusIds(['CLIENT']);
    const owned = await this.tx.company.findMany({ where: { ...this.companyBase(), ...inUsers(this.s, 'ownerId') }, select: { id: true, statusId: true }, take: CAP });
    const ids = owned.map((c) => c.id);
    const won = ids.length ? await this.tx.revenueRecord.findMany({ where: { tenantId: this.s.tenantId, voidedAt: null, companyId: { in: ids } }, select: { companyId: true } }) : [];
    const wonSet = new Set(won.map((w) => w.companyId));
    return owned.filter((c) => (c.statusId && client.includes(c.statusId)) || wonSet.has(c.id)).map((c) => c.id);
  }

  /** Of these companies, the clients: a client status, or a won deal or RFQ on record. */
  async clientsAmong(companyIds: string[]): Promise<string[]> {
    if (!companyIds.length) return [];
    const client = await this.statusIds(['CLIENT']);
    const [rows, won] = await Promise.all([
      this.tx.company.findMany({ where: { tenantId: this.s.tenantId, id: { in: companyIds } }, select: { id: true, statusId: true } }),
      this.tx.revenueRecord.findMany({ where: { tenantId: this.s.tenantId, voidedAt: null, companyId: { in: companyIds } }, select: { companyId: true } }),
    ]);
    const wonSet = new Set(won.map((w) => w.companyId));
    return rows.filter((c) => (c.statusId && client.includes(c.statusId)) || wonSet.has(c.id)).map((c) => c.id);
  }

  /** Leads generated in the period that have since become clients (the overall conversion rate's numerator). */
  async leadsConverted(): Promise<{ leads: string[]; converted: string[] }> {
    const leads = await this.leadsGenerated();
    return { leads, converted: await this.clientsAmong(leads) };
  }

  async unassignedLeads(): Promise<string[]> {
    const rows = await this.tx.company.findMany({ where: { ...this.companyBase(), OR: unset('ownerId') }, select: { id: true }, take: CAP });
    return rows.map((r) => r.id);
  }

  /** Companies whose status moved to a lost meaning in the period. */
  async clientsRejected(): Promise<string[]> {
    const lost = await this.statusIds(['LOST']);
    if (!lost.length) return [];
    const rows = await this.tx.company.findMany({ where: { ...this.companyBase(), ...inUsers(this.s, 'ownerId'), statusId: { in: lost }, statusChangedAt: inRange(this.s) }, select: { id: true }, take: CAP });
    return rows.map((r) => r.id);
  }

  /** Companies with a concern status, or an open concern (escalation) on them. */
  async clientConcerns(): Promise<string[]> {
    const concern = await this.statusIds(['CONCERN']);
    const [byStatus, open] = await Promise.all([
      concern.length ? this.tx.company.findMany({ where: { ...this.companyBase(), ...inUsers(this.s, 'ownerId'), statusId: { in: concern } }, select: { id: true }, take: CAP }) : Promise.resolve([]),
      this.tx.escalation.findMany({ where: { tenantId: this.s.tenantId, status: { not: 'RESOLVED' } }, select: { companyId: true, ownerId: true }, take: CAP }),
    ]);
    const ids = new Set(byStatus.map((c) => c.id));
    const openIds = [...new Set(open.map((e) => e.companyId))];
    if (openIds.length) {
      const mine = this.s.users ? new Set(this.s.users) : null;
      const owners = new Map((await this.tx.company.findMany({ where: { ...this.companyBase(), id: { in: openIds } }, select: { id: true, ownerId: true } })).map((c) => [c.id, c.ownerId]));
      for (const e of open) {
        if (!owners.has(e.companyId)) continue;
        if (!mine || (e.ownerId && mine.has(e.ownerId)) || mine.has(owners.get(e.companyId) ?? '')) ids.add(e.companyId);
      }
    }
    return [...ids];
  }

  /** Companies whose first revenue record (ever) closed in the period, with a share held by someone in scope. */
  async clientsConverted(): Promise<string[]> {
    const recs = await this.creditedRecords();
    const companyIds = [...new Set(recs.map((r) => r.companyId).filter((c): c is string => !!c))];
    if (!companyIds.length) return [];
    const earlier = await this.tx.revenueRecord.findMany({ where: { tenantId: this.s.tenantId, voidedAt: null, companyId: { in: companyIds }, closedAt: { lt: this.s.start } }, select: { companyId: true } });
    const before = new Set(earlier.map((e) => e.companyId));
    return companyIds.filter((c) => !before.has(c));
  }

  // ─── Communication ───

  private actWhere(extra: Prisma.ActivityWhereInput): Prisma.ActivityWhereInput {
    return { tenantId: this.s.tenantId, deletedAt: null, ...inUsers(this.s, 'ownerId'), occurredAt: { gte: this.s.start, lt: this.s.end < this.s.now ? this.s.end : this.s.now }, ...extra };
  }

  private kindWhere(kinds: string[], legacy: Prisma.ActivityWhereInput[] = []): Prisma.ActivityWhereInput {
    return { OR: [{ interaction: { in: kinds } }, ...legacy.map((l) => ({ AND: [{ OR: unset('interaction') }, l] }))] };
  }

  async emailsSent(): Promise<{ logged: string[]; synced: string[] }> {
    const conns = await this.connections();
    const [logged, synced] = await Promise.all([
      this.tx.activity.findMany({ where: this.actWhere(this.kindWhere(['EMAIL_SENT'], [{ type: 'EMAIL' }])), select: { id: true }, take: CAP }),
      conns.length ? this.tx.emailMessage.findMany({ where: { tenantId: this.s.tenantId, connectionId: { in: conns }, direction: 'OUTBOUND', sentAt: { gte: this.s.start, lt: this.s.end } }, select: { id: true }, take: CAP }) : Promise.resolve([]),
    ]);
    return { logged: logged.map((r) => r.id), synced: synced.map((r) => r.id) };
  }

  async responses(): Promise<{ logged: string[]; synced: string[] }> {
    const conns = await this.connections();
    const [logged, synced] = await Promise.all([
      this.tx.activity.findMany({ where: this.actWhere(this.kindWhere(RESPONSE_KINDS)), select: { id: true }, take: CAP }),
      conns.length ? this.tx.emailMessage.findMany({ where: { tenantId: this.s.tenantId, connectionId: { in: conns }, direction: 'INBOUND', contactId: { not: null }, sentAt: { gte: this.s.start, lt: this.s.end } }, select: { id: true }, take: CAP }) : Promise.resolve([]),
    ]);
    return { logged: logged.map((r) => r.id), synced: synced.map((r) => r.id) };
  }

  async positiveResponses(): Promise<string[]> {
    const rows = await this.tx.activity.findMany({ where: this.actWhere({ sentiment: 'POSITIVE' }), select: { id: true }, take: CAP });
    return rows.map((r) => r.id);
  }

  /** Employees (contacts) reached out to in the period: logged outreach, or a synced email sent to them. */
  async employeesContacted(): Promise<string[]> {
    const conns = await this.connections();
    const [acts, mails] = await Promise.all([
      this.tx.activity.findMany({ where: this.actWhere({ contactId: { not: null }, ...this.kindWhere(OUTREACH_KINDS, [{ type: { in: ['EMAIL', 'CALL', 'MEETING'] } }]) }), select: { contactId: true }, take: CAP }),
      conns.length ? this.tx.emailMessage.findMany({ where: { tenantId: this.s.tenantId, connectionId: { in: conns }, direction: 'OUTBOUND', contactId: { not: null }, sentAt: { gte: this.s.start, lt: this.s.end } }, select: { contactId: true }, take: CAP }) : Promise.resolve([]),
    ]);
    return [...new Set([...acts, ...mails].map((a) => a.contactId).filter((c): c is string => !!c))];
  }

  // ─── Follow-ups ───

  private followUps(extra: Prisma.TaskWhereInput): Prisma.TaskWhereInput {
    return { tenantId: this.s.tenantId, deletedAt: null, status: 'OPEN', followUpType: { not: null }, ...inUsers(this.s, 'assigneeId'), ...extra };
  }

  async followUpsToday(): Promise<string[]> {
    return ids(await this.tx.task.findMany({ where: this.followUps({ dueAt: { gte: this.s.todayStart, lt: this.s.tomorrowStart } }), select: { id: true }, take: CAP }));
  }

  async followUpsOverdue(): Promise<string[]> {
    return ids(await this.tx.task.findMany({ where: this.followUps({ dueAt: { lt: this.s.now } }), select: { id: true }, take: CAP }));
  }

  async followUpsPending(): Promise<string[]> {
    return ids(await this.tx.task.findMany({ where: this.followUps({}), select: { id: true }, take: CAP }));
  }

  /** Follow-ups due in the period, and how many of them were completed (follow-up completion). */
  async followUpCompletion(): Promise<{ due: number; done: number }> {
    const where: Prisma.TaskWhereInput = { tenantId: this.s.tenantId, deletedAt: null, followUpType: { not: null }, ...inUsers(this.s, 'assigneeId'), dueAt: { gte: this.s.start, lt: this.s.end < this.s.now ? this.s.end : this.s.now }, status: { in: ['OPEN', 'DONE'] } };
    const [due, done] = await Promise.all([this.tx.task.count({ where }), this.tx.task.count({ where: { ...where, status: 'DONE' } })]);
    return { due, done };
  }

  // ─── RFQs ───

  private rfqWhere(extra: Prisma.RfqWhereInput): Prisma.RfqWhereInput {
    return { tenantId: this.s.tenantId, deletedAt: null, ...inUsers(this.s, 'ownerId'), ...extra };
  }

  async rfqsReceived(): Promise<string[]> {
    return ids(await this.tx.rfq.findMany({ where: this.rfqWhere({ receivedAt: inRange(this.s) }), select: { id: true }, take: CAP }));
  }

  async rfqsSubmitted(): Promise<string[]> {
    return ids(await this.tx.rfq.findMany({ where: this.rfqWhere({ submittedAt: inRange(this.s) }), select: { id: true }, take: CAP }));
  }

  async rfqsDecided(status: 'WON' | 'LOST'): Promise<string[]> {
    return ids(await this.tx.rfq.findMany({ where: this.rfqWhere({ status, statusChangedAt: inRange(this.s) }), select: { id: true }, take: CAP }));
  }

  // ─── Transfers ───

  async transfersToSenior(): Promise<string[]> {
    return ids(await this.tx.leadTransfer.findMany({ where: { tenantId: this.s.tenantId, ...inUsers(this.s, 'fromUserId'), status: { in: ['APPROVED', 'REASSIGNED'] }, decidedAt: inRange(this.s) }, select: { id: true }, take: CAP }));
  }

  // ─── Deals and revenue ───

  async openDeals(): Promise<{ id: string; amount: number; currency: string; ownerId: string | null; companyId: string | null }[]> {
    return this.tx.opportunity.findMany({ where: { tenantId: this.s.tenantId, deletedAt: null, status: 'OPEN', ...inUsers(this.s, 'ownerId') }, select: { id: true, amount: true, currency: true, ownerId: true, companyId: true }, take: CAP });
  }

  /** Records closed in the period that someone in scope holds a share of (every record for the organisation). */
  async creditedRecords(start = this.s.start, end = this.s.end) {
    if (!this.s.users) return this.tx.revenueRecord.findMany({ where: { tenantId: this.s.tenantId, voidedAt: null, closedAt: { gte: start, lt: end } }, take: CAP });
    const credits = await this.tx.revenueCredit.findMany({ where: { tenantId: this.s.tenantId, voided: false, userId: { in: this.s.users }, closedAt: { gte: start, lt: end } }, select: { recordId: true }, take: CAP });
    const recIds = [...new Set(credits.map((c) => c.recordId))];
    return recIds.length ? this.tx.revenueRecord.findMany({ where: { tenantId: this.s.tenantId, voidedAt: null, id: { in: recIds } } }) : [];
  }

  /**
   * Revenue in the workspace currency: the shares held by people in scope (or each record once, for the
   * organisation), plus the full value of those deals and what could not be converted.
   */
  async revenue(start = this.s.start, end = this.s.end): Promise<{ amount: number; dealValue: number; deals: number; unconverted: Money[]; byUser: Map<string, number>; dealsByUser: Map<string, number>; records: Prisma.RevenueRecordGetPayload<object>[] }> {
    const recs = await this.creditedRecords(start, end);
    const credits = recs.length ? await this.tx.revenueCredit.findMany({ where: { tenantId: this.s.tenantId, recordId: { in: recs.map((r) => r.id) }, voided: false } }) : [];
    const mine = this.s.users ? new Set(this.s.users) : null;
    let amount = 0;
    let dealValue = 0;
    const unconverted = new Map<string, number>();
    const byUser = new Map<string, number>();
    const dealsByUser = new Map<string, number>();
    for (const r of recs) {
      for (const c of credits) if (c.recordId === r.id && c.userId && c.percent > 0) dealsByUser.set(c.userId, (dealsByUser.get(c.userId) ?? 0) + 1);
      const v = this.money({ amount: r.amount, currency: r.currency });
      if (v === null) {
        unconverted.set(r.currency, (unconverted.get(r.currency) ?? 0) + r.amount);
        continue;
      }
      dealValue += v;
      const own = credits.filter((c) => c.recordId === r.id);
      for (const c of own) if (c.userId) byUser.set(c.userId, (byUser.get(c.userId) ?? 0) + (v * c.percent) / 100);
      const pct = mine ? own.filter((c) => c.userId && mine.has(c.userId)).reduce((a, c) => a + c.percent, 0) : 100;
      amount += (v * pct) / 100;
    }
    for (const [k, val] of byUser) byUser.set(k, r2(val));
    return { amount: r2(amount), dealValue: r2(dealValue), deals: recs.length, unconverted: [...unconverted].map(([currency, amount]) => ({ currency, amount: r2(amount) })), byUser, dealsByUser, records: recs };
  }

  /** Won value not yet recorded as collected (every active record of the scope, whenever it closed). */
  async outstanding(): Promise<{ amount: number; ids: string[] }> {
    const recs = await this.creditedRecords(new Date(0), new Date(Date.UTC(9999, 0, 1)));
    let amount = 0;
    const out: string[] = [];
    for (const r of recs) {
      const left = r.amount - (r.collectedAmount ?? 0);
      if (left <= 0.005) continue;
      const v = this.money({ amount: left, currency: r.currency });
      if (v === null) continue;
      amount += v;
      out.push(r.id);
    }
    return { amount: r2(amount), ids: out };
  }

  async pipelineValue(): Promise<number> {
    const deals = await this.openDeals();
    return r2(deals.reduce((a, d) => a + (this.money(d) ?? 0), 0));
  }

  // ─── The funnel ───

  /** Funnel stage of each company the people in scope own (every company for the organisation). */
  async funnel(): Promise<{ stages: Map<string, FunnelStage>; rows: FunnelRow[]; owners: Map<string, string | null> }> {
    const companies = await this.tx.company.findMany({ where: { ...this.companyBase(), ...inUsers(this.s, 'ownerId') }, select: { id: true, statusId: true, ownerId: true }, take: CAP });
    const cids = companies.map((c) => c.id);
    const statuses = await this.statuses();
    const owners = new Map(companies.map((c) => [c.id, c.ownerId]));
    const stages = new Map<string, FunnelStage>();
    const empty = FUNNEL_STAGES.map((stage) => ({ stage, companies: 0, opportunities: 0, potentialValue: 0, conversion: null as number | null }));
    if (!cids.length) return { stages, rows: empty, owners };
    const [actByCompany, contacts, rfqs, deals, won] = await Promise.all([
      this.tx.activity.groupBy({ by: ['companyId'], where: { tenantId: this.s.tenantId, deletedAt: null, companyId: { in: cids } } }),
      this.tx.contact.findMany({ where: { tenantId: this.s.tenantId, deletedAt: null, companyId: { in: cids } }, select: { id: true, companyId: true } }),
      this.tx.rfq.findMany({ where: { tenantId: this.s.tenantId, deletedAt: null, companyId: { in: cids } }, select: { companyId: true, status: true, opportunityId: true, totalQuotation: true, currency: true } }),
      this.tx.opportunity.findMany({ where: { tenantId: this.s.tenantId, deletedAt: null, companyId: { in: cids } }, select: { companyId: true, status: true, amount: true, currency: true, stage: { select: { name: true } } } }),
      this.tx.revenueRecord.findMany({ where: { tenantId: this.s.tenantId, voidedAt: null, companyId: { in: cids } }, select: { companyId: true } }),
    ]);
    const contacted = new Set(actByCompany.map((a) => a.companyId).filter((c): c is string => !!c));
    const contactCompany = new Map(contacts.map((c) => [c.id, c.companyId]));
    if (contacts.length) {
      const [byContact, mails] = await Promise.all([
        this.tx.activity.groupBy({ by: ['contactId'], where: { tenantId: this.s.tenantId, deletedAt: null, contactId: { in: contacts.map((c) => c.id) } } }),
        this.tx.emailMessage.groupBy({ by: ['contactId'], where: { tenantId: this.s.tenantId, contactId: { in: contacts.map((c) => c.id) } } }),
      ]);
      for (const a of [...byContact, ...mails]) {
        const co = a.contactId ? contactCompany.get(a.contactId) : null;
        if (co) contacted.add(co);
      }
    }
    const wonSet = new Set(won.map((w) => w.companyId));
    const rows = new Map(empty.map((r) => [r.stage, r]));
    for (const c of companies) {
      const st = c.statusId ? statuses.get(c.statusId) : undefined;
      const cr = rfqs.filter((r) => r.companyId === c.id);
      const cd = deals.filter((d) => d.companyId === c.id);
      const open = cd.filter((d) => d.status === 'OPEN');
      const stage = funnelStageOf({
        status: st ? { name: st.name, meaning: st.meaning } : null,
        contacted: contacted.has(c.id),
        rfqStatuses: cr.map((r) => r.status),
        openDeals: open.length,
        negotiating: open.some((d) => /negotiat/i.test(d.stage.name)),
        won: wonSet.has(c.id) || cd.some((d) => d.status === 'WON') || cr.some((r) => r.status === 'WON'),
      });
      stages.set(c.id, stage);
      const row = rows.get(stage)!;
      row.companies += 1;
      const openRfqs = cr.filter((r) => !r.opportunityId && RFQ_OPEN_STATUSES.includes(r.status as RfqStatus));
      row.opportunities += open.length + openRfqs.length;
      row.potentialValue += open.reduce((a, d) => a + (this.money(d) ?? 0), 0) + openRfqs.reduce((a, r) => a + (r.totalQuotation ? (this.money({ amount: r.totalQuotation, currency: r.currency }) ?? 0) : 0), 0);
    }
    const total = companies.length;
    const rank = (s: FunnelStage) => FUNNEL_STAGES.indexOf(s);
    const list = [...rows.values()].map((r) => {
      const reached = r.stage === 'LOST' ? r.companies : [...rows.values()].filter((x) => x.stage !== 'LOST' && rank(x.stage) >= rank(r.stage)).reduce((a, x) => a + x.companies, 0);
      return { ...r, potentialValue: r2(r.potentialValue), conversion: total ? Math.round((reached / total) * 1000) / 10 : null };
    });
    return { stages, rows: list, owners };
  }

  // ─── Drill-down rows ───

  async rows(metric: DrillMetric): Promise<{ rows: DrillRow[]; total: number }> {
    const tx = this.tx;
    const t = this.s.tenantId;
    const companyRows = async (idList: string[]) => {
      const list = await tx.company.findMany({ where: { tenantId: t, id: { in: idList.slice(0, 200) } }, select: { id: true, name: true, leadNumber: true, ownerId: true, statusId: true, country: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
      const people = await personRefs(tx, t, list.map((c) => c.ownerId));
      const st = await this.statuses();
      return {
        total: idList.length,
        rows: list.map((c): DrillRow => ({
          kind: 'company', id: c.id, title: c.leadNumber ? `${c.leadNumber} ${c.name}` : c.name, subtitle: c.country, href: `/app/companies/${c.id}`, at: c.createdAt.toISOString(),
          person: ref(people, c.ownerId), status: c.statusId && st.get(c.statusId) ? { name: st.get(c.statusId)!.name, color: st.get(c.statusId)!.color } : null, amount: null, currency: null,
        })),
      };
    };
    const taskRows = async (idList: string[]) => {
      const list = await tx.task.findMany({ where: { tenantId: t, id: { in: idList.slice(0, 200) } }, select: { id: true, title: true, dueAt: true, assigneeId: true, companyId: true, followUpType: true, priority: true }, orderBy: { dueAt: 'asc' } });
      const people = await personRefs(tx, t, list.map((x) => x.assigneeId));
      return {
        total: idList.length,
        rows: list.map((x): DrillRow => ({
          kind: 'followUp', id: x.id, title: x.title, subtitle: x.followUpType, href: x.companyId ? `/app/companies/${x.companyId}?tab=follow-ups` : '/app/follow-ups', at: x.dueAt?.toISOString() ?? null,
          person: ref(people, x.assigneeId), status: x.dueAt && x.dueAt < this.s.now ? { name: 'Overdue', color: null } : null, amount: null, currency: null,
        })),
      };
    };
    const rfqRows = async (idList: string[]) => {
      const list = await tx.rfq.findMany({ where: { tenantId: t, id: { in: idList.slice(0, 200) } }, select: { id: true, number: true, projectName: true, status: true, receivedAt: true, ownerId: true, totalQuotation: true, currency: true, companyId: true }, orderBy: { receivedAt: 'desc' } });
      const people = await personRefs(tx, t, list.map((x) => x.ownerId));
      return {
        total: idList.length,
        rows: list.map((x): DrillRow => ({ kind: 'rfq', id: x.id, title: `${x.number} ${x.projectName}`, subtitle: null, href: `/app/rfqs?open=${x.id}`, at: x.receivedAt.toISOString(), person: ref(people, x.ownerId), status: { name: x.status, color: null }, amount: x.totalQuotation, currency: x.currency })),
      };
    };
    const actRows = async (idList: string[], synced: string[] = []) => {
      const [list, mails] = await Promise.all([
        tx.activity.findMany({ where: { tenantId: t, id: { in: idList.slice(0, 200) } }, select: { id: true, subject: true, occurredAt: true, ownerId: true, companyId: true, interaction: true, type: true }, orderBy: { occurredAt: 'desc' } }),
        tx.emailMessage.findMany({ where: { tenantId: t, id: { in: synced.slice(0, 200) } }, select: { id: true, subject: true, sentAt: true, fromAddress: true, contactId: true }, orderBy: { sentAt: 'desc' } }),
      ]);
      const people = await personRefs(tx, t, list.map((x) => x.ownerId));
      const rows: DrillRow[] = [
        ...list.map((x): DrillRow => ({ kind: 'interaction', id: x.id, title: x.subject, subtitle: x.interaction ?? x.type, href: x.companyId ? `/app/companies/${x.companyId}?tab=interactions` : null, at: x.occurredAt.toISOString(), person: ref(people, x.ownerId), status: null, amount: null, currency: null })),
        ...mails.map((m): DrillRow => ({ kind: 'email', id: m.id, title: m.subject || '(no subject)', subtitle: 'EMAIL_SYNCED', href: m.contactId ? `/app/contacts/${m.contactId}` : null, at: m.sentAt.toISOString(), person: null, status: null, amount: null, currency: null })),
      ].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
      return { total: idList.length + synced.length, rows };
    };
    switch (metric) {
      case 'leadsGenerated': return companyRows(await this.leadsGenerated());
      case 'activeCompanies': return companyRows(await this.activeCompanies());
      case 'companies': return companyRows(await this.companies());
      case 'existingClients': return companyRows(await this.existingClients());
      case 'clientsConverted': return companyRows(await this.clientsConverted());
      case 'clientsRejected': return companyRows(await this.clientsRejected());
      case 'clientConcerns': return companyRows(await this.clientConcerns());
      case 'unassignedLeads': return companyRows(await this.unassignedLeads());
      case 'employeesContacted': {
        const idList = await this.employeesContacted();
        const list = await tx.contact.findMany({ where: { tenantId: t, id: { in: idList.slice(0, 200) } }, select: { id: true, firstName: true, lastName: true, jobTitle: true, companyId: true, ownerId: true } });
        const people = await personRefs(tx, t, list.map((x) => x.ownerId));
        return { total: idList.length, rows: list.map((c): DrillRow => ({ kind: 'contact', id: c.id, title: [c.firstName, c.lastName].filter(Boolean).join(' '), subtitle: c.jobTitle, href: `/app/contacts/${c.id}`, at: null, person: ref(people, c.ownerId), status: null, amount: null, currency: null })) };
      }
      case 'emailsSent': { const e = await this.emailsSent(); return actRows(e.logged, e.synced); }
      case 'responses': { const e = await this.responses(); return actRows(e.logged, e.synced); }
      case 'positiveResponses': return actRows(await this.positiveResponses());
      case 'followUpsToday': return taskRows(await this.followUpsToday());
      case 'followUpsOverdue': return taskRows(await this.followUpsOverdue());
      case 'followUpsPending': return taskRows(await this.followUpsPending());
      case 'rfqsReceived': return rfqRows(await this.rfqsReceived());
      case 'rfqsSubmitted': return rfqRows(await this.rfqsSubmitted());
      case 'rfqsWon': return rfqRows(await this.rfqsDecided('WON'));
      case 'rfqsLost': return rfqRows(await this.rfqsDecided('LOST'));
      case 'transfersToSenior': {
        const idList = await this.transfersToSenior();
        const list = await tx.leadTransfer.findMany({ where: { tenantId: t, id: { in: idList.slice(0, 200) } }, orderBy: { decidedAt: 'desc' } });
        const companies = new Map((await tx.company.findMany({ where: { tenantId: t, id: { in: list.map((x) => x.companyId) } }, select: { id: true, name: true, leadNumber: true } })).map((c) => [c.id, c]));
        const people = await personRefs(tx, t, list.map((x) => x.newOwnerId));
        return {
          total: idList.length,
          rows: list.map((x): DrillRow => {
            const c = companies.get(x.companyId);
            return { kind: 'transfer', id: x.id, title: c ? (c.leadNumber ? `${c.leadNumber} ${c.name}` : c.name) : '', subtitle: x.reason, href: `/app/companies/${x.companyId}`, at: x.decidedAt?.toISOString() ?? null, person: ref(people, x.newOwnerId), status: { name: x.status, color: null }, amount: x.opportunityValue, currency: x.currency };
          }),
        };
      }
      case 'revenue': {
        const recs = await this.creditedRecords();
        const people = await personRefs(tx, t, recs.map((r) => r.closerId));
        return {
          total: recs.length,
          rows: recs
            .sort((a, b) => b.closedAt.getTime() - a.closedAt.getTime())
            .slice(0, 200)
            .map((r): DrillRow => ({ kind: 'revenue', id: r.id, title: r.project, subtitle: r.source, href: r.opportunityId ? `/app/deals/${r.opportunityId}` : r.companyId ? `/app/companies/${r.companyId}` : null, at: r.closedAt.toISOString(), person: ref(people, r.closerId), status: null, amount: r.amount, currency: r.currency })),
        };
      }
      case 'outstanding': {
        const o = await this.outstanding();
        const recs = await tx.revenueRecord.findMany({ where: { tenantId: t, id: { in: o.ids.slice(0, 200) } }, orderBy: { closedAt: 'desc' } });
        const people = await personRefs(tx, t, recs.map((r) => r.closerId));
        return { total: o.ids.length, rows: recs.map((r): DrillRow => ({ kind: 'revenue', id: r.id, title: r.project, subtitle: r.paymentStatus, href: r.opportunityId ? `/app/deals/${r.opportunityId}` : null, at: r.closedAt.toISOString(), person: ref(people, r.closerId), status: null, amount: r2(r.amount - (r.collectedAmount ?? 0)), currency: r.currency })) };
      }
      case 'conversionRate': return companyRows((await this.leadsConverted()).converted);
      case 'targetAchievement': return this.rows('revenue');
      case 'pipelineValue':
      case 'openOpportunities': {
        const deals = await this.openDeals();
        const list = await tx.opportunity.findMany({ where: { tenantId: t, id: { in: deals.slice(0, 200).map((d) => d.id) } }, select: { id: true, name: true, dealNumber: true, amount: true, currency: true, ownerId: true, expectedCloseDate: true, stage: { select: { name: true } } } });
        const people = await personRefs(tx, t, list.map((d) => d.ownerId));
        return { total: deals.length, rows: list.map((d): DrillRow => ({ kind: 'deal', id: d.id, title: d.dealNumber ? `${d.dealNumber} ${d.name}` : d.name, subtitle: d.stage.name, href: `/app/deals/${d.id}`, at: d.expectedCloseDate?.toISOString() ?? null, person: ref(people, d.ownerId), status: null, amount: d.amount, currency: d.currency })) };
      }
      default: {
        const stage = metric.slice('stage:'.length) as FunnelStage;
        const f = await this.funnel();
        return companyRows([...f.stages.entries()].filter(([, s]) => s === stage).map(([id]) => id));
      }
    }
  }
}

function ids(rows: { id: string }[]): string[] {
  return rows.map((r) => r.id);
}

function ref(people: Map<string, PersonRef>, id: string | null | undefined): PersonRef | null {
  return id ? (people.get(id) ?? null) : null;
}

export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export { DAY };

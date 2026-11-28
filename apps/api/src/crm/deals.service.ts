import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { formatDealNumber, nextSequenceValue, Prisma, type TenantTx } from '@dealflow/database';
import type { BulkDealUpdateInput, CustomFieldFilter, DealForecast, DealsSummary, DealHistoryItem, DealInput, DealMoveInput, DealRow, ListQuery, Page, PipelineRow, PriorityDeal } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { assertRefs, badRef, diff, iso, notFound, orderBy, ownerRefs, paging, recordStageEvent } from './crm-helpers';
import { companyWonByDeal } from './company-deal-sync';
import { CustomFieldsService } from './custom-fields.service';
import { reportingManagerOf } from './companies.service';
import { RevenueRecordsService } from './revenue-records.service';
import { dealScope, visibility } from './visibility';
import { dealsSummary } from './deals-summary';
import { withDealExtras } from './deal-extras';

const SORTABLE = ['name', 'amount', 'status', 'priority', 'expectedCloseDate', 'createdAt', 'updatedAt'] as const;
export const dealInclude = {
  pipeline: { select: { id: true, name: true } },
  stage: true,
  company: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  healthScore: { select: { health: true, risk: true, computedAt: true } },
} satisfies Prisma.OpportunityInclude;
const include = dealInclude;
type DealWith = Prisma.OpportunityGetPayload<{ include: typeof dealInclude }>;

export interface BoardColumn {
  stage: PipelineRow['stages'][number];
  deals: DealRow[];
  total: number;
  value: number;
}

@Injectable()
export class DealsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly fields: CustomFieldsService,
    private readonly revenue: RevenueRecordsService,
  ) {}

  /** The deals the caller's record visibility reaches (ADR 0063). */
  private async scope(tx: TenantTx, auth: AuthContext): Promise<Prisma.OpportunityWhereInput> {
    return dealScope(await visibility(tx, auth));
  }

  /** A deal the caller can see, or 404. */
  private async visibleDeal(tx: TenantTx, auth: AuthContext, id: string) {
    const row = await tx.opportunity.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null, ...(await this.scope(tx, auth)) } });
    if (!row) throw notFound('Deal');
    return row;
  }

  list(auth: AuthContext, q: ListQuery, cf?: CustomFieldFilter[]): Promise<Page<DealRow>> {
    return this.prisma.run(auth, async (tx) => {
      const status = q.status && ['OPEN', 'WON', 'LOST'].includes(q.status) ? (q.status as 'OPEN' | 'WON' | 'LOST') : undefined;
      const cfFilter = await this.fields.rawFilter(tx, auth, 'OPPORTUNITY', cf);
      const cfIds = cfFilter ? await this.fields.matchingIds(tx.opportunity, cfFilter) : null;
      const where: Prisma.OpportunityWhereInput = {
        tenantId: auth.tenantId,
        deletedAt: null,
        archivedAt: q.archived === 'true' ? { not: null } : null,
        ...(cfIds ? { id: { in: cfIds } } : {}),
        ...(await this.scope(tx, auth)),
        ...(status ? { status } : {}),
        ...(q.pipelineId ? { pipelineId: q.pipelineId } : {}),
        ...(q.stageId ? { stageId: q.stageId } : {}),
        ...(q.ownerId ? { ownerId: q.ownerId } : {}),
        ...(q.companyId ? { companyId: q.companyId } : {}),
        ...(q.contactId ? { contactId: q.contactId } : {}),
        ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
        ...(q.closeFrom || q.closeTo
          ? { expectedCloseDate: { ...(q.closeFrom ? { gte: new Date(q.closeFrom) } : {}), ...(q.closeTo ? { lte: new Date(q.closeTo) } : {}) } }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.opportunity.findMany({ where, include, orderBy: orderBy(q, SORTABLE, 'createdAt', ['priority', 'expectedCloseDate']), ...paging(q) }),
        tx.opportunity.count({ where }),
      ]);
      const owners = await ownerRefs(tx, rows.map((r) => r.ownerId));
      const cfRead = await this.fields.reader(tx, auth, 'OPPORTUNITY');
      const items = await withDealExtras(tx, rows.map((r) => toDealRow(r, owners, cfRead)));
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  /** Kanban data: every stage of a pipeline with up to `perStage` deals each (most recently updated first). */
  board(auth: AuthContext, pipelineId: string | undefined, perStage = 50): Promise<{ pipeline: { id: string; name: string }; columns: BoardColumn[] }> {
    return this.prisma.run(auth, async (tx) => {
      const pipeline = await tx.pipeline.findFirst({
        where: { tenantId: auth.tenantId, deletedAt: null, ...(pipelineId ? { id: pipelineId } : {}) },
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
        include: { stages: { orderBy: { position: 'asc' } } },
      });
      if (!pipeline) throw notFound('Pipeline');
      const scope = await this.scope(tx, auth);
      const [deals, totals] = await Promise.all([
        // One query per stage so a crowded stage cannot starve the others (pipelines have at most 20 stages).
        Promise.all(
          pipeline.stages.map((s) =>
            tx.opportunity.findMany({
              where: { tenantId: auth.tenantId, pipelineId: pipeline.id, stageId: s.id, deletedAt: null, archivedAt: null, ...scope },
              include,
              orderBy: { updatedAt: 'desc' },
              take: perStage,
            }),
          ),
        ).then((perStageRows) => perStageRows.flat()),
        tx.opportunity.groupBy({
          by: ['stageId'],
          where: { tenantId: auth.tenantId, pipelineId: pipeline.id, deletedAt: null, archivedAt: null, ...scope },
          _count: { _all: true },
          _sum: { amount: true },
        }),
      ]);
      const owners = await ownerRefs(tx, deals.map((d) => d.ownerId));
      const cfRead = await this.fields.reader(tx, auth, 'OPPORTUNITY');
      const byStage = new Map(totals.map((t) => [t.stageId, t]));
      const rows = await withDealExtras(tx, deals.map((d) => toDealRow(d, owners, cfRead)));
      return {
        pipeline: { id: pipeline.id, name: pipeline.name },
        columns: pipeline.stages.map((s) => ({
          stage: { id: s.id, name: s.name, position: s.position, probability: s.probability, category: s.category },
          deals: rows.filter((d) => d.stage.id === s.id),
          total: byStage.get(s.id)?._count._all ?? 0,
          value: byStage.get(s.id)?._sum.amount?? 0,
        })),
      };
    });
  }

  /**
   * Open deals ranked for attention: risk from the stored health score, how soon (or how overdue) the close date is,
   * size relative to the other candidates, and the priority people set. Each deal carries the reasons for its rank.
   */
  priority(auth: AuthContext, f: { pipelineId?: string; ownerId?: string; limit: number }, now = new Date()): Promise<PriorityDeal[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.opportunity.findMany({
        where: { tenantId: auth.tenantId, deletedAt: null, archivedAt: null, status: 'OPEN', ...(await this.scope(tx, auth)), ...(f.pipelineId ? { pipelineId: f.pipelineId } : {}), ...(f.ownerId ? { ownerId: f.ownerId } : {}) },
        include,
        orderBy: { amount: 'desc' },
        take: 1000,
      });
      const owners = await ownerRefs(tx, rows.map((r) => r.ownerId));
      const cfRead = await this.fields.reader(tx, auth, 'OPPORTUNITY');
      const max = Math.max(1, ...rows.map((r) => Number(r.amount)));
      const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const ranked = rows.map((r) => {
        const deal = toDealRow(r, owners, cfRead);
        return { deal, ...priorityScore(deal, max, today) };
      });
      ranked.sort((a, b) => b.score - a.score || b.deal.amount - a.deal.amount || a.deal.id.localeCompare(b.deal.id));
      return ranked.slice(0, f.limit);
    });
  }

  /** Open deals by expected close month for the next six months, with overdue and undated deals kept separate. */
  forecast(auth: AuthContext, f: { pipelineId?: string; ownerId?: string }, now = new Date()): Promise<DealForecast> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.opportunity.findMany({
        where: { tenantId: auth.tenantId, deletedAt: null, archivedAt: null, status: 'OPEN', ...(await this.scope(tx, auth)), ...(f.pipelineId ? { pipelineId: f.pipelineId } : {}), ...(f.ownerId ? { ownerId: f.ownerId } : {}) },
        include,
        orderBy: [{ expectedCloseDate: 'asc' }, { amount: 'desc' }],
        take: 2000,
      });
      const owners = await ownerRefs(tx, rows.map((r) => r.ownerId));
      const cfRead = await this.fields.reader(tx, auth, 'OPPORTUNITY');
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { defaultCurrency: true } });
      const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const fmt = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const months = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1)));
      const bucket = (key: string, label: string): DealForecast['buckets'][number] => ({ key, label, count: 0, value: 0, weighted: 0, deals: [] });
      const buckets = new Map(
        [bucket('overdue', 'Overdue'), ...months.map((m) => bucket(monthKey(m), fmt.format(m))), bucket('later', 'Later'), bucket('undated', 'No close date')].map((b) => [b.key, b]),
      );
      for (const r of rows) {
        const deal = toDealRow(r, owners, cfRead);
        const d = r.expectedCloseDate;
        const key = !d ? 'undated' : d < today ? 'overdue' : (buckets.has(monthKey(d)) ? monthKey(d) : 'later');
        const b = buckets.get(key)!;
        b.count += 1;
        b.value += deal.amount;
        b.weighted += (deal.amount * deal.effectiveProbability) / 100;
        if (b.deals.length < 25) b.deals.push(deal);
      }
      return {
        currency: tenant.defaultCurrency,
        buckets: [...buckets.values()].map((b) => ({ ...b, value: Math.round(b.value * 100) / 100, weighted: Math.round(b.weighted * 100) / 100 })),
      };
    });
  }

  /** Audit history of one deal, newest first: who changed what and when. Visible to anyone who can read the deal. */
  history(auth: AuthContext, id: string, limit = 50): Promise<DealHistoryItem[]> {
    return this.prisma.run(auth, async (tx) => {
      await this.visibleDeal(tx, auth, id);
      const rows = await tx.auditLog.findMany({
        where: { tenantId: auth.tenantId, entityType: 'deal', entityId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      });
      const names = await ownerRefs(tx, rows.map((r) => r.actorUserId));
      return rows.map((r) => {
        const meta = (r.metadata ?? {}) as Record<string, unknown>;
        const changes = meta.changes && typeof meta.changes === 'object' ? (meta.changes as DealHistoryItem['changes']) : null;
        return { id: r.id, action: r.action, actorName: r.actorUserId ? (names.get(r.actorUserId)?.name ?? null) : null, changes, metadata: meta, createdAt: r.createdAt.toISOString() };
      });
    });
  }

  get(auth: AuthContext, id: string): Promise<DealRow> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.opportunity.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null, ...(await this.scope(tx, auth)) }, include });
      if (!row) throw notFound('Deal');
      const [deal] = await withDealExtras(tx, [toDealRow(row, await ownerRefs(tx, [row.ownerId]), await this.fields.reader(tx, auth, 'OPPORTUNITY'))]);
      return deal!;
    });
  }

  create(auth: AuthContext, input: DealInput, meta: RequestMeta): Promise<DealRow> {
    return this.prisma.run(auth, (tx) => this.createIn(tx, auth, input, meta));
  }

  /** Creates a deal inside a running transaction (the company-won automation, ADR 0084, uses it too). */
  async createIn(tx: TenantTx, auth: AuthContext, input: DealInput, meta: RequestMeta): Promise<DealRow> {
    {
      const ownerId = input.ownerId ?? auth.userId;
      await assertRefs(tx, auth.tenantId, { ownerId, companyId: input.companyId, contactId: input.contactId });
      await this.assertPeople(tx, auth.tenantId, input);
      const { pipelineId, stage } = await this.resolveStage(tx, auth.tenantId, input.pipelineId, input.stageId);
      if (!input.allowDuplicate) await this.assertNotDuplicate(tx, auth, input.name, input.companyId ?? null);
      const company = input.companyId ? await tx.company.findFirst({ where: { id: input.companyId, tenantId: auth.tenantId }, select: { createdById: true, managerId: true } }) : null;
      const dealSeq = await nextSequenceValue(tx, `deal:${auth.tenantId}`);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { defaultCurrency: true } });
      const customFields = await this.fields.validateFor(tx, auth, 'OPPORTUNITY', input.customFields);
      const row = await tx.opportunity.create({
        data: {
          tenantId: auth.tenantId,
          name: input.name,
          amount: input.amount,
          currency: input.currency ?? tenant.defaultCurrency,
          probability: input.probability ?? null,
          priority: input.priority ?? null,
          expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null,
          companyId: input.companyId ?? null,
          contactId: input.contactId ?? null,
          ownerId,
          pipelineId,
          stageId: stage.id,
          status: stage.category,
          closedAt: stage.category === 'OPEN' ? null : new Date(),
          customFields: (customFields ?? {}) as Prisma.InputJsonValue,
          dealSeq,
          dealNumber: formatDealNumber(dealSeq),
          leadCreatorId: company?.createdById ?? null,
          managerId: input.managerId ?? company?.managerId ?? (await reportingManagerOf(tx, auth.tenantId, ownerId)),
          supportingUserIds: [...new Set(input.supportingUserIds ?? [])],
          source: input.source ?? null,
          products: cleanProducts(input.products),
          notes: input.notes ?? null,
        },
        include,
      });
      await this.fields.claimFiles(tx, auth.tenantId, 'OPPORTUNITY', row.id, customFields);
      if (input.rfqId) await this.linkRfq(tx, auth, row.id, row.companyId, input.rfqId);
      if (input.nextFollowUpAt) await this.bookFollowUp(tx, auth, row, input.nextFollowUpAt, meta);
      await this.revenue.reconcile(tx, auth.tenantId, { opportunityIds: [row.id] });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'deal.created', entityType: 'deal', entityId: row.id,
        metadata: { amount: input.amount, stage: stage.name }, meta,
      });
      await recordStageEvent(tx, { tenantId: auth.tenantId, opportunityId: row.id, pipelineId, fromStageId: null, toStageId: stage.id, actorUserId: auth.userId });
      if (row.status === 'WON' && row.companyId) await companyWonByDeal(tx, this.audit, auth, row.companyId, row.id, meta);
      return toDealRow(row, await ownerRefs(tx, [row.ownerId]), await this.fields.reader(tx, auth, 'OPPORTUNITY'));
    }
  }

  update(auth: AuthContext, id: string, input: Partial<DealInput>, meta: RequestMeta): Promise<DealRow> {
    return this.prisma.run(auth, async (tx) => {
      const before = await this.visibleDeal(tx, auth, id);
      if (input.pipelineId || input.stageId) {
        throw badRef(input.stageId ? 'stageId' : 'pipelineId', 'use POST /deals/:id/move to change stage');
      }
      await assertRefs(tx, auth.tenantId, { ownerId: input.ownerId, companyId: input.companyId, contactId: input.contactId });
      await this.assertPeople(tx, auth.tenantId, input);
      const customFields = await this.fields.validateFor(tx, auth, 'OPPORTUNITY', input.customFields, before.customFields as Record<string, unknown>);
      const { customFields: _cf, expectedCloseDate, supportingUserIds, rfqId, nextFollowUpAt, allowDuplicate: _dup, products, ...rest } = input;
      const row = await tx.opportunity.update({
        where: { id },
        data: {
          ...rest,
          ...(supportingUserIds !== undefined ? { supportingUserIds: [...new Set(supportingUserIds)] } : {}),
          ...(products !== undefined ? { products: cleanProducts(products) } : {}),
          ...(expectedCloseDate !== undefined ? { expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null } : {}),
          ...(customFields ? { customFields: customFields as Prisma.InputJsonValue } : {}),
        },
        include,
      });
      if (customFields) await this.fields.claimFiles(tx, auth.tenantId, 'OPPORTUNITY', id, customFields);
      if (rfqId !== undefined) await this.linkRfq(tx, auth, id, row.companyId, rfqId);
      if (nextFollowUpAt) await this.bookFollowUp(tx, auth, row, nextFollowUpAt, meta);
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'deal.updated', entityType: 'deal', entityId: id,
        metadata: { changes: diff(before, input) }, meta,
      });
      await this.revenue.reconcile(tx, auth.tenantId, { opportunityIds: [id] });
      return toDealRow(row, await ownerRefs(tx, [row.ownerId]), await this.fields.reader(tx, auth, 'OPPORTUNITY'));
    });
  }

  /** Moves a deal to another stage of the same pipeline, updating status and close date. */
  move(auth: AuthContext, id: string, input: DealMoveInput, meta: RequestMeta): Promise<DealRow> {
    return this.prisma.run(auth, async (tx) => {
      const row = await this.moveInTx(tx, auth, id, input, meta);
      return toDealRow(row, await ownerRefs(tx, [row.ownerId]), await this.fields.reader(tx, auth, 'OPPORTUNITY'));
    });
  }

  /** Moves a deal inside a running transaction (the company-won automation closes an open deal as won). */
  moveIn(tx: TenantTx, auth: AuthContext, id: string, input: DealMoveInput, meta: RequestMeta): Promise<DealWith> {
    return this.moveInTx(tx, auth, id, input, meta);
  }

  private async moveInTx(tx: TenantTx, auth: AuthContext, id: string, input: DealMoveInput, meta: RequestMeta): Promise<DealWith> {
    const before = await tx.opportunity.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null, ...(await this.scope(tx, auth)) }, include: { stage: true } });
    if (!before) throw notFound('Deal');
    const stage = await tx.pipelineStage.findFirst({ where: { id: input.stageId, tenantId: auth.tenantId, pipelineId: before.pipelineId } });
    if (!stage) throw badRef('stageId', 'is not a stage of this deal’s pipeline');
    if (stage.category === 'LOST' && !input.lossReason && !before.lossReason) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED', message: 'Give a loss reason when marking a deal as lost.',
        details: [{ path: 'lossReason', message: 'is required for lost deals' }],
      });
    }
    const row = await tx.opportunity.update({
      where: { id },
      data: {
        stageId: stage.id,
        status: stage.category,
        closedAt: stage.category === 'OPEN' ? null : before.status === stage.category ? before.closedAt : new Date(),
        lossReason: stage.category === 'LOST' ? (input.lossReason ?? before.lossReason) : null,
      },
      include,
    });
    if (before.stageId !== stage.id) {
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'deal.stage_changed', entityType: 'deal', entityId: id,
        metadata: { from: before.stage.name, to: stage.name, status: stage.category }, meta,
      });
      await recordStageEvent(tx, { tenantId: auth.tenantId, opportunityId: id, pipelineId: before.pipelineId, fromStageId: before.stageId, toStageId: stage.id, actorUserId: auth.userId });
    }
    await this.revenue.reconcile(tx, auth.tenantId, { opportunityIds: [id] });
    // A won deal makes its company a client (ADR 0084).
    if (stage.category === 'WON' && before.status !== 'WON' && row.companyId) await companyWonByDeal(tx, this.audit, auth, row.companyId, id, meta);
    return row;
  }

  /** The Deals dashboard numbers (ADR 0096) for the deals the caller can see, optionally one pipeline or owner. */
  summary(auth: AuthContext, f: { pipelineId?: string; ownerId?: string; from?: string; to?: string }, now = new Date()): Promise<DealsSummary> {
    return this.prisma.run(auth, async (tx) => {
      const where: Prisma.OpportunityWhereInput = { ...(await this.scope(tx, auth)), ...(f.pipelineId ? { pipelineId: f.pipelineId } : {}), ...(f.ownerId ? { ownerId: f.ownerId } : {}) };
      return dealsSummary(tx, auth.tenantId, where, f, now);
    });
  }

  /**
   * Changes many deals at once (ADR 0096): owner, priority, close date and probability in one write each, then a stage
   * move per deal through the normal move rules (won deals make their company a client; lost needs a reason).
   */
  bulkUpdate(auth: AuthContext, input: BulkDealUpdateInput, meta: RequestMeta): Promise<{ updated: number }> {
    return this.prisma.run(auth, async (tx) => {
      const ids = [...new Set(input.ids)];
      await assertRefs(tx, auth.tenantId, { ownerId: input.ownerId });
      const found = await tx.opportunity.findMany({ where: { id: { in: ids }, tenantId: auth.tenantId, deletedAt: null, ...(await this.scope(tx, auth)) }, select: { id: true } });
      if (found.length !== ids.length) throw badRef('ids', 'contains deals that do not exist');
      const data: Prisma.OpportunityUpdateManyMutationInput = {
        ...(input.ownerId ? { ownerId: input.ownerId } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.probability !== undefined ? { probability: input.probability } : {}),
        ...(input.expectedCloseDate !== undefined ? { expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null } : {}),
        ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null, archivedById: input.archived ? auth.userId : null } : {}),
      };
      if (Object.keys(data).length) await tx.opportunity.updateMany({ where: { id: { in: ids }, tenantId: auth.tenantId }, data });
      if (input.stageId) for (const id of ids) await this.moveInTx(tx, auth, id, { stageId: input.stageId, lossReason: input.lossReason }, meta);
      const { ids: _ids, ...changes } = input;
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'deal.bulk_updated', entityType: 'deal',
        metadata: { ids, ...changes }, meta,
      });
      await this.revenue.reconcile(tx, auth.tenantId, { opportunityIds: ids });
      return { updated: ids.length };
    });
  }

  /** Archives a deal (true) or brings it back (false): it leaves or rejoins the board, the list and the dashboard. */
  archive(auth: AuthContext, id: string, archived: boolean, meta: RequestMeta): Promise<DealRow> {
    return this.prisma.run(auth, async (tx) => {
      const before = await this.visibleDeal(tx, auth, id);
      if (!!before.archivedAt !== archived) {
        await tx.opportunity.update({ where: { id }, data: { archivedAt: archived ? new Date() : null, archivedById: archived ? auth.userId : null } });
        await this.audit.record(tx, {
          tenantId: auth.tenantId, actorUserId: auth.userId, action: archived ? 'deal.archived' : 'deal.restored', entityType: 'deal', entityId: id, meta,
        });
      }
      const row = await tx.opportunity.findUniqueOrThrow({ where: { id }, include });
      return toDealRow(row, await ownerRefs(tx, [row.ownerId]), await this.fields.reader(tx, auth, 'OPPORTUNITY'));
    });
  }

  /**
   * Stops an accidental second deal (ADR 0096): the same company may not have two active open deals with the same
   * name (case and spacing ignored). The caller can confirm with allowDuplicate.
   */
  private async assertNotDuplicate(tx: TenantTx, auth: AuthContext, name: string, companyId: string | null): Promise<void> {
    const key = dealNameKey(name);
    const candidates = await tx.opportunity.findMany({
      where: { tenantId: auth.tenantId, deletedAt: null, archivedAt: null, status: 'OPEN', companyId, name: { contains: name.trim().split(/\s+/)[0] ?? '', mode: 'insensitive' } },
      select: { id: true, name: true, dealNumber: true },
      take: 50,
    });
    const same = candidates.find((c) => dealNameKey(c.name) === key);
    if (same) {
      throw new ConflictException({
        code: 'DUPLICATE_DEAL',
        message: companyId ? 'This company already has an open deal with this name.' : 'An open deal with this name already exists.',
        details: [{ path: 'name', message: 'matches an open deal', existing: { id: same.id, name: same.name, dealNumber: same.dealNumber } }],
      });
    }
  }

  /** Links an RFQ of the deal's company to the deal (null unlinks the RFQs linked now). */
  private async linkRfq(tx: TenantTx, auth: AuthContext, dealId: string, companyId: string | null, rfqId: string | null): Promise<void> {
    if (rfqId === null) {
      await tx.rfq.updateMany({ where: { tenantId: auth.tenantId, opportunityId: dealId }, data: { opportunityId: null } });
      return;
    }
    const rfq = await tx.rfq.findFirst({ where: { id: rfqId, tenantId: auth.tenantId, deletedAt: null }, select: { id: true, companyId: true } });
    if (!rfq) throw badRef('rfqId', 'does not exist');
    if (companyId && rfq.companyId !== companyId) throw badRef('rfqId', 'belongs to another company');
    await tx.rfq.update({ where: { id: rfq.id }, data: { opportunityId: dealId } });
  }

  /** Books a follow-up task on the deal for its owner (or the caller), once per date. */
  private async bookFollowUp(tx: TenantTx, auth: AuthContext, deal: { id: string; name: string; ownerId: string | null; companyId: string | null }, date: string, meta: RequestMeta): Promise<void> {
    const dueAt = new Date(`${date}T09:00:00.000Z`);
    const exists = await tx.task.findFirst({ where: { tenantId: auth.tenantId, opportunityId: deal.id, status: 'OPEN', deletedAt: null, dueAt }, select: { id: true } });
    if (exists) return;
    const task = await tx.task.create({
      data: { tenantId: auth.tenantId, title: `Follow up: ${deal.name}`.slice(0, 200), dueAt, assigneeId: deal.ownerId ?? auth.userId, opportunityId: deal.id, createdById: auth.userId },
    });
    await this.audit.record(tx, {
      tenantId: auth.tenantId, actorUserId: auth.userId, action: 'task.created', entityType: 'task', entityId: task.id, metadata: { opportunityId: deal.id, from: 'deal' }, meta,
    });
  }

  clone(auth: AuthContext, id: string, meta: RequestMeta): Promise<DealRow> {
    return this.prisma.run(auth, async (tx) => {
      const src = await this.visibleDeal(tx, auth, id);
      const first = await tx.pipelineStage.findFirstOrThrow({ where: { pipelineId: src.pipelineId, category: 'OPEN' }, orderBy: { position: 'asc' } });
      const row = await tx.opportunity.create({
        data: {
          tenantId: auth.tenantId, pipelineId: src.pipelineId, stageId: first.id, name: `${src.name} (copy)`, amount: src.amount,
          currency: src.currency, probability: src.probability, priority: src.priority, companyId: src.companyId, contactId: src.contactId,
          ownerId: auth.userId, customFields: src.customFields as Prisma.InputJsonValue,
          ...(await this.number(tx, auth.tenantId)), leadCreatorId: src.leadCreatorId, managerId: src.managerId, supportingUserIds: src.supportingUserIds,
        },
        include,
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'deal.cloned', entityType: 'deal', entityId: row.id,
        metadata: { sourceId: id }, meta,
      });
      await recordStageEvent(tx, { tenantId: auth.tenantId, opportunityId: row.id, pipelineId: src.pipelineId, fromStageId: null, toStageId: first.id, actorUserId: auth.userId });
      return toDealRow(row, await ownerRefs(tx, [row.ownerId]), await this.fields.reader(tx, auth, 'OPPORTUNITY'));
    });
  }

  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const { count } = await tx.opportunity.updateMany({ where: { id, tenantId: auth.tenantId, deletedAt: null, ...(await this.scope(tx, auth)) }, data: { deletedAt: new Date() } });
      if (count === 0) throw notFound('Deal');
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'deal.deleted', entityType: 'deal', entityId: id, meta });
      await this.revenue.reconcile(tx, auth.tenantId, { opportunityIds: [id] });
    });
  }

  private async number(tx: TenantTx, tenantId: string): Promise<{ dealSeq: number; dealNumber: string }> {
    const dealSeq = await nextSequenceValue(tx, `deal:${tenantId}`);
    return { dealSeq, dealNumber: formatDealNumber(dealSeq) };
  }

  /** The manager and supporting people must be members of the workspace. */
  private async assertPeople(tx: TenantTx, tenantId: string, input: Partial<DealInput>): Promise<void> {
    if (input.managerId && !(await tx.membership.findFirst({ where: { tenantId, userId: input.managerId, status: 'ACTIVE' }, select: { id: true } }))) throw badRef('managerId');
    const ids = [...new Set(input.supportingUserIds ?? [])];
    if (!ids.length) return;
    const found = await tx.membership.count({ where: { tenantId, userId: { in: ids } } });
    if (found !== ids.length) throw badRef('supportingUserIds', 'contains people who are not in this workspace');
  }

  private async resolveStage(tx: TenantTx, tenantId: string, pipelineId?: string, stageId?: string) {
    if (stageId) {
      const stage = await tx.pipelineStage.findFirst({
        where: { id: stageId, tenantId, ...(pipelineId ? { pipelineId } : {}), pipeline: { deletedAt: null } },
      });
      if (!stage) throw badRef('stageId');
      return { pipelineId: stage.pipelineId, stage };
    }
    const pipeline = await tx.pipeline.findFirst({
      where: { tenantId, deletedAt: null, ...(pipelineId ? { id: pipelineId } : {}) },
      orderBy: [{ isDefault: 'desc' }, { position: 'asc' }],
      include: { stages: { where: { category: 'OPEN' }, orderBy: { position: 'asc' }, take: 1 } },
    });
    if (!pipeline) throw badRef('pipelineId');
    if (!pipeline.stages[0]) throw badRef('pipelineId', 'has no open stage');
    return { pipelineId: pipeline.id, stage: pipeline.stages[0] };
  }
}

/** A deal name compared without case, punctuation or extra spaces. */
export const dealNameKey = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const cleanProducts = (list: string[] | undefined) => [...new Set((list ?? []).map((p) => p.trim()).filter(Boolean))];

export function toDealRow(r: DealWith, owners: Map<string, { id: string; name: string }>, cf?: (values: unknown) => Record<string, unknown>): DealRow {
  return {
    id: r.id,
    name: r.name,
    amount: Number(r.amount),
    currency: r.currency,
    probability: r.probability,
    effectiveProbability: r.probability ?? r.stage.probability,
    status: r.status,
    expectedCloseDate: r.expectedCloseDate ? r.expectedCloseDate.toISOString().slice(0, 10) : null,
    closedAt: iso(r.closedAt),
    lossReason: r.lossReason,
    priority: r.priority,
    health: r.healthScore ? { score: r.healthScore.health, risk: r.healthScore.risk as 'low' | 'medium' | 'high', computedAt: r.healthScore.computedAt.toISOString() } : null,
    pipeline: r.pipeline,
    stage: { id: r.stage.id, name: r.stage.name, position: r.stage.position, probability: r.stage.probability, category: r.stage.category },
    company: r.company,
    contact: r.contact ? { id: r.contact.id, name: [r.contact.firstName, r.contact.lastName].filter(Boolean).join(' ') } : null,
    owner: r.ownerId ? (owners.get(r.ownerId) ?? null) : null,
    sourceLeadId: r.sourceLeadId,
    customFields: cf ? cf(r.customFields) : ((r.customFields ?? {}) as Record<string, unknown>),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    dealNumber: r.dealNumber ?? null,
    managerId: r.managerId ?? null,
    leadCreatorId: r.leadCreatorId ?? null,
    supportingUserIds: r.supportingUserIds ?? [],
    source: r.source ?? null,
    products: r.products ?? [],
    notes: r.notes ?? null,
    archivedAt: iso(r.archivedAt),
  };
}

const RISK_POINTS = { high: 40, medium: 20, low: 0 } as const;
const PRIORITY_POINTS = { HIGH: 15, MEDIUM: 5, LOW: 0 } as const;
const DAY = 86_400_000;

/** Deterministic attention score (0 to about 115) and the reasons behind it. Exported for unit tests. */
export function priorityScore(deal: DealRow, maxAmount: number, today: number): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  if (deal.health) {
    score += RISK_POINTS[deal.health.risk];
    if (deal.health.risk !== 'low') reasons.push(`${deal.health.risk === 'high' ? 'Critical' : 'At risk'}: health ${deal.health.score}`);
  } else {
    score += 10;
    reasons.push('Not scored yet');
  }
  if (deal.expectedCloseDate) {
    const days = Math.round((Date.parse(deal.expectedCloseDate) - today) / DAY);
    if (days < 0) {
      score += 30;
      reasons.push(`Close date passed ${-days} ${days === -1 ? 'day' : 'days'} ago`);
    } else if (days <= 14) {
      score += 25;
      reasons.push(days === 0 ? 'Closes today' : `Closes in ${days} ${days === 1 ? 'day' : 'days'}`);
    } else if (days <= 30) {
      score += 15;
      reasons.push(`Closes in ${days} days`);
    }
  } else {
    score += 5;
    reasons.push('No close date');
  }
  const size = Math.round((30 * deal.amount) / maxAmount);
  score += size;
  if (size >= 20) reasons.push('One of the largest open deals');
  if (deal.priority) {
    score += PRIORITY_POINTS[deal.priority];
    if (deal.priority !== 'LOW') reasons.push(`Marked ${deal.priority.toLowerCase()} priority`);
  }
  return { score, reasons };
}

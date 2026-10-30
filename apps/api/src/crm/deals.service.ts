import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import type { DealInput, DealMoveInput, DealRow, ListQuery, Page, PipelineRow } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { assertRefs, badRef, diff, iso, notFound, orderBy, ownerRefs, paging, recordStageEvent } from './crm-helpers';
import { CustomFieldsService } from './custom-fields.service';

const SORTABLE = ['name', 'amount', 'expectedCloseDate', 'createdAt', 'updatedAt'] as const;
const include = {
  pipeline: { select: { id: true, name: true } },
  stage: true,
  company: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.OpportunityInclude;
type DealWith = Prisma.OpportunityGetPayload<{ include: typeof include }>;

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
  ) {}

  list(auth: AuthContext, q: ListQuery): Promise<Page<DealRow>> {
    return this.prisma.run(auth, async (tx) => {
      const status = q.status && ['OPEN', 'WON', 'LOST'].includes(q.status) ? (q.status as 'OPEN' | 'WON' | 'LOST') : undefined;
      const where: Prisma.OpportunityWhereInput = {
        tenantId: auth.tenantId,
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(q.pipelineId ? { pipelineId: q.pipelineId } : {}),
        ...(q.stageId ? { stageId: q.stageId } : {}),
        ...(q.ownerId ? { ownerId: q.ownerId } : {}),
        ...(q.companyId ? { companyId: q.companyId } : {}),
        ...(q.contactId ? { contactId: q.contactId } : {}),
        ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
      };
      const [rows, total] = await Promise.all([
        tx.opportunity.findMany({ where, include, orderBy: orderBy(q, SORTABLE, 'createdAt'), ...paging(q) }),
        tx.opportunity.count({ where }),
      ]);
      const owners = await ownerRefs(tx, rows.map((r) => r.ownerId));
      return { items: rows.map((r) => toDealRow(r, owners)), total, page: q.page, pageSize: q.pageSize };
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
      const [deals, totals] = await Promise.all([
        // One query per stage so a crowded stage cannot starve the others (pipelines have at most 20 stages).
        Promise.all(
          pipeline.stages.map((s) =>
            tx.opportunity.findMany({
              where: { tenantId: auth.tenantId, pipelineId: pipeline.id, stageId: s.id, deletedAt: null },
              include,
              orderBy: { updatedAt: 'desc' },
              take: perStage,
            }),
          ),
        ).then((perStageRows) => perStageRows.flat()),
        tx.opportunity.groupBy({
          by: ['stageId'],
          where: { tenantId: auth.tenantId, pipelineId: pipeline.id, deletedAt: null },
          _count: { _all: true },
          _sum: { amount: true },
        }),
      ]);
      const owners = await ownerRefs(tx, deals.map((d) => d.ownerId));
      const byStage = new Map(totals.map((t) => [t.stageId, t]));
      return {
        pipeline: { id: pipeline.id, name: pipeline.name },
        columns: pipeline.stages.map((s) => ({
          stage: { id: s.id, name: s.name, position: s.position, probability: s.probability, category: s.category },
          deals: deals.filter((d) => d.stageId === s.id).map((d) => toDealRow(d, owners)),
          total: byStage.get(s.id)?._count._all ?? 0,
          value: byStage.get(s.id)?._sum.amount?.toNumber() ?? 0,
        })),
      };
    });
  }

  get(auth: AuthContext, id: string): Promise<DealRow> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.opportunity.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null }, include });
      if (!row) throw notFound('Deal');
      return toDealRow(row, await ownerRefs(tx, [row.ownerId]));
    });
  }

  create(auth: AuthContext, input: DealInput, meta: RequestMeta): Promise<DealRow> {
    return this.prisma.run(auth, async (tx) => {
      const ownerId = input.ownerId ?? auth.userId;
      await assertRefs(tx, auth.tenantId, { ownerId, companyId: input.companyId, contactId: input.contactId });
      const { pipelineId, stage } = await this.resolveStage(tx, auth.tenantId, input.pipelineId, input.stageId);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId }, select: { defaultCurrency: true } });
      const customFields = await this.fields.validate(tx, auth.tenantId, 'OPPORTUNITY', input.customFields);
      const row = await tx.opportunity.create({
        data: {
          tenantId: auth.tenantId,
          name: input.name,
          amount: input.amount,
          currency: input.currency ?? tenant.defaultCurrency,
          probability: input.probability ?? null,
          expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null,
          companyId: input.companyId ?? null,
          contactId: input.contactId ?? null,
          ownerId,
          pipelineId,
          stageId: stage.id,
          status: stage.category,
          closedAt: stage.category === 'OPEN' ? null : new Date(),
          customFields: (customFields ?? {}) as Prisma.InputJsonValue,
        },
        include,
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'deal.created', entityType: 'deal', entityId: row.id,
        metadata: { amount: input.amount, stage: stage.name }, meta,
      });
      await recordStageEvent(tx, { tenantId: auth.tenantId, opportunityId: row.id, pipelineId, fromStageId: null, toStageId: stage.id, actorUserId: auth.userId });
      return toDealRow(row, await ownerRefs(tx, [row.ownerId]));
    });
  }

  update(auth: AuthContext, id: string, input: Partial<DealInput>, meta: RequestMeta): Promise<DealRow> {
    return this.prisma.run(auth, async (tx) => {
      const before = await tx.opportunity.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
      if (!before) throw notFound('Deal');
      if (input.pipelineId || input.stageId) {
        throw badRef(input.stageId ? 'stageId' : 'pipelineId', 'use POST /deals/:id/move to change stage');
      }
      await assertRefs(tx, auth.tenantId, { ownerId: input.ownerId, companyId: input.companyId, contactId: input.contactId });
      const customFields = await this.fields.validate(tx, auth.tenantId, 'OPPORTUNITY', input.customFields, before.customFields as Record<string, unknown>);
      const { customFields: _cf, expectedCloseDate, ...rest } = input;
      const row = await tx.opportunity.update({
        where: { id },
        data: {
          ...rest,
          ...(expectedCloseDate !== undefined ? { expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null } : {}),
          ...(customFields ? { customFields: customFields as Prisma.InputJsonValue } : {}),
        },
        include,
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'deal.updated', entityType: 'deal', entityId: id,
        metadata: { changes: diff(before, input) }, meta,
      });
      return toDealRow(row, await ownerRefs(tx, [row.ownerId]));
    });
  }

  /** Moves a deal to another stage of the same pipeline, updating status and close date. */
  move(auth: AuthContext, id: string, input: DealMoveInput, meta: RequestMeta): Promise<DealRow> {
    return this.prisma.run(auth, async (tx) => {
      const row = await this.moveInTx(tx, auth, id, input, meta);
      return toDealRow(row, await ownerRefs(tx, [row.ownerId]));
    });
  }

  private async moveInTx(tx: TenantTx, auth: AuthContext, id: string, input: DealMoveInput, meta: RequestMeta): Promise<DealWith> {
    const before = await tx.opportunity.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null }, include: { stage: true } });
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
    return row;
  }

  bulkUpdate(auth: AuthContext, input: { ids: string[]; ownerId?: string; stageId?: string }, meta: RequestMeta): Promise<{ updated: number }> {
    return this.prisma.run(auth, async (tx) => {
      if (!input.ownerId && !input.stageId) throw badRef('ownerId', 'provide ownerId or stageId');
      await assertRefs(tx, auth.tenantId, { ownerId: input.ownerId });
      const found = await tx.opportunity.findMany({ where: { id: { in: input.ids }, tenantId: auth.tenantId, deletedAt: null }, select: { id: true } });
      if (found.length !== input.ids.length) throw badRef('ids', 'contains deals that do not exist');
      if (input.ownerId) {
        await tx.opportunity.updateMany({ where: { id: { in: input.ids }, tenantId: auth.tenantId }, data: { ownerId: input.ownerId } });
      }
      if (input.stageId) for (const id of input.ids) await this.moveInTx(tx, auth, id, { stageId: input.stageId }, meta);
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'deal.bulk_updated', entityType: 'deal',
        metadata: { ids: input.ids, ownerId: input.ownerId, stageId: input.stageId }, meta,
      });
      return { updated: input.ids.length };
    });
  }

  clone(auth: AuthContext, id: string, meta: RequestMeta): Promise<DealRow> {
    return this.prisma.run(auth, async (tx) => {
      const src = await tx.opportunity.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
      if (!src) throw notFound('Deal');
      const first = await tx.pipelineStage.findFirstOrThrow({ where: { pipelineId: src.pipelineId, category: 'OPEN' }, orderBy: { position: 'asc' } });
      const row = await tx.opportunity.create({
        data: {
          tenantId: auth.tenantId, pipelineId: src.pipelineId, stageId: first.id, name: `${src.name} (copy)`, amount: src.amount,
          currency: src.currency, probability: src.probability, companyId: src.companyId, contactId: src.contactId,
          ownerId: auth.userId, customFields: src.customFields as Prisma.InputJsonValue,
        },
        include,
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'deal.cloned', entityType: 'deal', entityId: row.id,
        metadata: { sourceId: id }, meta,
      });
      await recordStageEvent(tx, { tenantId: auth.tenantId, opportunityId: row.id, pipelineId: src.pipelineId, fromStageId: null, toStageId: first.id, actorUserId: auth.userId });
      return toDealRow(row, await ownerRefs(tx, [row.ownerId]));
    });
  }

  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const { count } = await tx.opportunity.updateMany({ where: { id, tenantId: auth.tenantId, deletedAt: null }, data: { deletedAt: new Date() } });
      if (count === 0) throw notFound('Deal');
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'deal.deleted', entityType: 'deal', entityId: id, meta });
    });
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

export function toDealRow(r: DealWith, owners: Map<string, { id: string; name: string }>): DealRow {
  return {
    id: r.id,
    name: r.name,
    amount: r.amount.toNumber(),
    currency: r.currency,
    probability: r.probability,
    effectiveProbability: r.probability ?? r.stage.probability,
    status: r.status,
    expectedCloseDate: r.expectedCloseDate ? r.expectedCloseDate.toISOString().slice(0, 10) : null,
    closedAt: iso(r.closedAt),
    lossReason: r.lossReason,
    pipeline: r.pipeline,
    stage: { id: r.stage.id, name: r.stage.name, position: r.stage.position, probability: r.stage.probability, category: r.stage.category },
    company: r.company,
    contact: r.contact ? { id: r.contact.id, name: [r.contact.firstName, r.contact.lastName].filter(Boolean).join(' ') } : null,
    owner: r.ownerId ? (owners.get(r.ownerId) ?? null) : null,
    sourceLeadId: r.sourceLeadId,
    customFields: (r.customFields ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

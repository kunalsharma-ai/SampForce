import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@dealflow/database';
import type { PipelineInput, PipelineRow } from '@dealflow/types';
import { entitlementsFor } from '../billing/entitlements';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { badRef, notFound } from './crm-helpers';

@Injectable()
export class PipelinesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(auth: AuthContext): Promise<PipelineRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.pipeline.findMany({
        where: { tenantId: auth.tenantId, deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { position: 'asc' }, { createdAt: 'asc' }],
        include: {
          stages: { orderBy: { position: 'asc' } },
          _count: { select: { opportunities: { where: { deletedAt: null } } } },
        },
      });
      return rows.map((p) => ({
        id: p.id,
        name: p.name,
        isDefault: p.isDefault,
        dealCount: p._count.opportunities,
        stages: p.stages.map((s) => ({ id: s.id, name: s.name, position: s.position, probability: s.probability, category: s.category })),
      }));
    });
  }

  create(auth: AuthContext, input: PipelineInput, meta: RequestMeta): Promise<PipelineRow> {
    return this.prisma.run(auth, async (tx) => {
      const limit = (await entitlementsFor(tx, auth.tenantId)).entitlements.maxPipelines;
      const count = await tx.pipeline.count({ where: { tenantId: auth.tenantId, deletedAt: null } });
      if (limit !== null && count >= limit) {
        throw new ForbiddenException({
          code: 'PLAN_LIMIT',
          message: limit === 1 ? 'Your plan allows 1 pipeline. Upgrade to add more.' : `Your plan allows ${limit} pipelines. Upgrade to add more.`,
        });
      }
      try {
        const p = await tx.pipeline.create({ data: { tenantId: auth.tenantId, name: input.name, position: count } });
        await tx.pipelineStage.createMany({
          data: input.stages.map((s, position) => ({ tenantId: auth.tenantId, pipelineId: p.id, name: s.name, probability: s.probability, category: s.category, position })),
        });
        await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'pipeline.created', entityType: 'pipeline', entityId: p.id, metadata: { name: p.name }, meta });
        return { id: p.id, name: p.name, isDefault: false, dealCount: 0, stages: (await tx.pipelineStage.findMany({ where: { pipelineId: p.id }, orderBy: { position: 'asc' } })).map((s) => ({ id: s.id, name: s.name, position: s.position, probability: s.probability, category: s.category })) };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictException({ code: 'DUPLICATE_NAME', message: 'A pipeline with this name already exists.' });
        }
        throw err;
      }
    });
  }

  /**
   * Replaces the pipeline's name and stage list. Stages with an `id` are updated, new ones created,
   * and omitted ones deleted only if no deal uses them.
   */
  update(auth: AuthContext, id: string, input: PipelineInput, meta: RequestMeta): Promise<PipelineRow> {
    return this.prisma.run(auth, async (tx) => {
      const p = await tx.pipeline.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null }, include: { stages: true } });
      if (!p) throw notFound('Pipeline');
      const keepIds = new Set(input.stages.map((s) => s.id).filter(Boolean));
      for (const s of input.stages) if (s.id && !p.stages.some((e) => e.id === s.id)) throw badRef('stages', 'contains a stage from another pipeline');
      const removed = p.stages.filter((s) => !keepIds.has(s.id));
      if (removed.length) {
        const inUse = await tx.opportunity.count({ where: { tenantId: auth.tenantId, stageId: { in: removed.map((s) => s.id) } } });
        if (inUse > 0) throw new ConflictException({ code: 'STAGE_IN_USE', message: 'Move deals out of a stage before removing it.' });
        await tx.pipelineStage.deleteMany({ where: { id: { in: removed.map((s) => s.id) } } });
      }
      // Two passes avoid colliding with the (pipeline_id, position) unique constraint while reordering.
      await tx.pipelineStage.updateMany({ where: { pipelineId: id }, data: { position: { increment: 1000 } } });
      for (const [position, s] of input.stages.entries()) {
        if (s.id) await tx.pipelineStage.update({ where: { id: s.id }, data: { name: s.name, probability: s.probability, category: s.category, position } });
        else await tx.pipelineStage.create({ data: { tenantId: auth.tenantId, pipelineId: id, name: s.name, probability: s.probability, category: s.category, position } });
      }
      await tx.pipeline.update({ where: { id }, data: { name: input.name } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'pipeline.updated', entityType: 'pipeline', entityId: id, metadata: { stages: input.stages.map((s) => s.name) }, meta });
      return (await this.listIn(tx, auth.tenantId)).find((x) => x.id === id)!;
    });
  }

  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const p = await tx.pipeline.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
      if (!p) throw notFound('Pipeline');
      if (p.isDefault) throw new ConflictException({ code: 'DEFAULT_PIPELINE', message: 'Make another pipeline the default before deleting this one.' });
      const deals = await tx.opportunity.count({ where: { tenantId: auth.tenantId, pipelineId: id, deletedAt: null } });
      if (deals > 0) throw new ConflictException({ code: 'PIPELINE_IN_USE', message: 'Move or delete this pipeline’s deals first.' });
      await tx.pipeline.update({ where: { id }, data: { deletedAt: new Date(), name: `${p.name} (deleted ${p.id.slice(0, 8)})` } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'pipeline.deleted', entityType: 'pipeline', entityId: id, meta });
    });
  }

  setDefault(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const p = await tx.pipeline.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
      if (!p) throw notFound('Pipeline');
      await tx.pipeline.updateMany({ where: { tenantId: auth.tenantId }, data: { isDefault: false } });
      await tx.pipeline.update({ where: { id }, data: { isDefault: true } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'pipeline.default_changed', entityType: 'pipeline', entityId: id, meta });
    });
  }

  private async listIn(tx: Prisma.TransactionClient, tenantId: string): Promise<PipelineRow[]> {
    const rows = await tx.pipeline.findMany({
      where: { tenantId, deletedAt: null },
      include: { stages: { orderBy: { position: 'asc' } }, _count: { select: { opportunities: { where: { deletedAt: null } } } } },
    });
    return rows.map((p) => ({
      id: p.id, name: p.name, isDefault: p.isDefault, dealCount: p._count.opportunities,
      stages: p.stages.map((s) => ({ id: s.id, name: s.name, position: s.position, probability: s.probability, category: s.category })),
    }));
  }
}

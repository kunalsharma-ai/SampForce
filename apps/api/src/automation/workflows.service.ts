import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@dealflow/database';
import {
  type ExecutionRow,
  type SimulationResult,
  TRIGGER_EVENTS,
  type TriggerEvent,
  type WorkflowDefinition,
  type WorkflowInput,
  type WorkflowRow,
  workflowDefinitionSchema,
} from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { assertRefs, notFound, ownerRefs } from '../crm/crm-helpers';
import { WorkflowActions } from './actions.service';
import { advance, evaluateGroup, type EvalContext } from './engine';
import { AutomationRecords } from './records';

type WorkflowWith = Prisma.WorkflowGetPayload<{ include: { versions: true } }>;
const latestVersion = { versions: { orderBy: { version: 'desc' as const }, take: 1 } };

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly records: AutomationRecords,
    private readonly actions: WorkflowActions,
  ) {}

  list(auth: AuthContext): Promise<WorkflowRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.workflow.findMany({ where: { tenantId: auth.tenantId, deletedAt: null }, include: latestVersion, orderBy: { updatedAt: 'desc' } });
      return this.toRows(tx, auth.tenantId, rows);
    });
  }

  get(auth: AuthContext, id: string): Promise<WorkflowRow> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.workflow.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null }, include: latestVersion });
      if (!row) throw notFound('Workflow');
      return (await this.toRows(tx, auth.tenantId, [row]))[0]!;
    });
  }

  create(auth: AuthContext, input: WorkflowInput, meta: RequestMeta): Promise<WorkflowRow> {
    return this.prisma.run(auth, async (tx) => {
      await this.checkReferences(tx, auth, input.definition);
      const wf = await tx.workflow.create({
        data: { tenantId: auth.tenantId, name: input.name, description: input.description ?? null, triggerType: input.definition.trigger.event, createdById: auth.userId },
      });
      const v = await tx.workflowVersion.create({
        data: { tenantId: auth.tenantId, workflowId: wf.id, version: 1, definition: input.definition as Prisma.InputJsonValue, createdById: auth.userId },
      });
      await tx.workflow.update({ where: { id: wf.id }, data: { activeVersionId: v.id } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'workflow.created', entityType: 'workflow', entityId: wf.id,
        metadata: { name: input.name, trigger: input.definition.trigger.event }, meta,
      });
      return this.getIn(tx, auth, wf.id);
    });
  }

  /**
   * Saves a new immutable version. New runs use it at once; runs already in progress finish on the
   * version they started with. The editor becomes the person the workflow acts as.
   */
  update(auth: AuthContext, id: string, input: WorkflowInput, meta: RequestMeta): Promise<WorkflowRow> {
    return this.prisma.run(auth, async (tx) => {
      const wf = await tx.workflow.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null }, include: latestVersion });
      if (!wf) throw notFound('Workflow');
      await this.checkReferences(tx, auth, input.definition);
      const next = (wf.versions[0]?.version ?? 0) + 1;
      const v = await tx.workflowVersion.create({
        data: { tenantId: auth.tenantId, workflowId: id, version: next, definition: input.definition as Prisma.InputJsonValue, createdById: auth.userId },
      });
      await tx.workflow.update({
        where: { id },
        data: { name: input.name, description: input.description ?? null, triggerType: input.definition.trigger.event, activeVersionId: v.id, createdById: auth.userId },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'workflow.updated', entityType: 'workflow', entityId: id,
        metadata: { version: next }, meta,
      });
      return this.getIn(tx, auth, id);
    });
  }

  setStatus(auth: AuthContext, id: string, status: 'ACTIVE' | 'PAUSED', meta: RequestMeta): Promise<WorkflowRow> {
    return this.prisma.run(auth, async (tx) => {
      const wf = await tx.workflow.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null }, include: latestVersion });
      if (!wf) throw notFound('Workflow');
      if (status === 'ACTIVE') {
        const def = workflowDefinitionSchema.parse(wf.versions[0]?.definition);
        if (!def.start || def.nodes.length === 0) {
          throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Add at least one step before activating.', details: [{ path: 'definition', message: 'No steps' }] });
        }
        await this.checkReferences(tx, auth, def);
      }
      await tx.workflow.update({ where: { id }, data: { status, ...(status === 'ACTIVE' ? { createdById: auth.userId, activatedAt: new Date() } : {}) } });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: status === 'ACTIVE' ? 'workflow.activated' : 'workflow.paused', entityType: 'workflow', entityId: id, meta,
      });
      return this.getIn(tx, auth, id);
    });
  }

  /** Soft-deletes the workflow and cancels its unfinished runs and pending approvals. */
  remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const { count } = await tx.workflow.updateMany({ where: { id, tenantId: auth.tenantId, deletedAt: null }, data: { deletedAt: new Date(), status: 'PAUSED' } });
      if (count === 0) throw notFound('Workflow');
      await tx.workflowExecution.updateMany({
        where: { workflowId: id, status: { in: ['RUNNING', 'WAITING', 'AWAITING_APPROVAL'] } },
        data: { status: 'CANCELED', error: 'The workflow was deleted.', finishedAt: new Date() },
      });
      await tx.approvalRequest.updateMany({ where: { status: 'PENDING', execution: { workflowId: id } }, data: { status: 'CANCELED' } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'workflow.deleted', entityType: 'workflow', entityId: id, meta });
    });
  }

  versions(auth: AuthContext, id: string) {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.workflowVersion.findMany({ where: { workflowId: id, tenantId: auth.tenantId }, orderBy: { version: 'desc' }, take: 50 });
      const names = await ownerRefs(tx, rows.map((r) => r.createdById));
      return rows.map((r) => ({ id: r.id, version: r.version, createdAt: r.createdAt.toISOString(), createdBy: names.get(r.createdById) ?? null, definition: r.definition as WorkflowDefinition }));
    });
  }

  executions(auth: AuthContext, q: { workflowId?: string; status?: string; limit: number }): Promise<ExecutionRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.workflowExecution.findMany({
        where: {
          tenantId: auth.tenantId,
          ...(q.workflowId ? { workflowId: q.workflowId } : {}),
          ...(q.status ? { status: q.status as Prisma.EnumExecutionStatusFilter['equals'] } : {}),
        },
        include: { workflow: { select: { name: true } }, version: { select: { version: true } }, steps: { orderBy: { startedAt: 'asc' } } },
        orderBy: { startedAt: 'desc' },
        take: q.limit,
      });
      return rows.map((r) => {
        const ev = (r.context as { event?: { type?: string; entityType?: string | null; entityId?: string | null } }).event ?? {};
        return {
          id: r.id,
          workflowId: r.workflowId,
          workflowName: r.workflow.name,
          version: r.version.version,
          status: r.status,
          simulation: r.simulation,
          eventType: ev.type ?? '',
          entityType: ev.entityType ?? null,
          entityId: ev.entityId ?? null,
          error: r.error,
          resumeAt: r.resumeAt?.toISOString() ?? null,
          startedAt: r.startedAt.toISOString(),
          finishedAt: r.finishedAt?.toISOString() ?? null,
          steps: r.steps.map((s) => ({
            nodeId: s.nodeId,
            nodeType: s.nodeType,
            status: s.status,
            output: s.output as Record<string, unknown>,
            error: s.error,
            startedAt: s.startedAt.toISOString(),
          })),
        };
      });
    });
  }

  /** Dry run against a real record. Nothing is written and no action runs. */
  async simulate(auth: AuthContext, def: WorkflowDefinition, recordId: string): Promise<SimulationResult> {
    let entity: string = TRIGGER_EVENTS[def.trigger.event as TriggerEvent].entity;
    // Email triggers are about a lead or a contact; try both.
    let record = await this.records.load(auth, entity === 'person' ? 'contact' : entity, recordId);
    if (entity === 'person') {
      entity = record ? 'contact' : 'lead';
      record ??= await this.records.load(auth, 'lead', recordId);
    }
    if (!record) throw notFound('Record');
    const ctx: EvalContext = { record, event: sampleEvent(def.trigger.event, entity, recordId, auth.userId, record) };
    if (!evaluateGroup(def.trigger.conditions, ctx)) return { path: [], triggerMatched: false, ended: 'trigger_not_matched' };
    const { steps, state } = await advance(def, def.start, ctx, { action: async (node) => ({ wouldDo: this.actions.describe(node.action, ctx) }) }, { now: new Date(), simulate: true });
    return {
      triggerMatched: true,
      path: steps.map((s) => ({
        nodeId: s.nodeId,
        nodeType: s.nodeType,
        outcome: s.nodeType === 'condition' ? (s.output.result ? 'true' : 'false') : s.status,
        detail:
          typeof s.output.wouldDo === 'string'
            ? s.output.wouldDo
            : typeof s.output.wouldWaitUntil === 'string'
              ? `Would wait until ${s.output.wouldWaitUntil}`
              : typeof s.output.wouldRequestApproval === 'string'
                ? `Would ask for approval: ${s.output.wouldRequestApproval} (assumed approved)`
                : undefined,
      })),
      ended: state.kind === 'failed' ? 'failed' : 'completed',
    };
  }

  private async getIn(tx: Prisma.TransactionClient, auth: AuthContext, id: string): Promise<WorkflowRow> {
    const row = await tx.workflow.findFirstOrThrow({ where: { id, tenantId: auth.tenantId }, include: latestVersion });
    return (await this.toRows(tx, auth.tenantId, [row]))[0]!;
  }

  /** User ids named in assign/notify/task steps must be active members of this workspace. */
  private async checkReferences(tx: Prisma.TransactionClient, auth: AuthContext, def: WorkflowDefinition): Promise<void> {
    const ids = new Set<string>();
    for (const n of def.nodes) {
      if (n.type !== 'action') continue;
      const a = n.action;
      if (a.type === 'assign_owner') a.userIds.forEach((u) => ids.add(u));
      if ((a.type === 'create_task' && a.assignTo.length === 36) || (a.type === 'notify' && a.to.length === 36)) ids.add(a.type === 'create_task' ? a.assignTo : a.to);
    }
    for (const id of ids) await assertRefs(tx, auth.tenantId, { ownerId: id }, 'definition.');
  }

  private async toRows(tx: Prisma.TransactionClient, tenantId: string, rows: WorkflowWith[]): Promise<WorkflowRow[]> {
    if (rows.length === 0) return [];
    const since = new Date(Date.now() - 30 * 86_400_000);
    const stats = await tx.workflowExecution.groupBy({
      by: ['workflowId', 'status'],
      where: { tenantId, workflowId: { in: rows.map((r) => r.id) }, startedAt: { gte: since } },
      _count: { _all: true },
    });
    const names = await ownerRefs(tx, rows.map((r) => r.createdById));
    return rows.map((r) => {
      const mine = stats.filter((s) => s.workflowId === r.id);
      const v = r.versions[0];
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        status: r.status,
        triggerType: r.triggerType as TriggerEvent,
        version: v?.version ?? 0,
        definition: (v?.definition ?? { trigger: { event: r.triggerType }, start: null, nodes: [] }) as WorkflowDefinition,
        runs30d: mine.reduce((n, s) => n + s._count._all, 0),
        failures30d: mine.filter((s) => s.status === 'FAILED').reduce((n, s) => n + s._count._all, 0),
        createdBy: names.get(r.createdById) ?? null,
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }
}

function sampleEvent(type: string, entity: string, id: string, userId: string, record: Record<string, unknown>): Record<string, unknown> {
  const base = { type, entityType: entity, entityId: id, actorUserId: userId };
  if (entity === 'deal') {
    const stage = record.stage as { name?: string } | undefined;
    return { ...base, to: stage?.name, status: record.status };
  }
  if (type.startsWith('email.') || type.startsWith('sequence.')) {
    return { ...base, email: record.email, subject: '(sample email)', sequenceName: '(sample sequence)', url: type === 'email.clicked' ? 'https://example.com/proposal' : undefined, confirmed: type !== 'email.opened' && type !== 'email.clicked', occurredAt: new Date().toISOString() };
  }
  return base;
}

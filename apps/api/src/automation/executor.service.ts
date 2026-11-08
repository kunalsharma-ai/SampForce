import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import { type WorkflowAction, workflowDefinitionSchema } from '@dealflow/types';
import { entitlementsFor } from '../billing/entitlements';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { claim, errorMessage } from '../worker/queue';
import { recordLink, WorkflowActions } from './actions.service';
import { runInAutomationScope } from './automation-context';
import { advance, type EvalContext, type RunState, type StepRecord } from './engine';
import { AutomationRecords } from './records';

/** What an execution keeps between steps. */
export interface ExecutionContext {
  event: Record<string, unknown> & { type?: string; entityType?: string | null; entityId?: string | null; actorUserId?: string | null };
  /** Node whose external action a person approved; cleared once it runs. */
  approvedNode?: string;
}

const APPROVAL_TTL_MS = 7 * 86_400_000;
const LEASE_MS = 5 * 60_000;
/** An execution claimed this many times without finishing is assumed to crash the worker and is failed. */
const MAX_ATTEMPTS = 5;

@Injectable()
export class WorkflowExecutor {
  private readonly log = new Logger(WorkflowExecutor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly actions: WorkflowActions,
    private readonly records: AutomationRecords,
    private readonly notifications: NotificationsService,
  ) {}

  /** Claims due executions (new, resumed after a delay, or approved) and runs each one. */
  async runDue(limit = 20): Promise<number> {
    const due = await claim<{ id: string; tenant_id: string }>(
      this.prisma,
      Prisma.sql`
        UPDATE workflow_executions SET locked_until = now() + ${`${LEASE_MS} milliseconds`}::interval, attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM workflow_executions
          WHERE status IN ('RUNNING', 'WAITING') AND (resume_at IS NULL OR resume_at <= now())
            AND (locked_until IS NULL OR locked_until < now())
          ORDER BY resume_at NULLS FIRST
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)
        RETURNING id, tenant_id`,
    );
    for (const row of due) {
      try {
        await this.runOne(row.id, row.tenant_id);
      } catch (err) {
        this.log.error({ executionId: row.id, err: errorMessage(err) }, 'workflow execution crashed');
        await this.finish(row.tenant_id, row.id, { kind: 'failed', nodeId: '', error: `Internal error: ${errorMessage(err)}` }).catch(() => undefined);
      }
    }
    return due.length;
  }

  async runOne(executionId: string, tenantId: string): Promise<void> {
    const exec = await this.prisma.run({ tenantId }, (tx) =>
      tx.workflowExecution.findFirst({ where: { id: executionId, tenantId }, include: { version: true, workflow: true, steps: true } }),
    );
    if (!exec || (exec.status !== 'RUNNING' && exec.status !== 'WAITING')) return;
    if (exec.workflow.deletedAt) return this.finish(tenantId, exec.id, { kind: 'failed', nodeId: exec.currentNode ?? '', error: 'The workflow was deleted.' }, 'CANCELED');
    if (exec.attempts > MAX_ATTEMPTS) {
      return this.finish(tenantId, exec.id, { kind: 'failed', nodeId: exec.currentNode ?? '', error: 'Stopped after repeated interruptions.' });
    }

    const actor = await this.actorFor(tenantId, exec.workflow.createdById);
    if (!actor) {
      return this.finish(tenantId, exec.id, {
        kind: 'failed',
        nodeId: exec.currentNode ?? '',
        error: 'The workflow owner is no longer an active member with permission to manage automations.',
      });
    }

    const def = workflowDefinitionSchema.parse(exec.version.definition);
    const context = exec.context as unknown as ExecutionContext;
    const entityType = context.event.entityType ?? null;
    const entityId = context.event.entityId ?? null;
    // Email engagement is measured from when the triggering event happened ("replied since the trigger").
    const since = typeof context.event.occurredAt === 'string' ? context.event.occurredAt : exec.startedAt.toISOString();
    const evalCtx: EvalContext = { record: await this.records.load(actor, entityType, entityId, { since }), event: context.event };
    const done = new Set(exec.steps.filter((s) => s.nodeType === 'action' && s.status === 'succeeded').map((s) => s.nodeId));

    await this.prisma.run({ tenantId }, (tx) => tx.workflowExecution.update({ where: { id: exec.id }, data: { status: 'RUNNING' } }));

    const { state } = await advance(
      def,
      exec.currentNode,
      evalCtx,
      {
        alreadyDone: (id) => done.has(id),
        refresh: () => this.records.load(actor, entityType, entityId, { since }),
        action: (node) =>
          runInAutomationScope({ workflowId: exec.workflowId, executionId: exec.id, depth: exec.depth }, () =>
            this.actions.run(actor, { workflowId: exec.workflowId, executionId: exec.id, nodeId: node.id, entityType, entityId }, node.action, evalCtx),
          ),
        onStep: (step) => this.saveStep(tenantId, exec.id, step),
      },
      { now: new Date(), approvedNode: context.approvedNode },
    );

    if (state.kind === 'awaiting_approval') {
      await this.requestApproval(tenantId, exec.id, exec.workflowId, exec.workflow.name, state, evalCtx);
      return;
    }
    await this.finish(tenantId, exec.id, state);
    if (state.kind === 'failed') {
      await this.prisma.run({ tenantId }, (tx) =>
        this.notifications.send(tx, tenantId, [exec.workflow.createdById], {
          type: 'workflow.failed',
          title: `Workflow "${exec.workflow.name}" failed`,
          body: state.error,
          link: `/app/automation/${exec.workflowId}?run=${exec.id}`,
        }),
      );
    }
  }

  private async saveStep(tenantId: string, executionId: string, step: StepRecord): Promise<void> {
    await this.prisma.run({ tenantId }, (tx) =>
      tx.workflowStep.create({
        data: {
          tenantId,
          executionId,
          nodeId: step.nodeId,
          nodeType: step.nodeType,
          status: step.status,
          output: step.output as Prisma.InputJsonValue,
          error: step.error ?? null,
          finishedAt: new Date(),
        },
      }),
    );
  }

  /** Persists where a run stopped. Waiting runs keep their lease cleared so the worker picks them up when due. */
  async finish(tenantId: string, executionId: string, state: RunState, override?: 'CANCELED'): Promise<void> {
    await this.prisma.run({ tenantId }, async (tx) => {
      const exec = await tx.workflowExecution.findFirst({ where: { id: executionId, tenantId } });
      if (!exec) return;
      const context = { ...(exec.context as object), approvedNode: undefined } as Prisma.InputJsonValue;
      const data: Prisma.WorkflowExecutionUpdateInput =
        state.kind === 'waiting'
          ? { status: 'WAITING', currentNode: state.resumeNode, resumeAt: state.resumeAt, lockedUntil: null, attempts: 0, context }
          : state.kind === 'completed'
            ? { status: 'SUCCEEDED', currentNode: null, resumeAt: null, lockedUntil: null, finishedAt: new Date(), context }
            : state.kind === 'failed'
              ? { status: override ?? 'FAILED', error: state.error, resumeAt: null, lockedUntil: null, finishedAt: new Date() }
              : {};
      await tx.workflowExecution.update({ where: { id: executionId }, data });
    });
  }

  private async requestApproval(
    tenantId: string,
    executionId: string,
    workflowId: string,
    workflowName: string,
    state: Extract<RunState, { kind: 'awaiting_approval' }>,
    ctx: EvalContext,
  ): Promise<void> {
    await this.prisma.run({ tenantId }, async (tx) => {
      const recordName = recordLabel(ctx.record);
      const action: WorkflowAction | undefined = state.action;
      const approval = await tx.approvalRequest.create({
        data: {
          tenantId,
          executionId,
          nodeId: state.nodeId,
          kind: state.reason === 'external_action' ? `workflow.${action?.type}` : 'workflow.approval_step',
          title: state.reason === 'external_action' && action ? this.actions.describe(action, ctx) : state.title,
          summary: `Workflow "${workflowName}"${recordName ? ` for ${recordName}` : ''}`,
          payload: {
            workflowId,
            nodeId: state.nodeId,
            entityType: ctx.event.entityType ?? null,
            entityId: ctx.event.entityId ?? null,
            ...(action ? { action } : {}),
          } as Prisma.InputJsonValue,
          permission: 'automation:manage',
          expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
        },
      });
      await tx.workflowExecution.update({
        where: { id: executionId },
        data: { status: 'AWAITING_APPROVAL', currentNode: state.nodeId, resumeAt: null, lockedUntil: null, attempts: 0 },
      });
      await this.notifications.send(tx, tenantId, await this.notifications.usersWithPermission(tx, tenantId, 'automation:manage'), {
        type: 'approval.requested',
        title: `Approval needed: ${approval.title}`,
        body: approval.summary,
        link: '/app/approvals',
      });
    });
  }

  /** Builds the identity a workflow acts as: its owner, with their current role, if they may still run automations. */
  async actorFor(tenantId: string, userId: string): Promise<AuthContext | null> {
    const m = await this.prisma.run({ tenantId, userId }, (tx) =>
      tx.membership.findFirst({
        where: { tenantId, userId, status: 'ACTIVE', user: { status: 'ACTIVE' }, tenant: { status: 'ACTIVE', deletedAt: null } },
        include: { role: true },
      }),
    );
    if (!m || !m.role.permissions.includes('automation:manage')) return null;
    return { userId, tenantId, sessionId: 'automation', membershipId: m.id, roleKey: m.role.key, permissions: m.role.permissions, authMethod: 'password' };
  }

  /** Starts executions for every active workflow whose trigger and conditions match an event. */
  async startForEvent(
    tx: TenantTx,
    event: { id: string; tenantId: string; type: string; entityType: string | null; entityId: string | null; actorUserId: string | null; payload: unknown; depth: number; createdAt?: Date },
    record: Record<string, unknown> | null,
    evaluate: (conditions: unknown, ctx: EvalContext) => boolean,
  ): Promise<number> {
    const workflows = await tx.workflow.findMany({
      where: { tenantId: event.tenantId, status: 'ACTIVE', triggerType: event.type, deletedAt: null, activeVersionId: { not: null } },
    });
    if (workflows.length === 0) return 0;
    const ent = await entitlementsFor(tx, event.tenantId);
    // Workflows stay saved but do not run while the plan leaves Automation Studio out (ADR 0057).
    if (!ent.features.includes('automation')) return 0;
    const runLimit = ent.entitlements.automationRunsPerMonth;
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    let used = await tx.workflowExecution.count({ where: { tenantId: event.tenantId, startedAt: { gte: monthStart } } });
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const eventCtx: ExecutionContext['event'] = {
      ...payload,
      type: event.type,
      entityType: event.entityType,
      entityId: event.entityId,
      actorUserId: event.actorUserId,
      occurredAt: (event.createdAt ?? new Date()).toISOString(),
    };
    let started = 0;
    for (const wf of workflows) {
      // A workflow never re-triggers itself; deeper chains are cut off by the depth limit.
      if (payload.workflowId === wf.id) continue;
      // Events from before the workflow was switched on (still queued when it was) do not start it.
      if (wf.activatedAt && event.createdAt && event.createdAt < wf.activatedAt) continue;
      const version = await tx.workflowVersion.findFirst({ where: { id: wf.activeVersionId!, tenantId: event.tenantId } });
      if (!version) continue;
      const def = workflowDefinitionSchema.parse(version.definition);
      if (!def.start || !evaluate(def.trigger.conditions, { record, event: eventCtx })) continue;
      if (used >= runLimit) {
        this.log.warn({ tenantId: event.tenantId, runLimit }, 'monthly automation run limit reached');
        throw new RunLimitReached(runLimit);
      }
      const r = await tx.workflowExecution.createMany({
        data: [{
          tenantId: event.tenantId,
          workflowId: wf.id,
          versionId: version.id,
          eventId: event.id,
          status: 'RUNNING',
          currentNode: def.start,
          context: { event: eventCtx } as unknown as Prisma.InputJsonValue,
          depth: event.depth,
          resumeAt: new Date(),
        }],
        skipDuplicates: true,
      });
      started += r.count;
      used += r.count;
    }
    return started;
  }
}

/** The tenant used its plan's automation runs for this month; remaining matches are skipped. */
export class RunLimitReached extends Error {
  constructor(readonly limit: number) {
    super(`Monthly automation run limit (${limit}) reached; workflows were not started.`);
  }
}

export function recordLabel(record: Record<string, unknown> | null): string | null {
  if (!record) return null;
  for (const k of ['fullName', 'name', 'title', 'subject']) if (typeof record[k] === 'string') return record[k] as string;
  if (typeof record.firstName === 'string') return [record.firstName, record.lastName].filter(Boolean).join(' ');
  return null;
}

export { recordLink };

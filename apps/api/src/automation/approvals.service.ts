import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@dealflow/database';
import { type ApprovalRow, workflowDefinitionSchema } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { applyQuoteDecision, assertCanDecideQuote, QUOTE_APPROVAL_KIND } from '../commercial/quote-approval';
import { notFound, ownerRefs } from '../crm/crm-helpers';
import { claim } from '../worker/queue';
import type { ExecutionContext } from './executor.service';

type ApprovalWith = Prisma.ApprovalRequestGetPayload<{ include: { execution: { include: { workflow: { select: { id: true; name: true } } } } } }>;
const include = { execution: { include: { workflow: { select: { id: true, name: true } } } } } as const;

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(auth: AuthContext, status: 'PENDING' | 'DECIDED'): Promise<ApprovalRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.approvalRequest.findMany({
        where: { tenantId: auth.tenantId, permission: { in: [...auth.permissions] }, ...(status === 'PENDING' ? { status: 'PENDING' } : { status: { not: 'PENDING' } }) },
        include,
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      const names = await ownerRefs(tx, rows.map((r) => r.decidedById));
      return rows.map((r) => toApprovalRow(r, names));
    });
  }

  /**
   * Records a decision and moves the paused run on. Approving an approval step continues with its
   * "next" step; approving an external action lets exactly that action run. Rejections take the
   * step's reject path, or cancel the run when an external action is refused.
   */
  decide(auth: AuthContext, id: string, decision: 'approve' | 'reject', note: string | undefined, meta: RequestMeta): Promise<ApprovalRow> {
    return this.prisma.run(auth, async (tx) => {
      const approval = await tx.approvalRequest.findFirst({ where: { id, tenantId: auth.tenantId }, include });
      if (!approval) throw notFound('Approval');
      if (!auth.permissions.includes(approval.permission)) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Your role cannot decide this approval.' });
      }
      const quoteId = approval.kind === QUOTE_APPROVAL_KIND ? String((approval.payload as { quoteId?: string }).quoteId ?? '') : null;
      if (quoteId) await assertCanDecideQuote(tx, auth.tenantId, quoteId, auth.userId);
      // Conditional update: two people deciding at once cannot both win.
      const { count } = await tx.approvalRequest.updateMany({
        where: { id, status: 'PENDING', expiresAt: { gt: new Date() } },
        data: { status: decision === 'approve' ? 'APPROVED' : 'REJECTED', decidedById: auth.userId, decidedAt: new Date(), decisionNote: note ?? null },
      });
      if (count === 0) throw new ConflictException({ code: 'ALREADY_DECIDED', message: 'This request was already decided or has expired.' });

      if (approval.executionId && approval.nodeId) {
        await this.resumeExecution(tx, approval.executionId, approval.nodeId, decision, auth);
      }
      if (quoteId) await applyQuoteDecision(tx, auth.tenantId, quoteId, decision === 'approve' ? 'APPROVED' : 'REJECTED');
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: decision === 'approve' ? 'approval.approved' : 'approval.rejected',
        entityType: 'approval', entityId: id, metadata: { kind: approval.kind, executionId: approval.executionId, note }, meta,
      });
      const updated = await tx.approvalRequest.findFirstOrThrow({ where: { id }, include });
      return toApprovalRow(updated, await ownerRefs(tx, [updated.decidedById]));
    });
  }

  private async resumeExecution(tx: Prisma.TransactionClient, executionId: string, nodeId: string, decision: 'approve' | 'reject', auth: AuthContext) {
    const exec = await tx.workflowExecution.findFirst({ where: { id: executionId, tenantId: auth.tenantId, status: 'AWAITING_APPROVAL' }, include: { version: true } });
    if (!exec) return;
    const def = workflowDefinitionSchema.parse(exec.version.definition);
    const node = def.nodes.find((n) => n.id === nodeId);
    const context = exec.context as unknown as ExecutionContext;
    const step = (status: string) =>
      tx.workflowStep.create({ data: { tenantId: auth.tenantId, executionId, nodeId, nodeType: node?.type ?? 'approval', status, output: { decidedBy: auth.userId }, finishedAt: new Date() } });

    if (decision === 'approve') {
      await step('approved');
      const next = node?.type === 'approval' ? node.next : nodeId;
      const ctx = node?.type === 'action' ? { ...context, approvedNode: nodeId } : context;
      await tx.workflowExecution.update({
        where: { id: executionId },
        data: next
          ? { status: 'RUNNING', currentNode: next, resumeAt: new Date(), context: ctx as unknown as Prisma.InputJsonValue }
          : { status: 'SUCCEEDED', currentNode: null, finishedAt: new Date() },
      });
      return;
    }
    await step('rejected');
    const onReject = node?.type === 'approval' ? node.onReject : null;
    await tx.workflowExecution.update({
      where: { id: executionId },
      data: onReject
        ? { status: 'RUNNING', currentNode: onReject, resumeAt: new Date() }
        : node?.type === 'approval'
          ? { status: 'SUCCEEDED', currentNode: null, finishedAt: new Date() }
          : { status: 'CANCELED', error: 'The action was rejected.', finishedAt: new Date() },
    });
  }

  /** Expires stale requests and cancels the runs waiting on them. */
  async expireDue(): Promise<number> {
    const rows = await claim<{ id: string; tenant_id: string; execution_id: string | null; kind: string; quote_id: string | null }>(
      this.prisma,
      Prisma.sql`
        UPDATE approval_requests SET status = 'EXPIRED'
        WHERE id IN (SELECT id FROM approval_requests WHERE status = 'PENDING' AND expires_at <= now() LIMIT 100 FOR UPDATE SKIP LOCKED)
        RETURNING id, tenant_id, execution_id, kind, payload->>'quoteId' AS quote_id`,
    );
    for (const r of rows) {
      if (r.kind === QUOTE_APPROVAL_KIND && r.quote_id) {
        await this.prisma.run({ tenantId: r.tenant_id }, (tx) => applyQuoteDecision(tx, r.tenant_id, r.quote_id!, 'EXPIRED'));
        continue;
      }
      if (!r.execution_id) continue;
      await this.prisma.run({ tenantId: r.tenant_id }, (tx) =>
        tx.workflowExecution.updateMany({
          where: { id: r.execution_id!, status: 'AWAITING_APPROVAL' },
          data: { status: 'CANCELED', error: 'The approval request expired.', finishedAt: new Date() },
        }),
      );
    }
    return rows.length;
  }
}

function toApprovalRow(r: ApprovalWith, names: Map<string, { id: string; name: string }>): ApprovalRow {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    payload: r.payload as Record<string, unknown>,
    status: r.status,
    workflow: r.execution?.workflow ?? null,
    executionId: r.executionId,
    decidedBy: r.decidedById ? (names.get(r.decidedById) ?? null) : null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

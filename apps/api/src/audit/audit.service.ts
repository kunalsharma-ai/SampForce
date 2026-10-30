import { Injectable } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import { currentAutomationScope } from '../automation/automation-context';
import { domainEventsFor } from '../automation/domain-events';
import type { RequestMeta } from '../common/auth-context';

export interface AuditEntry {
  tenantId: string;
  actorUserId: string | null;
  actorType?: 'USER' | 'SYSTEM' | 'AI_AGENT' | 'PLATFORM_ADMIN';
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  meta?: RequestMeta;
}

@Injectable()
export class AuditService {
  /**
   * Records an audit event inside the caller's transaction so the event and the change it
   * describes commit (or roll back) together. Business actions also publish domain events to the
   * outbox in the same transaction, which the worker relays to workflows, webhooks and notifications.
   */
  async record(tx: TenantTx, entry: AuditEntry): Promise<void> {
    const scope = currentAutomationScope();
    const metadata = { ...(entry.metadata ?? {}), ...(scope ? { workflowId: scope.workflowId, executionId: scope.executionId } : {}) };
    await tx.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        actorUserId: entry.actorUserId,
        actorType: scope ? 'SYSTEM' : (entry.actorType ?? 'USER'),
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        metadata: metadata as Prisma.InputJsonValue,
        ipAddress: entry.meta?.ipAddress ?? null,
        userAgent: entry.meta?.userAgent ?? null,
        requestId: entry.meta?.requestId || null,
      },
    });
    const types = domainEventsFor(entry.action, entry.metadata);
    if (types.length > 0) {
      await tx.domainEvent.createMany({
        data: types.map((type) => ({
          tenantId: entry.tenantId,
          type,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          actorUserId: entry.actorUserId,
          payload: metadata as Prisma.InputJsonValue,
          depth: scope ? scope.depth + 1 : 0,
        })),
      });
    }
  }
}

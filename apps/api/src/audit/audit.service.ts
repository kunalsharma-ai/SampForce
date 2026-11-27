import { Injectable } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
import { currentAutomationScope } from '../automation/automation-context';
import { domainEventsFor } from '../automation/domain-events';
import type { DomainEventType } from '@dealflow/types';
import type { RequestMeta } from '../common/auth-context';

export interface AuditEntry {
  tenantId: string;
  actorUserId: string | null;
  actorType?: 'USER' | 'SYSTEM' | 'AI_AGENT' | 'PLATFORM_ADMIN';
  action: string;
  /** REFUSED for an attempt the system turned down (no permission, wrong password); DONE otherwise. */
  outcome?: 'DONE' | 'REFUSED';
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  meta?: RequestMeta;
}

/** Something that wants to know about business actions as they are recorded (achievements, ADR 0090). */
export type AuditObserver = (tx: TenantTx, entry: AuditEntry) => Promise<void> | void;

@Injectable()
export class AuditService {
  private readonly observers: AuditObserver[] = [];

  /** Calls `fn` for every entry recorded from now on, inside the recording transaction. Refused attempts are left out. */
  observe(fn: AuditObserver): void {
    this.observers.push(fn);
  }

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
        outcome: entry.outcome ?? 'DONE',
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        metadata: metadata as Prisma.InputJsonValue,
        ipAddress: entry.meta?.ipAddress ?? null,
        userAgent: entry.meta?.userAgent ?? null,
        requestId: entry.meta?.requestId || null,
      },
    });
    const types = entry.outcome === 'REFUSED' ? [] : domainEventsFor(entry.action, entry.metadata);
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
    if (entry.outcome !== 'REFUSED') for (const fn of this.observers) await fn(tx, entry);
  }

  /**
   * Publishes one domain event without an audit entry, for high-volume facts already stored elsewhere
   * (email opens, clicks, replies). Same outbox, same transaction, same loop protection as `record`.
   */
  async publish(tx: TenantTx, e: { tenantId: string; type: DomainEventType; entityType: string; entityId: string; actorUserId?: string | null; payload?: Record<string, unknown> }): Promise<void> {
    const scope = currentAutomationScope();
    await tx.domainEvent.create({
      data: {
        tenantId: e.tenantId,
        type: e.type,
        entityType: e.entityType,
        entityId: e.entityId,
        actorUserId: e.actorUserId ?? null,
        payload: { ...(e.payload ?? {}), ...(scope ? { workflowId: scope.workflowId, executionId: scope.executionId } : {}) } as Prisma.InputJsonValue,
        depth: scope ? scope.depth + 1 : 0,
      },
    });
  }
}

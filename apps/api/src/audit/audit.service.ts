import { Injectable } from '@nestjs/common';
import { Prisma, type TenantTx } from '@dealflow/database';
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
   * describes commit (or roll back) together.
   */
  async record(tx: TenantTx, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        actorUserId: entry.actorUserId,
        actorType: entry.actorType ?? 'USER',
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
        ipAddress: entry.meta?.ipAddress ?? null,
        userAgent: entry.meta?.userAgent ?? null,
        requestId: entry.meta?.requestId || null,
      },
    });
  }
}

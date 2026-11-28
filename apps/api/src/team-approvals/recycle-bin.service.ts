import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type RecycleScope, type TenantTx, unpackRecord } from '@dealflow/database';
import { recordModelLabel, type RecycleBatchRow, type RestoreResult, approvalReference } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { scan } from '../worker/queue';
import { callerOf } from '../workspace-work/hierarchy';
import { branchUserIds, resolveOrganisation } from '../workspaces/access';
import { nameOfRecord, recordOfRoute } from './record-of-route';
import { TeamApprovalsService } from './team-approvals.service';

const DAY = 86_400_000;
const CHUNK = 500;

type Delegate = {
  findMany(args: unknown): Promise<Record<string, unknown>[]>;
  create(args: unknown): Promise<unknown>;
  updateMany(args: unknown): Promise<{ count: number }>;
};
const delegateOf = (tx: TenantTx, model: string) => (tx as unknown as Record<string, Delegate | undefined>)[model.charAt(0).toLowerCase() + model.slice(1)];

/**
 * Deleted items (ADR 0098): every delete request, by anyone, is kept as one batch that can be restored until the
 * organisation's keep period ends. Super sees every batch, a manager its team's, an executive their own.
 */
@Injectable()
export class RecycleBinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approvals: TeamApprovalsService,
  ) {}

  /** Stores what a delete request removed. Returns the batch id, or null when it removed nothing the bin keeps. */
  async keep(auth: AuthContext, scope: RecycleScope, method: string, path: string, body: unknown, approvalId: string | null): Promise<string | null> {
    if (!scope.entries.length) return null;
    return this.prisma.run(auth, async (tx) => {
      const settings = await this.approvals.settingsOf(tx, auth.tenantId);
      const rr = recordOfRoute(path, body);
      const counts: Record<string, number> = {};
      for (const e of scope.entries) counts[e.model] = (counts[e.model] ?? 0) + 1;
      const main = rr?.model && counts[rr.model] ? rr.model : scope.entries[0]!.model;
      const mainEntries = scope.entries.filter((e) => e.model === main);
      let label: string;
      if (mainEntries.length === 1) {
        const e = mainEntries[0]!;
        let rec = e.data ? (unpackRecord(e.data) as Record<string, unknown>) : null;
        if (!rec) rec = (await delegateOf(tx, main)?.findMany({ where: { id: e.recordId, tenantId: auth.tenantId } }))?.[0] ?? null;
        label = (rec && nameOfRecord(main, rec)) ?? recordModelLabel(main);
      } else {
        label = `${mainEntries.length.toLocaleString('en-US')} ${recordModelLabel(main, mainEntries.length).toLowerCase()}`;
      }
      const batch = await tx.recycleBatch.create({
        data: {
          tenantId: auth.tenantId,
          actorUserId: auth.userId,
          actorNodeId: auth.workspaceNodeId ?? null,
          method,
          path,
          recordType: main,
          label: label.slice(0, 200),
          count: mainEntries.length,
          models: counts,
          partial: scope.overflow,
          approvalId,
          purgeAfter: new Date(Date.now() + settings.keepDeletedDays * DAY),
        },
      });
      return batch.id;
    }).then(async (batchId) => {
      // The copies go in after the batch, in chunks of their own, so a large delete does not hit the transaction limit.
      if (!batchId) return batchId;
      for (let i = 0; i < scope.entries.length; i += CHUNK) {
        const part = scope.entries.slice(i, i + CHUNK);
        await this.prisma.run(auth, (tx) =>
          tx.recycleEntry.createMany({
            data: part.map((e, j) => ({ tenantId: auth.tenantId, batchId, seq: i + j, model: e.model, recordId: e.recordId, kind: e.kind, data: (e.data ?? undefined) as Prisma.InputJsonValue | undefined })),
          }),
        );
      }
      return batchId;
    });
  }

  /** Users whose deletes the caller sees: everyone (Super), their team (Manager), themselves (Executive). */
  private async actorsVisible(tx: TenantTx, auth: AuthContext): Promise<string[] | null> {
    const org = await resolveOrganisation(tx, auth.tenantId);
    const me = callerOf(auth, org);
    if (me.level === 'SUPER') return null;
    if (me.level === 'MANAGER') return [...new Set([auth.userId, ...(await branchUserIds(tx, auth.tenantId, me.node.id))])];
    return [auth.userId];
  }

  list(auth: AuthContext, q: { q?: string; state?: 'kept' | 'restored' | 'any' }): Promise<RecycleBatchRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const actors = await this.actorsVisible(tx, auth);
      const org = await resolveOrganisation(tx, auth.tenantId);
      const me = callerOf(auth, org);
      const where: Prisma.RecycleBatchWhereInput = {
        tenantId: auth.tenantId,
        purgeAfter: { gt: new Date() },
        ...(actors ? { actorUserId: { in: actors } } : {}),
        ...(q.state === 'kept' ? { OR: [{ restoredAt: null }, { restoredAt: { isSet: false } }] } : q.state === 'restored' ? { restoredAt: { not: null } } : {}),
        ...(q.q ? { label: { contains: q.q, mode: 'insensitive' as const } } : {}),
      };
      const rows = await tx.recycleBatch.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 });
      const users = new Map((await tx.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.actorUserId, r.restoredById]).filter((v): v is string => !!v))] } }, select: { id: true, name: true } })).map((u) => [u.id, u]));
      const approvals = new Map((await tx.teamApproval.findMany({ where: { tenantId: auth.tenantId, id: { in: rows.map((r) => r.approvalId).filter((v): v is string => !!v) } }, select: { id: true, number: true } })).map((a) => [a.id, a.number]));
      return rows.map((r) => {
        const models = (r.models ?? {}) as Record<string, number>;
        return {
          id: r.id,
          recordType: r.recordType,
          recordTypeLabel: recordModelLabel(r.recordType, r.count),
          label: r.label,
          count: r.count,
          parts: Object.entries(models).map(([model, count]) => ({ label: recordModelLabel(model, count), count })),
          partial: r.partial,
          deletedBy: users.get(r.actorUserId) ?? { id: r.actorUserId, name: 'Former member' },
          deletedAt: r.createdAt.toISOString(),
          approvalReference: r.approvalId && approvals.has(r.approvalId) ? approvalReference(approvals.get(r.approvalId)!) : null,
          restoredAt: r.restoredAt?.toISOString() ?? null,
          restoredBy: r.restoredById ? (users.get(r.restoredById) ?? null) : null,
          restoreFailed: r.restoreFailed,
          purgeAfter: r.purgeAfter.toISOString(),
          canRestore: !r.restoredAt,
          canPurge: me.level !== 'EXECUTIVE' || r.actorUserId === auth.userId,
        };
      });
    });
  }

  private async batchFor(tx: TenantTx, auth: AuthContext, id: string) {
    const actors = await this.actorsVisible(tx, auth);
    const batch = await tx.recycleBatch.findFirst({ where: { id, tenantId: auth.tenantId, purgeAfter: { gt: new Date() } } });
    if (!batch || (actors && !actors.includes(batch.actorUserId))) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Deleted item not found.' });
    return batch;
  }

  /** Puts everything a batch removed back. Records whose unique value was taken again meanwhile are counted as failed. */
  async restore(auth: AuthContext, id: string, meta: RequestMeta): Promise<RestoreResult> {
    // Claimed first, so two people restoring at once do not both insert.
    await this.prisma.run(auth, async (tx) => {
      await this.batchFor(tx, auth, id);
      const { count } = await tx.recycleBatch.updateMany({ where: { id, OR: [{ restoredAt: null }, { restoredAt: { isSet: false } }] }, data: { restoredAt: new Date(), restoredById: auth.userId } });
      if (!count) throw new ConflictException({ code: 'ALREADY_RESTORED', message: 'This was already restored.' });
    });
    const entries = await this.prisma.run(auth, (tx) => tx.recycleEntry.findMany({ where: { tenantId: auth.tenantId, batchId: id }, orderBy: { seq: 'desc' } }));
    let restored = 0;
    let failed = 0;
    const soft = new Map<string, string[]>();
    for (const e of entries) if (e.kind === 'SOFT') soft.set(e.model, [...(soft.get(e.model) ?? []), e.recordId]);
    for (const [model, ids] of soft) {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const part = ids.slice(i, i + CHUNK);
        restored += await this.prisma.run(auth, async (tx) => (await delegateOf(tx, model)!.updateMany({ where: { tenantId: auth.tenantId, id: { in: part } }, data: { deletedAt: null } })).count);
      }
    }
    // Copies go back one by one: on MongoDB a refused insert ends its transaction, so each has its own.
    for (const e of entries) {
      if (e.kind !== 'HARD' || !e.data) continue;
      try {
        await this.prisma.run(auth, async (tx) => {
          const delegate = delegateOf(tx, e.model);
          if (!delegate) throw new Error('unknown model');
          const exists = await delegate.findMany({ where: { id: e.recordId }, select: { id: true } });
          if (exists.length) return;
          await delegate.create({ data: unpackRecord(e.data) });
        });
        restored++;
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError) && !(err instanceof Error)) throw err;
        failed++;
      }
    }
    await this.prisma.run(auth, async (tx) => {
      await tx.recycleBatch.update({ where: { id }, data: { restoreFailed: failed } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'records.restored', entityType: 'recycle_batch', entityId: id, metadata: { restored, failed }, meta });
    });
    return { restored, failed };
  }

  /** Removes a batch for good: its records can no longer be restored. */
  async purge(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    await this.prisma.run(auth, async (tx) => {
      const batch = await this.batchFor(tx, auth, id);
      const org = await resolveOrganisation(tx, auth.tenantId);
      if (callerOf(auth, org).level === 'EXECUTIVE' && batch.actorUserId !== auth.userId) {
        throw new ForbiddenException({ code: 'NOT_YOUR_DELETE', message: 'You can remove only what you deleted yourself.' });
      }
      await tx.recycleEntry.deleteMany({ where: { tenantId: auth.tenantId, batchId: id } });
      await tx.recycleBatch.delete({ where: { id } });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'records.purged', entityType: 'recycle_batch', entityId: id, metadata: { label: batch.label, count: batch.count, recordType: batch.recordType }, meta });
    });
  }

  /** Removes batches past their keep period (the worker). */
  async sweep(): Promise<number> {
    const due = await scan(() => this.prisma.recycleBatch.findMany({ where: { purgeAfter: { lte: new Date() } }, select: { id: true, tenantId: true }, take: 200 }));
    for (const b of due) {
      await this.prisma.run({ tenantId: b.tenantId }, async (tx) => {
        await tx.recycleEntry.deleteMany({ where: { tenantId: b.tenantId, batchId: b.id } });
        await tx.recycleBatch.deleteMany({ where: { id: b.id } });
      });
    }
    return due.length;
  }
}

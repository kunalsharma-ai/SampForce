import { Injectable, Logger } from '@nestjs/common';
import { type DomainEvent, Prisma, type TenantTx } from '@dealflow/database';
import { TRIGGER_EVENTS } from '@dealflow/types';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { claim, enterTenant, errorMessage } from '../worker/queue';
import { MAX_AUTOMATION_DEPTH } from './automation-context';
import { evaluateGroup } from './engine';
import { recordLabel, recordLink, RunLimitReached, WorkflowExecutor } from './executor.service';
import { AutomationRecords } from './records';

const MAX_EVENT_ATTEMPTS = 10;

/**
 * Relays committed domain events from the outbox to workflows, webhook deliveries and notifications.
 * Each event is handled in one transaction that holds its row lock, so two workers never relay the
 * same event, and the fan-out commits atomically with the "processed" mark.
 */
@Injectable()
export class EventRelay {
  private readonly log = new Logger(EventRelay.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: WorkflowExecutor,
    private readonly records: AutomationRecords,
    private readonly notifications: NotificationsService,
  ) {}

  async relayBatch(limit = 100): Promise<number> {
    const failed: string[] = [];
    let processed = 0;
    while (processed + failed.length < limit) {
      const outcome = await this.relayNext(failed);
      if (!outcome) break;
      if (outcome.ok) processed++;
      else failed.push(outcome.id);
    }
    return processed;
  }

  private async relayNext(skip: string[]): Promise<{ id: string; ok: boolean } | null> {
    let claimed: { id: string; tenant_id: string } | undefined;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.worker_scan', 'on', true)`;
          const rows = await tx.$queryRaw<{ id: string; tenant_id: string }[]>`
            SELECT id, tenant_id FROM domain_events
            WHERE processed_at IS NULL AND attempts < ${MAX_EVENT_ATTEMPTS}
              ${skip.length ? Prisma.sql`AND id <> ALL(${skip}::uuid[])` : Prisma.empty}
            ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
          claimed = rows[0];
          if (!claimed) return null;
          await enterTenant(tx, claimed.tenant_id);
          const event = await tx.domainEvent.findUniqueOrThrow({ where: { id: claimed.id } });
          const note = await this.fanOut(tx, event);
          await tx.domainEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), attempts: { increment: 1 }, lastError: note } });
          return { id: event.id, ok: true };
        },
        { timeout: 60_000 },
      );
    } catch (err) {
      if (!claimed) throw err;
      const id = claimed.id;
      this.log.warn({ eventId: id, err: errorMessage(err) }, 'event relay failed');
      await claim(this.prisma, Prisma.sql`UPDATE domain_events SET attempts = attempts + 1, last_error = ${errorMessage(err)} WHERE id = ${id}::uuid RETURNING id`);
      return { id, ok: false };
    }
  }

  /** Returns a note stored on the event (for example, why no workflow started). */
  private async fanOut(tx: TenantTx, event: DomainEvent): Promise<string | null> {
    let note: string | null = null;
    let record: Record<string, unknown> | null | undefined;
    const loadRecord = async () => (record === undefined ? (record = await this.records.load({ tenantId: event.tenantId, userId: '' }, event.entityType, event.entityId)) : record);

    if (event.type in TRIGGER_EVENTS) {
      if (event.depth > MAX_AUTOMATION_DEPTH) {
        note = `Automation depth limit (${MAX_AUTOMATION_DEPTH}) reached; no workflows started.`;
      } else {
        const hasWorkflows = await tx.workflow.count({ where: { tenantId: event.tenantId, status: 'ACTIVE', triggerType: event.type, deletedAt: null } });
        if (hasWorkflows > 0) {
          try {
            await this.executor.startForEvent(tx, event, await loadRecord(), (conditions, ctx) =>
              evaluateGroup(conditions as Parameters<typeof evaluateGroup>[0], ctx),
            );
          } catch (err) {
            if (!(err instanceof RunLimitReached)) throw err;
            note = err.message;
          }
        }
      }
    }

    const hooks = await tx.webhook.findMany({
      where: { tenantId: event.tenantId, active: true, deletedAt: null, events: { has: event.type } },
      select: { id: true },
    });
    if (hooks.length > 0) {
      await tx.webhookDelivery.createMany({
        data: hooks.map((h) => ({ tenantId: event.tenantId, webhookId: h.id, eventId: event.id, eventType: event.type })),
        skipDuplicates: true,
      });
    }

    await this.notify(tx, event, loadRecord);
    return note;
  }

  /** Personal notifications for people affected by someone else's change. */
  private async notify(tx: TenantTx, event: DomainEvent, loadRecord: () => Promise<Record<string, unknown> | null>): Promise<void> {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const link = recordLink(event.entityType, event.entityId);
    const others = (ids: (string | null | undefined)[]) => ids.filter((u) => u && u !== event.actorUserId);
    switch (event.type) {
      case 'lead.assigned': {
        const to = (payload.changes as { ownerId?: { to?: string } } | undefined)?.ownerId?.to;
        const users = others([to]);
        if (users.length === 0) return;
        const name = recordLabel(await loadRecord()) ?? 'A lead';
        await this.notifications.send(tx, event.tenantId, users, { type: 'lead.assigned', title: `${name} was assigned to you`, link, eventId: event.id });
        return;
      }
      case 'task.created': {
        const users = others([payload.assigneeId as string | undefined]);
        if (users.length === 0) return;
        const task = await loadRecord();
        await this.notifications.send(tx, event.tenantId, users, {
          type: 'task.assigned',
          title: `New task for you: ${recordLabel(task) ?? 'Task'}`,
          link: '/app/activities',
          eventId: event.id,
        });
        return;
      }
      case 'deal.won': {
        const deal = await loadRecord();
        const owner = (deal?.owner as { id?: string } | null | undefined)?.id;
        const users = others([owner]);
        if (users.length === 0) return;
        await this.notifications.send(tx, event.tenantId, users, { type: 'deal.won', title: `Deal won: ${recordLabel(deal) ?? 'a deal'}`, link, eventId: event.id });
        return;
      }
      default:
        return;
    }
  }
}

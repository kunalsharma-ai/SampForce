import { Injectable, Logger } from '@nestjs/common';
import { createManySkipDuplicates, type DomainEvent, Prisma, type TenantTx } from '@dealflow/database';
import { TRIGGER_EVENTS } from '@dealflow/types';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { errorMessage, scan } from '../worker/queue';
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
    const candidate = await scan(() =>
      this.prisma.domainEvent.findFirst({
        where: { processedAt: null, attempts: { lt: MAX_EVENT_ATTEMPTS }, ...(skip.length ? { id: { notIn: skip } } : {}) },
        orderBy: { createdAt: 'asc' },
        select: { id: true, tenantId: true },
      }),
    );
    if (!candidate) return null;
    const { id, tenantId } = candidate;
    try {
      return await this.prisma.run(
        { tenantId },
        async (tx) => {
          // Writing the event first takes it for this transaction (was FOR UPDATE SKIP LOCKED): a second worker
          // relaying the same event gets a write conflict, retries after this one commits, and then finds it done.
          const taken = await tx.domainEvent.updateMany({ where: { id, processedAt: null }, data: { attempts: { increment: 1 } } });
          if (taken.count === 0) return { id, ok: true };
          const event = await tx.domainEvent.findUniqueOrThrow({ where: { id } });
          const note = await this.fanOut(tx, event);
          await tx.domainEvent.update({ where: { id }, data: { processedAt: new Date(), lastError: note } });
          return { id, ok: true };
        },
        { timeoutMs: 60_000 },
      );
    } catch (err) {
      this.log.warn({ eventId: id, err: errorMessage(err) }, 'event relay failed');
      await scan(() => this.prisma.domainEvent.updateMany({ where: { id }, data: { attempts: { increment: 1 }, lastError: errorMessage(err) } }));
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

    if (event.type === 'lead.created' && event.entityId) await this.queueLeadQualification(tx, event);

    const hooks = await tx.webhook.findMany({
      where: { tenantId: event.tenantId, active: true, deletedAt: null, events: { has: event.type } },
      select: { id: true },
    });
    if (hooks.length > 0) {
      await createManySkipDuplicates(tx.webhookDelivery, 'WebhookDelivery', hooks.map((h) => ({ tenantId: event.tenantId, webhookId: h.id, eventId: event.id, eventType: event.type })));
    }

    await this.notify(tx, event, loadRecord);
    return note;
  }

  /** Automatic lead qualification, when the workspace turned it on. The AI runner picks the run up. */
  private async queueLeadQualification(tx: TenantTx, event: DomainEvent): Promise<void> {
    const s = await tx.aiSettings.findUnique({ where: { tenantId: event.tenantId } });
    if (!s?.enabled || !s.autoQualifyLeads || s.disabledAgents.includes('lead_qualification')) return;
    await tx.aiRun.createMany({
      data: [{ tenantId: event.tenantId, agent: 'lead_qualification', status: 'QUEUED', entityType: 'lead', entityId: event.entityId, input: { eventId: event.id }, promptVersion: 'queued' }],
    });
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

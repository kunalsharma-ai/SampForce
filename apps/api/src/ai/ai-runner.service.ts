import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@dealflow/database';
import { PrismaService } from '../common/prisma.service';
import { claimDue, errorMessage } from '../worker/queue';
import { AgentsService, systemActor } from './agents.service';

const MAX_ATTEMPTS = 3;
const LEASE_MS = 5 * 60_000;

/**
 * Processes queued agent runs (today: automatic lead qualification after `lead.created`). Automatic
 * runs act as a read-only system identity, so they can score and summarise but never change records
 * beyond the stored score.
 */
@Injectable()
export class AiRunner {
  private readonly log = new Logger(AiRunner.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agents: AgentsService,
  ) {}

  async runDue(limit = 10): Promise<number> {
    const now = new Date();
    const rows = (
      await claimDue(this.prisma.aiRun, {
        where: { OR: [{ status: 'QUEUED', runAt: { lte: now } }, { status: 'RUNNING', leaseUntil: { lt: now }, attempts: { lt: MAX_ATTEMPTS } }] },
        lease: { status: 'RUNNING', attempts: { increment: 1 }, leaseUntil: new Date(now.getTime() + LEASE_MS) },
        select: { tenantId: true, agent: true, entityId: true },
        orderBy: { runAt: 'asc' },
        limit,
      })
    ).map((r) => ({ id: r.id, tenant_id: r.tenantId, agent: r.agent, entity_id: r.entityId }));
    for (const r of rows) {
      try {
        if (r.agent === 'lead_qualification' && r.entity_id) {
          await this.agents.qualifyLead(systemActor(r.tenant_id, ['leads:read', 'activities:read']), r.entity_id, { runId: r.id });
        } else {
          await this.prisma.run({ tenantId: r.tenant_id }, (tx) => tx.aiRun.update({ where: { id: r.id }, data: { status: 'FAILED', error: 'Unknown queued agent.', finishedAt: new Date() } }));
        }
      } catch (err) {
        // qualifyLead already recorded the failure on the run.
        this.log.warn({ runId: r.id, err: errorMessage(err) }, 'queued AI run failed');
      }
    }
    return rows.length;
  }
}

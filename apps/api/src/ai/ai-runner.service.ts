import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@dealflow/database';
import { PrismaService } from '../common/prisma.service';
import { claim, errorMessage } from '../worker/queue';
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
    const rows = await claim<{ id: string; tenant_id: string; agent: string; entity_id: string | null }>(
      this.prisma,
      Prisma.sql`
        UPDATE ai_runs SET status = 'RUNNING', attempts = attempts + 1, lease_until = now() + ${`${LEASE_MS} milliseconds`}::interval
        WHERE id IN (
          SELECT id FROM ai_runs
          WHERE (status = 'QUEUED' AND run_at <= now()) OR (status = 'RUNNING' AND lease_until < now() AND attempts < ${MAX_ATTEMPTS})
          ORDER BY run_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
        RETURNING id, tenant_id, agent, entity_id`,
    );
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

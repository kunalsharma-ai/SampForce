import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { AiRunner } from '../ai/ai-runner.service';
import { ApprovalsService } from '../automation/approvals.service';
import { EventRelay } from '../automation/event-relay.service';
import { WorkflowExecutor } from '../automation/executor.service';
import { API_ENV, type ApiEnv } from '../common/env';
import { IntegrationsService } from '../integrations/integrations.service';
import { WebhookDeliverer } from '../webhooks/delivery.service';
import { errorMessage } from './queue';

export interface WorkerTick {
  events: number;
  executions: number;
  deliveries: number;
  approvalsExpired: number;
  syncs: number;
  aiRuns: number;
}

/**
 * The background worker: one loop that drains the Postgres-backed queues (outbox, workflow runs,
 * webhook deliveries, approval expiry, mailbox sync, queued AI agent runs). Safe to run several copies; every claim uses
 * FOR UPDATE SKIP LOCKED with a lease.
 */
@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(WorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;
  private stopped = false;

  constructor(
    private readonly relay: EventRelay,
    private readonly executor: WorkflowExecutor,
    private readonly deliverer: WebhookDeliverer,
    private readonly approvals: ApprovalsService,
    private readonly integrations: IntegrationsService,
    private readonly aiRunner: AiRunner,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** The API process runs the loop only when RUN_WORKER_IN_PROCESS is set; `worker.ts` always starts it. */
  onApplicationBootstrap(): void {
    if (this.env.RUN_WORKER_IN_PROCESS) this.start();
  }

  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.log.log(`worker polling every ${this.env.WORKER_POLL_MS} ms`);
    const loop = async () => {
      if (this.stopped) return;
      this.running = this.tick().catch((err) => this.log.error({ err: errorMessage(err) }, 'worker tick failed'));
      await this.running;
      if (!this.stopped) this.timer = setTimeout(loop, this.env.WORKER_POLL_MS);
    };
    this.timer = setTimeout(loop, 0);
  }

  /** One pass over every queue. Relays first so new events start their workflows in the same tick. */
  async tick(): Promise<WorkerTick> {
    const events = await this.relay.relayBatch();
    const executions = await this.executor.runDue();
    const deliveries = await this.deliverer.deliverDue();
    const approvalsExpired = await this.approvals.expireDue();
    const syncs = await this.integrations.syncDue();
    const aiRuns = await this.aiRunner.runDue();
    return { events, executions, deliveries, approvalsExpired, syncs, aiRuns };
  }

  /** Runs ticks until the queues are idle (tests and the "run now" paths use this). */
  async drain(maxTicks = 10): Promise<WorkerTick[]> {
    const ticks: WorkerTick[] = [];
    for (let i = 0; i < maxTicks; i++) {
      const t = await this.tick();
      ticks.push(t);
      if (t.events + t.executions + t.deliveries + t.approvalsExpired + t.syncs + t.aiRuns === 0) break;
    }
    return ticks;
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running;
  }
}

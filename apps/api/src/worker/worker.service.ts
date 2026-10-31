import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { AiRunner } from '../ai/ai-runner.service';
import { BillingService } from '../billing/billing.service';
import { ApprovalsService } from '../automation/approvals.service';
import { EventRelay } from '../automation/event-relay.service';
import { WorkflowExecutor } from '../automation/executor.service';
import { ContractsService } from '../commercial/contracts.service';
import { API_ENV, type ApiEnv } from '../common/env';
import { IntegrationsService } from '../integrations/integrations.service';
import { SuccessService } from '../revenue/success.service';
import { GamificationService } from '../gamification/gamification.service';
import { VisitorsService } from '../visitors/visitors.service';
import { DealHealthService } from '../intelligence/deal-health.service';
import { SequenceRunner } from '../sequences/sequence-runner.service';
import { WebhookDeliverer } from '../webhooks/delivery.service';
import { workerItems, workerLastTick, workerTicks } from '../observability/metrics';
import { errorMessage } from './queue';

export interface WorkerTick {
  events: number;
  executions: number;
  deliveries: number;
  approvalsExpired: number;
  syncs: number;
  aiRuns: number;
  contracts: number;
  health: number;
  billing: number;
  sequences: number;
  /** Badges awarded by the hourly gamification sweep. */
  badges: number;
  /** Website tracking rows deleted under each workspace's retention period. */
  visitorRetention: number;
}

/**
 * The background worker: one loop that drains the Postgres-backed queues (outbox, workflow runs,
 * webhook deliveries, approval expiry, mailbox sync, queued AI agent runs, contract expiry and renewal reminders, customer health, trial expiry and dunning, sequence sends). Safe to run several copies; every claim uses
 * FOR UPDATE SKIP LOCKED with a lease.
 */
@Injectable()
export class WorkerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger(WorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;
  private stopped = false;
  private lastTickAt = Date.now();

  constructor(
    private readonly relay: EventRelay,
    private readonly executor: WorkflowExecutor,
    private readonly deliverer: WebhookDeliverer,
    private readonly approvals: ApprovalsService,
    private readonly integrations: IntegrationsService,
    private readonly aiRunner: AiRunner,
    private readonly contracts: ContractsService,
    private readonly success: SuccessService,
    private readonly dealHealth: DealHealthService,
    private readonly billing: BillingService,
    private readonly sequences: SequenceRunner,
    private readonly gamification: GamificationService,
    private readonly visitors: VisitorsService,
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
      this.running = this.tick().then(
        (counts) => {
          workerTicks.inc({ outcome: 'ok' });
          for (const [queue, n] of Object.entries(counts)) if (n) workerItems.inc({ queue }, n);
        },
        (err) => {
          workerTicks.inc({ outcome: 'error' });
          this.log.error({ err: errorMessage(err) }, 'worker tick failed');
        },
      );
      await this.running;
      this.lastTickAt = Date.now();
      workerLastTick.set(this.lastTickAt / 1000);
      if (!this.stopped) this.timer = setTimeout(loop, this.env.WORKER_POLL_MS);
    };
    this.timer = setTimeout(loop, 0);
  }

  /** Healthy while passes keep finishing within five minutes (a failed pass still counts: the loop is alive and retries). */
  isHealthy(): boolean {
    return !this.stopped && Date.now() - this.lastTickAt < Math.max(300_000, this.env.WORKER_POLL_MS * 10);
  }

  /** One pass over every queue. Relays first so new events start their workflows in the same tick. */
  async tick(): Promise<WorkerTick> {
    const events = await this.relay.relayBatch();
    const executions = await this.executor.runDue();
    const deliveries = await this.deliverer.deliverDue();
    const approvalsExpired = await this.approvals.expireDue();
    const syncs = await this.integrations.syncDue();
    const aiRuns = await this.aiRunner.runDue();
    const contracts = await this.contracts.runDue();
    const health = (await this.success.sweep()) + (await this.dealHealth.sweep());
    const billing = await this.billing.runDue();
    const sequences = await this.sequences.runDue();
    const badges = await this.gamification.sweep();
    const visitorRetention = await this.visitors.sweep();
    return { events, executions, deliveries, approvalsExpired, syncs, aiRuns, contracts, health, billing, sequences, badges, visitorRetention };
  }

  /** Runs ticks until the queues are idle (tests and the "run now" paths use this). */
  async drain(maxTicks = 10): Promise<WorkerTick[]> {
    const ticks: WorkerTick[] = [];
    for (let i = 0; i < maxTicks; i++) {
      const t = await this.tick();
      ticks.push(t);
      if (t.events + t.executions + t.deliveries + t.approvalsExpired + t.syncs + t.aiRuns + t.contracts + t.sequences === 0) break;
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

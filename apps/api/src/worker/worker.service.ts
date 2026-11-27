import { ZoomService } from '../apps/zoom.service';
import { SampbidxChatService } from '../apps/sampbidx-chat.service';
import { TaskPlansService } from '../task-plans/task-plans.service';
import { PipsService } from '../recognition/pips.service';
import { RecognitionService } from '../recognition/recognition.service';
import { CrmRemindersService } from '../crm/crm-reminders.service';
import { CompanyLogosService } from '../crm/company-logos.service';
import { CompanyEnrichmentService } from '../crm/company-enrichment.service';
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
import { ProspectsService } from '../prospects/prospects.service';
import { DealHealthService } from '../intelligence/deal-health.service';
import { SequenceRunner } from '../sequences/sequence-runner.service';
import { WebhookDeliverer } from '../webhooks/delivery.service';
import { workerItems, workerLastTick, workerTicks } from '../observability/metrics';
import { errorMessage } from './queue';
import { MobilePushService } from '../mobile/push/mobile-push.service';
import { CompanyClosureService } from '../tenants/company-closure.service';
import { ConsoleNotificationSweep } from '../operator/console-notifications.service';
import { ConsoleHealthService } from '../operator/console-health.service';
import { ConsoleOverviewService } from '../operator/console-overview.service';

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
  prospectImports: number;
  /** Zoom transcripts imported into meeting notes. */
  zoomTranscripts: number;
  /** Follow-up and RFQ deadline reminders sent (ADR 0062). */
  reminders: number;
  /** Company logos looked up from company websites (ADR 0070). */
  logos: number;
  /** Company auto-fill runs (ADR 0076). */
  autofills: number;
  /** Phone notifications sent through Expo (ADR 0072, M8). */
  pushes: number;
  /** Closed companies whose 30 days passed, erased (workspace redesign W7). */
  erasures: number;
  /** Console notifications delivered to operators (ADR 0074, C3b). */
  consoleNotifications: number;
  /** Clients whose health score was measured (ADR 0074, C5): each once a day, and again after the weights change. */
  clientHealth: number;
  /** SampBidx chat messages tried again (ADR 0078). */
  sampbidxChat: number;
  /** Recurring task instances made, counted, closed and reminded (ADR 0096). */
  taskPlans: number;
  /** Employee of the Month targets counted (and month-end selections) and improvement plans counted (ADR 0102). */
  recognition: number;
}

/**
 * The background worker: one loop that drains the database-backed queues (outbox, workflow runs,
 * webhook deliveries, approval expiry, mailbox sync, queued AI agent runs, contract expiry and renewal reminders, customer health, trial expiry and dunning, sequence sends, company logo look-ups). Safe to run several copies; every claim uses
 * a conditional update that takes a lease (worker/queue.ts), so exactly one copy wins each item.
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
    private readonly prospects: ProspectsService,
    private readonly zoom: ZoomService,
    private readonly sampbidxChat: SampbidxChatService,
    private readonly taskPlans: TaskPlansService,
    private readonly recognition: RecognitionService,
    private readonly pips: PipsService,
    private readonly reminders: CrmRemindersService,
    private readonly logos: CompanyLogosService,
    private readonly autofill: CompanyEnrichmentService,
    private readonly pushes: MobilePushService,
    private readonly closures: CompanyClosureService,
    private readonly consoleNotices: ConsoleNotificationSweep,
    private readonly clientHealth: ConsoleHealthService,
    private readonly overview: ConsoleOverviewService,
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
  private lastConsoleSweep = 0;

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
    const prospectImports = await this.prospects.sweep();
    const zoomTranscripts = await this.zoom.importDue();
    const reminders = await this.reminders.sweep();
    const logos = await this.logos.runDue();
    const autofills = await this.autofill.runDue();
    // After everything that notifies, so a reminder written in this pass reaches phones in the same pass.
    const pushes = await this.pushes.sendDue();
    const erasures = await this.closures.eraseDue();
    const sampbidxChat = await this.sampbidxChat.sweep();
    const taskPlans = await this.taskPlans.sweep();
    const recognition = (await this.recognition.sweep()) + (await this.pips.sweep());
    // Console notifications once a minute: they read across every client, so not on every tick.
    // Client health scores (ADR 0074, C5) on the same once-a-minute pace: each client is measured once a day.
    let consoleNotifications = 0;
    let clientHealth = 0;
    if (Date.now() - this.lastConsoleSweep >= this.env.CONSOLE_NOTIFY_INTERVAL_MS) {
      this.lastConsoleSweep = Date.now();
      consoleNotifications = await this.consoleNotices.sweep();
      clientHealth = await this.clientHealth.sweep();
      // The Overview's KPI values for today (C5b), once a day.
      await this.overview.snapshot();
    }
    return { events, executions, deliveries, approvalsExpired, syncs, aiRuns, contracts, health, billing, sequences, badges, visitorRetention, prospectImports, zoomTranscripts, reminders, logos, autofills, pushes, erasures, consoleNotifications, clientHealth, sampbidxChat, taskPlans, recognition };
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
    await this.logos.settle();
    await this.autofill.settle();
  }
}

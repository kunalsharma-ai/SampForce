import { Injectable, Logger } from '@nestjs/common';
import type { ConsoleSystemStatus, SystemState } from '@dealflow/types';
import { PrismaService } from '../common/prisma.service';
import { scan } from '../worker/queue';

/** The platform setting the worker writes its heartbeat to (an ISO time). */
export const WORKER_HEARTBEAT_KEY = 'worker.heartbeat';
/** How often the worker writes it. */
const BEAT_EVERY_MS = 30_000;
/** A heartbeat older than this means the worker has stopped or is stuck in one long pass. */
const WORKER_LATE_MS = 5 * 60_000;
/** Events the worker has not relayed after this long count as a backlog. */
const EVENT_LATE_MS = 2 * 60_000;
const CACHE_MS = 15_000;

/**
 * The Console header's system status (control-center K1). Three cheap reads: a database ping, the worker's heartbeat
 * and the count of late domain events (the worker's queue read: counts and times only, never payloads). Cached for 15 seconds so every open Console tab costs one read a quarter
 * minute at most. It reads no client data.
 */
@Injectable()
export class ConsoleSystemService {
  private readonly log = new Logger(ConsoleSystemService.name);
  private cache: { at: number; data: ConsoleSystemStatus } | null = null;
  private lastBeat = 0;

  constructor(private readonly prisma: PrismaService) {}

  /** The worker calls this after every pass; it writes at most once every 30 seconds. A failed write is only logged. */
  async beat(now = new Date()): Promise<void> {
    if (now.getTime() - this.lastBeat < BEAT_EVERY_MS) return;
    this.lastBeat = now.getTime();
    const value = now.toISOString();
    try {
      await this.prisma.platformSetting.upsert({ where: { key: WORKER_HEARTBEAT_KEY }, create: { key: WORKER_HEARTBEAT_KEY, value }, update: { value } });
    } catch (err) {
      this.log.warn(`worker heartbeat not written: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async status(now = new Date()): Promise<ConsoleSystemStatus> {
    if (this.cache && now.getTime() - this.cache.at < CACHE_MS) return this.cache.data;
    const data = await this.measure(now);
    this.cache = { at: now.getTime(), data };
    return data;
  }

  /** Drops the cached status (tests). */
  forget(): void {
    this.cache = null;
    this.lastBeat = 0;
  }

  private async measure(now: Date): Promise<ConsoleSystemStatus> {
    const started = Date.now();
    let dbOk = true;
    let latencyMs: number | null = null;
    try {
      await this.prisma.$runCommandRaw({ ping: 1 });
      latencyMs = Date.now() - started;
    } catch {
      dbOk = false;
    }
    let lastBeatAt: string | null = null;
    let events = 0;
    let oldestSeconds: number | null = null;
    if (dbOk) {
      const late = new Date(now.getTime() - EVENT_LATE_MS);
      const [beat, count, oldest] = await Promise.all([
        this.prisma.platformSetting.findUnique({ where: { key: WORKER_HEARTBEAT_KEY }, select: { value: true } }),
        scan(() => this.prisma.domainEvent.count({ where: { processedAt: null, createdAt: { lt: late } } })),
        scan(() => this.prisma.domainEvent.findFirst({ where: { processedAt: null }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } })),
      ]);
      lastBeatAt = beat?.value ?? null;
      events = count;
      oldestSeconds = oldest ? Math.max(0, Math.round((now.getTime() - oldest.createdAt.getTime()) / 1000)) : null;
    }
    const beatAge = lastBeatAt ? now.getTime() - new Date(lastBeatAt).getTime() : Number.POSITIVE_INFINITY;
    const workerOk = beatAge < WORKER_LATE_MS;
    const status: SystemState = !dbOk ? 'down' : !workerOk || events > 0 ? 'degraded' : 'ok';
    return {
      status,
      checkedAt: now.toISOString(),
      database: { ok: dbOk, latencyMs },
      worker: { ok: workerOk, lastBeatAt },
      backlog: { events, oldestSeconds },
    };
  }
}

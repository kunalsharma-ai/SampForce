import { randomUUID } from 'node:crypto';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Prisma, TenantTx } from '@dealflow/database';
import type { ChatStreamEvent } from '@dealflow/types';
import { PrismaService } from '../common/prisma.service';

/** Who a live chat event is for. */
export interface ChatAudience {
  tenantId: string;
  conversationId: string;
  userIds: string[];
  /** Support line events also go to the deployment's super admins. */
  operators: boolean;
}

/** One open live stream: a workspace user in one workspace, or a super admin in the operator console. */
export type ChatListener = { realm: 'user'; tenantId: string; userId: string; send: (e: ChatStreamEvent) => void } | { realm: 'operator'; operatorId: string; send: (e: ChatStreamEvent) => void };

/** How often each API server reads the events other API servers wrote. */
const RELAY_MS = Number(process.env.CHAT_RELAY_MS ?? 1500);
/** How long an event is kept for the other servers. A browser that missed more re-reads its conversations. */
const KEEP_MS = 10 * 60_000;

/**
 * Live delivery for team chat (ADR 0061), with nothing outside SampForce: no message broker, no hosted chat service.
 *
 * A change is written as a `chat_signals` document in the same transaction as the change itself. After the
 * transaction commits, the server that made it tells its own listeners at once; every other API server reads new
 * signals every 1.5 seconds and tells its listeners. A browser that was disconnected re-reads its conversations when
 * it reconnects, so a signal that is missed costs a refresh, never a message: messages live in `chat_messages`.
 */
@Injectable()
export class ChatBus implements OnModuleDestroy {
  private readonly log = new Logger('ChatBus');
  readonly instance = randomUUID();
  private readonly listeners = new Set<ChatListener>();
  private timer: NodeJS.Timeout | null = null;
  private cursor = new Date();
  private seen = new Set<string>();
  private lastPrune = 0;
  private polling = false;

  constructor(private readonly prisma: PrismaService) {}

  /** Records the event in the caller's transaction; call `deliver` with the result after it commits. */
  async record(tx: TenantTx, audience: ChatAudience, event: ChatStreamEvent): Promise<{ audience: ChatAudience; event: ChatStreamEvent }> {
    await tx.chatSignal.create({
      data: {
        tenantId: audience.tenantId,
        conversationId: audience.conversationId,
        instance: this.instance,
        event: event as unknown as Prisma.InputJsonValue,
        userIds: [...new Set(audience.userIds)],
        operators: audience.operators,
      },
    });
    return { audience, event };
  }

  /** Tells this server's listeners. */
  deliver(signals: { audience: ChatAudience; event: ChatStreamEvent }[]): void {
    for (const s of signals) this.fanOut(s.audience, s.event);
  }

  subscribe(listener: ChatListener): () => void {
    this.listeners.add(listener);
    this.ensureRelay();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopRelay();
    };
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  onModuleDestroy(): void {
    this.stopRelay();
    this.listeners.clear();
  }

  private fanOut(a: ChatAudience, event: ChatStreamEvent): void {
    const users = new Set(a.userIds);
    for (const l of this.listeners) {
      const match = l.realm === 'user' ? l.tenantId === a.tenantId && users.has(l.userId) : a.operators;
      if (!match) continue;
      try {
        l.send(event);
      } catch {
        // A closed stream is removed by its own close handler.
      }
    }
  }

  private ensureRelay(): void {
    if (this.timer) return;
    this.cursor = new Date(Date.now() - RELAY_MS);
    this.timer = setInterval(() => void this.poll(), RELAY_MS);
    this.timer.unref();
  }

  private stopRelay(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Reads the signals other API servers wrote since the last pass. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      // Look back three seconds (a transaction commits a little after it stamps its signal); ids already delivered in the window are skipped.
      const since = new Date(this.cursor.getTime() - 3000);
      const rows = await this.prisma.run({ chatRelay: true }, (tx) =>
        tx.chatSignal.findMany({ where: { createdAt: { gt: since }, instance: { not: this.instance } }, orderBy: { createdAt: 'asc' }, take: 1000 }),
      );
      const fresh = new Set<string>();
      for (const r of rows) {
        fresh.add(r.id);
        if (this.seen.has(r.id)) continue;
        this.fanOut({ tenantId: r.tenantId, conversationId: r.conversationId, userIds: r.userIds, operators: r.operators }, r.event as unknown as ChatStreamEvent);
        if (r.createdAt > this.cursor) this.cursor = r.createdAt;
      }
      this.seen = fresh;
      // Keep the window short: a transaction commits within seconds of stamping its signal.
      const floor = new Date(Date.now() - 8000);
      if (this.cursor < floor) this.cursor = floor;
      if (Date.now() - this.lastPrune > 60_000) {
        this.lastPrune = Date.now();
        await this.prisma.run({ chatRelay: true }, (tx) => tx.chatSignal.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_MS) } } }));
      }
    } catch (err) {
      this.log.warn(`chat relay pass failed: ${(err as Error).message}`);
    } finally {
      this.polling = false;
    }
  }
}

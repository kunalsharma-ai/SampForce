import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { CHAT_ONLINE_WINDOW_MS, type ChatPresenceRow } from '@dealflow/types';
import { PrismaService } from '../common/prisma.service';
import { ChatBus } from './chat-bus';

/** How often an open connection refreshes its person's presence. */
const BEAT_MS = Number(process.env.CHAT_PRESENCE_BEAT_MS ?? 30_000);
/** A closed connection counts as offline only if the person does not reconnect this soon (a page reload). */
const GRACE_MS = Number(process.env.CHAT_PRESENCE_GRACE_MS ?? 8000);

type Key = `${string}:${string}`;
const keyOf = (tenantId: string, userId: string): Key => `${tenantId}:${userId}`;

/** Whether a stored presence document means "online now". */
export function isOnline(p: { lastSeenAt: Date; offlineAt: Date | null } | null | undefined, now = Date.now()): boolean {
  if (!p) return false;
  if (p.offlineAt && p.offlineAt >= p.lastSeenAt) return false;
  return now - p.lastSeenAt.getTime() < CHAT_ONLINE_WINDOW_MS;
}

/**
 * Online and offline for team chat (ADR 0069). Each API server counts the live connections of the people connected
 * to it and refreshes their `chat_presence` document while any is open, so every server (and a person with two
 * devices on two servers) agrees: online means "refreshed in the last 75 seconds and not closed since".
 * Coming online and going offline are announced to the workspace, which re-reads presence.
 */
@Injectable()
export class ChatPresence implements OnModuleDestroy {
  private readonly log = new Logger('ChatPresence');
  private readonly open = new Map<Key, number>();
  private readonly leaving = new Map<Key, NodeJS.Timeout>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: ChatBus,
  ) {}

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const t of this.leaving.values()) clearTimeout(t);
    this.leaving.clear();
  }

  /** A live connection opened. */
  async connected(tenantId: string, userId: string): Promise<void> {
    const k = keyOf(tenantId, userId);
    this.open.set(k, (this.open.get(k) ?? 0) + 1);
    const pending = this.leaving.get(k);
    if (pending) {
      clearTimeout(pending);
      this.leaving.delete(k);
    }
    this.ensureBeat();
    await this.touch(tenantId, userId, true);
  }

  /** A live connection closed; after a short grace the person is offline unless another connection is open. */
  disconnected(tenantId: string, userId: string): void {
    const k = keyOf(tenantId, userId);
    const n = (this.open.get(k) ?? 1) - 1;
    if (n > 0) {
      this.open.set(k, n);
      return;
    }
    this.open.delete(k);
    if (this.leaving.has(k)) return;
    const t = setTimeout(() => {
      this.leaving.delete(k);
      if (this.open.has(k)) return;
      void this.goOffline(tenantId, userId);
    }, GRACE_MS);
    t.unref();
    this.leaving.set(k, t);
  }

  /**
   * Marks the person as seen now (a WebSocket heartbeat or a catch-up request). Announces it when they were offline.
   * `force` writes even if the stored time is recent.
   */
  async touch(tenantId: string, userId: string, force = false): Promise<void> {
    try {
      const now = new Date();
      const before = await this.prisma.run({ tenantId }, async (tx) => {
        const p = await tx.chatPresence.findFirst({ where: { tenantId, userId } });
        if (p && !force && !p.offlineAt && now.getTime() - p.lastSeenAt.getTime() < BEAT_MS / 2) return p;
        if (p) await tx.chatPresence.update({ where: { id: p.id }, data: { lastSeenAt: now, offlineAt: null } });
        else await tx.chatPresence.create({ data: { tenantId, userId, lastSeenAt: now } });
        return p;
      });
      if (!isOnline(before, now.getTime())) await this.announce(tenantId, userId, true);
    } catch (err) {
      // A race between two connections of the same person creating the document: the other one wrote it.
      this.log.debug(`presence touch: ${(err as Error).message}`);
    }
  }

  /** Presence of the workspace's active members. */
  async list(tenantId: string): Promise<ChatPresenceRow[]> {
    return this.prisma.run({ tenantId }, async (tx) => {
      const [members, rows] = await Promise.all([
        tx.membership.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { userId: true } }),
        tx.chatPresence.findMany({ where: { tenantId } }),
      ]);
      const byUser = new Map(rows.map((r) => [r.userId, r]));
      const now = Date.now();
      return members.map((m) => {
        const p = byUser.get(m.userId);
        return { userId: m.userId, online: isOnline(p, now), lastSeenAt: p ? (p.offlineAt && p.offlineAt > p.lastSeenAt ? p.offlineAt : p.lastSeenAt).toISOString() : null };
      });
    });
  }

  private async goOffline(tenantId: string, userId: string): Promise<void> {
    try {
      await this.prisma.run({ tenantId }, (tx) => tx.chatPresence.updateMany({ where: { tenantId, userId }, data: { offlineAt: new Date() } }));
      await this.announce(tenantId, userId, false);
    } catch (err) {
      this.log.warn(`presence offline: ${(err as Error).message}`);
    }
  }

  private async announce(tenantId: string, userId: string, online: boolean): Promise<void> {
    const members = await this.prisma.run({ tenantId }, (tx) => tx.membership.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { userId: true } }));
    const userIds = members.map((m) => m.userId).filter((id) => id !== userId);
    if (!userIds.length) return;
    // Presence is not about one conversation; the signal names the person instead.
    await this.bus.emit({ tenantId, conversationId: `presence:${userId}`, userIds, operators: false }, { type: 'presence', userId, online });
  }

  private ensureBeat(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (!this.open.size) {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        return;
      }
      for (const k of this.open.keys()) {
        const [tenantId, userId] = k.split(':') as [string, string];
        void this.touch(tenantId, userId, true);
      }
    }, BEAT_MS);
    this.timer.unref();
  }
}

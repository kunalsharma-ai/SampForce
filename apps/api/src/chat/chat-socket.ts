import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { jwtVerify, SignJWT } from 'jose';
import { type WebSocket, WebSocketServer } from 'ws';
import type { ChatClientFrame, ChatSocketTicket, ChatStreamEvent } from '@dealflow/types';
import { hasFeature } from '../billing/entitlements';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { ChatBus, type ChatListener } from './chat-bus';
import { ChatPresence } from './chat-presence';
import { ChatService } from './chat.service';
import { mobileBlockReason } from '../mobile/mobile-gate';
import { MobileConfigService } from '../mobile/mobile-config.service';

export const USER_SOCKET_PATH = '/api/v1/chat/socket';
export const OPERATOR_SOCKET_PATH = '/api/v1/operator/chat/socket';

const ISSUER = 'dealflow-api';
const AUDIENCE = 'sampforce-chat-socket';
/** Server ping; a socket that misses two answers in a row is closed (a laptop lid shut, a cable pulled). */
const PING_MS = Number(process.env.CHAT_SOCKET_PING_MS ?? 25_000);
/** How often an open socket checks that its session, membership and plan still allow chat. */
const RECHECK_MS = Number(process.env.CHAT_SOCKET_RECHECK_MS ?? 60_000);
/** More than this many sockets for one person on one server is a runaway page; the oldest is closed. */
const MAX_PER_PERSON = 20;

type Who = { realm: 'user'; tenantId: string; userId: string; sessionId: string } | { realm: 'operator'; operatorId: string };

/**
 * One-minute tickets for opening the chat WebSocket. A browser cannot set headers on a WebSocket, and the cookie may
 * not reach a gateway's upgrade the same way, so the signed-in page asks for a ticket over the normal, guarded API
 * (session, membership, plan and origin checks all apply) and opens the socket with it.
 */
@Injectable()
export class ChatSocketTickets {
  private readonly key: Uint8Array;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.key = new TextEncoder().encode(`chat-socket:${env.JWT_ACCESS_SECRET}`);
  }

  async issue(who: Who): Promise<ChatSocketTicket> {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const claims = who.realm === 'user' ? { realm: 'user', tid: who.tenantId, sid: who.sessionId } : { realm: 'operator' };
    const ticket = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(who.realm === 'user' ? who.userId : who.operatorId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(exp)
      .sign(this.key);
    return { ticket, path: who.realm === 'user' ? USER_SOCKET_PATH : OPERATOR_SOCKET_PATH, expiresAt: new Date(exp * 1000).toISOString() };
  }

  async verify(ticket: string): Promise<Who | null> {
    try {
      const { payload } = await jwtVerify(ticket, this.key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
      if (typeof payload.sub !== 'string') return null;
      if (payload.realm === 'operator') return { realm: 'operator', operatorId: payload.sub };
      if (payload.realm === 'user' && typeof payload.tid === 'string' && typeof payload.sid === 'string') return { realm: 'user', tenantId: payload.tid, userId: payload.sub, sessionId: payload.sid };
      return null;
    } catch {
      return null;
    }
  }
}

/**
 * The team chat WebSocket (ADR 0069), on the API's own HTTP server: `/api/v1/chat/socket` for workspace people and
 * `/api/v1/operator/chat/socket` for super admins. It carries the same events as the catch-up route, plus typing
 * from the browser. Every API server runs one; ChatBus relays events between servers through the database.
 */
@Injectable()
export class ChatSocketServer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('ChatSocket');
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  private readonly allowed: Set<string>;
  private readonly sockets = new Map<string, WebSocket[]>();
  private onUpgrade: ((req: IncomingMessage, socket: Duplex, head: Buffer) => void) | null = null;
  private server: { on: (e: string, f: (...a: never[]) => void) => void; off: (e: string, f: (...a: never[]) => void) => void } | null = null;

  constructor(
    @Inject(API_ENV) env: ApiEnv,
    private readonly adapter: HttpAdapterHost,
    private readonly tickets: ChatSocketTickets,
    private readonly bus: ChatBus,
    private readonly presence: ChatPresence,
    private readonly chat: ChatService,
    private readonly prisma: PrismaService,
    private readonly mobileConfigs: MobileConfigService,
  ) {
    this.allowed = new Set(env.WEB_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean));
  }

  onApplicationBootstrap(): void {
    const server = this.adapter.httpAdapter?.getHttpServer() as ChatSocketServer['server'];
    if (!server) return;
    this.server = server;
    this.onUpgrade = (req, socket, head) => void this.upgrade(req, socket, head);
    server.on('upgrade', this.onUpgrade as never);
  }

  onModuleDestroy(): void {
    if (this.server && this.onUpgrade) this.server.off('upgrade', this.onUpgrade as never);
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
  }

  get openSockets(): number {
    return this.wss.clients.size;
  }

  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname !== USER_SOCKET_PATH && url.pathname !== OPERATOR_SOCKET_PATH) return; // Not ours.
    const refuse = (status: number, text: string) => {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    // Cross-site WebSocket hijacking: only SampForce's own pages may open it.
    const origin = req.headers.origin;
    if (origin && !this.allowed.has(origin)) return refuse(403, 'Forbidden');
    const who = await this.tickets.verify(url.searchParams.get('ticket') ?? '');
    if (!who || (who.realm === 'operator') !== (url.pathname === OPERATOR_SOCKET_PATH)) return refuse(401, 'Unauthorized');
    if (!(await this.allows(who))) return refuse(401, 'Unauthorized');
    this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, who));
  }

  /** The session, membership and plan (or the operator account) still allow chat. */
  private async allows(who: Who): Promise<boolean> {
    try {
      if (who.realm === 'operator') {
        const op = await this.prisma.platformOperator.findUnique({ where: { id: who.operatorId }, select: { status: true } });
        return op?.status === 'ACTIVE';
      }
      const session = await this.prisma.session.findUnique({ where: { id: who.sessionId }, select: { revokedAt: true, replacedById: true, expiresAt: true, client: true, deviceId: true } });
      if (!session || session.expiresAt <= new Date() || (session.revokedAt && !session.replacedById)) return false;
      return await this.prisma.run({ tenantId: who.tenantId, userId: who.userId }, async (tx) => {
        const m = await tx.membership.findFirst({
          where: { tenantId: who.tenantId, userId: who.userId, status: 'ACTIVE', tenant: { status: 'ACTIVE', deletedAt: null }, user: { status: 'ACTIVE' } },
          select: { id: true, workspaceNodeId: true, role: { select: { permissions: true } } },
        });
        if (!m || !(await hasFeature(tx, who.tenantId, 'team_chat'))) return false;
        if (session.client !== 'MOBILE') return true;
        // A phone's socket closes when mobile access stops, the phone is signed out, or its configuration turns chat off.
        if (await mobileBlockReason(tx, who.tenantId)) return false;
        if (!session.deviceId || !(await tx.mobileDevice.findFirst({ where: { id: session.deviceId, signedOutAt: null }, select: { id: true } }))) return false;
        const config = await this.mobileConfigs.resolvedFor(tx, { tenantId: who.tenantId, workspaceNodeId: m.workspaceNodeId ?? null, permissions: m.role.permissions });
        return config.chat.enabled && config.modules.some((x) => x.key === 'chat');
      });
    } catch (err) {
      this.log.warn(`chat socket check failed: ${(err as Error).message}`);
      return false;
    }
  }

  private accept(ws: WebSocket, who: Who): void {
    const person = who.realm === 'user' ? `u:${who.tenantId}:${who.userId}` : `o:${who.operatorId}`;
    const mine = [...(this.sockets.get(person) ?? []), ws];
    while (mine.length > MAX_PER_PERSON) mine.shift()?.close(4008, 'too many connections');
    this.sockets.set(person, mine);

    const send = (e: ChatStreamEvent | { type: 'pong' }) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(e));
    };
    const listener: ChatListener = who.realm === 'user' ? { realm: 'user', tenantId: who.tenantId, userId: who.userId, send } : { realm: 'operator', operatorId: who.operatorId, send };
    const unsubscribe = this.bus.subscribe(listener);
    if (who.realm === 'user') void this.presence.connected(who.tenantId, who.userId);
    send({ type: 'ready' });

    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, PING_MS);
    const recheck = setInterval(() => {
      void this.allows(who).then((ok) => {
        if (!ok) ws.close(4401, 'signed out');
      });
    }, RECHECK_MS);
    ping.unref();
    recheck.unref();

    const typed = new Map<string, number>();
    ws.on('message', (raw) => {
      alive = true;
      let frame: ChatClientFrame;
      try {
        frame = JSON.parse(String(raw)) as ChatClientFrame;
      } catch {
        return;
      }
      if (frame?.type === 'ping') return send({ type: 'pong' });
      if (frame?.type === 'typing' && typeof frame.conversationId === 'string' && /^[0-9a-f-]{36}$/i.test(frame.conversationId)) {
        const last = typed.get(frame.conversationId) ?? 0;
        if (Date.now() - last < 1000) return;
        typed.set(frame.conversationId, Date.now());
        void this.chat.typing(who.realm === 'user' ? { tenantId: who.tenantId, userId: who.userId } : { operatorId: who.operatorId }, frame.conversationId).catch(() => undefined);
      }
    });

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      clearInterval(recheck);
      unsubscribe();
      const left = (this.sockets.get(person) ?? []).filter((s) => s !== ws);
      if (left.length) this.sockets.set(person, left);
      else this.sockets.delete(person);
      if (who.realm === 'user') this.presence.disconnected(who.tenantId, who.userId);
    };
    ws.on('close', close);
    ws.on('error', close);
  }
}

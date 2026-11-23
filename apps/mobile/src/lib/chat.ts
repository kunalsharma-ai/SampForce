import type { ChatEventsPage, ChatMemberRow, ChatMessageRow, ChatSocketTicket, ChatStreamEvent } from '@dealflow/types';
import { ApiError, type ApiClient } from './api';

/*
 * Team chat on the phone (ADR 0072, M7). The same conversations, people rules and live events as the web (ADR 0069):
 * a WebSocket opened with a one-minute ticket, and the catch-up route when a network between the phone and SampForce
 * does not pass WebSockets on. Events carry no text; the screens re-read what changed.
 */

/** The socket's address on the person's server ("https://crm.example.com" → "wss://crm.example.com/api/v1/…"). */
export function socketUrl(server: string, path: string, ticket: string): string {
  return `${server.replace(/^http/, 'ws')}${path}?ticket=${encodeURIComponent(ticket)}`;
}

export type Receipt = 'sending' | 'sent' | 'delivered' | 'read';

/** How far the caller's own message got: every other member read it, it reached all their devices, or neither yet. */
export function receiptOf(m: Pick<ChatMessageRow, 'createdAt'>, members: ChatMemberRow[], me: string): Receipt {
  const others = members.filter((x) => x.person.operator || x.person.id !== me);
  if (!others.length) return 'sent';
  const at = Date.parse(m.createdAt);
  const reached = (v: string | null) => !!v && Date.parse(v) >= at;
  if (others.every((x) => reached(x.lastReadAt))) return 'read';
  if (others.every((x) => reached(x.lastDeliveredAt) || reached(x.lastReadAt))) return 'delivered';
  return 'sent';
}

/** "14:05" today, "Mon 14:05" this week, "24 Nov" before. In the phone's own time. */
export function chatTime(iso: string, now = new Date(), locale?: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const days = (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86_400_000;
  if (days <= 0) return time;
  if (days < 7) return `${d.toLocaleDateString(locale, { weekday: 'short' })} ${time}`;
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

/** Messages that come from the same person within five minutes sit together under one name. */
export function startsGroup(prev: ChatMessageRow | undefined, m: ChatMessageRow): boolean {
  if (!prev || !prev.author || !m.author) return true;
  return prev.author.id !== m.author.id || Date.parse(m.createdAt) - Date.parse(prev.createdAt) > 5 * 60_000;
}

/** A random message id, made on the phone, so a message sent twice (a retry) is stored once. */
export function clientId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  const b = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type ChatListener = (e: ChatStreamEvent) => void;

export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((m: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export interface ChatLiveOptions {
  /** Opens a WebSocket (the phone's own in the app; a fake in tests). */
  open?: (url: string) => SocketLike;
  /** Called when the server says chat is not available here any more (sign-out, chat switched off). */
  onRefused?: (e: unknown) => void;
}

/**
 * One live connection for the whole app, shared by the chat screens. It hands each event to the listeners once, even
 * when the socket and the catch-up route both bring it, and comes back by itself after the network drops.
 */
export class ChatLive {
  private readonly listeners = new Set<ChatListener>();
  private readonly seen: string[] = [];
  private socket: SocketLike | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private polling = false;
  private stopped = true;
  private cursor: string | undefined;

  constructor(
    private readonly api: ApiClient,
    private readonly opts: ChatLiveOptions = {},
  ) {}

  subscribe(fn: ChatListener): () => void {
    this.listeners.add(fn);
    if (this.stopped) this.start();
    return () => {
      this.listeners.delete(fn);
      if (!this.listeners.size) this.stop();
    };
  }

  /** Tell the others in a conversation that the person is writing. */
  typing(conversationId: string): void {
    if (this.socket) this.socket.send(JSON.stringify({ type: 'typing', conversationId }));
    else void this.api.post(`/chat/conversations/${conversationId}/typing`, {}).catch(() => undefined);
  }

  private emit(e: ChatStreamEvent) {
    if (e.sid) {
      if (this.seen.includes(e.sid)) return;
      this.seen.push(e.sid);
      if (this.seen.length > 200) this.seen.shift();
    }
    for (const fn of [...this.listeners]) fn(e);
  }

  private start() {
    this.stopped = false;
    void this.connect();
  }

  private stop() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.ping) clearInterval(this.ping);
    this.retry = null;
    this.ping = null;
    const s = this.socket;
    this.socket = null;
    s?.close();
  }

  private async connect() {
    if (this.stopped) return;
    // Two failed sockets in a row: something between the phone and the server blocks them. Use catch-up instead.
    if (this.failures >= 2 || !this.opts.open) return this.poll();
    let ticket: ChatSocketTicket;
    try {
      ticket = await this.api.post<ChatSocketTicket>('/chat/socket-ticket', {});
    } catch (e) {
      if (this.refused(e)) return;
      return this.later();
    }
    if (this.stopped) return;
    let opened = false;
    const ws = this.opts.open(socketUrl(this.api.server, ticket.path, ticket.ticket));
    this.socket = ws;
    ws.onopen = () => {
      opened = true;
      this.failures = 0;
      this.ping = setInterval(() => ws.send(JSON.stringify({ type: 'ping' })), 25_000);
    };
    ws.onmessage = (m) => {
      try {
        this.emit(JSON.parse(String(m.data)) as ChatStreamEvent);
      } catch {
        // Not an event.
      }
    };
    ws.onerror = () => undefined;
    ws.onclose = () => {
      if (this.ping) clearInterval(this.ping);
      this.ping = null;
      if (this.socket === ws) this.socket = null;
      if (!opened) this.failures += 1;
      // Back again: re-read everything, something may have changed while the phone was away.
      this.later();
    };
  }

  /** The server said no (signed out, chat switched off): stop until a screen asks again. */
  private refused(e: unknown): boolean {
    if (!(e instanceof ApiError) || (e.status !== 401 && e.status !== 403)) return false;
    this.opts.onRefused?.(e);
    this.stop();
    return true;
  }

  private later() {
    if (this.stopped || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      void this.connect();
    }, 3000);
  }

  private async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      while (!this.stopped) {
        try {
          const q = new URLSearchParams({ wait: '25', ...(this.cursor ? { cursor: this.cursor } : {}), ...(this.seen.length ? { seen: this.seen.slice(-100).join(',') } : {}) });
          const page = await this.api.get<ChatEventsPage>(`/chat/events?${q.toString()}`);
          this.cursor = page.cursor;
          for (const e of page.events) this.emit(e);
        } catch (e) {
          if (this.refused(e)) return;
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    } finally {
      this.polling = false;
    }
  }
}

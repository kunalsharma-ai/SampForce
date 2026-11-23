'use client';

import {
  CHAT_TYPING_REPEAT_MS,
  CHAT_TYPING_SHOW_MS,
  type ChatAttachmentRow,
  type ChatConversationRow,
  type ChatDirectoryPerson,
  type ChatEventsPage,
  type ChatLinkOption,
  type ChatMessageRow,
  type ChatPresenceRow,
  type ChatSearchHit,
  type ChatSocketTicket,
  type ChatStreamEvent,
} from '@dealflow/types';
import { type InfiniteData, type QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { create } from 'zustand';
import { api, ApiError } from '@/lib/api';
import { type OutboxItem, outboxList, outboxPut, outboxRemove } from './outbox';

export type { OutboxItem } from './outbox';

/**
 * Team chat in the browser (ADR 0064). The same screens serve workspace people (`/chat`) and super admins in the
 * operator console (`/operator/chat`); a realm says which API and whose outbox.
 */
export interface ChatRealm {
  kind: 'user' | 'operator';
  base: '/chat' | '/operator/chat';
  /** The signed-in person: a user id, or an operator id. */
  selfId: string;
  /** Outbox owner and query-key prefix. */
  owner: string;
}

export function userRealm(tenantId: string, userId: string): ChatRealm {
  return { kind: 'user', base: '/chat', selfId: userId, owner: `user:${tenantId}:${userId}` };
}
export function operatorRealm(operatorId: string): ChatRealm {
  return { kind: 'operator', base: '/operator/chat', selfId: operatorId, owner: `operator:${operatorId}` };
}

const key = (r: ChatRealm, ...parts: unknown[]) => ['chat', r.owner, ...parts];

// ─── Connection ───

export type ChatConnection = 'connecting' | 'live' | 'offline';
/** How live events arrive: a WebSocket, or held requests when a gateway does not pass WebSockets on. */
export type ChatTransport = 'websocket' | 'polling';

interface ConnectionState {
  state: ChatConnection;
  transport: ChatTransport | null;
  /** When the connection last dropped, for "Reconnecting…" rather than "Offline" on a short blip. */
  since: number;
  set: (s: ChatConnection, transport?: ChatTransport | null) => void;
}
export const useChatConnection = create<ConnectionState>((set) => ({
  state: 'connecting',
  transport: null,
  since: Date.now(),
  set: (state, transport) => set((cur) => ({ state, transport: transport === undefined ? cur.transport : transport, since: cur.state === state ? cur.since : Date.now() })),
}));

/** Who is typing where: conversation id → person id → name and when it stops showing. */
interface TypingState {
  typing: Record<string, Record<string, { name: string; until: number }>>;
  add: (conversationId: string, personId: string, name: string) => void;
  clear: (conversationId: string, personId: string) => void;
  prune: () => void;
}
export const useTypingStore = create<TypingState>((set, get) => ({
  typing: {},
  add: (c, p, name) => set((s) => ({ typing: { ...s.typing, [c]: { ...s.typing[c], [p]: { name, until: Date.now() + CHAT_TYPING_SHOW_MS } } } })),
  clear: (c, p) =>
    set((s) => {
      if (!s.typing[c]?.[p]) return s;
      const next = { ...s.typing[c] };
      delete next[p];
      return { typing: { ...s.typing, [c]: next } };
    }),
  prune: () => {
    const now = Date.now();
    const cur = get().typing;
    let changed = false;
    const out: TypingState['typing'] = {};
    for (const [c, people] of Object.entries(cur)) {
      const keep = Object.fromEntries(Object.entries(people).filter(([, v]) => v.until > now));
      if (Object.keys(keep).length !== Object.keys(people).length) changed = true;
      if (Object.keys(keep).length) out[c] = keep;
    }
    if (changed) set({ typing: out });
  },
}));

/** Names of the people typing in a conversation now. */
export function useTyping(conversationId: string | null): string[] {
  const people = useTypingStore((s) => (conversationId ? s.typing[conversationId] : undefined));
  return React.useMemo(() => Object.values(people ?? {}).map((p) => p.name), [people]);
}

/** Which conversation the person is looking at, so a message there is not announced as a notification. */
interface ViewState {
  openId: string | null;
  setOpen: (id: string | null) => void;
}
export const useChatView = create<ViewState>((set) => ({ openId: null, setOpen: (openId) => set({ openId }) }));

/** A new message from someone else, shown as a pop-up when it is not the conversation on screen. */
export interface ChatNotice {
  id: string;
  conversationId: string;
  title: string;
  preview: string;
  href: string;
}
interface NoticeState {
  notices: ChatNotice[];
  push: (n: ChatNotice) => void;
  dismiss: (id: string) => void;
}
export const useChatNotices = create<NoticeState>((set) => ({
  notices: [],
  push: (n) => set((s) => ({ notices: [...s.notices.filter((x) => x.conversationId !== n.conversationId), n].slice(-3) })),
  dismiss: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
}));

/** Sends "typing" on the open connection, or over HTTP when events arrive by polling. Set by useChatLive. */
let sendTypingNow: ((conversationId: string) => void) | null = null;
const lastTyping = new Map<string, number>();
export function announceTyping(conversationId: string): void {
  const last = lastTyping.get(conversationId) ?? 0;
  if (Date.now() - last < CHAT_TYPING_REPEAT_MS) return;
  lastTyping.set(conversationId, Date.now());
  sendTypingNow?.(conversationId);
}
export function stoppedTyping(conversationId: string): void {
  lastTyping.delete(conversationId);
}

/** How long a WebSocket may take to say "ready" before this browser tries again or falls back to polling. */
const OPEN_TIMEOUT_MS = 8000;
/** The browser pings this often; no frame at all for twice as long means the connection is dead. */
const PING_MS = 20_000;
/** After falling back to polling, try the WebSocket again this often (the gateway may have been fixed). */
const RETRY_SOCKET_MS = 5 * 60_000;

function socketUrl(path: string, ticket: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}?ticket=${encodeURIComponent(ticket)}`;
}

/**
 * Keeps one live connection to the SampForce server for as long as the app is open, on every page (ADR 0069).
 *
 * It opens a WebSocket first. If a gateway between the browser and SampForce does not pass WebSockets on (the
 * socket fails twice before it is ready), it switches to held requests (`/chat/events`), which work through any
 * proxy, and tries the WebSocket again every five minutes. Lost connections are noticed within 40 seconds by
 * heartbeats and reconnected with a short back-off; on every (re)connect the chat is re-read, the outbox is sent and
 * delivery is confirmed, so nothing written or received while disconnected is lost. Events are de-duplicated by
 * their id, so one heard twice (socket and catch-up, two servers) is acted on once.
 */
export function useChatLive(realm: ChatRealm | null): void {
  const qc = useQueryClient();
  const setState = useChatConnection((s) => s.set);
  const owner = realm?.owner;
  React.useEffect(() => {
    if (!realm) return;
    let stopped = false;
    let mode: ChatTransport = 'websocket';
    let socketFailures = 0;
    let wait = 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let socket: WebSocket | null = null;
    let poll: AbortController | null = null;
    let backToSocket: ReturnType<typeof setTimeout> | null = null;
    let cursor: string | undefined;
    const seen = new Map<string, number>();
    const deliveredFor = new Set<string>();
    let deliveredTimer: ReturnType<typeof setTimeout> | null = null;

    const remember = (sid: string | undefined): boolean => {
      if (!sid) return true;
      const now = Date.now();
      if (seen.has(sid)) return false;
      seen.set(sid, now);
      if (seen.size > 400) for (const [k, t] of seen) if (now - t > 60_000) seen.delete(k);
      return true;
    };
    const recentSeen = () => {
      const now = Date.now();
      return [...seen.entries()].filter(([, t]) => now - t < 30_000).map(([k]) => k).slice(-100);
    };

    /** Tells the server this device has the messages, batched so a burst sends one request. */
    const confirmDelivered = (conversationId: string | null) => {
      deliveredFor.add(conversationId ?? '*');
      if (deliveredTimer) return;
      deliveredTimer = setTimeout(() => {
        deliveredTimer = null;
        const ids = [...deliveredFor];
        deliveredFor.clear();
        if (realm.kind === 'user') {
          if (ids.includes('*')) void api(`/chat/delivered`, { method: 'POST', json: {} }).catch(() => undefined);
          else for (const id of ids) void api(`/chat/delivered`, { method: 'POST', json: { conversationId: id } }).catch(() => undefined);
        } else {
          for (const id of ids.filter((x) => x !== '*')) void api(`/operator/chat/conversations/${id}/delivered`, { method: 'POST' }).catch(() => undefined);
        }
      }, 250);
    };

    const notify = async (conversationId: string) => {
      const view = useChatView.getState();
      const onScreen = view.openId === conversationId && document.visibilityState === 'visible';
      if (onScreen) return;
      let rows: ChatConversationRow[] | undefined;
      try {
        rows = await qc.fetchQuery({ queryKey: key(realm, 'conversations', false), queryFn: () => api<ChatConversationRow[]>(`${realm.base}/conversations`), staleTime: 0 });
      } catch {
        return;
      }
      const c = rows?.find((r) => r.id === conversationId);
      if (!c || c.unread === 0) return;
      const title = realm.kind === 'operator' ? c.workspace : c.title;
      const preview = c.lastMessagePreview ?? '';
      const href = `${realm.kind === 'user' ? '/app/chat' : '/operator/chat'}?c=${c.id}`;
      useChatNotices.getState().push({ id: `${c.id}:${c.lastMessageAt}`, conversationId: c.id, title, preview, href });
      if (document.visibilityState !== 'visible' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        try {
          const n = new Notification(title, { body: preview, tag: `sampforce-chat-${c.id}` });
          n.onclick = () => {
            window.focus();
            window.location.href = href;
          };
        } catch {
          // Some browsers only show notifications from a service worker; the in-page pop-up still shows.
        }
      }
    };

    const handle = (e: ChatStreamEvent) => {
      if (!remember(e.sid)) return;
      switch (e.type) {
        case 'ready':
          void qc.invalidateQueries({ queryKey: key(realm) });
          void flushOutbox(qc, realm);
          confirmDelivered(null);
          return;
        case 'message':
          void qc.invalidateQueries({ queryKey: key(realm, 'conversations') });
          void qc.invalidateQueries({ queryKey: key(realm, 'unread') });
          void qc.invalidateQueries({ queryKey: key(realm, 'conversation', e.conversationId) });
          void qc.invalidateQueries({ queryKey: key(realm, 'messages', e.conversationId) });
          if (e.authorId && e.authorId !== realm.selfId) {
            useTypingStore.getState().clear(e.conversationId, e.authorId);
            confirmDelivered(e.conversationId);
            void notify(e.conversationId);
          }
          return;
        case 'message_changed':
          void qc.invalidateQueries({ queryKey: key(realm, 'messages', e.conversationId) });
          void qc.invalidateQueries({ queryKey: key(realm, 'conversations') });
          return;
        case 'read':
        case 'delivered':
          void qc.invalidateQueries({ queryKey: key(realm, 'conversation', e.conversationId) });
          if (e.personId === realm.selfId) {
            void qc.invalidateQueries({ queryKey: key(realm, 'conversations') });
            void qc.invalidateQueries({ queryKey: key(realm, 'unread') });
          }
          return;
        case 'conversation':
          void qc.invalidateQueries({ queryKey: key(realm, 'conversations') });
          void qc.invalidateQueries({ queryKey: key(realm, 'conversation', e.conversationId) });
          void qc.invalidateQueries({ queryKey: key(realm, 'unread') });
          return;
        case 'typing':
          if (e.personId !== realm.selfId) useTypingStore.getState().add(e.conversationId, e.personId, e.name);
          return;
        case 'presence':
          void qc.invalidateQueries({ queryKey: ['chat-presence'] });
          void qc.invalidateQueries({ queryKey: ['chat-people'] });
      }
    };

    const schedule = (ms: number) => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void connect(), ms);
    };
    const dropped = () => {
      if (stopped) return;
      setState(navigator.onLine === false ? 'offline' : 'connecting');
      wait = Math.min(wait * 2, 15_000);
      schedule(wait);
    };

    const openSocket = async () => {
      let ticket: ChatSocketTicket;
      try {
        ticket = await api<ChatSocketTicket>(`${realm.base}/socket-ticket`, { method: 'POST' });
      } catch (err) {
        // A refusal (signed out, chat not in the plan) is not a network problem: wait longer.
        if (err instanceof ApiError && err.status < 500) wait = 30_000;
        return dropped();
      }
      if (stopped) return;
      const ws = new WebSocket(socketUrl(ticket.path, ticket.ticket));
      socket = ws;
      let ready = false;
      let lastFrame = Date.now();
      const opening = setTimeout(() => {
        if (!ready) ws.close();
      }, OPEN_TIMEOUT_MS);
      const beat = setInterval(() => {
        if (Date.now() - lastFrame > PING_MS * 2) return ws.close();
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, PING_MS);
      ws.onmessage = (m) => {
        lastFrame = Date.now();
        let e: ChatStreamEvent | { type: 'pong' };
        try {
          e = JSON.parse(String(m.data)) as ChatStreamEvent | { type: 'pong' };
        } catch {
          return;
        }
        if (e.type === 'pong') return;
        if (e.type === 'ready') {
          ready = true;
          socketFailures = 0;
          wait = 1000;
          setState('live', 'websocket');
        }
        handle(e);
      };
      ws.onclose = (ev) => {
        clearTimeout(opening);
        clearInterval(beat);
        // Replaced by a fresh connection (the network came back): that one carries on.
        if (socket !== ws) return;
        socket = null;
        if (stopped) return;
        if (!ready) {
          socketFailures++;
          // Twice in a row without getting through: the way to the server does not carry WebSockets.
          if (socketFailures >= 2 && navigator.onLine !== false) {
            mode = 'polling';
            if (backToSocket) clearTimeout(backToSocket);
            backToSocket = setTimeout(() => {
              mode = 'websocket';
              socketFailures = 0;
              poll?.abort();
            }, RETRY_SOCKET_MS);
            return schedule(50);
          }
        }
        // 4401: the session ended; the next ticket request refreshes it or fails.
        if (ready && ev.code !== 4401) wait = 500;
        dropped();
      };
    };

    const runPolling = async () => {
      poll = new AbortController();
      const signal = poll.signal;
      cursor = undefined;
      try {
        while (!stopped && mode === 'polling') {
          const params = new URLSearchParams({ wait: '25' });
          if (cursor) params.set('cursor', cursor);
          const s = recentSeen();
          if (s.length) params.set('seen', s.join(','));
          const page = await api<ChatEventsPage>(`${realm.base}/events?${params}`, { signal });
          if (useChatConnection.getState().state !== 'live' || useChatConnection.getState().transport !== 'polling') setState('live', 'polling');
          wait = 1000;
          cursor = page.cursor;
          for (const e of page.events) handle(e);
        }
        if (!stopped) schedule(50);
      } catch {
        if (stopped) return;
        if (mode !== 'polling') return schedule(50);
        // Aborted on purpose (the network came back): whoever aborted has already scheduled the next try.
        if (signal.aborted) return;
        dropped();
      } finally {
        poll = null;
      }
    };

    const connect = async () => {
      if (stopped) return;
      if (useChatConnection.getState().state !== 'live') setState(navigator.onLine === false ? 'offline' : 'connecting');
      if (mode === 'websocket') await openSocket();
      else await runPolling();
    };

    sendTypingNow = (conversationId) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'typing', conversationId }));
      else void api(`${realm.base}/conversations/${conversationId}/typing`, { method: 'POST' }).catch(() => undefined);
    };

    const online = () => {
      wait = 250;
      void flushOutbox(qc, realm);
      // After a network change an old socket may look open but be dead: start afresh now rather than after the
      // heartbeat or the back-off notices.
      const old = socket;
      socket = null;
      old?.close();
      poll?.abort();
      schedule(50);
    };
    const offline = () => setState('offline');
    const visible = () => {
      if (document.visibilityState === 'visible' && useChatConnection.getState().state !== 'live') online();
    };
    const prune = setInterval(() => useTypingStore.getState().prune(), 1000);
    // The outbox is also retried every few seconds while anything waits, whatever the connection says.
    const retry = setInterval(() => void flushOutbox(qc, realm), 8000);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    void flushOutbox(qc, realm);
    void connect();
    return () => {
      stopped = true;
      sendTypingNow = null;
      socket?.close();
      poll?.abort();
      if (timer) clearTimeout(timer);
      if (backToSocket) clearTimeout(backToSocket);
      if (deliveredTimer) clearTimeout(deliveredTimer);
      clearInterval(prune);
      clearInterval(retry);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, qc, setState]);
}

// ─── Reads ───

export function useConversations(realm: ChatRealm | null, archived = false) {
  return useQuery({
    enabled: !!realm,
    queryKey: realm ? key(realm, 'conversations', archived) : ['chat', 'none'],
    queryFn: () => api<ChatConversationRow[]>(`${realm!.base}/conversations${archived ? '?archived=true' : ''}`),
    // Live events keep it fresh; this is only a safety net.
    refetchInterval: 120_000,
  });
}

export function useConversation(realm: ChatRealm, id: string | null) {
  return useQuery({ enabled: !!id, queryKey: key(realm, 'conversation', id), queryFn: () => api<ChatConversationRow>(`${realm.base}/conversations/${id}`) });
}

export const MESSAGE_PAGE = 50;

/** Messages, newest page first in `pages`; scrolling up loads older pages. */
export function useMessages(realm: ChatRealm, id: string | null) {
  return useInfiniteQuery({
    enabled: !!id,
    queryKey: key(realm, 'messages', id),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<ChatMessageRow[]>(`${realm.base}/conversations/${id}/messages?limit=${MESSAGE_PAGE}${pageParam ? `&before=${pageParam}` : ''}`),
    getNextPageParam: (page) => (page.length === MESSAGE_PAGE ? page[0]!.id : undefined),
  });
}

/** All loaded messages, oldest first. */
export function flattenMessages(data: InfiniteData<ChatMessageRow[]> | undefined): ChatMessageRow[] {
  if (!data) return [];
  const out: ChatMessageRow[] = [];
  const ids = new Set<string>();
  for (const page of [...data.pages].reverse())
    for (const m of page) {
      if (ids.has(m.id)) continue;
      ids.add(m.id);
      out.push(m);
    }
  return out;
}

export function useChatUnread(realm: ChatRealm | null) {
  return useQuery({ enabled: !!realm, queryKey: realm ? key(realm, 'unread') : ['chat', 'none-unread'], queryFn: () => api<{ total: number; conversations: number }>(`${realm!.base}/unread`), refetchInterval: 60_000 });
}

export function useChatPeople(enabled: boolean) {
  return useQuery({ enabled, queryKey: ['chat-people'], queryFn: () => api<ChatDirectoryPerson[]>('/chat/people'), staleTime: 30_000 });
}

/** Who is online, refreshed by presence events and every minute. */
export function useChatPresence(enabled: boolean) {
  const q = useQuery({ enabled, queryKey: ['chat-presence'], queryFn: () => api<ChatPresenceRow[]>('/chat/presence'), refetchInterval: 60_000, staleTime: 15_000 });
  return React.useMemo(() => new Map((q.data ?? []).map((p) => [p.userId, p])), [q.data]);
}

export function useChatSearch(q: string) {
  const text = q.trim();
  return useQuery({ enabled: text.length >= 2, queryKey: ['chat-search', text], queryFn: () => api<ChatSearchHit[]>(`/chat/search?q=${encodeURIComponent(text)}`) });
}

export function useLinkOptions(q: string, enabled: boolean) {
  return useQuery({ enabled, queryKey: ['chat-link-options', q.trim()], queryFn: () => api<ChatLinkOption[]>(`/chat/link-options?q=${encodeURIComponent(q.trim())}`) });
}

export function attachmentUrl(realm: ChatRealm, conversationId: string, attachmentId: string): string {
  return realm.kind === 'user' ? `/api/v1/chat/attachments/${attachmentId}/download` : `/api/v1/operator/chat/conversations/${conversationId}/attachments/${attachmentId}/download`;
}

// ─── Writes ───

export function useChatMutations(realm: ChatRealm) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: key(realm) });
  const markRead = useMutation({
    mutationFn: (v: { id: string; messageId?: string }) => api<{ lastReadAt: string }>(`${realm.base}/conversations/${v.id}/read`, { method: 'POST', json: { messageId: v.messageId ?? null } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key(realm, 'unread') });
      void qc.invalidateQueries({ queryKey: key(realm, 'conversations') });
    },
  });
  const edit = useMutation({ mutationFn: (v: { id: string; body: string }) => api<ChatMessageRow>(`${realm.base}/messages/${v.id}`, { method: 'PATCH', json: { body: v.body } }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api(`${realm.base}/messages/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const create = useMutation({ mutationFn: (input: object) => api<ChatConversationRow>('/chat/conversations', { method: 'POST', json: input }), onSuccess: refresh });
  const update = useMutation({ mutationFn: (v: { id: string; patch: object }) => api<ChatConversationRow>(`/chat/conversations/${v.id}`, { method: 'PATCH', json: v.patch }), onSuccess: refresh });
  const addMembers = useMutation({ mutationFn: (v: { id: string; userIds: string[] }) => api<ChatConversationRow>(`/chat/conversations/${v.id}/members`, { method: 'POST', json: { userIds: v.userIds } }), onSuccess: refresh });
  const removeMember = useMutation({ mutationFn: (v: { id: string; userId: string }) => api(`/chat/conversations/${v.id}/members/${v.userId}`, { method: 'DELETE' }), onSuccess: refresh });
  return { markRead, edit, remove, create, update, addMembers, removeMember };
}

// ─── Outbox ───

interface OutboxState {
  items: Record<string, OutboxItem[]>;
  load: (owner: string) => Promise<void>;
}
export const useOutboxStore = create<OutboxState>((set) => ({
  items: {},
  load: async (owner) => {
    const list = await outboxList(owner);
    set((s) => ({ items: { ...s.items, [owner]: list } }));
  },
}));

export function useOutbox(realm: ChatRealm, conversationId?: string | null): OutboxItem[] {
  const all = useOutboxStore((s) => s.items[realm.owner]);
  const load = useOutboxStore((s) => s.load);
  React.useEffect(() => {
    void load(realm.owner);
  }, [load, realm.owner]);
  return React.useMemo(() => (all ?? []).filter((i) => !conversationId || i.conversationId === conversationId), [all, conversationId]);
}

/** A network failure (no answer, gateway down) rather than a refusal: keep the message queued. */
function isNetworkError(err: unknown): boolean {
  // 401: the session ran out; the message waits until the person signs in again.
  return !(err instanceof ApiError) || err.status >= 500 || err.status === 401 || err.status === 408 || err.status === 429;
}

const flushing = new Set<string>();

/** Sends what waits in the outbox, oldest first. Stops at the first network failure; the next try picks it up. */
export async function flushOutbox(qc: QueryClient, realm: ChatRealm): Promise<void> {
  if (flushing.has(realm.owner)) return;
  flushing.add(realm.owner);
  const reload = () => useOutboxStore.getState().load(realm.owner);
  try {
    for (const item of await outboxList(realm.owner)) {
      if (item.status === 'failed') continue;
      await outboxPut({ ...item, status: 'sending' });
      await reload();
      try {
        const attachmentIds: string[] = [];
        for (const f of item.files) {
          if (!f.attachmentId) {
            const up = await uploadRaw(realm, item.conversationId, f);
            f.attachmentId = up.id;
            await outboxPut({ ...item, status: 'sending' });
          }
          attachmentIds.push(f.attachmentId);
        }
        const stored = await api<ChatMessageRow>(`${realm.base}/conversations/${item.conversationId}/messages`, {
          method: 'POST',
          json: { clientId: item.clientId, body: item.body, writtenAt: item.writtenAt, link: item.link ? { type: item.link.type, id: item.link.id } : null, attachmentIds },
        });
        // Show the stored message straight away, then drop the outbox copy, so the bubble never blinks.
        qc.setQueryData<InfiniteData<ChatMessageRow[]>>(key(realm, 'messages', item.conversationId), (d) => {
          if (!d?.pages.length || d.pages.some((p) => p.some((m) => m.id === stored.id))) return d;
          return { ...d, pages: [[...d.pages[0]!, stored], ...d.pages.slice(1)] };
        });
        await outboxRemove(item.clientId);
        void qc.invalidateQueries({ queryKey: key(realm, 'messages', item.conversationId) });
        void qc.invalidateQueries({ queryKey: key(realm, 'conversations') });
      } catch (err) {
        if (isNetworkError(err)) {
          await outboxPut({ ...item, status: 'queued' });
          break;
        }
        await outboxPut({ ...item, status: 'failed', error: err instanceof Error ? err.message : String(err) });
      } finally {
        await reload();
      }
    }
  } finally {
    flushing.delete(realm.owner);
  }
}

async function uploadRaw(realm: ChatRealm, conversationId: string, f: { name: string; type: string; blob: Blob }): Promise<ChatAttachmentRow> {
  return api<ChatAttachmentRow>(`${realm.base}/conversations/${conversationId}/attachments?name=${encodeURIComponent(f.name)}`, {
    method: 'POST',
    headers: { 'content-type': f.type || 'application/octet-stream' },
    body: f.blob,
  });
}

/**
 * A random v4 UUID. `crypto.randomUUID` exists only on secure pages (HTTPS or localhost), and an office server is
 * often opened as plain http://192.168.x.x, so this builds one from `getRandomValues`, which works everywhere.
 */
export function newClientId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Puts a message in the outbox and tries to send it straight away. */
export async function queueMessage(qc: QueryClient, realm: ChatRealm, input: { conversationId: string; body: string; link: OutboxItem['link']; files: File[] }): Promise<void> {
  const item: OutboxItem = {
    clientId: newClientId(),
    owner: realm.owner,
    conversationId: input.conversationId,
    body: input.body,
    link: input.link,
    files: input.files.map((f) => ({ name: f.name, type: f.type, blob: f })),
    writtenAt: new Date().toISOString(),
    status: 'queued',
  };
  await outboxPut(item);
  await useOutboxStore.getState().load(realm.owner);
  void flushOutbox(qc, realm);
}

export async function retryOutboxItem(qc: QueryClient, realm: ChatRealm, item: OutboxItem): Promise<void> {
  await outboxPut({ ...item, status: 'queued', error: undefined });
  await useOutboxStore.getState().load(realm.owner);
  void flushOutbox(qc, realm);
}

export async function discardOutboxItem(realm: ChatRealm, clientId: string): Promise<void> {
  await outboxRemove(clientId);
  await useOutboxStore.getState().load(realm.owner);
}

'use client';

import type { ChatAttachmentRow, ChatConversationRow, ChatLinkOption, ChatMessageRow, ChatPerson, ChatSearchHit, ChatStreamEvent } from '@dealflow/types';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { create } from 'zustand';
import { api, ApiError, languageHeader, refreshSession } from '@/lib/api';
import { type OutboxItem, outboxList, outboxPut, outboxRemove } from './outbox';

export type { OutboxItem } from './outbox';

/**
 * Team chat in the browser (ADR 0061). The same screens serve workspace people (`/chat`) and super admins in the
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

interface ConnectionState {
  state: ChatConnection;
  set: (s: ChatConnection) => void;
}
export const useChatConnection = create<ConnectionState>((set) => ({ state: 'connecting', set: (state) => set({ state }) }));

function invalidateFor(qc: QueryClient, r: ChatRealm, e: ChatStreamEvent): void {
  if (e.type === 'ready') {
    void qc.invalidateQueries({ queryKey: key(r) });
    return;
  }
  void qc.invalidateQueries({ queryKey: key(r, 'conversations') });
  void qc.invalidateQueries({ queryKey: key(r, 'unread') });
  void qc.invalidateQueries({ queryKey: key(r, 'conversation', e.conversationId) });
  if (e.type === 'message' || e.type === 'message_changed') void qc.invalidateQueries({ queryKey: key(r, 'messages', e.conversationId) });
}

/**
 * On every page: sends the outbox when the browser comes back online and every few seconds while anything waits,
 * and re-reads the unread count now and then. Short requests only, so pages still settle (no open stream here).
 */
export function useChatBackground(realm: ChatRealm | null): void {
  const qc = useQueryClient();
  const owner = realm?.owner;
  React.useEffect(() => {
    if (!realm) return;
    const flush = () => void flushOutbox(qc, realm);
    const online = () => {
      flush();
      void qc.invalidateQueries({ queryKey: key(realm, 'unread') });
    };
    window.addEventListener('online', online);
    flush();
    const retry = setInterval(flush, 8000);
    return () => {
      clearInterval(retry);
      window.removeEventListener('online', online);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, qc]);
}

/**
 * Keeps one live stream open to the SampForce server while a chat page is open, reconnecting with a short back-off.
 * On every (re)connect the chat queries are re-read and the outbox is sent, so nothing written or received while
 * disconnected is lost. Other pages use useChatBackground instead.
 */
export function useChatLive(realm: ChatRealm | null): void {
  const qc = useQueryClient();
  const setState = useChatConnection((s) => s.set);
  const owner = realm?.owner;
  React.useEffect(() => {
    if (!realm) return;
    let stopped = false;
    let ctrl: AbortController | null = null;
    let wait = 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      if (stopped) return;
      ctrl = new AbortController();
      setState('connecting');
      try {
        let res = await fetch(`/api/v1${realm.base}/stream`, { credentials: 'include', headers: languageHeader(), signal: ctrl.signal });
        if (res.status === 401 && realm.kind === 'user' && (await refreshSession())) res = await fetch(`/api/v1${realm.base}/stream`, { credentials: 'include', headers: languageHeader(), signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const data = chunk.split('\n').find((l) => l.startsWith('data: '));
            if (!data) continue;
            const e = JSON.parse(data.slice(6)) as ChatStreamEvent;
            if (e.type === 'ready') {
              wait = 1000;
              setState('live');
              void flushOutbox(qc, realm);
            }
            invalidateFor(qc, realm, e);
          }
        }
        // The server closes streams every few minutes; reconnect at once.
        wait = 250;
      } catch {
        if (stopped) return;
        setState('offline');
        wait = Math.min(wait * 2, 10_000);
      }
      if (!stopped) timer = setTimeout(() => void connect(), wait);
    };

    const online = () => {
      if (timer) clearTimeout(timer);
      ctrl?.abort();
      wait = 250;
      timer = setTimeout(() => void connect(), 50);
    };
    const offline = () => setState('offline');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    void connect();
    return () => {
      stopped = true;
      ctrl?.abort();
      if (timer) clearTimeout(timer);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
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
    refetchInterval: 60_000,
  });
}

export function useConversation(realm: ChatRealm, id: string | null) {
  return useQuery({ enabled: !!id, queryKey: key(realm, 'conversation', id), queryFn: () => api<ChatConversationRow>(`${realm.base}/conversations/${id}`) });
}

export function useMessages(realm: ChatRealm, id: string | null) {
  return useQuery({ enabled: !!id, queryKey: key(realm, 'messages', id), queryFn: () => api<ChatMessageRow[]>(`${realm.base}/conversations/${id}/messages?limit=100`) });
}

export function useChatUnread(realm: ChatRealm | null) {
  return useQuery({ enabled: !!realm, queryKey: realm ? key(realm, 'unread') : ['chat', 'none-unread'], queryFn: () => api<{ total: number; conversations: number }>(`${realm!.base}/unread`), refetchInterval: 20_000 });
}

export function useChatPeople(enabled: boolean) {
  return useQuery({ enabled, queryKey: ['chat-people'], queryFn: () => api<ChatPerson[]>('/chat/people'), staleTime: 60_000 });
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
        await api<ChatMessageRow>(`${realm.base}/conversations/${item.conversationId}/messages`, {
          method: 'POST',
          json: { clientId: item.clientId, body: item.body, writtenAt: item.writtenAt, link: item.link ? { type: item.link.type, id: item.link.id } : null, attachmentIds },
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

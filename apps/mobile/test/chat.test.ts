import type { ChatMemberRow, ChatMessageRow, ChatStreamEvent } from '@dealflow/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/lib/api';
import { ChatLive, chatTime, clientId, receiptOf, type SocketLike, socketUrl, startsGroup } from '../src/lib/chat';
import { fakeFetch, MemoryTokens } from './fakes';

const SERVER = 'https://crm.example.com';
const member = (id: string, read: string | null, delivered: string | null): ChatMemberRow => ({ person: { id, name: id, operator: false }, role: 'MEMBER', lastReadAt: read, lastDeliveredAt: delivered });
const msg = (author: string, at: string): ChatMessageRow => ({ id: at, conversationId: 'c', clientId: at, author: { id: author, name: author, operator: false }, body: 'x', link: null, attachments: [], createdAt: at, writtenAt: null, editedAt: null, deleted: false });

class FakeSocket implements SocketLike {
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  constructor(readonly url: string) {}
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.onclose?.();
  }
}

describe('chat on the phone', () => {
  afterEach(() => vi.useRealTimers());

  it('opens the socket on the same server, over wss', () => {
    expect(socketUrl(SERVER, '/api/v1/chat/socket', 'a.b+c')).toBe('wss://crm.example.com/api/v1/chat/socket?ticket=a.b%2Bc');
    expect(socketUrl('http://10.0.2.2:4000', '/api/v1/chat/socket', 't')).toBe('ws://10.0.2.2:4000/api/v1/chat/socket?ticket=t');
  });

  it('marks the own last message sent, delivered or read by everyone else', () => {
    const m = { createdAt: '2026-11-24T10:00:00.000Z' };
    const me = member('me', null, null);
    expect(receiptOf(m, [me, member('a', null, null)], 'me')).toBe('sent');
    expect(receiptOf(m, [me, member('a', null, '2026-11-24T10:00:01.000Z')], 'me')).toBe('delivered');
    expect(receiptOf(m, [me, member('a', '2026-11-24T10:00:02.000Z', null)], 'me')).toBe('read');
    // A channel: read only when every other member has read it.
    expect(receiptOf(m, [me, member('a', '2026-11-24T10:00:02.000Z', null), member('b', null, '2026-11-24T10:00:02.000Z')], 'me')).toBe('delivered');
    expect(receiptOf(m, [me], 'me')).toBe('sent');
  });

  it('groups messages from one person within five minutes', () => {
    expect(startsGroup(undefined, msg('a', '2026-11-24T10:00:00Z'))).toBe(true);
    expect(startsGroup(msg('a', '2026-11-24T10:00:00Z'), msg('a', '2026-11-24T10:04:00Z'))).toBe(false);
    expect(startsGroup(msg('a', '2026-11-24T10:00:00Z'), msg('a', '2026-11-24T10:06:00Z'))).toBe(true);
    expect(startsGroup(msg('a', '2026-11-24T10:00:00Z'), msg('b', '2026-11-24T10:01:00Z'))).toBe(true);
  });

  it('shows the time today and the date before this week', () => {
    const now = new Date(2026, 10, 24, 15, 0);
    expect(chatTime(new Date(2026, 10, 24, 9, 5).toISOString(), now, 'en-GB')).toBe('09:05');
    expect(chatTime(new Date(2026, 10, 2, 9, 5).toISOString(), now, 'en-GB')).toBe('2 Nov');
  });

  it('makes message ids the server accepts', () => {
    expect(clientId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('hands each live event over once, and falls back to catch-up when sockets are blocked', async () => {
    const store = new MemoryTokens();
    store.value = { accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3_600_000, tenantId: 't', deviceId: 'd' };
    let polls = 0;
    const f = fakeFetch({
      'POST /chat/socket-ticket': () => ({ status: 200, body: { ticket: 'tk', path: '/api/v1/chat/socket', expiresAt: '' } }),
      'GET /chat/events': () => {
        polls += 1;
        // The server holds a catch-up request open until there is news; here, only the first one has any.
        if (polls > 1) return new Promise(() => undefined);
        return { status: 200, body: { events: [{ type: 'message', conversationId: 'c', messageId: 'm2', authorId: 'a', sid: 's2' }], cursor: new Date().toISOString() } };
      },
    });
    const api = new ApiClient({ server: SERVER, store, fetch: f.impl });
    const sockets: FakeSocket[] = [];
    const live = new ChatLive(api, { open: (url) => (sockets.push(new FakeSocket(url)), sockets.at(-1)!) });
    const got: ChatStreamEvent[] = [];
    const stop = live.subscribe((e) => got.push(e));
    await vi.waitFor(() => expect(sockets.length).toBe(1));
    expect(sockets[0]!.url).toBe('wss://crm.example.com/api/v1/chat/socket?ticket=tk');
    sockets[0]!.onopen?.();
    const e = { type: 'message', conversationId: 'c', messageId: 'm1', authorId: 'a', sid: 's1' };
    sockets[0]!.onmessage?.({ data: JSON.stringify(e) });
    sockets[0]!.onmessage?.({ data: JSON.stringify(e) });
    expect(got).toEqual([e]);
    // Typing goes over the open socket.
    live.typing('c');
    expect(JSON.parse(sockets[0]!.sent.at(-1)!)).toEqual({ type: 'typing', conversationId: 'c' });
    stop();
    expect(f.calls.filter((c) => c.path.startsWith('/chat/events'))).toEqual([]);

    // Two sockets that never open: the phone uses the catch-up route instead.
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    const live2 = new ChatLive(api, { open: (url) => (sockets.push(new FakeSocket(url)), sockets.at(-1)!) });
    const got2: ChatStreamEvent[] = [];
    const stop2 = live2.subscribe((x) => got2.push(x));
    await vi.waitFor(() => expect(sockets.length).toBe(2));
    sockets[1]!.close();
    await vi.advanceTimersByTimeAsync(3100);
    await vi.waitFor(() => expect(sockets.length).toBe(3));
    sockets[2]!.close();
    await vi.advanceTimersByTimeAsync(3100);
    await vi.waitFor(() => expect(got2.map((x) => (x as { messageId?: string }).messageId)).toEqual(['m2']));
    stop2();
  });
});

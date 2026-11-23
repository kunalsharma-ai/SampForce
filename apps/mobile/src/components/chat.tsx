import Ionicons from '@expo/vector-icons/Ionicons';
import type { ChatConversationRow, ChatDirectoryPerson, ChatMessageRow, ChatPerson } from '@dealflow/types';
import { Redirect, useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ApiClient } from '../lib/api';
import { ChatLive, type ChatListener, chatTime, clientId, receiptOf, type SocketLike, startsGroup } from '../lib/chat';
import { currentLanguage, t } from '../lib/i18n';
import { useApi, useController, useSignedIn, useTheme } from '../lib/session';
import { Avatar, Body, Button, ErrorNote, Field, Loading } from './ui';

/*
 * The chat screens (ADR 0072, M7): conversations, one conversation, and a new direct message. They show exactly what
 * the web's chat shows the same person, and update live.
 */

let shared: { api: ApiClient; live: ChatLive } | null = null;

/** The app's one live chat connection for this signed-in session. */
export function chatLive(api: ApiClient, report?: (e: unknown) => void): ChatLive {
  if (shared?.api !== api) {
    const open = typeof WebSocket === 'undefined' ? undefined : (url: string) => new WebSocket(url) as unknown as SocketLike;
    shared = { api, live: new ChatLive(api, { open, onRefused: report }) };
  }
  return shared.live;
}

/** Calls `fn` for each live chat event while the screen is mounted. */
export function useChatEvents(fn: ChatListener) {
  const c = useController();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => chatLive(c.api, (e) => c.report(e)).subscribe((e) => ref.current(e)), [c]);
}

/** Chat is in this person's configuration and switched on; otherwise the screen goes home. */
function useChatAllowed(): boolean {
  const s = useSignedIn();
  return s.config.chat.enabled && s.config.modules.some((m) => m.key === 'chat');
}

/** The person a direct message is with, for its picture. */
function otherOf(c: ChatConversationRow, me: string): ChatPerson | null {
  if (c.kind !== 'DIRECT') return null;
  return c.members.find((m) => m.person.operator || m.person.id !== me)?.person ?? null;
}

export function ConversationList() {
  const allowed = useChatAllowed();
  const s = useSignedIn();
  const c = useController();
  const th = useTheme();
  const router = useRouter();
  const { data, error, loading, reload } = useApi<ChatConversationRow[]>(allowed ? '/chat/conversations' : null);
  const me = s.session.user.id;

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );
  // New messages have reached this phone: the senders see "Delivered".
  useEffect(() => {
    if (data) void c.api.post('/chat/delivered', {}).catch(() => undefined);
  }, [c, data]);
  useChatEvents((e) => {
    if (e.type === 'message' || e.type === 'conversation' || e.type === 'read' || e.type === 'message_changed') reload();
  });

  if (!allowed) return <Redirect href="/" />;
  if (error && !data) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const rows = [...data].filter((x) => !x.archived).sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt));

  return (
    <FlatList
      style={{ backgroundColor: th.background }}
      contentContainerStyle={{ padding: 16, gap: 8 }}
      data={rows}
      keyExtractor={(x) => x.id}
      refreshing={loading}
      onRefresh={reload}
      ListHeaderComponent={<Button label={t('New message')} onPress={() => router.push('/chat/new')} />}
      ListEmptyComponent={
        <View style={{ paddingVertical: 24, gap: 6 }}>
          <Body>{t('No conversations yet.')}</Body>
          <Body muted>{t('Start one with someone in your team.')}</Body>
        </View>
      }
      renderItem={({ item }) => {
        const other = otherOf(item, me);
        const title = item.kind === 'SUPPORT' ? t('SampForce support') : item.title;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.unread ? t('{name}, {n} unread', { name: title, n: item.unread }) : title}
            onPress={() => router.push({ pathname: '/chat/[id]', params: { id: item.id } })}
            style={({ pressed }) => [styles.row, { backgroundColor: th.card, borderColor: th.border, opacity: pressed ? 0.7 : 1 }]}
          >
            {other ? (
              <Avatar name={other.name} photoUrl={other.photoUrl} size={44} />
            ) : (
              <View style={[styles.channel, { backgroundColor: th.border }]}>
                <Ionicons aria-hidden name={item.kind === 'SUPPORT' ? 'help-buoy-outline' : 'people-outline'} size={22} color={th.text} />
              </View>
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'baseline' }}>
                <Text numberOfLines={1} style={{ flex: 1, color: th.text, fontSize: 16, fontWeight: item.unread ? '700' : '600' }}>
                  {item.kind === 'CHANNEL' ? `# ${title}` : title}
                </Text>
                {item.lastMessageAt ? <Text style={{ color: th.muted, fontSize: 12 }}>{chatTime(item.lastMessageAt, new Date(), currentLanguage())}</Text> : null}
              </View>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Text numberOfLines={1} style={{ flex: 1, color: th.muted, fontSize: 14 }}>
                  {item.lastMessagePreview ?? t('No messages yet')}
                </Text>
                {item.unread ? (
                  <View style={[styles.badge, { backgroundColor: th.primary }]}>
                    <Text style={{ color: th.onPrimary, fontSize: 12, fontWeight: '700' }}>{item.unread > 99 ? '99+' : item.unread}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

type Shown = ChatMessageRow & { pending?: 'sending' | 'failed' };

const receiptText = (r: 'sending' | 'sent' | 'delivered' | 'read') => (r === 'sending' ? t('Sending') : r === 'sent' ? t('Sent') : r === 'delivered' ? t('Delivered') : t('Read'));

export function Conversation({ id }: { id: string }) {
  const allowed = useChatAllowed();
  const s = useSignedIn();
  const c = useController();
  const th = useTheme();
  const navigation = useNavigation();
  const me = s.session.user.id;
  const conv = useApi<ChatConversationRow>(allowed ? `/chat/conversations/${id}` : null);
  const [messages, setMessages] = useState<Shown[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [older, setOlder] = useState(true);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState<{ name: string; until: number } | null>(null);
  const lastTyped = useRef(0);
  const list = useRef<Shown[]>([]);
  list.current = messages;

  const title = conv.data ? (conv.data.kind === 'SUPPORT' ? t('SampForce support') : conv.data.title) : '';
  useEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  const markRead = useCallback(
    (rows: Shown[]) => {
      const last = [...rows].reverse().find((m) => !m.pending);
      if (last) void c.api.post(`/chat/conversations/${id}/read`, { messageId: last.id }).catch(() => undefined);
    },
    [c, id],
  );

  const merge = useCallback((incoming: ChatMessageRow[]) => {
    setMessages((prev) => {
      const byId = new Map(prev.filter((m) => !incoming.some((x) => x.clientId === m.clientId && m.pending)).map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }, []);

  const loadLatest = useCallback(async () => {
    try {
      const rows = await c.api.get<ChatMessageRow[]>(`/chat/conversations/${id}/messages?limit=50`);
      setMessages((prev) => [...rows, ...prev.filter((m) => m.pending)]);
      setOlder(rows.length === 50);
      setLoaded(true);
      setError(null);
      markRead(rows);
    } catch (e) {
      if (!c.report(e)) setError(e instanceof Error ? e.message : t('Something went wrong. Try again.'));
    }
  }, [c, id, markRead]);

  const loadNewer = useCallback(async () => {
    const last = [...list.current].reverse().find((m) => !m.pending);
    if (!last) return loadLatest();
    try {
      const rows = await c.api.get<ChatMessageRow[]>(`/chat/conversations/${id}/messages?after=${encodeURIComponent(last.createdAt)}&limit=200`);
      if (rows.length) {
        merge(rows);
        markRead(rows);
      }
    } catch (e) {
      c.report(e);
    }
  }, [c, id, loadLatest, merge, markRead]);

  const loadOlder = useCallback(async () => {
    const first = list.current.find((m) => !m.pending);
    if (!older || !first) return;
    try {
      const rows = await c.api.get<ChatMessageRow[]>(`/chat/conversations/${id}/messages?before=${first.id}&limit=50`);
      setOlder(rows.length === 50);
      merge(rows);
    } catch (e) {
      c.report(e);
    }
  }, [c, id, older, merge]);

  useEffect(() => {
    if (allowed) void loadLatest();
  }, [allowed, loadLatest]);

  useChatEvents((e) => {
    if (!('conversationId' in e) || e.conversationId !== id) return;
    if (e.type === 'message') {
      void loadNewer();
      if (typing) setTyping(null);
    } else if (e.type === 'message_changed') void loadLatest();
    else if (e.type === 'read' || e.type === 'delivered' || e.type === 'conversation') conv.reload();
    else if (e.type === 'typing' && e.personId !== me) setTyping({ name: e.name, until: Date.now() + 5000 });
  });
  useEffect(() => {
    if (!typing) return;
    const timer = setTimeout(() => setTyping(null), Math.max(0, typing.until - Date.now()));
    return () => clearTimeout(timer);
  }, [typing]);

  const send = async (body: string, retry?: Shown) => {
    const cid = retry?.clientId ?? clientId();
    const draft: Shown = retry
      ? { ...retry, pending: 'sending' }
      : { id: `local-${cid}`, conversationId: id, clientId: cid, author: { id: me, name: s.session.user.name, operator: false, photoUrl: s.session.user.photoUrl }, body, link: null, attachments: [], createdAt: new Date().toISOString(), writtenAt: null, editedAt: null, deleted: false, pending: 'sending' };
    setMessages((prev) => [...prev.filter((m) => m.clientId !== cid), draft]);
    try {
      const saved = await c.api.post<ChatMessageRow>(`/chat/conversations/${id}/messages`, { clientId: cid, body: draft.body, writtenAt: retry ? draft.createdAt : null });
      setMessages((prev) => [...prev.filter((m) => m.clientId !== cid && m.id !== saved.id), saved].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    } catch (e) {
      if (c.report(e)) return;
      setMessages((prev) => prev.map((m) => (m.clientId === cid ? { ...m, pending: 'failed' } : m)));
    }
  };

  const onType = (v: string) => {
    setText(v);
    if (v.trim() && Date.now() - lastTyped.current > 3000) {
      lastTyped.current = Date.now();
      chatLive(c.api).typing(id);
    }
  };

  const members = conv.data?.members ?? [];
  const lastMine = useMemo(() => [...messages].reverse().find((m) => m.author?.id === me && !m.author.operator && !m.pending)?.id ?? null, [messages, me]);
  const shown = useMemo(() => [...messages].reverse(), [messages]);

  if (!allowed) return <Redirect href="/" />;
  if (conv.error && !conv.data) return <ErrorNote message={conv.error} onRetry={conv.reload} />;
  if (!loaded && !error) return <Loading />;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: th.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      {error ? <ErrorNote message={error} onRetry={loadLatest} /> : null}
      <FlatList
        inverted
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12, gap: 2 }}
        data={shown}
        keyExtractor={(m) => m.clientId || m.id}
        onEndReached={() => void loadOlder()}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          <View style={{ padding: 24, transform: [{ scaleY: -1 }] }}>
            <Body muted>{t('No messages yet. Say hello.')}</Body>
          </View>
        }
        renderItem={({ item, index }) => {
          const prev = shown[index + 1];
          const mine = !!item.author && !item.author.operator && item.author.id === me;
          const first = startsGroup(prev, item);
          const receipt = item.pending === 'sending' ? 'sending' : mine && item.id === lastMine ? receiptOf(item, members, me) : null;
          return (
            <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginTop: first ? 10 : 0 }}>
              {first && !mine ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Avatar name={item.author?.name ?? '?'} photoUrl={item.author?.photoUrl} size={24} />
                  <Text style={{ color: th.muted, fontSize: 13, fontWeight: '600' }}>{item.author?.operator ? t('SampForce support') : (item.author?.name ?? t('Someone who left'))}</Text>
                </View>
              ) : null}
              <Pressable
                disabled={item.pending !== 'failed'}
                onPress={() => void send(item.body, item)}
                accessibilityRole={item.pending === 'failed' ? 'button' : undefined}
                style={[styles.bubble, mine ? { backgroundColor: th.primary } : { backgroundColor: th.card, borderColor: th.border, borderWidth: StyleSheet.hairlineWidth }]}
              >
                <Text style={{ color: mine ? th.onPrimary : th.text, fontSize: 15, fontStyle: item.deleted ? 'italic' : 'normal' }}>{item.deleted ? t('This message was deleted.') : item.body}</Text>
                {item.link ? <Text style={{ color: mine ? th.onPrimary : th.primaryText, fontSize: 13, marginTop: 4 }}>{item.link.label}</Text> : null}
                {item.attachments.map((a) => (
                  <Text key={a.id} style={{ color: mine ? th.onPrimary : th.muted, fontSize: 13, marginTop: 4 }}>
                    {t('Attachment: {name}', { name: a.name })}
                  </Text>
                ))}
                <Text style={{ color: mine ? th.onPrimary : th.muted, fontSize: 11, marginTop: 2, alignSelf: 'flex-end', opacity: 0.85 }}>
                  {chatTime(item.createdAt, new Date(), currentLanguage())}
                  {item.editedAt ? ` · ${t('edited')}` : ''}
                </Text>
              </Pressable>
              {item.pending === 'failed' ? <Text style={{ color: th.danger, fontSize: 12, marginTop: 2 }}>{t('Not sent. Tap to try again.')}</Text> : null}
              {receipt ? <Text style={{ color: th.muted, fontSize: 12, marginTop: 2 }}>{receiptText(receipt)}</Text> : null}
            </View>
          );
        }}
      />
      {typing ? <Text style={{ color: th.muted, fontSize: 13, paddingHorizontal: 16, paddingBottom: 4 }}>{t('{name} is writing…', { name: typing.name })}</Text> : null}
      <View style={[styles.composer, { borderTopColor: th.border, backgroundColor: th.card }]}>
        <TextInput
          value={text}
          onChangeText={onType}
          placeholder={t('Write a message')}
          aria-label={t('Write a message')}
          placeholderTextColor={th.muted}
          multiline
          maxLength={4000}
          style={[styles.input, { color: th.text, borderColor: th.border, backgroundColor: th.background }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Send')}
          disabled={!text.trim()}
          onPress={() => {
            const body = text.trim();
            setText('');
            void send(body);
          }}
          style={[styles.send, { backgroundColor: text.trim() ? th.primary : th.border }]}
        >
          <Ionicons aria-hidden name="send" size={18} color={text.trim() ? th.onPrimary : th.muted} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

export function NewMessage() {
  const allowed = useChatAllowed();
  const s = useSignedIn();
  const c = useController();
  const th = useTheme();
  const router = useRouter();
  const people = useApi<ChatDirectoryPerson[]>(allowed ? '/chat/people' : null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!allowed) return <Redirect href="/" />;
  if (people.error && !people.data) return <ErrorNote message={people.error} onRetry={people.reload} />;
  if (!people.data) return <Loading />;
  const me = s.session.user.id;
  const needle = q.trim().toLowerCase();
  const rows = people.data.filter((p) => p.id !== me && (!needle || p.name.toLowerCase().includes(needle) || (p.email ?? '').toLowerCase().includes(needle)));

  const start = async (p: ChatDirectoryPerson) => {
    setBusy(p.id);
    setError(null);
    try {
      const conv = await c.api.post<ChatConversationRow>('/chat/conversations', { kind: 'DIRECT', userId: p.id });
      router.replace({ pathname: '/chat/[id]', params: { id: conv.id } });
    } catch (e) {
      if (!c.report(e)) setError(e instanceof Error ? e.message : t('Something went wrong. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <FlatList
      style={{ backgroundColor: th.background }}
      contentContainerStyle={{ padding: 16, gap: 8 }}
      keyboardShouldPersistTaps="handled"
      data={rows}
      keyExtractor={(p) => p.id}
      ListHeaderComponent={
        <View style={{ gap: 8 }}>
          <Field label={t('Search people')} value={q} onChangeText={setQ} autoCapitalize="none" autoCorrect={false} />
          {error ? <ErrorNote message={error} /> : null}
          <Body muted>{t('You can write to the people your workspace works with.')}</Body>
        </View>
      }
      ListEmptyComponent={<Body muted>{t('Nobody matches.')}</Body>}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Write to {name}', { name: item.name })}
          disabled={!!busy}
          onPress={() => void start(item)}
          style={({ pressed }) => [styles.row, { backgroundColor: th.card, borderColor: th.border, opacity: pressed || busy === item.id ? 0.6 : 1 }]}
        >
          <View>
            <Avatar name={item.name} photoUrl={item.photoUrl} size={44} />
            {item.online ? <View accessibilityLabel={t('Online')} style={[styles.online, { borderColor: th.card }]} /> : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: th.text, fontSize: 16, fontWeight: '600' }}>{item.name}</Text>
            <Text style={{ color: th.muted, fontSize: 13 }}>{[item.role, item.online ? t('Online') : null].filter(Boolean).join(' · ')}</Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  channel: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  bubble: { maxWidth: '82%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 8, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 40, maxHeight: 120, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, fontSize: 15 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  online: { position: 'absolute', right: 0, bottom: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: '#16A34A', borderWidth: 2 },
});

import { mobileRouteFor, type NotificationRow } from '@dealflow/types';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { chatTime } from '../lib/chat';
import { currentLanguage, t } from '../lib/i18n';
import { useApi, useController, useSignedIn, useTheme } from '../lib/session';
import { Body, Button, ErrorNote, Loading } from './ui';

/**
 * The person's notifications (ADR 0072, M8): the same list as the bell on the web, newest first. A tap opens the
 * record on the phone when the app has it, and marks the notification read.
 */
export function NotificationList() {
  const s = useSignedIn();
  const c = useController();
  const th = useTheme();
  const router = useRouter();
  const allowed = s.config.modules.some((m) => m.key === 'notifications');
  const { data, error, loading, reload } = useApi<{ items: NotificationRow[]; unread: number }>(allowed ? '/notifications' : null);
  const [read, setRead] = useState<Set<string>>(new Set());
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );
  if (!allowed) return <Redirect href="/" />;
  if (error && !data) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const isRead = (n: NotificationRow) => !!n.readAt || read.has(n.id) || read.has('all');
  const unread = data.items.filter((n) => !isRead(n)).length;

  const markRead = (ids: string[] | 'all') => {
    setRead((prev) => new Set([...prev, ...(ids === 'all' ? ['all'] : ids)]));
    void c.api.post('/notifications/read', { ids }).catch((e) => c.report(e));
  };
  const open = (n: NotificationRow) => {
    if (!isRead(n)) markRead([n.id]);
    const route = mobileRouteFor(n.link);
    const module = route?.split('/')[1];
    if (route && route !== '/notifications' && s.config.modules.some((m) => m.key === module)) router.push(route as never);
  };

  return (
    <FlatList
      style={{ backgroundColor: th.background }}
      contentContainerStyle={{ padding: 16, gap: 8 }}
      data={data.items}
      keyExtractor={(n) => n.id}
      refreshing={loading}
      onRefresh={reload}
      ListHeaderComponent={unread ? <Button kind="secondary" label={t('Mark all as read')} onPress={() => markRead('all')} /> : undefined}
      ListEmptyComponent={<Body muted>{t('No notifications yet.')}</Body>}
      renderItem={({ item }) => {
        const fresh = !isRead(item);
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={fresh ? t('{title}, unread', { title: item.title }) : item.title}
            onPress={() => open(item)}
            style={({ pressed }) => [styles.row, { backgroundColor: th.card, borderColor: th.border, borderLeftColor: fresh ? th.accent : th.border, opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'baseline' }}>
              <Text style={{ flex: 1, color: th.text, fontSize: 15, fontWeight: fresh ? '700' : '500' }}>{item.title}</Text>
              <Text style={{ color: th.muted, fontSize: 12 }}>{chatTime(item.createdAt, new Date(), currentLanguage())}</Text>
            </View>
            {item.body ? <Text style={{ color: th.muted, fontSize: 14 }}>{item.body}</Text> : null}
            {item.sender ? <Text style={{ color: th.muted, fontSize: 12 }}>{item.sender.designation ? `${item.sender.name} · ${item.sender.designation}` : item.sender.name}</Text> : null}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  row: { padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderLeftWidth: 4, gap: 4 },
});

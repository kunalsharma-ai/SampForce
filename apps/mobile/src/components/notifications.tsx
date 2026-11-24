import type { NotificationFilter, NotificationPage } from '@dealflow/types';
import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { t } from '../lib/i18n';
import { useNotificationCenter } from '../lib/notification-center';
import { useApi, useController, useSignedIn, useTheme } from '../lib/session';
import { NotificationRowView, useOpenNotification } from './notification-center';
import { Chips } from './records';
import { Body, Button, ErrorNote, Loading } from './ui';

/**
 * The person's notifications (ADR 0072 M8, ADR 0075): the same list as the bell on the web, newest first, as All,
 * Unread or Action required. A tap opens the record on the phone when the app has it, and marks it read.
 */
export function NotificationList() {
  const s = useSignedIn();
  const c = useController();
  const th = useTheme();
  const center = useNotificationCenter();
  const open = useOpenNotification();
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const allowed = s.config.modules.some((m) => m.key === 'notifications');
  const { data, error, loading, reload } = useApi<NotificationPage>(allowed ? `/notifications?filter=${filter}&limit=50` : null);
  const [read, setRead] = useState<Set<string>>(new Set());
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );
  if (!allowed) return <Redirect href="/" />;
  const isRead = (id: string, readAt: string | null) => !!readAt || read.has(id) || read.has('all');
  const unread = center.summary?.unread ?? data?.unread ?? 0;

  const markAll = () => {
    setRead(new Set(['all']));
    void c.api.post('/notifications/read', { ids: 'all' }).then(() => {
      center.refresh();
      reload();
    }, (e: unknown) => c.report(e));
  };

  return (
    <FlatList
      style={{ backgroundColor: th.background }}
      contentContainerStyle={{ padding: 16, gap: 8 }}
      data={data?.items ?? []}
      keyExtractor={(n) => n.id}
      refreshing={loading}
      onRefresh={reload}
      ListHeaderComponent={
        <View style={{ gap: 10, marginBottom: 4 }}>
          <Chips
            label={t('Show')}
            value={filter}
            onChange={(v) => setFilter((v || 'all') as NotificationFilter)}
            options={[
              { value: 'all', label: t('All') },
              { value: 'unread', label: t('Unread') },
              { value: 'action', label: t('Action required') },
            ]}
          />
          {unread ? <Button kind="secondary" label={t('Mark all as read')} onPress={markAll} /> : null}
          {error && !data ? <ErrorNote message={error} onRetry={reload} /> : null}
          {!data && !error ? <Loading /> : null}
        </View>
      }
      ListEmptyComponent={!data ? undefined : <Body muted>{filter === 'unread' ? t('No unread notifications.') : filter === 'action' ? t('Nothing needs your action right now.') : t('No notifications yet.')}</Body>}
      renderItem={({ item }) => (
        <NotificationRowView
          n={{ ...item, readAt: isRead(item.id, item.readAt) ? (item.readAt ?? new Date().toISOString()) : null }}
          onPress={() => {
            setRead((prev) => new Set([...prev, item.id]));
            open(item, !isRead(item.id, item.readAt));
          }}
        />
      )}
    />
  );
}

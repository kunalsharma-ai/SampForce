import Ionicons from '@expo/vector-icons/Ionicons';
import { type CenterNotification, mobileRouteFor, type NotificationPage, notificationTone } from '@dealflow/types';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { chatTime } from '../lib/chat';
import { currentLanguage, t } from '../lib/i18n';
import { badgeText, useNotificationCenter } from '../lib/notification-center';
import { useApi, useController, useSignedIn, useTheme } from '../lib/session';
import { Body, Button, Card } from './ui';

const RED = '#E02424';

/** Opens what a notification is about when the app has that screen, else the Notifications screen. */
export function useOpenNotification() {
  const s = useSignedIn();
  const c = useController();
  const router = useRouter();
  const center = useNotificationCenter();
  return (n: CenterNotification, markRead = true) => {
    if (markRead && !n.readAt) void c.api.post('/notifications/read', { ids: [n.id] }).then(center.refresh, (e: unknown) => c.report(e));
    const route = mobileRouteFor(n.link);
    const module = route?.split('/')[1];
    router.push((route && s.config.modules.some((m) => m.key === module) ? route : '/notifications') as never);
  };
}

/** The bell in every screen's header, with the unread count (ADR 0075). */
export function HeaderBell({ color }: { color: string }) {
  const router = useRouter();
  const { summary } = useNotificationCenter();
  const unread = summary?.unread ?? 0;
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!unread) return;
    // A small ring of the bell each time the count goes up.
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1.25, duration: 160, useNativeDriver: true }),
      Animated.spring(pulse, { toValue: 1, friction: 3, useNativeDriver: true }),
    ]).start();
  }, [unread, pulse]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={unread ? t('Notifications, {n} unread', { n: unread }) : t('Notifications')}
      onPress={() => router.push('/notifications' as never)}
      style={styles.bell}
      testID="header-bell"
    >
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Ionicons aria-hidden name={unread ? 'notifications' : 'notifications-outline'} size={24} color={color} />
      </Animated.View>
      {unread ? (
        <View style={styles.badge} aria-hidden>
          <Text style={styles.badgeText}>{badgeText(unread)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Something new slides down from the top for six seconds; a tap opens it, the cross closes it. */
export function NotificationBanner() {
  const th = useTheme();
  const insets = useSafeAreaInsets();
  const { banner, dismissBanner } = useNotificationCenter();
  const open = useOpenNotification();
  const y = useRef(new Animated.Value(-160)).current;
  useEffect(() => {
    if (!banner) return;
    y.setValue(-160);
    Animated.spring(y, { toValue: 0, friction: 7, tension: 60, useNativeDriver: true }).start();
    const timer = setTimeout(() => Animated.timing(y, { toValue: -160, duration: 260, useNativeDriver: true }).start(dismissBanner), 6000);
    return () => clearTimeout(timer);
  }, [banner, y, dismissBanner]);
  if (!banner) return null;
  const tone = notificationTone(banner);
  return (
    <Animated.View style={[styles.bannerWrap, { top: insets.top + 6, transform: [{ translateY: y }] }]} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('New notification: {title}', { title: banner.title })}
        accessibilityLiveRegion="polite"
        onPress={() => {
          dismissBanner();
          open(banner);
        }}
        style={[styles.banner, { backgroundColor: th.card, borderColor: tone === 'normal' ? th.border : RED }]}
        testID="notification-banner"
      >
        <View style={[styles.bannerIcon, { backgroundColor: RED }]}>
          <Ionicons aria-hidden name={tone === 'action' ? 'alert-circle' : 'notifications'} size={18} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: th.text, fontWeight: '700', fontSize: 15 }} numberOfLines={1}>
            {banner.title}
          </Text>
          {banner.body ? (
            <Text style={{ color: th.muted, fontSize: 13 }} numberOfLines={2}>
              {banner.body}
            </Text>
          ) : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Dismiss')} onPress={dismissBanner} hitSlop={10}>
          <Ionicons aria-hidden name="close" size={18} color={th.muted} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

/** One notification in a list: unread ones are bold with a red edge; action-required ones say so. */
export function NotificationRowView({ n, onPress }: { n: CenterNotification; onPress: () => void }) {
  const th = useTheme();
  const fresh = !n.readAt;
  const tone = notificationTone(n);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={fresh ? t('{title}, unread', { title: n.title }) : n.title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { backgroundColor: th.card, borderColor: th.border, borderLeftColor: fresh ? RED : th.border, opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'baseline' }}>
        <Text style={{ flex: 1, color: th.text, fontSize: 15, fontWeight: fresh ? '700' : '500' }}>{n.title}</Text>
        <Text style={{ color: th.muted, fontSize: 12 }}>{chatTime(n.createdAt, new Date(), currentLanguage())}</Text>
      </View>
      {n.body ? <Text style={{ color: th.muted, fontSize: 14 }}>{n.body}</Text> : null}
      {tone === 'action' ? <Text style={{ color: th.danger, fontSize: 12, fontWeight: '700' }}>{t('Action required')}</Text> : null}
      {n.sender ? <Text style={{ color: th.muted, fontSize: 12 }}>{n.sender.designation ? `${n.sender.name} · ${n.sender.designation}` : n.sender.name}</Text> : null}
    </Pressable>
  );
}

/** The home screen's notifications: the three newest unread, and the way to all of them (ADR 0075). */
export function HomeNotificationsCard() {
  const router = useRouter();
  const th = useTheme();
  const { summary } = useNotificationCenter();
  const open = useOpenNotification();
  const list = useApi<NotificationPage>('/notifications?filter=unread&limit=3');
  const reload = list.reload;
  // A new arrival or a read elsewhere changes the summary; the card follows it.
  useEffect(() => reload(), [summary?.unread, summary?.latestAt, reload]);
  const items = list.data?.items ?? [];
  return (
    <Card accent>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} testID="home-notifications">
        <Ionicons aria-hidden name="notifications" size={18} color={RED} />
        <Text accessibilityRole="header" style={{ flex: 1, color: th.text, fontSize: 17, fontWeight: '700' }}>
          {t('Notifications')}
        </Text>
        {summary?.unread ? (
          <View style={styles.pill}>
            <Text style={styles.badgeText}>{t('{n} new', { n: summary.unread })}</Text>
          </View>
        ) : null}
      </View>
      {items.length ? items.map((n) => <NotificationRowView key={n.id} n={n} onPress={() => open(n)} />) : <Body muted>{t('You’re all caught up.')}</Body>}
      <Button kind="secondary" label={t('View all notifications')} onPress={() => router.push('/notifications' as never)} />
    </Card>
  );
}

const styles = StyleSheet.create({
  bell: { paddingHorizontal: 14, paddingVertical: 6 },
  badge: { position: 'absolute', top: 0, right: 6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: RED, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  badgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  pill: { backgroundColor: RED, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  bannerWrap: { position: 'absolute', left: 12, right: 12, zIndex: 50 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 16, borderWidth: 1, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  bannerIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  row: { padding: 12, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderLeftWidth: 4, gap: 4 },
});

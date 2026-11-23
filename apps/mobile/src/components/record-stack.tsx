import { MOBILE_MODULE_BY_KEY, type MobileLiveRecordModule } from '@dealflow/types';
import { Stack } from 'expo-router';
import { tMaybe } from '../lib/i18n';
import { useSignedIn, useTheme } from '../lib/session';
import { HeaderBell } from './notification-center';

/** A record module's own stack inside its tab: the list, then a record, then its form. */
export function RecordStack({ module }: { module: MobileLiveRecordModule }) {
  const th = useTheme();
  const bell = useSignedIn().config.modules.some((m) => m.key === 'notifications');
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: th.primary }, headerTintColor: th.onPrimary, contentStyle: { backgroundColor: th.background } }}>
      {/* The list keeps the notifications bell (ADR 0075); a record's own screens keep their actions there. */}
      <Stack.Screen name="index" options={{ title: tMaybe(MOBILE_MODULE_BY_KEY[module].label), ...(bell ? { headerRight: () => <HeaderBell color={th.onPrimary} /> } : {}) }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
      <Stack.Screen name="form" options={{ title: '' }} />
    </Stack>
  );
}

import { MOBILE_MODULE_BY_KEY, type MobileLiveRecordModule } from '@dealflow/types';
import { Stack } from 'expo-router';
import { tMaybe } from '../lib/i18n';
import { useTheme } from '../lib/session';

/** A record module's own stack inside its tab: the list, then a record, then its form. */
export function RecordStack({ module }: { module: MobileLiveRecordModule }) {
  const th = useTheme();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: th.primary }, headerTintColor: th.onPrimary, contentStyle: { backgroundColor: th.background } }}>
      <Stack.Screen name="index" options={{ title: tMaybe(MOBILE_MODULE_BY_KEY[module].label) }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
      <Stack.Screen name="form" options={{ title: '' }} />
    </Stack>
  );
}

import { Stack } from 'expo-router';
import { t } from '../../../src/lib/i18n';
import { useTheme } from '../../../src/lib/session';

/** Chat's own stack inside its tab: conversations, then one conversation or a new message. */
export default function ChatLayout() {
  const th = useTheme();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: th.primary }, headerTintColor: th.onPrimary, contentStyle: { backgroundColor: th.background } }}>
      <Stack.Screen name="index" options={{ title: t('Internal chat') }} />
      <Stack.Screen name="[id]" options={{ title: '' }} />
      <Stack.Screen name="new" options={{ title: t('New message') }} />
    </Stack>
  );
}

import { Stack } from 'expo-router';
import { t } from '../../../src/lib/i18n';
import { useTheme } from '../../../src/lib/session';

export default function HelpLayout() {
  const th = useTheme();
  return (
    <Stack screenOptions={{ headerStyle: { backgroundColor: th.primary }, headerTintColor: th.onPrimary, contentStyle: { backgroundColor: th.background } }}>
      <Stack.Screen name="index" options={{ title: t('Help') }} />
      <Stack.Screen name="tickets/index" options={{ title: t('Your questions') }} />
      <Stack.Screen name="tickets/new" options={{ title: t('Ask a question') }} />
      <Stack.Screen name="tickets/[id]" options={{ title: t('Question') }} />
    </Stack>
  );
}

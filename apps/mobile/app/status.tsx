import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Body, Button, Screen, Title } from '../src/components/ui';
import { t, tMaybe } from '../src/lib/i18n';
import { useController, useSession, useTheme } from '../src/lib/session';

/**
 * Shown when the organisation's phones are stopped (the Console suspended or revoked access, the plan dropped the app,
 * or the Super Workspace switched it off) or the server cannot be reached. The message comes from the server.
 */
export default function Status() {
  const s = useSession();
  const c = useController();
  const th = useTheme();
  const [busy, setBusy] = useState(false);
  if (s.status !== 'blocked' && s.status !== 'unreachable') return <Redirect href="/" />;
  const retry = async () => {
    setBusy(true);
    await c.reload();
    setBusy(false);
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: th.background }}>
      <Screen>
        <View style={{ alignItems: 'center', gap: 12, marginTop: 48 }}>
          <Ionicons aria-hidden name={s.status === 'blocked' ? 'lock-closed-outline' : 'cloud-offline-outline'} size={48} color={th.muted} />
          <Title>{s.status === 'blocked' ? t('The mobile app is not available') : t('Can’t reach SampForce')}</Title>
          <Body muted style={{ textAlign: 'center' }}>
            {tMaybe(s.message)}
          </Body>
          {s.status === 'blocked' ? (
            <Body muted style={{ textAlign: 'center' }}>
              {t('You can still use SampForce on the web. Ask your administrator if you need the app.')}
            </Body>
          ) : null}
        </View>
        <Button label={t('Try again')} busy={busy} onPress={retry} />
        <Button kind="secondary" label={t('Sign out')} onPress={() => void c.signOut()} />
      </Screen>
    </SafeAreaView>
  );
}

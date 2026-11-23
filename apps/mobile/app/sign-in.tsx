import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Body, BrandMark, Button, Card, Field, Screen, Title } from '../src/components/ui';
import { t, tMaybe } from '../src/lib/i18n';
import { useController, useSession, useTheme } from '../src/lib/session';

/**
 * Sign-in with the same SampForce account as the web (ADR 0072). The server address is there for organisations that
 * run their own SampForce server; most people never open it.
 */
export default function SignIn() {
  const s = useSession();
  const c = useController();
  const th = useTheme();
  const [server, setServer] = useState('');
  const [showServer, setShowServer] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if ((s.status === 'signedOut' || s.status === 'mfa') && !server) setServer(s.server);
  }, [s, server]);

  if (s.status === 'signedIn' || s.status === 'blocked' || s.status === 'unreachable') return <Redirect href="/" />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const error = s.status === 'signedOut' || s.status === 'mfa' ? s.error : null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: th.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Screen>
          <View style={styles.brand}>
            <BrandMark name="SampForce" logo={null} size={56} color={th.primary} />
            <Title>SampForce</Title>
            <Body muted>{t('Sign in with your SampForce account.')}</Body>
          </View>
          {error ? (
            <Card>
              <Text accessibilityRole="alert" style={{ color: th.danger, fontSize: 15 }}>
                {tMaybe(error)}
              </Text>
            </Card>
          ) : null}
          {s.status === 'mfa' ? (
            <>
              <Body>{t('Enter the 6-digit code from your authenticator app, or one of your backup codes.')}</Body>
              <Field label={t('Code')} value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" autoFocus />
              <Button label={t('Verify')} busy={busy} disabled={code.replace(/\s/g, '').length < 6} onPress={() => run(() => c.verifyMfa(code))} />
              <Button kind="secondary" label={t('Back')} onPress={() => run(() => c.signOut())} />
            </>
          ) : (
            <>
              <Field label={t('Email')} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" />
              <Field label={t('Password')} value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={() => run(() => c.signIn(server, email, password))} />
              <Button label={t('Sign in')} busy={busy} disabled={!email.trim() || !password} onPress={() => run(() => c.signIn(server, email, password))} />
              <Pressable accessibilityRole="button" onPress={() => setShowServer((v) => !v)} style={styles.link}>
                <Text style={{ color: th.primary, fontSize: 15 }}>{showServer ? t('Hide server address') : t('Use another server')}</Text>
              </Pressable>
              {showServer ? <Field label={t('Server address')} hint={t('Only if your organisation runs its own SampForce server.')} value={server} onChangeText={setServer} autoCapitalize="none" keyboardType="url" autoCorrect={false} /> : null}
              <Body muted style={styles.small}>
                {t('Your organisation’s administrator must switch on the mobile app first. Forgot your password? Reset it on the web.')}
              </Body>
            </>
          )}
        </Screen>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', gap: 8, marginTop: 24, marginBottom: 8 },
  link: { alignSelf: 'center', padding: 8 },
  small: { fontSize: 13, textAlign: 'center' },
});

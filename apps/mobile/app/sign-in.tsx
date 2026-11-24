import Ionicons from '@expo/vector-icons/Ionicons';
import * as Linking from 'expo-linking';
import { Redirect } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CardFrame, markWelcome, RED, ResultMark, SceneBackdrop, SceneGreeting, SceneStage, useLastVariant, WorkspaceBadge } from '../src/components/sign-in-scene';
import { t, tMaybe } from '../src/lib/i18n';
import { useController, useSession } from '../src/lib/session';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CARD = { bg: '#1A0A0C', field: '#26110F', border: '#5B1D1D', text: '#FFF5F5', muted: '#F5B7B7', danger: '#FCA5A5' };

/** A field drawn for the dark sign-in box, with an icon, and a check once the value is right. */
function SignInField({ label, icon, valid, invalid, right, ...input }: TextInputProps & { label: string; icon: 'mail' | 'lock-closed' | 'keypad' | 'server'; valid?: boolean; invalid?: string | null; right?: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, { borderColor: invalid ? CARD.danger : valid ? '#4ADE80' : CARD.border }]}>
        <Ionicons aria-hidden name={icon} size={18} color={CARD.muted} />
        <TextInput accessibilityLabel={label} placeholderTextColor="#B98585" {...input} style={styles.input} aria-invalid={invalid ? true : undefined} />
        {valid ? <Ionicons aria-hidden name="checkmark-circle" size={18} color="#4ADE80" /> : null}
        {right}
      </View>
      {invalid ? <Text style={{ color: CARD.danger, fontSize: 13 }}>{invalid}</Text> : null}
    </View>
  );
}

function RedButton({ label, onPress, busy, disabled }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { opacity: disabled ? 0.55 : pressed ? 0.85 : 1 }]}
    >
      <Text style={styles.buttonText}>{busy ? t('Signing in…') : label}</Text>
    </Pressable>
  );
}

function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.link}>
      <Text style={{ color: '#FCA5A5', fontSize: 15, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

/**
 * Sign-in with the same SampForce account as the web (ADR 0072), on the level's own animated scene (ADR 0075): the
 * greeting names the workspace in bold, the password has an eye, a wrong password shakes the box with a red cross, and
 * the right one draws a green tick before the welcome. The server address is for organisations with their own server.
 */
export default function SignIn() {
  const s = useSession();
  const c = useController();
  const variant = useLastVariant();
  const [server, setServer] = useState('');
  const [showServer, setShowServer] = useState(false);
  const [email, setEmail] = useState('');
  const [emailLeft, setEmailLeft] = useState(false);
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'idle' | 'success' | 'error'>('idle');
  const shake = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if ((s.status === 'signedOut' || s.status === 'mfa') && !server) setServer(s.server);
  }, [s, server]);

  // Held on the tick for a moment, then the app opens (and the welcome plays there).
  if (result !== 'success' && (s.status === 'signedIn' || s.status === 'blocked' || s.status === 'unreachable')) return <Redirect href="/" />;

  const settle = async () => {
    const now = c.state;
    if (now.status === 'signedIn') {
      markWelcome();
      setResult('success');
      await new Promise((r) => setTimeout(r, 950));
      setResult('idle');
    } else if ((now.status === 'signedOut' || now.status === 'mfa') && now.error) {
      setResult('error');
      Animated.sequence([10, -10, 7, -7, 3, 0].map((x) => Animated.timing(shake, { toValue: x, duration: 55, useNativeDriver: true }))).start();
    }
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setResult('idle');
    try {
      await fn();
    } finally {
      setBusy(false);
    }
    await settle();
  };
  const error = s.status === 'signedOut' || s.status === 'mfa' ? s.error : null;
  const emailInvalid = emailLeft && email.trim() !== '' && !EMAIL.test(email.trim()) ? t('Enter a valid email address.') : null;
  const typed = () => result === 'error' && setResult('idle');
  const forgot = () => void Linking.openURL(`${(server || (s.status === 'signedOut' ? s.server : '')).replace(/\/+$/, '')}/forgot-password`);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#140405' }}>
      <SceneBackdrop variant={variant} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
          <View style={styles.brandRow}>
            <View style={styles.logo}>
              <Ionicons aria-hidden name="flash" size={18} color="#FFFFFF" />
            </View>
            <Text style={styles.brand}>
              Samp<Text style={{ color: '#FF6B6B' }}>Force</Text>
            </Text>
          </View>
          <SceneGreeting variant={variant} />
          <SceneStage variant={variant} />
          <CardFrame>
            <Animated.View style={[styles.card, { transform: [{ translateX: shake }] }]} testID="sign-in-card">
              <WorkspaceBadge variant={variant} />
              <View style={{ gap: 2 }}>
                <Text accessibilityRole="header" style={styles.title}>
                  {s.status === 'mfa' ? t('Two-step verification') : t('Sign in')}
                </Text>
                <Text style={{ color: CARD.muted, fontSize: 14 }}>{t('Sign in with your SampForce account.')}</Text>
              </View>
              {s.status === 'mfa' ? (
                <>
                  <Text style={{ color: CARD.text, fontSize: 15 }}>{t('Enter the 6-digit code from your authenticator app, or one of your backup codes.')}</Text>
                  <SignInField label={t('Code')} icon="keypad" value={code} onChangeText={(v) => { setCode(v); typed(); }} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" autoFocus />
                  {result === 'error' ? <ResultMark kind="error" /> : null}
                  {error ? <Text accessibilityRole="alert" style={styles.error}>{tMaybe(error)}</Text> : null}
                  <RedButton label={t('Verify')} busy={busy} disabled={code.replace(/\s/g, '').length < 6} onPress={() => run(() => c.verifyMfa(code))} />
                  <LinkButton label={t('Back')} onPress={() => run(() => c.signOut())} />
                </>
              ) : (
                <>
                  <SignInField
                    label={t('Email')}
                    icon="mail"
                    value={email}
                    onChangeText={(v) => { setEmail(v); typed(); }}
                    onBlur={() => setEmailLeft(true)}
                    valid={EMAIL.test(email.trim())}
                    invalid={emailInvalid}
                    autoCapitalize="none"
                    autoComplete="email"
                    keyboardType="email-address"
                    textContentType="username"
                  />
                  <SignInField
                    label={t('Password')}
                    icon="lock-closed"
                    value={password}
                    onChangeText={(v) => { setPassword(v); typed(); }}
                    secureTextEntry={!shown}
                    autoComplete="password"
                    textContentType="password"
                    onSubmitEditing={() => run(() => c.signIn(server, email, password))}
                    right={
                      // Named "Show characters", so the field alone answers to "Password".
                      <Pressable accessibilityRole="button" accessibilityLabel={shown ? t('Hide characters') : t('Show characters')} aria-pressed={shown} onPress={() => setShown((v) => !v)} hitSlop={8} testID="reveal-password">
                        <Ionicons aria-hidden name={shown ? 'eye-off' : 'eye'} size={20} color={CARD.muted} />
                      </Pressable>
                    }
                  />
                  <Pressable accessibilityRole="link" onPress={forgot} style={{ alignSelf: 'flex-end' }}>
                    <Text style={{ color: '#FCA5A5', fontSize: 14, fontWeight: '600' }}>{t('Forgot your password?')}</Text>
                  </Pressable>
                  {result === 'error' ? <ResultMark kind="error" /> : null}
                  {error ? (
                    <Text accessibilityRole="alert" style={styles.error}>
                      {tMaybe(error)}
                    </Text>
                  ) : null}
                  <RedButton label={t('Sign in')} busy={busy} disabled={!email.trim() || !password || result === 'success'} onPress={() => run(() => c.signIn(server, email, password))} />
                  <LinkButton label={showServer ? t('Hide server address') : t('Use another server')} onPress={() => setShowServer((v) => !v)} />
                  {showServer ? (
                    <SignInField label={t('Server address')} icon="server" value={server} onChangeText={setServer} autoCapitalize="none" keyboardType="url" autoCorrect={false} />
                  ) : null}
                  {showServer ? <Text style={styles.small}>{t('Only if your organisation runs its own SampForce server.')}</Text> : null}
                  <Text style={styles.small}>{t('Your organisation’s administrator must switch on the mobile app first. Forgot your password? Reset it on the web.')}</Text>
                </>
              )}
              <View style={styles.trust}>
                <Ionicons aria-hidden name="lock-closed" size={12} color={CARD.muted} />
                <Text style={{ color: CARD.muted, fontSize: 12 }}>{t('Secure, encrypted sign-in')}</Text>
              </View>
              {result === 'success' ? (
                <View style={styles.successCover} testID="sign-in-success">
                  <ResultMark kind="success" />
                  <Text accessibilityRole="alert" style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800', marginTop: 10 }}>
                    {t('Signed in')}
                  </Text>
                  <Text style={{ color: CARD.muted, fontSize: 14 }}>{t('Opening your workspace…')}</Text>
                </View>
              ) : null}
            </Animated.View>
          </CardFrame>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 18, gap: 12, paddingBottom: 40 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { width: 30, height: 30, borderRadius: 9, backgroundColor: RED, alignItems: 'center', justifyContent: 'center' },
  brand: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  card: { backgroundColor: CARD.bg, borderRadius: 22, padding: 18, gap: 14, overflow: 'hidden' },
  title: { color: '#FFFFFF', fontSize: 24, fontWeight: '800' },
  label: { color: CARD.text, fontSize: 14, fontWeight: '600' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 12, backgroundColor: CARD.field },
  input: { flex: 1, color: CARD.text, fontSize: 16, paddingVertical: 10 },
  button: { minHeight: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: RED, shadowColor: RED, shadowOpacity: 0.6, shadowRadius: 16, elevation: 6 },
  buttonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  link: { alignSelf: 'center', padding: 8 },
  error: { color: CARD.danger, fontSize: 15, textAlign: 'center', backgroundColor: 'rgba(220,38,38,0.12)', borderRadius: 10, padding: 10 },
  small: { color: CARD.muted, fontSize: 13, textAlign: 'center' },
  trust: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: CARD.border, paddingTop: 10 },
  successCover: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(26,10,12,0.96)', alignItems: 'center', justifyContent: 'center', gap: 4 },
});

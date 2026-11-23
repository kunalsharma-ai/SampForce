import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { t } from '../lib/i18n';
import { usePhoto } from '../lib/photos';
import { useTheme } from '../lib/session';

/** Small building blocks shared by every screen, drawn in the organisation's colours. */

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Screen({ children, refreshing, onRefresh }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void }) {
  const th = useTheme();
  return (
    <ScrollView
      // Keyboard users can scroll the screen on the web build (screen readers on phones scroll natively).
      tabIndex={0}
      style={{ backgroundColor: th.background }}
      contentContainerStyle={styles.screen}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={th.primary} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

export function Card({ children, accent }: { children: ReactNode; accent?: boolean }) {
  const th = useTheme();
  return <View style={[styles.card, { backgroundColor: th.card, borderColor: th.border }, accent && { borderLeftWidth: 4, borderLeftColor: th.accent }]}>{children}</View>;
}

export function Title({ children }: { children: ReactNode }) {
  const th = useTheme();
  return (
    <Text accessibilityRole="header" style={[styles.title, { color: th.text }]}>
      {children}
    </Text>
  );
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  const th = useTheme();
  return <Text style={[styles.body, { color: muted ? th.muted : th.text }, style]}>{children}</Text>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  const th = useTheme();
  return <Text style={[styles.section, { color: th.muted }]}>{children}</Text>;
}

export function Button({ label, onPress, kind = 'primary', busy, disabled }: { label: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; busy?: boolean; disabled?: boolean }) {
  const th = useTheme();
  const bg = kind === 'primary' ? th.primary : 'transparent';
  const fg = kind === 'primary' ? th.onPrimary : kind === 'danger' ? th.danger : th.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, borderColor: kind === 'primary' ? bg : th.border, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

export function Field({ label, hint, error, ...input }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const th = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: th.text }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={th.muted}
        {...input}
        style={[styles.input, { color: th.text, borderColor: error ? th.danger : th.border, backgroundColor: th.card }, input.multiline && { minHeight: 110, textAlignVertical: 'top' }]}
      />
      {hint ? <Text style={[styles.hint, { color: th.muted }]}>{hint}</Text> : null}
      {error ? <Text style={[styles.hint, { color: th.danger }]}>{error}</Text> : null}
    </View>
  );
}

export function Row({ icon, label, detail, onPress, last }: { icon?: IconName; label: string; detail?: string; onPress?: () => void; last?: boolean }) {
  const th = useTheme();
  return (
    <Pressable accessibilityRole={onPress ? 'button' : 'text'} onPress={onPress} style={({ pressed }) => [styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: th.border }, pressed && onPress && { opacity: 0.7 }]}>
      {icon ? <Ionicons aria-hidden name={icon} size={20} color={th.primary} style={styles.rowIcon} /> : null}
      <View style={styles.rowText}>
        <Text style={[styles.body, { color: th.text }]}>{label}</Text>
        {detail ? <Text style={[styles.hint, { color: th.muted }]}>{detail}</Text> : null}
      </View>
      {onPress ? <Ionicons aria-hidden name="chevron-forward" size={18} color={th.muted} /> : null}
    </Pressable>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const th = useTheme();
  return (
    <Card>
      <Text accessibilityRole="alert" style={[styles.body, { color: th.danger }]}>
        {message}
      </Text>
      {onRetry ? <Button kind="secondary" label={t('Try again')} onPress={onRetry} /> : null}
    </Card>
  );
}

export function Loading() {
  const th = useTheme();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={th.primary} accessibilityLabel={t('Loading')} />
    </View>
  );
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/**
 * A person's photo, or their initials while it loads or when they have none. Others' photos follow the
 * organisation's "show profile pictures" setting; the server applies it too.
 */
export function Avatar({ name, photoUrl, size = 40, label }: { name: string; photoUrl: string | null | undefined; size?: number; label?: string }) {
  const th = useTheme();
  const src = usePhoto(photoUrl);
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (src) return <Image source={{ uri: src }} accessibilityLabel={label} accessibilityIgnoresInvertColors style={[box, { backgroundColor: th.border }]} />;
  return (
    <View accessibilityLabel={label} role={label ? 'img' : undefined} style={[box, { backgroundColor: th.primary, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color: th.onPrimary, fontWeight: '700', fontSize: size * 0.38 }}>{initials(name)}</Text>
    </View>
  );
}

/** The organisation's logo, or its initials when it has none. */
export function BrandMark({ name, logo, size = 32, color }: { name: string; logo: string | null; size?: number; color: string }) {
  if (logo) return <Image source={{ uri: logo }} accessibilityIgnoresInvertColors style={{ width: size, height: size, borderRadius: 6, backgroundColor: '#FFFFFF' }} resizeMode="contain" />;
  return (
    <View style={{ width: size, height: size, borderRadius: 6, borderWidth: 1, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color, fontWeight: '700', fontSize: size * 0.4 }}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 12, paddingBottom: 32 },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 8 },
  title: { fontSize: 22, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 22 },
  section: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  button: { minHeight: 48, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonText: { fontSize: 16, fontWeight: '600' },
  field: { gap: 6 },
  label: { fontSize: 14, fontWeight: '600' },
  input: { minHeight: 48, borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  hint: { fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingVertical: 10, gap: 12 },
  rowIcon: { width: 22 },
  rowText: { flex: 1, gap: 2 },
  loading: { padding: 32, alignItems: 'center' },
});

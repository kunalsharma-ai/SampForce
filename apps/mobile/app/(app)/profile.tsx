import type { MobilePushStatus } from '@dealflow/types';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Avatar, Body, Button, Card, ErrorNote, Row, Screen, SectionLabel, Title } from '../../src/components/ui';
import { choosePhoto } from '../../src/lib/photos';
import { pushSupported, turnOffPush, turnOnPush } from '../../src/lib/push';
import { t, tMaybe } from '../../src/lib/i18n';
import { LEVEL_LABEL } from '../../src/lib/labels';
import { useApi, useController, useSignedIn } from '../../src/lib/session';

/** The app's privacy notice (app.json extra.privacyUrl), also linked from the store listings. */
const PRIVACY_URL = (Constants.expoConfig?.extra as { privacyUrl?: string } | undefined)?.privacyUrl ?? null;

/** Who is signed in, where, and on which phone; switching organisation and signing out. */
export default function Profile() {
  const s = useSignedIn();
  const c = useController();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { user, organisation, level, designation, workspaces, device } = s.session;
  const others = workspaces.filter((w) => w.tenantId !== organisation.id);
  const notifies = s.config.notifications.enabled && s.config.notifications.types.length > 0;
  const push = useApi<MobilePushStatus>(notifies ? '/mobile/push' : null);
  const [pushState, setPushState] = useState<MobilePushStatus | null>(null);
  const registered = (pushState ?? push.data)?.registered ?? false;
  const togglePush = async () => {
    setBusy('push');
    setError(null);
    try {
      setPushState(registered ? await turnOffPush(c.api) : await turnOnPush(c.api));
    } catch (e) {
      if (!c.report(e)) setError(e instanceof Error ? e.message : t('Something went wrong. Try again.'));
    } finally {
      setBusy(null);
    }
  };
  const switchTo = async (tenantId: string) => {
    setBusy(tenantId);
    setError(null);
    try {
      await c.switchWorkspace(tenantId);
    } catch (e) {
      if (!c.report(e)) setError(e instanceof Error ? e.message : t('Something went wrong. Try again.'));
    } finally {
      setBusy(null);
    }
  };
  // Choosing, taking or removing the person's own photo; the session then carries the new one everywhere.
  const photo = async (kind: 'library' | 'camera' | 'remove') => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'remove') await c.api.delete('/me/photo');
      else if (!(await choosePhoto(c.api, kind))) return;
      await c.reload();
    } catch (e) {
      if (!c.report(e)) setError(e instanceof Error ? e.message : t('Something went wrong. Try again.'));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: 8 }}>
        <Avatar name={user.name} photoUrl={user.photoUrl} size={96} label={user.photoUrl ? t('Your photo') : t('No photo yet')} />
        <Title>{user.name}</Title>
        <Body muted>{user.email}</Body>
      </View>
      <View style={{ gap: 8 }}>
        <Button kind="secondary" label={user.photoUrl ? t('Change photo') : t('Add a photo')} busy={busy === 'library'} disabled={!!busy} onPress={() => void photo('library')} />
        {Platform.OS !== 'web' ? <Button kind="secondary" label={t('Take a photo')} busy={busy === 'camera'} disabled={!!busy} onPress={() => void photo('camera')} /> : null}
        {user.photoUrl ? <Button kind="secondary" label={t('Remove photo')} busy={busy === 'remove'} disabled={!!busy} onPress={() => void photo('remove')} /> : null}
      </View>
      <Card>
        <Row icon="business-outline" label={organisation.name} detail={t('Organisation')} />
        <Row icon="layers-outline" label={tMaybe(LEVEL_LABEL[level])} detail={designation ? `${t('Level')} · ${designation}` : t('Level')} />
        <Row icon="phone-portrait-outline" label={device.platform === 'IOS' ? 'iPhone' : device.platform === 'ANDROID' ? 'Android' : t('Browser')} detail={t('This device')} last />
      </Card>
      {notifies ? (
        <>
          <SectionLabel>{t('Notifications')}</SectionLabel>
          <Card>
            {pushSupported() ? (
              <>
                <Body>{registered ? t('Notifications are on for this phone.') : t('Get tasks, reminders, messages and announcements on this phone.')}</Body>
                <Button kind={registered ? 'secondary' : 'primary'} label={registered ? t('Turn off notifications') : t('Turn on notifications')} busy={busy === 'push'} disabled={!!busy || push.loading} onPress={() => void togglePush()} />
              </>
            ) : (
              <Body muted>{t('Notifications arrive in the iPhone and Android app.')}</Body>
            )}
          </Card>
        </>
      ) : null}
      {others.length > 0 ? (
        <>
          <SectionLabel>{t('Switch organisation')}</SectionLabel>
          <Card>
            {others.map((w, i) => (
              <Row key={w.tenantId} icon="swap-horizontal-outline" label={w.name} detail={busy === w.tenantId ? t('Switching…') : undefined} onPress={busy ? undefined : () => void switchTo(w.tenantId)} last={i === others.length - 1} />
            ))}
          </Card>
        </>
      ) : null}
      {error ? <ErrorNote message={tMaybe(error)} /> : null}
      {PRIVACY_URL ? (
        <Card>
          <Row icon="shield-checkmark-outline" label={t('Privacy policy')} onPress={() => void Linking.openURL(PRIVACY_URL)} last />
        </Card>
      ) : null}
      <Button kind="danger" label={t('Sign out')} onPress={() => void c.signOut()} />
    </Screen>
  );
}

import { useState } from 'react';
import { Body, Button, Card, ErrorNote, Row, Screen, SectionLabel, Title } from '../../src/components/ui';
import { t, tMaybe } from '../../src/lib/i18n';
import { LEVEL_LABEL } from '../../src/lib/labels';
import { useController, useSignedIn } from '../../src/lib/session';

/** Who is signed in, where, and on which phone; switching organisation and signing out. */
export default function Profile() {
  const s = useSignedIn();
  const c = useController();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { user, organisation, level, designation, workspaces, device } = s.session;
  const others = workspaces.filter((w) => w.tenantId !== organisation.id);
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
  return (
    <Screen>
      <Title>{user.name}</Title>
      <Body muted>{user.email}</Body>
      <Card>
        <Row icon="business-outline" label={organisation.name} detail={t('Organisation')} />
        <Row icon="layers-outline" label={tMaybe(LEVEL_LABEL[level])} detail={designation ? `${t('Level')} · ${designation}` : t('Level')} />
        <Row icon="phone-portrait-outline" label={device.platform === 'IOS' ? 'iPhone' : device.platform === 'ANDROID' ? 'Android' : t('Browser')} detail={t('This device')} last />
      </Card>
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
      <Button kind="danger" label={t('Sign out')} onPress={() => void c.signOut()} />
    </Screen>
  );
}

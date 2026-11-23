import { MOBILE_MODULE_BY_KEY } from '@dealflow/types';
import { useRouter } from 'expo-router';
import { Button, Card, Row, Screen, SectionLabel } from '../../src/components/ui';
import { t, tMaybe } from '../../src/lib/i18n';
import { MODULE_ICON } from '../../src/lib/modules';
import { useController, useSignedIn } from '../../src/lib/session';

/** Everything that is not a bottom tab, then Help and the person's questions to support. No "Recent" list. */
export default function More() {
  const s = useSignedIn();
  const c = useController();
  const router = useRouter();
  const rest = s.config.more;
  const showProfile = !s.config.tabs.includes('profile') && !rest.includes('profile');
  return (
    <Screen>
      {rest.length > 0 || showProfile ? (
        <Card>
          {rest.map((k, i) => (
            <Row key={k} icon={MODULE_ICON[k].off} label={tMaybe(MOBILE_MODULE_BY_KEY[k].label)} onPress={() => router.push(`/${k}`)} last={i === rest.length - 1 && !showProfile} />
          ))}
          {showProfile ? <Row icon={MODULE_ICON.profile.off} label={tMaybe(MOBILE_MODULE_BY_KEY.profile.label)} onPress={() => router.push('/profile')} last /> : null}
        </Card>
      ) : null}
      <SectionLabel>{t('Help and support')}</SectionLabel>
      <Card>
        <Row icon="help-circle-outline" label={t('Help')} detail={t('Answers and guides for what you can use')} onPress={() => router.push('/help')} />
        <Row icon="chatbox-ellipses-outline" label={t('Your questions')} detail={t('Questions you asked and their answers')} onPress={() => router.push('/help/tickets')} last />
      </Card>
      <Button kind="danger" label={t('Sign out')} onPress={() => void c.signOut()} />
    </Screen>
  );
}

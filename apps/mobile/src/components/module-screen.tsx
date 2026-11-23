import Ionicons from '@expo/vector-icons/Ionicons';
import { MOBILE_MODULE_BY_KEY, type MobileModuleKey } from '@dealflow/types';
import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { t, tMaybe } from '../lib/i18n';
import { MODULE_ICON } from '../lib/modules';
import { useSignedIn, useTheme } from '../lib/session';
import { Body, Card, Screen, SectionLabel, Title } from './ui';

/**
 * A module whose records arrive in a later app update (ADR 0072: records in M4, dashboards in M5, chat in M7, push in
 * M8). It says plainly what this person will be able to do here, taken from their published configuration, so the
 * Super Workspace can check its settings on a real phone already.
 */
export function ModuleScreen({ module }: { module: MobileModuleKey }) {
  const s = useSignedIn();
  const th = useTheme();
  const def = MOBILE_MODULE_BY_KEY[module];
  const m = s.config.modules.find((x) => x.key === module);
  // A module this person may not use has no tab; an old link to it goes home.
  if (!m) return <Redirect href="/" />;
  const fields = s.config.fields[module as keyof typeof s.config.fields];
  const actions = [t('View'), m.create && t('Add'), m.edit && t('Edit'), m.delete && t('Delete')].filter(Boolean).join(' · ');
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Ionicons aria-hidden name={MODULE_ICON[module].on} size={28} color={th.primary} />
        <Title>{tMaybe(def.label)}</Title>
      </View>
      <Body muted>{tMaybe(def.description)}</Body>
      <Card accent>
        <Body>{t('This part of the app arrives in the next update. Until then, use SampForce on the web for it.')}</Body>
      </Card>
      <SectionLabel>{t('What you will be able to do here')}</SectionLabel>
      <Card>
        <Body>{actions}</Body>
        {fields ? <Body muted>{t('{n} fields shown for your level', { n: Object.keys(fields).length })}</Body> : null}
      </Card>
    </Screen>
  );
}

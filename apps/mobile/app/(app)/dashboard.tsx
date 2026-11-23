import { MOBILE_DASHBOARD_CARD_DEFS } from '@dealflow/types';
import { useState } from 'react';
import { Body, Card, Screen, SectionLabel, Title } from '../../src/components/ui';
import { t, tMaybe } from '../../src/lib/i18n';
import { greetingFor, LEVEL_LABEL } from '../../src/lib/labels';
import { useController, useSignedIn } from '../../src/lib/session';

/**
 * The home screen: a greeting and the dashboard cards the Super Workspace chose for this level, in its order. The
 * figures on the cards come with the dashboards update (M5); pulling down checks for a new configuration now.
 */
export default function Dashboard() {
  const s = useSignedIn();
  const c = useController();
  const [refreshing, setRefreshing] = useState(false);
  const first = s.session.user.name.split(/\s+/)[0] ?? s.session.user.name;
  const refresh = async () => {
    setRefreshing(true);
    await c.reload();
    setRefreshing(false);
  };
  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Title>{t(greetingFor(new Date().getHours()), { name: first })}</Title>
      <Body muted>
        {s.session.organisation.name} · {tMaybe(LEVEL_LABEL[s.session.level])}
      </Body>
      {s.config.dashboard.length === 0 ? (
        <Card>
          <Body muted>{t('Your administrator has not chosen any cards for your home screen.')}</Body>
        </Card>
      ) : (
        <>
          <SectionLabel>{t('Your home screen')}</SectionLabel>
          {s.config.dashboard.map((d) => (
            <Card key={d.card} accent>
              <Body style={{ fontWeight: '600' }}>{tMaybe(MOBILE_DASHBOARD_CARD_DEFS[d.card].label)}</Body>
              <Body muted>{tMaybe(MOBILE_DASHBOARD_CARD_DEFS[d.card].description)}</Body>
            </Card>
          ))}
          <Body muted style={{ fontSize: 13 }}>
            {t('Figures on these cards arrive in the next app update.')}
          </Body>
        </>
      )}
    </Screen>
  );
}

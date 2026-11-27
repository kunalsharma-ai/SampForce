import { MOBILE_DASHBOARD_CARD_DEFS, type MobileDashboard, WORKSPACE_DASHBOARD_PERIOD_LABEL, WORKSPACE_DASHBOARD_PERIODS, type WorkspaceDashboardPeriod } from '@dealflow/types';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { DashboardCard } from '../../src/components/dashboard';
import { HomeNotificationsCard } from '../../src/components/notification-center';
import { LiveClock, SpecialDayCard } from '../../src/components/live-clock';
import { Chips } from '../../src/components/records';
import { BirthdayCard } from '../../src/components/birthdays';
import { View } from 'react-native';
import { Avatar, Body, Card, ErrorNote, Loading, Screen, Title } from '../../src/components/ui';
import { t, tMaybe } from '../../src/lib/i18n';
import { greetingFor, LEVEL_LABEL } from '../../src/lib/labels';
import { useApi, useController, useSignedIn } from '../../src/lib/session';

/**
 * The home screen: a greeting and the dashboard cards the Super Workspace chose for this level, in its order, with
 * figures counted from the same records as the web (ADR 0072, M5). Pulling down refreshes the figures and checks for
 * a new configuration. There is no recent list.
 */
export default function Dashboard() {
  const s = useSignedIn();
  const c = useController();
  const [period, setPeriod] = useState<WorkspaceDashboardPeriod>('MONTH');
  const data = useApi<MobileDashboard>(`/mobile/dashboard?period=${period}`);
  const [refreshing, setRefreshing] = useState(false);
  const first = s.session.user.name.split(/\s+/)[0] ?? s.session.user.name;
  const reload = data.reload;
  // Fresh figures each time the home screen comes back into view.
  useFocusEffect(useCallback(() => reload(), [reload]));
  const refresh = async () => {
    setRefreshing(true);
    await c.reload();
    data.reload();
    setRefreshing(false);
  };
  // Cards follow the configuration on the phone; figures for a card the server no longer sends are left out.
  const cards = (data.data?.cards ?? []).filter((x) => s.config.dashboard.some((d) => d.card === x.card));
  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Avatar name={s.session.user.name} photoUrl={s.session.user.photoUrl} size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <Title>{t(greetingFor(new Date().getHours()), { name: first })}</Title>
          <Body muted>
            {s.session.organisation.name} · {tMaybe(LEVEL_LABEL[s.session.level])}
          </Body>
        </View>
      </View>
      <LiveClock />
      <SpecialDayCard />
      {/* The second way to a notification (ADR 0075): the newest unread, on the home screen. */}
      {s.config.modules.some((m) => m.key === 'notifications') ? <HomeNotificationsCard /> : null}
      <BirthdayCard />
      {s.config.dashboard.length === 0 ? (
        <Card>
          <Body muted>{t('Your administrator has not chosen any cards for your home screen.')}</Body>
        </Card>
      ) : (
        <>
          <Chips label={t('Period')} value={period} onChange={(v) => v && setPeriod(v as WorkspaceDashboardPeriod)} options={WORKSPACE_DASHBOARD_PERIODS.map((p) => ({ value: p, label: tMaybe(WORKSPACE_DASHBOARD_PERIOD_LABEL[p]) }))} />
          {data.error && !data.data ? <ErrorNote message={data.error} onRetry={data.reload} /> : null}
          {!data.data && data.loading ? <Loading /> : null}
          {data.data
            ? cards.map((card) => <DashboardCard key={card.card} data={card} title={tMaybe(MOBILE_DASHBOARD_CARD_DEFS[card.card].label)} />)
            : null}
        </>
      )}
    </Screen>
  );
}

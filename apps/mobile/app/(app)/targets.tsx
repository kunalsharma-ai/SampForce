import { type MobileTargetRow, TARGET_PERIOD_LABEL } from '@dealflow/types';
import { Redirect, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { TargetLine } from '../../src/components/dashboard';
import { Body, Card, ErrorNote, Loading, Screen } from '../../src/components/ui';
import { currentLanguage, t, tMaybe } from '../../src/lib/i18n';
import { useApi, useSignedIn } from '../../src/lib/session';

const day = (d: string) => {
  try {
    return new Date(`${d}T00:00:00Z`).toLocaleDateString(currentLanguage(), { dateStyle: 'medium', timeZone: 'UTC' });
  } catch {
    return d;
  }
};

/** Sales targets this person can see, with how much is achieved (ADR 0072, M5). Setting targets stays on the web. */
export default function Targets() {
  const s = useSignedIn();
  const data = useApi<MobileTargetRow[]>(s.config.modules.some((m) => m.key === 'targets') ? '/mobile/targets' : null);
  const reload = data.reload;
  useFocusEffect(useCallback(() => reload(), [reload]));
  if (!s.config.modules.some((m) => m.key === 'targets')) return <Redirect href="/" />;
  return (
    <Screen refreshing={data.loading && !!data.data} onRefresh={data.reload}>
      {data.error && !data.data ? <ErrorNote message={data.error} onRetry={data.reload} /> : null}
      {!data.data && data.loading ? <Loading /> : null}
      {data.data && !data.data.length ? <Body muted>{t('No targets are running.')}</Body> : null}
      {data.data?.map((x) => (
        <Card key={x.id} accent>
          <Body style={{ fontWeight: '600' }}>
            {x.workspace} · {tMaybe(TARGET_PERIOD_LABEL[x.period])}
          </Body>
          <Body muted>
            {day(x.startsOn)} – {day(x.endsOn)}
          </Body>
          <TargetLine target={{ metric: x.metric, amount: x.amount, achieved: x.achieved, percent: x.percent }} />
          {x.note ? <Body muted>{x.note}</Body> : null}
        </Card>
      ))}
      <Body muted style={{ fontSize: 13 }}>
        {t('Targets are set on the web.')}
      </Body>
    </Screen>
  );
}

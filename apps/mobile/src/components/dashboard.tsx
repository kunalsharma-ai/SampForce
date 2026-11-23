import { type MobileDashboardCardData, type MobileFigure, TARGET_METRIC_LABEL, type MobileTargetFigure, WORKSPACE_DASHBOARD_PERIOD_LABEL } from '@dealflow/types';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { currentLanguage, t, tMaybe } from '../lib/i18n';
import { useTheme } from '../lib/session';
import { Body } from './ui';

/*
 * One home-screen card (ADR 0072, M5): headline numbers, then bars, a short list or target progress. Charts are drawn
 * with plain views, so they need no chart library and read the same on iOS, Android and the web build.
 */

const number = (n: number) => {
  try {
    return new Intl.NumberFormat(currentLanguage()).format(n);
  } catch {
    return String(n);
  }
};
const when = (iso: string) => {
  try {
    return new Date(iso).toLocaleString(currentLanguage(), { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
};
const PERIOD_LABELS: Record<string, string> = WORKSPACE_DASHBOARD_PERIOD_LABEL;

export function Progress({ percent, label }: { percent: number; label: string }) {
  const th = useTheme();
  const p = Math.max(0, Math.min(100, percent));
  return (
    <View role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)} style={[styles.track, { backgroundColor: th.border }]}>
      <View style={[styles.fill, { width: `${p}%`, backgroundColor: th.primary }]} />
    </View>
  );
}

function Stats({ stats }: { stats: MobileFigure[] }) {
  const th = useTheme();
  return (
    <View style={styles.stats}>
      {stats.map((s) => (
        <View key={s.label} style={styles.stat}>
          <Text style={[styles.statValue, { color: th.text }]}>{s.display ?? number(s.value)}</Text>
          <Text style={[styles.statLabel, { color: th.muted }]}>{tMaybe(s.label)}</Text>
        </View>
      ))}
    </View>
  );
}

function Bars({ bars, chart }: { bars: MobileFigure[]; chart: boolean }) {
  const th = useTheme();
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <View style={{ gap: 8 }}>
      {bars.map((b, i) => {
        const label = PERIOD_LABELS[b.label] ? tMaybe(PERIOD_LABELS[b.label]!) : b.label;
        if (b.dueAt)
          return (
            <View key={`${b.label}-${i}`} style={styles.line}>
              <Body style={{ flex: 1 }}>{label}</Body>
              <Text style={{ color: b.overdue ? th.danger : th.muted, fontSize: 13 }}>{b.overdue ? t('Overdue') : when(b.dueAt)}</Text>
            </View>
          );
        const value = b.display ?? number(b.value);
        const percent = b.percent ?? (b.value / max) * 100;
        return (
          <View key={`${b.label}-${i}`} style={{ gap: 4 }}>
            <View style={styles.line}>
              <Body style={{ flex: 1 }}>{label}</Body>
              <Text style={{ color: th.text, fontSize: 14, fontWeight: '600' }}>
                {value}
                {b.amount ? ` · ${b.amount}` : ''}
                {b.percent !== undefined && b.percent !== null ? ` · ${b.percent}%` : ''}
              </Text>
            </View>
            {chart ? <Progress percent={percent} label={`${label}: ${value}`} /> : null}
          </View>
        );
      })}
    </View>
  );
}

export function TargetLine({ target, chart = true }: { target: MobileTargetFigure; chart?: boolean }) {
  const th = useTheme();
  const label = tMaybe(TARGET_METRIC_LABEL[target.metric]);
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.line}>
        <Body style={{ flex: 1 }}>{label}</Body>
        <Text style={{ color: th.text, fontSize: 14, fontWeight: '600' }}>
          {number(target.achieved)} / {number(target.amount)} · {Math.round(target.percent)}%
        </Text>
      </View>
      {chart ? <Progress percent={target.percent} label={label} /> : null}
    </View>
  );
}

export function DashboardCard({ data, title }: { data: MobileDashboardCardData; title: string }) {
  const th = useTheme();
  const router = useRouter();
  const body = (
    <>
      <View style={styles.line}>
        <Text accessibilityRole="header" style={[styles.title, { color: th.text }]}>
          {title}
        </Text>
      </View>
      {data.stats.length ? <Stats stats={data.stats} /> : null}
      {data.bars.length ? <Bars bars={data.bars} chart={data.showChart} /> : null}
      {data.notices.map((n) => (
        <View key={n.id} style={{ gap: 2 }}>
          <Text style={{ color: th.text, fontSize: 15, fontWeight: '600' }}>{n.title}</Text>
          <Body muted>{n.body.length > 160 ? `${n.body.slice(0, 157)}…` : n.body}</Body>
        </View>
      ))}
      {data.targets.map((x) => (
        <TargetLine key={x.metric} target={x} chart={data.showChart} />
      ))}
      {data.empty ? <Body muted>{tMaybe(data.empty)}</Body> : null}
      {data.opens ? <Text style={{ color: th.primaryText, fontSize: 14, fontWeight: '600' }}>{t('Open')} ›</Text> : null}
    </>
  );
  const style = [styles.card, { backgroundColor: th.card, borderColor: th.border, borderLeftColor: th.accent }];
  if (!data.opens) return <View style={style}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={() => router.push(`/${data.opens}`)} style={({ pressed }) => [...style, pressed && { opacity: 0.8 }]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderLeftWidth: 4, padding: 14, gap: 10 },
  title: { fontSize: 16, fontWeight: '700', flex: 1 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 },
  stat: { width: '50%', gap: 2 },
  statValue: { fontSize: 22, fontWeight: '700' },
  statLabel: { fontSize: 13 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
});

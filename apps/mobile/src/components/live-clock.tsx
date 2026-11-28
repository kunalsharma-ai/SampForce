import { localYmd, type SpecialDayKind, type TodaySpecialDays } from '@dealflow/types';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { currentLanguage, t } from '../lib/i18n';
import { useApi, useTheme } from '../lib/session';

/** The current time, updated on each new second. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const d = new Date();
      setNow(d);
      timer = setTimeout(tick, 1000 - d.getMilliseconds() + 5);
    };
    timer = setTimeout(tick, 1000 - new Date().getMilliseconds() + 5);
    return () => clearTimeout(timer);
  }, []);
  return now;
}

const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(currentLanguage(), o);

/**
 * The live clock on the phone's home screen (Kunal, 2026-11-27), matching the web dashboards: the day, the date with
 * month and year, and the hours, minutes and seconds in the phone's own time zone and language.
 */
export function LiveClock() {
  const th = useTheme();
  const now = useNow();
  const parts = fmt(now, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const zone = fmt(now, { timeZoneName: 'long' }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? '';
  return (
    <View accessibilityRole="timer" accessibilityLabel={t('Current time')} testID="live-clock" style={[styles.clock, { backgroundColor: th.card, borderColor: th.border }]}>
      <View style={[styles.stripe, { backgroundColor: th.primary }]} />
      <View style={styles.row}>
        <View style={{ gap: 4 }}>
          <Text style={[styles.weekday, { color: th.muted }]}>{fmt(now, { weekday: 'long' }).format(now)}</Text>
          <View style={styles.time}>
            <Text style={[styles.hm, { color: th.text }]}>
              {part('hour')}:{part('minute')}
            </Text>
            <Text testID="live-clock-seconds" style={[styles.seconds, { color: th.background, backgroundColor: th.text }]}>
              {part('second')}
            </Text>
            {part('dayPeriod') ? <Text style={[styles.period, { color: th.muted }]}>{part('dayPeriod')}</Text> : null}
          </View>
        </View>
        <View style={styles.meta}>
          <Text testID="live-clock-date" style={[styles.date, { color: th.text }]}>
            {fmt(now, { day: 'numeric', month: 'long', year: 'numeric' }).format(now)}
          </Text>
          <Text style={[styles.zone, { color: th.muted }]} numberOfLines={1}>
            {zone}
          </Text>
        </View>
      </View>
      <View style={[styles.track, { backgroundColor: th.border }]}>
        <View style={[styles.fill, { backgroundColor: th.accent, width: `${((now.getSeconds() + 1) / 60) * 100}%` }]} />
      </View>
    </View>
  );
}

const LABEL: Record<SpecialDayKind, string> = { HOLIDAY: 'Public holiday today', OBSERVANCE: 'Celebrated today', COMPANY: 'Company event today' };
const TINT: Record<SpecialDayKind, [string, string]> = { HOLIDAY: ['#F59E0B', '#E11D48'], OBSERVANCE: ['#0EA5E9', '#8B5CF6'], COMPANY: ['', ''] };

/** Today's public holiday, world day or company event, as on the web dashboards; nothing on an ordinary day. */
export function SpecialDayCard() {
  const th = useTheme();
  const date = localYmd(useNow());
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const q = useApi<TodaySpecialDays>(`/special-days/today?date=${date}&zone=${encodeURIComponent(zone)}`);
  const days = q.data?.date === date ? q.data.days : [];
  if (!days.length) return null;
  const [lead, ...more] = days as [TodaySpecialDays['days'][number], ...TodaySpecialDays['days']];
  const [a, b] = lead.kind === 'COMPANY' ? [th.primary, th.accent] : TINT[lead.kind];
  return (
    <View testID="special-day" accessibilityLabel={`${t(LABEL[lead.kind])}: ${lead.name}`} style={[styles.special, { backgroundColor: th.card, borderColor: a }]}>
      <View style={[styles.stripeSide, { backgroundColor: b }]} />
      <View style={[styles.medal, { backgroundColor: th.dark ? '#1E293B' : '#FFF7ED', borderColor: a }]}>
        <Text style={styles.emoji}>{lead.emoji}</Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.weekday, { color: th.muted }]}>{t(LABEL[lead.kind])}</Text>
        <Text style={[styles.specialName, { color: th.text }]}>{lead.name}</Text>
        {lead.note ? <Text style={{ color: th.muted, fontSize: 14 }}>{lead.note}</Text> : null}
        {more.length ? (
          <View style={styles.chips}>
            {more.map((d) => (
              <Text key={`${d.kind}-${d.name}`} style={[styles.chip, { color: th.text, borderColor: th.border }]}>
                {d.emoji} {d.name}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clock: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14, paddingBottom: 18, overflow: 'hidden' },
  stripe: { position: 'absolute', top: 0, left: 0, right: 0, height: 3 },
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  weekday: { fontSize: 11, fontWeight: '700', letterSpacing: 1.6, textTransform: 'uppercase' },
  time: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hm: { fontSize: 34, fontWeight: '900', fontVariant: ['tabular-nums'] },
  seconds: { fontSize: 17, fontWeight: '900', fontVariant: ['tabular-nums'], paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8, overflow: 'hidden', minWidth: 36, textAlign: 'center' },
  period: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  meta: { alignItems: 'flex-start', gap: 2, flexShrink: 1 },
  date: { fontSize: 15, fontWeight: '700' },
  zone: { fontSize: 12 },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4 },
  fill: { height: 4 },
  special: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, borderWidth: 1, padding: 14, overflow: 'hidden' },
  stripeSide: { position: 'absolute', top: 0, bottom: 0, left: 0, width: 4 },
  medal: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 28 },
  specialName: { fontSize: 19, fontWeight: '900' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: { fontSize: 13, fontWeight: '600', borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
});

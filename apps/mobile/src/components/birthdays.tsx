import type { TodayBirthdays } from '@dealflow/types';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { t } from '../lib/i18n';
import { useApi, useTheme } from '../lib/session';
import { Avatar, Body, Card } from './ui';

function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const firstName = (name: string) => name.split(/\s+/)[0] || name;

/**
 * Today's birthdays on the home screen (ADR 0087), as on the web dashboards: "Happy birthday" on the person's own
 * birthday, and teammates' birthdays with their photos. Nothing shows on a day without birthdays.
 */
export function BirthdayCard() {
  const th = useTheme();
  const [date, setDate] = useState(localDate);
  useEffect(() => {
    const id = setInterval(() => setDate(localDate()), 60_000);
    return () => clearInterval(id);
  }, []);
  const q = useApi<TodayBirthdays>(`/people/birthdays?date=${date}`);
  const people = q.data?.date === date ? q.data.people : [];
  if (!people.length) return null;
  const me = people.find((p) => p.self);
  const others = people.filter((p) => !p.self);
  const names = others.map((p) => p.name).join(', ');
  const title = me
    ? t('Happy birthday, {name}!', { name: firstName(me.name) })
    : others.length === 1
      ? t("It's {name}'s birthday today!", { name: others[0]!.name })
      : t('{count} birthdays today!', { count: others.length });
  const line = me
    ? me.age
      ? t('You turn {age} today. Wishing you a wonderful year ahead, from all of us.', { age: me.age })
      : t('Wishing you a wonderful year ahead, from all of us.')
    : others.length === 1
      ? t('Send your wishes and make the day special.')
      : t('Celebrating {names}. Send your wishes and make the day special.', { names });
  return (
    <Card accent>
      <View accessibilityRole="summary" accessibilityLabel={t('Birthday celebration')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Text style={{ fontSize: 34 }} accessibilityElementsHidden importantForAccessibility="no">
          🎂
        </Text>
        <View style={{ flexDirection: 'row' }}>
          {people.slice(0, 3).map((p, i) => (
            <View key={p.id} style={{ marginLeft: i ? -12 : 0, borderRadius: 24, borderWidth: 3, borderColor: th.card }}>
              <Avatar name={p.name} photoUrl={p.photoUrl} size={42} label={p.name} />
            </View>
          ))}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: th.accent, fontWeight: '800', fontSize: 17 }}>🎉 {title}</Text>
          <Body muted>{line}</Body>
          {me && others.length ? <Body>{t('Also celebrating today: {names}', { names })}</Body> : null}
        </View>
      </View>
    </Card>
  );
}

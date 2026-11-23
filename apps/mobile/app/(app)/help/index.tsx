import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Body, Button, Card, ErrorNote, Field, Loading, Screen, SectionLabel } from '../../../src/components/ui';
import type { HelpResponse } from '../../../src/lib/help-types';
import { t } from '../../../src/lib/i18n';
import { useApi, useTheme } from '../../../src/lib/session';

/**
 * The Help Center on the phone (ADR 0073): the same questions and guides as on the web, narrowed by the server to
 * what this person's plan, level and role let them use, in their language. "Ask a question" raises a support ticket.
 */
export default function Help() {
  const router = useRouter();
  const th = useTheme();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);
  const { data, error, loading, reload } = useApi<HelpResponse>(query.length >= 2 ? `/help?q=${encodeURIComponent(query)}` : '/help');

  const faqs = useMemo(() => {
    if (!data) return [];
    if (data.results && query.length >= 2) {
      const hits = new Set(data.results.filter((r) => r.kind === 'faq').map((r) => r.id));
      return data.faqs.filter((f) => hits.has(f.id));
    }
    return category ? data.faqs.filter((f) => f.category === category) : data.faqs.slice(0, 8);
  }, [data, query, category]);
  const guides = useMemo(() => {
    if (!data) return [];
    if (data.results && query.length >= 2) {
      const hits = new Set(data.results.filter((r) => r.kind === 'guide').map((r) => r.id));
      return data.guides.filter((g) => hits.has(g.id));
    }
    return category ? data.guides.filter((g) => g.category === category) : [];
  }, [data, query, category]);

  return (
    <Screen>
      <Field label={t('Search help')} value={q} onChangeText={setQ} placeholder={t('For example: add a follow-up')} returnKeyType="search" autoCorrect={false} />
      {error ? <ErrorNote message={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data && query.length < 2 ? (
        <>
          <SectionLabel>{t('Topics')}</SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[{ id: null as string | null, title: t('Popular') }, ...data.categories.map((c) => ({ id: c.id as string | null, title: c.title }))].map((c) => (
              <Pressable
                key={c.id ?? 'popular'}
                accessibilityRole="button"
                accessibilityState={{ selected: category === c.id }}
                onPress={() => setCategory(c.id)}
                style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: category === c.id ? th.primary : th.border, backgroundColor: category === c.id ? th.primary : th.card }}
              >
                <Body style={{ fontSize: 14, color: category === c.id ? th.onPrimary : th.text }}>{c.title}</Body>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      {data ? (
        <>
          <SectionLabel>{query.length >= 2 ? t('Results') : t('Questions')}</SectionLabel>
          {faqs.length === 0 && guides.length === 0 ? <Body muted>{t('Nothing found. Try other words, or ask a question below.')}</Body> : null}
          {faqs.map((f) => (
            <Card key={f.id}>
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: open === f.id }} onPress={() => setOpen(open === f.id ? null : f.id)}>
                <Body style={{ fontWeight: '600' }}>{f.question}</Body>
              </Pressable>
              {open === f.id ? <Body muted>{f.answer}</Body> : null}
            </Card>
          ))}
          {guides.map((g) => (
            <Card key={g.id} accent>
              <Body style={{ fontWeight: '600' }}>{g.title}</Body>
              <Body muted>{g.what}</Body>
              {open === g.id ? (
                <>
                  <Body>{g.how}</Body>
                  <Body muted>{g.where}</Body>
                </>
              ) : (
                <Pressable accessibilityRole="button" onPress={() => setOpen(g.id)}>
                  <Body style={{ color: th.primary }}>{t('Show how')}</Body>
                </Pressable>
              )}
            </Card>
          ))}
        </>
      ) : null}
      <SectionLabel>{t('Still need help?')}</SectionLabel>
      <Button label={t('Ask a question')} onPress={() => router.push('/help/tickets/new')} />
      <Button kind="secondary" label={t('Your questions')} onPress={() => router.push('/help/tickets')} />
    </Screen>
  );
}

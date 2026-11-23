import type { SupportTicketDetail } from '@dealflow/types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Body, Button, ErrorNote, Field, Screen, SectionLabel } from '../../../../src/components/ui';
import { ApiError } from '../../../../src/lib/api';
import type { HelpResponse } from '../../../../src/lib/help-types';
import { t } from '../../../../src/lib/i18n';
import { useApi, useController, useTheme } from '../../../../src/lib/session';

/**
 * Raises a question with the level above this person (ADR 0071 part 5): an executive's goes to their manager, a
 * manager's to the Super Workspace, the Super Workspace's to SampForce support. The server marks it as from the phone.
 */
export default function NewTicket() {
  const c = useController();
  const th = useTheme();
  const router = useRouter();
  const help = useApi<HelpResponse>('/help');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('other');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const send = async () => {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const ticket = await c.api.post<SupportTicketDetail>('/support/tickets', { subject: subject.trim(), body: body.trim(), category });
      router.replace(`/help/tickets/${ticket.id}`);
    } catch (e) {
      if (c.report(e)) return;
      if (e instanceof ApiError && e.details.length) setFieldErrors(Object.fromEntries(e.details.map((d) => [d.path, d.message])));
      setError(e instanceof Error ? e.message : t('Something went wrong. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const topics = [{ id: 'other', title: t('Something else') }, ...(help.data?.categories ?? []).map((x) => ({ id: x.id, title: x.title }))];
  return (
    <Screen>
      <Body muted>{t('Your question goes to the person who looks after your workspace. You will see the answer here and on the web.')}</Body>
      <Field label={t('Subject')} value={subject} onChangeText={setSubject} maxLength={160} error={fieldErrors.subject} />
      <Field label={t('Your question')} value={body} onChangeText={setBody} multiline maxLength={5000} error={fieldErrors.body} />
      <SectionLabel>{t('Topic')}</SectionLabel>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {topics.map((x) => (
          <Pressable
            key={x.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: category === x.id }}
            onPress={() => setCategory(x.id)}
            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: category === x.id ? th.primary : th.border, backgroundColor: category === x.id ? th.primary : th.card }}
          >
            <Body style={{ fontSize: 14, color: category === x.id ? th.onPrimary : th.text }}>{x.title}</Body>
          </Pressable>
        ))}
      </View>
      {error ? <ErrorNote message={error} /> : null}
      <Button label={t('Send')} busy={busy} disabled={subject.trim().length < 3 || body.trim().length < 5} onPress={send} />
    </Screen>
  );
}

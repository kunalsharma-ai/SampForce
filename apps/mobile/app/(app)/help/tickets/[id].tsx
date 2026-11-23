import type { SupportTicketDetail } from '@dealflow/types';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Body, Button, Card, ErrorNote, Field, Loading, Screen, Title } from '../../../../src/components/ui';
import { HANDLER_LABEL, STATUS_LABEL } from '../../../../src/lib/help-types';
import { t, tMaybe } from '../../../../src/lib/i18n';
import { useApi, useController, useTheme } from '../../../../src/lib/session';

/** One question with its replies. The person who raised it can reply, close it, or reopen it. */
export default function Ticket() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useController();
  const th = useTheme();
  const loaded = useApi<SupportTicketDetail>(`/support/tickets/${id}`);
  const [ticket, setTicket] = useState<SupportTicketDetail | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState<'reply' | 'status' | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setTicket(loaded.data), [loaded.data]);

  const act = async (kind: 'reply' | 'status', fn: () => Promise<SupportTicketDetail>) => {
    setBusy(kind);
    setError(null);
    try {
      setTicket(await fn());
      if (kind === 'reply') setReply('');
    } catch (e) {
      if (!c.report(e)) setError(e instanceof Error ? e.message : t('Something went wrong. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  if (loaded.error && !ticket) return <Screen><ErrorNote message={loaded.error} onRetry={loaded.reload} /></Screen>;
  if (!ticket) return <Screen><Loading /></Screen>;
  const handler = ticket.handler.level === 'CONSOLE' ? tMaybe(HANDLER_LABEL.CONSOLE!) : ticket.handler.name;
  return (
    <Screen refreshing={loaded.loading} onRefresh={loaded.reload}>
      <Title>{ticket.subject}</Title>
      <Body muted>
        #{ticket.number} · {tMaybe(STATUS_LABEL[ticket.status] ?? ticket.status)} · {t('Handled by {name}', { name: handler })}
      </Body>
      {ticket.messages.map((m) => (
        <View key={m.id} style={{ alignItems: m.mine ? 'flex-end' : 'flex-start' }}>
          <View style={{ maxWidth: '88%', borderRadius: 12, padding: 12, gap: 4, backgroundColor: m.mine ? th.primary : th.card, borderWidth: m.mine ? 0 : 1, borderColor: th.border }}>
            <Body style={{ fontSize: 13, color: m.mine ? th.onPrimary : th.muted }}>
              {m.mine ? t('You') : m.authorKind === 'OPERATOR' ? tMaybe(HANDLER_LABEL.CONSOLE!) : (m.author?.name ?? handler)} · {new Date(m.createdAt).toLocaleString()}
            </Body>
            <Body style={{ color: m.mine ? th.onPrimary : th.text }}>{m.body}</Body>
          </View>
        </View>
      ))}
      {ticket.resolutionNote ? (
        <Card accent>
          <Body style={{ fontWeight: '600' }}>{t('Resolution')}</Body>
          <Body>{ticket.resolutionNote}</Body>
        </Card>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}
      {ticket.canReply && ticket.status !== 'CLOSED' ? (
        <>
          <Field label={t('Reply')} value={reply} onChangeText={setReply} multiline maxLength={5000} />
          <Button label={t('Send reply')} busy={busy === 'reply'} disabled={!reply.trim()} onPress={() => act('reply', () => c.api.post(`/support/tickets/${ticket.id}/messages`, { body: reply.trim() }))} />
        </>
      ) : null}
      {ticket.mine ? (
        ticket.status === 'RESOLVED' || ticket.status === 'CLOSED' ? (
          <Button kind="secondary" label={t('Reopen')} busy={busy === 'status'} onPress={() => act('status', () => c.api.patch(`/support/tickets/${ticket.id}`, { status: 'SUBMITTED' }))} />
        ) : (
          <Button kind="secondary" label={t('Close: my question is answered')} busy={busy === 'status'} onPress={() => act('status', () => c.api.patch(`/support/tickets/${ticket.id}`, { status: 'RESOLVED' }))} />
        )
      ) : null}
    </Screen>
  );
}

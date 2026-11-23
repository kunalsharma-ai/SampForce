import type { SupportTicketRow } from '@dealflow/types';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Body, Button, Card, ErrorNote, Loading, Row, Screen } from '../../../../src/components/ui';
import { HANDLER_LABEL, STATUS_LABEL } from '../../../../src/lib/help-types';
import { t, tMaybe } from '../../../../src/lib/i18n';
import { useApi } from '../../../../src/lib/session';

/** The questions this person raised, from the phone or the web, newest activity first. */
export default function Tickets() {
  const router = useRouter();
  const { data, error, loading, reload } = useApi<SupportTicketRow[]>('/support/tickets?scope=mine');
  // Back from a question: show its new status and replies.
  useFocusEffect(useCallback(() => reload(), [])); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Screen refreshing={loading && !!data} onRefresh={reload}>
      {error ? <ErrorNote message={error} onRetry={reload} /> : null}
      {loading && !data ? <Loading /> : null}
      {data && data.length === 0 ? <Body muted>{t('You have not asked anything yet.')}</Body> : null}
      {data && data.length > 0 ? (
        <Card>
          {data.map((r, i) => (
            <Row
              key={r.id}
              icon={r.status === 'ANSWERED' ? 'chatbox' : r.status === 'CLOSED' ? 'checkmark-circle-outline' : 'chatbox-outline'}
              label={`#${r.number} ${r.subject}`}
              detail={`${tMaybe(STATUS_LABEL[r.status] ?? r.status)} · ${r.handler.level === 'CONSOLE' ? tMaybe(HANDLER_LABEL.CONSOLE!) : r.handler.name}${r.lastAuthorKind && r.lastAuthorKind !== 'USER' ? ` · ${t('New reply')}` : ''}`}
              onPress={() => router.push(`/help/tickets/${r.id}`)}
              last={i === data.length - 1}
            />
          ))}
        </Card>
      ) : null}
      <Button label={t('Ask a question')} onPress={() => router.push('/help/tickets/new')} />
    </Screen>
  );
}

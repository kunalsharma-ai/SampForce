'use client';

import type { ChatConversationRow, OperatorTenantRow } from '@dealflow/types';
import { Skeleton } from '@dealflow/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { ChatWorkspace, SupportLinePicker } from '@/components/chat/chat-workspace';
import { PageHeader } from '@/components/page-header';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { operatorRealm } from '@/lib/chat';
import { useOperator } from '../operator-shell';

/** Super admins answer every workspace's support line here (ADR 0061). */
export default function OperatorChat() {
  const me = useOperator();
  const qc = useQueryClient();
  const realm = React.useMemo(() => (me.data ? operatorRealm(me.data.id) : null), [me.data]);
  const [opened, setOpened] = React.useState<string | null>(null);
  const [error, setError] = React.useState<Error | null>(null);
  const tenants = useQuery({ enabled: !!me.data, queryKey: ['operator', 'tenants', ''], queryFn: () => api<OperatorTenantRow[]>('/operator/tenants') });
  if (!realm) return <Skeleton className="h-96" />;
  const open = async (tenantId: string) => {
    setError(null);
    try {
      const c = await api<ChatConversationRow>(`/operator/chat/workspaces/${tenantId}/support`, { method: 'POST' });
      await qc.invalidateQueries({ queryKey: ['chat', realm.owner] });
      setOpened(c.id);
    } catch (e) {
      setError(e as Error);
    }
  };
  return (
    <>
      <PageHeader title="Support chat" description="Every workspace's support line. Workspace admins write here from Team chat; anything you send reaches them live, or as soon as they are back online." />
      <ChatWorkspace
        realm={realm}
        initialId={opened}
        header={
          <div className="space-y-1">
            <SupportLinePicker tenants={(tenants.data ?? []).filter((x) => x.status === 'ACTIVE')} onOpen={(id) => void open(id)} />
            <ErrorText error={error} />
          </div>
        }
      />
    </>
  );
}

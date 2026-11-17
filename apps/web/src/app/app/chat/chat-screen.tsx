'use client';

import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { Skeleton } from '@dealflow/ui';
import { ChatWorkspace } from '@/components/chat/chat-workspace';
import { userRealm } from '@/lib/chat';
import { useSession } from '@/lib/session';

/** `?c=<conversation id>` opens one conversation, as links from elsewhere do. */
export function ChatPage() {
  const { data } = useSession();
  const params = useSearchParams();
  const realm = React.useMemo(() => (data ? userRealm(data.tenant.id, data.user.id) : null), [data]);
  if (!realm) return <Skeleton className="h-96" />;
  return <ChatWorkspace realm={realm} initialId={params.get('c')} />;
}

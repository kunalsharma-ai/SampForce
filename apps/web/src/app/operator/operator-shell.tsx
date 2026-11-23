'use client';

import { Badge, Button } from '@dealflow/ui';
import { type OperatorMe, SUPPORT_WAITING_STATUSES } from '@dealflow/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Logo } from '@/components/logo';
import { api, ApiError } from '@/lib/api';
import { ChatNotices } from '@/components/chat/chat-notices';
import { operatorRealm, useChatLive, useChatUnread } from '@/lib/chat';
import { useOperatorTicketCounts } from '@/lib/support';
import * as React from 'react';

export function useOperator(enabled = true) {
  return useQuery({ enabled, queryKey: ['operator', 'me'], queryFn: () => api<OperatorMe>('/operator/me'), retry: false });
}

/** Support chat in the console menu, with its unread count; keeps the live connection open on every console page. */
function OperatorChatLink({ active }: { active: boolean }) {
  const me = useOperator();
  const realm = React.useMemo(() => (me.data ? operatorRealm(me.data.id) : null), [me.data]);
  useChatLive(realm);
  const unread = useChatUnread(realm).data?.total ?? 0;
  return (
    <>
      <ChatNotices />
      <Link href="/operator/chat" className={active ? 'font-medium' : 'text-muted-foreground hover:text-foreground'} data-chat-unread={unread}>
        Support chat
        {unread > 0 && <span className="ms-1 rounded-full bg-critical px-1.5 text-[11px] font-semibold text-background">{unread}</span>}
      </Link>
    </>
  );
}

/** Support tickets raised from Help in every client's workspaces, with how many wait for an answer (ADR 0073). */
function OperatorTicketsLink({ active }: { active: boolean }) {
  const counts = useOperatorTicketCounts();
  const waiting = counts.data ? SUPPORT_WAITING_STATUSES.reduce((n, st) => n + counts.data[st], 0) : 0;
  return (
    <Link href="/operator/support" className={active ? 'font-medium' : 'text-muted-foreground hover:text-foreground'} data-tickets-waiting={waiting}>
      Support tickets
      {waiting > 0 && <span className="ms-1 rounded-full bg-warning px-1.5 text-[11px] font-semibold text-background">{waiting}</span>}
    </Link>
  );
}

export function OperatorShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const onLogin = path === '/operator/login';
  const me = useOperator(!onLogin);

  useEffect(() => {
    if (!onLogin && me.error instanceof ApiError && me.error.status === 401) router.replace('/operator/login');
  }, [me.error, onLogin, router]);

  const signOut = async () => {
    await api('/operator/logout', { method: 'POST' }).catch(() => undefined);
    qc.removeQueries({ queryKey: ['operator'] });
    router.replace('/operator/login');
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3 sm:px-6">
          <Logo compact />
          <span className="font-semibold">Console Admin</span>
          <Badge tone="warning">Platform staff</Badge>
          {me.data && (
            <nav aria-label="Operator" className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
              <Link href="/operator" className={path === '/operator' ? 'font-medium' : 'text-muted-foreground hover:text-foreground'}>
                Overview
              </Link>
              <Link href="/operator/clients" className={path.startsWith('/operator/clients') || path.startsWith('/operator/tenants') ? 'font-medium' : 'text-muted-foreground hover:text-foreground'}>
                Clients
              </Link>
              <Link href="/operator/plans" className={path === '/operator/plans' ? 'font-medium' : 'text-muted-foreground hover:text-foreground'}>
                Plans
              </Link>
              <Link href="/operator/mobile" className={path.startsWith('/operator/mobile') ? 'font-medium' : 'text-muted-foreground hover:text-foreground'}>
                Mobile app
              </Link>
              <OperatorChatLink active={path === '/operator/chat'} />
              <OperatorTicketsLink active={path === '/operator/support'} />
              <Link href="/operator/audit" className={path === '/operator/audit' ? 'font-medium' : 'text-muted-foreground hover:text-foreground'}>
                Operator log
              </Link>
              <Link href="/operator/providers" className={path === '/operator/providers' ? 'font-medium' : 'text-muted-foreground hover:text-foreground'}>
                Providers
              </Link>
              <Link href="/operator/settings" className={path === '/operator/settings' ? 'font-medium' : 'text-muted-foreground hover:text-foreground'}>
                Settings
              </Link>
              <Link href="/operator/help" className={path.startsWith('/operator/help') ? 'font-medium' : 'text-muted-foreground hover:text-foreground'}>
                Help
              </Link>
            </nav>
          )}
          {me.data && (
            <div className="ms-auto flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                {me.data.name} · {me.data.role === 'ADMIN' ? 'Admin' : 'Support'}
              </span>
              <Button size="sm" variant="outline" onClick={signOut}>
                Sign out
              </Button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {me.error instanceof ApiError && me.error.status === 404 ? (
          <p className="text-sm text-muted-foreground">The operator console is not enabled on this deployment.</p>
        ) : (
          children
        )}
      </main>
    </div>
  );
}

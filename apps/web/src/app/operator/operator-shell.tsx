'use client';

import { Badge, Dialog, DialogContent, DialogTitle } from '@dealflow/ui';
import {
  type ConsoleClientDetail,
  type ConsolePreferencesUpdate,
  normaliseConsolePreferences,
  type OperatorMe,
  type OperatorPermission,
  SUPPORT_WAITING_STATUSES,
} from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import * as React from 'react';
import { useEffect, useState } from 'react';
import { ChatNotices } from '@/components/chat/chat-notices';
import { ClientAvatar } from '@/components/console/client-avatar';
import { ConsoleCommand } from '@/components/console/console-command';
import { consolePagesFor, crumbsFor } from '@/components/console/console-nav';
import { ConsoleSidebar, ConsoleSidebarNav } from '@/components/console/console-sidebar';
import { ConsoleTopBar } from '@/components/console/console-top-bar';
import { useUnreadNotifications } from '@/components/console/notifications';
import { Logo } from '@/components/logo';
import { api, ApiError } from '@/lib/api';
import { operatorRealm, useChatLive, useChatUnread } from '@/lib/chat';
import { isDarkNow, useConsolePaint } from '@/lib/console-appearance';
import { playConsoleSound } from '@/lib/console-sound';
import { useOperatorTicketCounts } from '@/lib/support';
import { WelcomeScene } from '@/components/sign-in/welcome-overlay';
import { StateBadge } from './console-ui';

const ME_KEY = ['operator', 'me'] as const;

const SIGNED_OUT_PAGES = ['/operator/login', '/operator/forgot-password', '/operator/set-password'];

/** Whether the signed-in operator's role allows something (ADR 0074). The API checks it again on every request. */
export function can(me: Pick<OperatorMe, 'permissions'> | undefined | null, permission: OperatorPermission): boolean {
  return !!me?.permissions?.includes(permission);
}

export function useOperator(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ME_KEY,
    queryFn: () => api<OperatorMe>('/operator/me'),
    retry: false,
  });
}

/** Saves a palette, mode, sidebar or sound change for the operator, showing it at once (ADR 0074). */
function usePreferenceSaver() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['operator', 'preferences'],
    mutationFn: (p: ConsolePreferencesUpdate) =>
      api('/operator/me/preferences', { method: 'PUT', json: p }),
    onMutate: (p) => {
      const before = qc.getQueryData<OperatorMe>(ME_KEY);
      if (before)
        qc.setQueryData<OperatorMe>(ME_KEY, {
          ...before,
          preferences: normaliseConsolePreferences({ ...before.preferences, ...p }),
        });
      return { before };
    },
    onError: (_e, _p, ctx) => {
      if (ctx?.before) qc.setQueryData(ME_KEY, ctx.before);
    },
  });
}

/** Plays the operator's feedback sounds, when they are on, as Console changes save or fail. */
function useMutationSounds(on: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!on) return;
    return qc.getMutationCache().subscribe((event) => {
      if (event.type !== 'updated' || event.mutation.options.mutationKey?.[1] === 'preferences')
        return;
      if (event.action.type === 'success') playConsoleSound('success');
      if (event.action.type === 'error') playConsoleSound('error');
    });
  }, [on, qc]);
}

/** Chat unread and tickets waiting, for the menu badges; keeps the support chat connection open on every page. */
function useBadgeCounts(me: OperatorMe | undefined) {
  // Only operators who handle support have the chat and ticket counts (ADR 0074).
  const handles = can(me, 'support.handle');
  const realm = React.useMemo(() => (me && handles ? operatorRealm(me.id) : null), [me, handles]);
  useChatLive(realm);
  const chat = useChatUnread(realm).data?.total ?? 0;
  const counts = useOperatorTicketCounts(handles);
  const tickets = counts.data
    ? SUPPORT_WAITING_STATUSES.reduce((n, st) => n + counts.data[st], 0)
    : 0;
  const notifications = useUnreadNotifications(!!me).data?.unread ?? 0;
  return { chat, tickets, notifications };
}

/** Keeps the client's name, plan and status in view on every page inside that client (ADR 0074). */
function ClientContextBar({ id }: { id: string }) {
  const client = useQuery({
    queryKey: ['operator', 'client', id],
    queryFn: () => api<ConsoleClientDetail>(`/operator/clients/${id}`),
  });
  if (!client.data) return null;
  const c = client.data;
  return (
    <div
      className="flex flex-wrap items-center gap-3 border-b border-border/70 bg-surface/60 px-4 py-2 text-sm sm:px-6"
      data-client-context={c.id}
    >
      <ClientAvatar name={c.name} logoUrl={c.logoUrl} size="sm" />
      <Link href={`/operator/clients/${c.id}`} className="font-medium hover:underline">
        {c.name}
      </Link>
      <StateBadge state={c.state} />
      {c.subscription && <span className="text-muted-foreground">{c.subscription.planName}</span>}
      <span className="text-muted-foreground tabular">
        {c.people} {c.people === 1 ? 'person' : 'people'} · {c.usage.managers} manager ·{' '}
        {c.usage.executives} executive workspaces
      </span>
    </div>
  );
}

export function OperatorShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  // Signed-out pages: sign in, forgot password, and choosing a password from a link.
  const onLogin = SIGNED_OUT_PAGES.includes(path);
  const me = useOperator(!onLogin);
  const save = usePreferenceSaver();
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const prefs = me.data?.preferences ?? null;
  useConsolePaint(prefs);
  useMutationSounds(!!prefs?.sound);
  const counts = useBadgeCounts(me.data);

  useEffect(() => {
    if (!onLogin && me.error instanceof ApiError && me.error.status === 401)
      router.replace('/operator/login');
  }, [me.error, onLogin, router]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && me.data) {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [me.data]);

  useEffect(() => setMenuOpen(false), [path]);

  // When the policy requires two-step verification and it is not on yet, only the account page opens.
  useEffect(() => {
    if (me.data?.mfaSetupRequired && path !== '/operator/account') router.replace('/operator/account?setup=1');
  }, [me.data?.mfaSetupRequired, path, router]);

  // A role without the overview (a support-only custom role) starts on the first page it may open.
  useEffect(() => {
    if (path === '/operator' && me.data && !can(me.data, 'clients.view')) {
      // Notifications is everyone's; a support-only role starts on its first working page instead.
      const first = consolePagesFor(me.data.permissions).find((p) => p.href !== '/operator/notifications');
      if (first) router.replace(first.href);
    }
  }, [path, me.data, router]);

  const signOut = async () => {
    await api('/operator/logout', { method: 'POST' }).catch(() => undefined);
    qc.removeQueries({ queryKey: ['operator'] });
    router.replace('/operator/login');
  };

  const clientId = /^\/operator\/clients\/([^/]+)/.exec(path)?.[1] ?? null;
  // The same query the client page and the client bar use, so the breadcrumb shows the client's name once it loads.
  const clientName = useQuery({
    enabled: !!clientId && !!me.data,
    queryKey: ['operator', 'client', clientId],
    queryFn: () => api<ConsoleClientDetail>(`/operator/clients/${clientId}`),
  }).data?.name;
  const crumbs = crumbsFor(
    path,
    clientId && clientName ? { [`/operator/clients/${clientId}`]: clientName } : {},
  );

  if (onLogin) return <div className="min-h-screen bg-background">{children}</div>;

  if (me.error instanceof ApiError && me.error.status === 404)
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <p className="text-sm text-muted-foreground">
          The operator console is not enabled on this deployment.
        </p>
      </main>
    );

  return (
    <div className="flex min-h-screen bg-background">
      <ChatNotices />
      <WelcomeScene variant="console" name={me.data ? me.data.name || me.data.email : null} />
      {me.data && (
        <ConsoleSidebar
          collapsed={me.data.preferences.sidebarCollapsed}
          counts={counts}
          permissions={me.data.permissions}
          onToggle={() => save.mutate({ sidebarCollapsed: !me.data!.preferences.sidebarCollapsed })}
        />
      )}
      <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogContent side="left" className="flex w-[280px] flex-col p-0 pt-4">
          <DialogTitle className="flex items-center gap-2 px-4 pb-4 text-sm font-semibold">
            <Logo compact /> SampForce Console
          </DialogTitle>
          {me.data && (
            <ConsoleSidebarNav
              collapsed={false}
              counts={counts}
              permissions={me.data.permissions}
              onNavigate={() => setMenuOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
      <div className="flex min-w-0 flex-1 flex-col">
        {me.data ? (
          <ConsoleTopBar
            me={me.data}
            crumbs={crumbs}
            onSearch={() => setSearchOpen(true)}
            onMenu={() => setMenuOpen(true)}
            onPreferences={(p) => save.mutate(p)}
            onSignOut={signOut}
          />
        ) : (
          <header className="flex h-16 items-center gap-3 border-b border-border/70 px-6">
            <Logo compact />
            <span className="font-semibold">SampForce Console</span>
            <Badge tone="warning">Platform staff</Badge>
          </header>
        )}
        {clientId && me.data && <ClientContextBar id={clientId} />}
        <motion.main
          key={path}
          initial={{ y: 6 }}
          animate={{ y: 0 }}
          transition={{ duration: 0.15 }}
          className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8"
        >
          {children}
        </motion.main>
      </div>
      {me.data && (
        <ConsoleCommand
          open={searchOpen}
          onOpenChange={setSearchOpen}
          permissions={me.data.permissions}
          dark={isDarkNow(me.data.preferences.mode)}
          sound={me.data.preferences.sound}
          onPreferences={(p) => save.mutate(p)}
        />
      )}
    </div>
  );
}

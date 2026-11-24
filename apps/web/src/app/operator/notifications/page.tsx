'use client';

import { Button, Card } from '@dealflow/ui';
import type { OperatorNotificationPage, OperatorNotificationPrefRow, OperatorNotificationType } from '@dealflow/types';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellOff, CheckCheck } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ConsoleEmpty, ConsoleError, ConsoleLoading } from '@/components/console/console-states';
import { NotificationItem, useNotificationActions, useUnreadNotifications } from '@/components/console/notifications';
import { PageHeader } from '@/components/page-header';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { useOperator } from '../operator-shell';

const PAGE = 30;
const PREFS_KEY = ['operator', 'notifications', 'prefs'] as const;

/**
 * Console notifications (ADR 0074, C3b): everything sent to this operator, newest first, and how they want each type.
 * Every operator has this page; the types listed are only those their role receives.
 */
export default function OperatorNotificationsPage() {
  return (
    <Suspense>
      <NotificationsPage />
    </Suspense>
  );
}

function NotificationsPage() {
  const me = useOperator();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = params.get('tab') === 'preferences' ? 'preferences' : params.get('tab') === 'unread' ? 'unread' : 'all';
  const go = (t: string) => router.replace(t === 'all' ? pathname : `${pathname}?tab=${t}`, { scroll: false });
  if (!me.data) return <ConsoleLoading />;

  return (
    <>
      <PageHeader title="Notifications" description="What needs you across SampForce, for the work your role covers. Choose how each kind reaches you under Preferences." />
      <div role="tablist" aria-label="Notifications" className="mb-6 inline-flex rounded-xl border border-border bg-surface p-1">
        {(
          [
            ['all', 'All'],
            ['unread', 'Unread'],
            ['preferences', 'Preferences'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            onClick={() => go(key)}
            className="rounded-lg px-4 py-1.5 text-sm font-medium text-muted-foreground aria-selected:bg-primary aria-selected:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {label}
          </button>
        ))}
      </div>
      <section role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'preferences' ? <Preferences /> : <List unreadOnly={tab === 'unread'} />}
      </section>
    </>
  );
}

function List({ unreadOnly }: { unreadOnly: boolean }) {
  const unread = useUnreadNotifications().data?.unread ?? 0;
  const { read, readAll } = useNotificationActions();
  const list = useInfiniteQuery({
    queryKey: ['operator', 'notifications', 'page', unreadOnly],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: String(PAGE) });
      if (unreadOnly) p.set('unread', 'true');
      if (pageParam) p.set('before', pageParam);
      return api<OperatorNotificationPage>(`/operator/me/notifications?${p}`);
    },
    getNextPageParam: (last) => last.next,
    refetchInterval: 30_000,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Card className="p-2 sm:p-3">
      <div className="flex items-center justify-between gap-3 border-b border-border px-2 pb-3 pt-1">
        <p className="text-sm text-muted-foreground" data-unread-count={unread}>
          {unread ? `${unread} unread` : 'Nothing unread'}
        </p>
        <Button variant="outline" size="sm" onClick={() => readAll.mutate()} disabled={!unread || readAll.isPending}>
          <CheckCheck className="size-4" aria-hidden /> Mark all read
        </Button>
      </div>
      {list.isError ? (
        <ConsoleError error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isPending ? (
        <ConsoleLoading label="Loading notifications" />
      ) : items.length === 0 ? (
        <ConsoleEmpty
          icon={BellOff}
          title={unreadOnly ? 'You are all caught up' : 'No notifications yet'}
          description={unreadOnly ? 'Everything sent to you has been read.' : 'New clients, failed payments, tickets and the other kinds your role covers appear here as they happen.'}
        />
      ) : (
        <ul className="divide-y divide-border/60 pt-1" aria-label="Notifications, newest first">
          {items.map((n) => (
            <li key={n.id} className="py-0.5">
              <NotificationItem n={n} onOpen={(x) => !x.readAt && read.mutate(x.id)} />
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <div className="px-2 pb-1 pt-3">
          <Button variant="outline" size="sm" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
            {list.isFetchingNextPage ? 'Loading…' : 'Show older notifications'}
          </Button>
        </div>
      )}
    </Card>
  );
}

function Preferences() {
  const qc = useQueryClient();
  const prefs = useQuery({ queryKey: PREFS_KEY, queryFn: () => api<OperatorNotificationPrefRow[]>('/operator/me/notification-preferences') });
  const save = useMutation({
    mutationKey: ['operator', 'preferences', 'notifications'],
    mutationFn: (p: { type: OperatorNotificationType; inApp: boolean; email: boolean }) =>
      api<OperatorNotificationPrefRow[]>('/operator/me/notification-preferences', { method: 'PUT', json: { prefs: [p] } }),
    // The box changes at once; a refused save puts it back.
    onMutate: (p) => {
      const before = qc.getQueryData<OperatorNotificationPrefRow[]>(PREFS_KEY);
      qc.setQueryData<OperatorNotificationPrefRow[]>(PREFS_KEY, (rows) => rows?.map((r) => (r.type === p.type ? { ...r, ...p } : r)));
      return { before };
    },
    onError: (_e, _p, ctx) => ctx?.before && qc.setQueryData(PREFS_KEY, ctx.before),
    onSuccess: (rows) => qc.setQueryData(PREFS_KEY, rows),
  });

  if (prefs.isError) return <ConsoleError error={prefs.error} onRetry={() => void prefs.refetch()} />;
  if (prefs.isPending) return <ConsoleLoading label="Loading preferences" />;
  const set = (row: OperatorNotificationPrefRow, change: Partial<Pick<OperatorNotificationPrefRow, 'inApp' | 'email'>>) =>
    save.mutate({ type: row.type, inApp: row.inApp, email: row.email, ...change });

  return (
    <Card className="overflow-hidden p-0">
      <table className="w-full text-sm" data-notification-prefs>
        <caption className="sr-only">How each kind of notification reaches you</caption>
        <thead className="bg-muted/50 text-start text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 text-start font-medium">
              Notification
            </th>
            <th scope="col" className="w-24 px-4 py-3 text-center font-medium">
              Console
            </th>
            <th scope="col" className="w-24 px-4 py-3 text-center font-medium">
              Email
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {prefs.data.map((row) => (
            <tr key={row.type} data-pref={row.type}>
              <th scope="row" className="px-4 py-3 text-start font-normal">
                <span className="block font-medium">{row.label}</span>
                <span className="block text-xs text-muted-foreground">{row.description}</span>
              </th>
              <td className="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  aria-label={`${row.label} in the Console`}
                  checked={row.inApp}
                  onChange={(e) => set(row, { inApp: e.target.checked })}
                  data-channel="inApp"
                />
              </td>
              <td className="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  aria-label={`${row.label} by email`}
                  checked={row.email}
                  onChange={(e) => set(row, { email: e.target.checked })}
                  data-channel="email"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
        Changes save as you make them. Email goes to the address you sign in with, when the platform's email provider is set up.
        {save.error && <ErrorText error={save.error} />}
      </div>
    </Card>
  );
}

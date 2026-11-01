'use client';

import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@dealflow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useNotifications } from '@/lib/automation';
import { relativeTime } from '@/lib/format';

/** Bell with the caller's unread notifications. Selecting one marks it read and opens its link. */
export function NotificationsMenu() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useNotifications();
  const markRead = useMutation({
    mutationFn: (ids: string[] | 'all') => api('/notifications/read', { method: 'POST', json: { ids } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const unread = data?.unread ?? 0;
  const items = data?.items.slice(0, 12) ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
          <Bell aria-hidden />
          {unread > 0 && (
            <span aria-hidden className="absolute end-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-critical px-1 text-[10px] font-semibold leading-4 text-background">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between pe-1">
          <DropdownMenuLabel>Notifications</DropdownMenuLabel>
          {unread > 0 && (
            <button type="button" className="rounded px-2 py-1 text-xs text-primary hover:underline" onClick={() => markRead.mutate('all')}>
              Mark all read
            </button>
          )}
        </div>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="px-2 py-3 text-sm text-muted-foreground">You&apos;re all caught up. Assignments, approvals and automation alerts appear here.</p>
        ) : (
          items.map((n) => (
            <DropdownMenuItem
              key={n.id}
              className="flex-col items-start gap-0.5"
              onSelect={() => {
                if (!n.readAt) markRead.mutate([n.id]);
                if (n.link) router.push(n.link);
              }}
            >
              <span className="flex w-full items-start gap-2">
                {!n.readAt && <span aria-label="Unread" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                <span className={`flex-1 text-sm ${n.readAt ? 'text-muted-foreground' : 'font-medium'}`}>{n.title}</span>
              </span>
              {n.body && <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>}
              <span className="text-[11px] text-muted-foreground">{relativeTime(n.createdAt)}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

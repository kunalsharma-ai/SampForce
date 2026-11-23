'use client';

import { type CenterNotification, notificationSection, notificationTone } from '@dealflow/types';
import { cn } from '@dealflow/ui';
import { Check, CheckCheck, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { relativeTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { fmtLocale } from '@/lib/i18n/locale';
import { useNotificationActions, useOpenNotification } from '@/lib/notification-center';

/**
 * One notification, the same in the bell, on the home dashboard, in a section and on the history page (ADR 0075).
 * Unread: a red dot and a light tint. Important (High, Urgent): an amber or red edge. Action required: a labelled
 * badge. Read: muted. Opening it marks it read and goes to its page.
 */
export function NotificationItem({ n, showSection = true, dense = false, animate = false, onOpened }: { n: CenterNotification; showSection?: boolean; dense?: boolean; animate?: boolean; onOpened?: () => void }) {
  const t = useT();
  const open = useOpenNotification();
  const { read, unread } = useNotificationActions();
  const [justRead, setJustRead] = useState(false);
  const tone = notificationTone(n);
  const section = notificationSection(n.section);
  const isUnread = !n.readAt;
  const meta = [
    n.sender && (n.sender.designation ? `${n.sender.name}, ${t.maybe(n.sender.designation)}` : n.sender.name),
    n.company?.name,
    n.contact?.name,
  ].filter(Boolean);

  return (
    <div
      className={cn(
        'group relative flex items-start gap-3 rounded-lg border-s-[3px] py-2 pe-2 ps-2.5 transition-colors',
        tone === 'action' && isUnread ? 'border-s-[hsl(var(--sf-red))]' : tone === 'important' && isUnread ? (n.priority === 'URGENT' ? 'border-s-[hsl(var(--sf-red))]' : 'border-s-warning') : 'border-s-transparent',
        isUnread ? 'bg-[hsl(var(--sf-red)/0.05)] hover:bg-[hsl(var(--sf-red)/0.09)]' : 'hover:bg-muted',
        animate && 'sf-item-in',
      )}
      data-notification={n.type}
      data-read={isUnread ? 'no' : 'yes'}
      data-tone={tone}
    >
      <span aria-hidden className="relative mt-1.5 grid size-2.5 shrink-0 place-items-center">
        {isUnread && <span className="size-2.5 rounded-full bg-[hsl(var(--sf-red))]" />}
      </span>
      <button
        type="button"
        onClick={() => {
          open(n);
          onOpened?.();
        }}
        className="min-w-0 flex-1 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
      >
        <span className={cn('block text-sm', isUnread ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
          {isUnread && <span className="sr-only">{t('Unread')}: </span>}
          {n.title}
        </span>
        {n.body && <span className={cn('mt-0.5 block text-xs text-muted-foreground', dense ? 'line-clamp-1' : 'line-clamp-2')}>{n.body}</span>}
        <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          {tone === 'action' && (
            <span className="rounded-full bg-[hsl(var(--sf-red))] px-1.5 py-px font-semibold text-white">{t('Action required')}</span>
          )}
          {(n.priority === 'HIGH' || n.priority === 'URGENT') && (
            <span className={cn('rounded-full px-1.5 py-px font-semibold', n.priority === 'URGENT' ? 'bg-critical/15 text-critical' : 'bg-warning/15 text-warning')}>
              {t(n.priority === 'URGENT' ? 'Urgent' : 'High')}
            </span>
          )}
          {showSection && section && <span className="rounded-full border border-border px-1.5 py-px text-foreground">{t.maybe(section.label)}</span>}
          {meta.length > 0 && <span>{meta.join(' · ')}</span>}
          <time dateTime={n.createdAt} title={new Date(n.createdAt).toLocaleString(fmtLocale())}>
            {relativeTime(n.createdAt)}
          </time>
        </span>
      </button>
      <span className="flex shrink-0 items-center">
        {isUnread ? (
          <button
            type="button"
            className="grid size-7 place-items-center rounded-md text-muted-foreground opacity-70 hover:bg-background hover:text-foreground hover:opacity-100 focus-visible:opacity-100"
            aria-label={t('Mark as read: {title}', { title: n.title })}
            title={t('Mark as read')}
            onClick={() => {
              setJustRead(true);
              read.mutate([n.id]);
            }}
          >
            <Check className="size-4" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            className="grid size-7 place-items-center rounded-md text-muted-foreground opacity-0 hover:bg-background hover:text-foreground focus-visible:opacity-100 group-hover:opacity-70"
            aria-label={t('Mark as unread: {title}', { title: n.title })}
            title={t('Mark as unread')}
            onClick={() => unread.mutate(n.id)}
          >
            {justRead ? <CheckCheck className="sf-check-pop size-4 text-[hsl(var(--sf-red))]" aria-hidden /> : <Undo2 className="size-4" aria-hidden />}
          </button>
        )}
      </span>
    </div>
  );
}

'use client';

import { AVAILABILITY_LABEL, AVAILABILITY_STATUSES, type AvailabilityPerson, type AvailabilityStatus, WORKSPACE_LEVEL_LABEL } from '@dealflow/types';
import { Card, CardContent, cn, Skeleton } from '@dealflow/ui';
import { Users } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { minutesSince, useAvailabilityTeam, useNow } from '@/lib/availability';
import { type MessageKey, useT } from '@/lib/i18n';
import { STATUS_TONE, StatusDot, useMinutes } from './status-control';

function Avatar({ person }: { person: AvailabilityPerson }) {
  const initials = person.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span className={cn('relative grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary/80 to-accent/80 text-sm font-semibold text-background ring-2 ring-offset-2 ring-offset-surface', STATUS_TONE[person.status].ring)}>
      {person.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a private, signed-in image that Next cannot optimise
        <img src={person.photoUrl} alt="" className="size-full rounded-full object-cover" />
      ) : (
        initials
      )}
      <span className="absolute -bottom-0.5 -end-0.5 grid size-4 place-items-center rounded-full bg-surface">
        <StatusDot status={person.status} />
      </span>
    </span>
  );
}

/** One line under a person's name: how long they have been on break or away, or when they checked in or out. */
function useStatusLine() {
  const t = useT();
  const now = useNow(30_000);
  const minutes = useMinutes();
  const time = (iso: string) => new Date(iso).toLocaleTimeString(t.formatLocale, { hour: '2-digit', minute: '2-digit' });
  return (p: AvailabilityPerson): string => {
    if (p.status === 'ON_BREAK' || p.status === 'AWAY') return t('for {time}', { time: minutes(minutesSince(p.since, now)) });
    if (p.status === 'CHECKED_OUT') return p.checkedOutAt ? t('Checked out at {time}', { time: time(p.checkedOutAt) }) : t('Not checked in today');
    return p.checkedInAt ? t('Since {time}', { time: time(p.checkedInAt) }) : '';
  };
}

/**
 * Who is working, on a break, away or checked out (ADR 0081), for the people the signed-in person may see. Used on
 * the Team status page and, compact, on the dashboards.
 */
export function TeamStatusBoard({ compact = false, workspaceId }: { compact?: boolean; workspaceId?: string }) {
  const t = useT();
  const team = useAvailabilityTeam(workspaceId);
  const minutes = useMinutes();
  const line = useStatusLine();
  const [filter, setFilter] = useState<AvailabilityStatus | null>(null);

  if (team.isPending) return <Skeleton className={compact ? 'h-40' : 'h-72'} aria-label={t('Loading')} />;
  if (team.isError || !team.data)
    return (
      <p role="alert" className="text-sm text-critical">
        {t('Team status could not be loaded. Try again in a moment.')}
      </p>
    );

  const { people, counts } = team.data;
  const shown = filter ? people.filter((p) => p.status === filter) : people;

  return (
    <div className="space-y-4" data-team-status="">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('Show people by status')}>
        {AVAILABILITY_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={filter === s}
            onClick={() => setFilter(filter === s ? null : s)}
            className={cn(
              'flex min-h-9 items-center gap-2 rounded-full border border-border bg-surface px-3 text-sm transition-colors hover:bg-muted',
              filter === s && 'border-primary/50 bg-primary/10',
            )}
            data-status-count={s}
          >
            <StatusDot status={s} />
            <span>{t(AVAILABILITY_LABEL[s] as MessageKey)}</span>
            <span className="font-semibold tabular-nums">{counts[s]}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          <Users className="size-8 opacity-60" aria-hidden />
          {filter ? t('Nobody is {status} right now.', { status: t(AVAILABILITY_LABEL[filter] as MessageKey).toLowerCase() }) : t('Nobody to show yet.')}
        </div>
      ) : (
        <ul className={cn('grid gap-3', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 xl:grid-cols-3')}>
          {shown.slice(0, compact ? 6 : undefined).map((p, i) => (
            <motion.li
              key={p.userId}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 8) * 0.03, duration: 0.2 }}
              data-person-status={p.status}
              data-person={p.name}
            >
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="flex items-start gap-3 p-4">
                  <Avatar person={p} />
                  <div className="min-w-0 flex-1">
                    <p className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate font-medium">{p.name}</span>
                      {p.isMe && <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">{t('You')}</span>}
                    </p>
                    {p.workspace && (
                      <p className="truncate text-xs text-muted-foreground">
                        {p.workspace.name} · {t.maybe(WORKSPACE_LEVEL_LABEL[p.workspace.level])}
                      </p>
                    )}
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-sm">
                      <span className="font-semibold">{t(AVAILABILITY_LABEL[p.status] as MessageKey)}</span>
                      <span className="text-muted-foreground">{line(p)}</span>
                    </p>
                    {!compact && p.checkedInAt && (
                      <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                        {t('Worked {worked} · breaks {breaks}', { worked: minutes(p.workedMinutes), breaks: minutes(p.breakMinutes) })}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </motion.li>
          ))}
        </ul>
      )}
    </div>
  );
}

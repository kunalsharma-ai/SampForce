'use client';

import { cn } from '@dealflow/ui';
import { localYmd, type SpecialDayKind, type TodaySpecialDays } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useNow } from './live-clock';

export type SpecialDayLabels = Record<SpecialDayKind, string>;

export const SPECIAL_DAY_LABELS: SpecialDayLabels = { HOLIDAY: 'Public holiday today', OBSERVANCE: 'Celebrated today', COMPANY: 'Company event today' };

/** Today's date and time zone in the browser, the person's own. */
function useToday(): { date: string; zone: string } | null {
  const now = useNow();
  if (!now) return null;
  return { date: localYmd(now), zone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

/**
 * Today's special day in the welcome banner (Kunal, 2026-11-27): a public holiday in the person's country, a day the
 * world celebrates, or the company's own event, in a festive ribbon of its own row. The first one leads; the others
 * follow as chips. Nothing shows on an ordinary day.
 */
export function SpecialDay({ path, labels = SPECIAL_DAY_LABELS, className }: { path: string; labels?: SpecialDayLabels; className?: string }) {
  const today = useToday();
  const q = useQuery({
    queryKey: ['special-days', path, today?.date, today?.zone],
    queryFn: () => api<TodaySpecialDays>(`${path}?date=${today!.date}&zone=${encodeURIComponent(today!.zone)}`),
    enabled: !!today,
    staleTime: 30 * 60_000,
  });
  const days = q.data?.date === today?.date ? (q.data?.days ?? []) : [];
  if (!days.length) return null;
  const [lead, ...more] = days as [TodaySpecialDays['days'][number], ...TodaySpecialDays['days']];
  return (
    <section aria-label={labels[lead.kind]} data-welcome-special={lead.kind} className={cn('sf-special', className)} data-kind={lead.kind}>
      <span aria-hidden className="sf-special-emoji">
        {lead.emoji}
      </span>
      <div className="relative min-w-0 flex-1 space-y-0.5">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground" data-special-kind>
          {labels[lead.kind]}
        </p>
        <p className="text-lg font-black leading-tight tracking-tight text-foreground sm:text-xl" data-special-name>
          {lead.name}
        </p>
        {lead.note && (
          <p className="text-sm text-muted-foreground" data-special-note>
            {lead.note}
          </p>
        )}
      </div>
      {more.length > 0 && (
        <ul className="relative flex flex-wrap gap-2" data-special-more>
          {more.map((d) => (
            <li key={`${d.kind}-${d.name}`} className="sf-special-chip" data-kind={d.kind} title={labels[d.kind]}>
              <span aria-hidden>{d.emoji}</span>
              <span>{d.name}</span>
              <span className="sr-only">({labels[d.kind]})</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import type { Insight, InsightFeed, InsightScope } from '@dealflow/types';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Info, Sparkles, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/session';
import { useCopilot } from '@/stores/copilot';

const ICON = { attention: AlertTriangle, good: TrendingUp, info: Info } as const;
const COLOR = { attention: 'text-warning', good: 'text-success', info: 'text-muted-foreground' } as const;

/** The week in numbers: last seven days against the seven before, every figure from workspace records. */
export function SalesInsights() {
  const [scope, setScope] = useState<InsightScope>('mine');
  const canAi = useCan('ai:use');
  const ask = useCopilot((s) => s.ask);
  const feed = useQuery({ queryKey: ['insights', scope], queryFn: () => api<InsightFeed>(`/insights?scope=${scope}`), refetchInterval: 300_000 });

  return (
    <Card className="h-full">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>This week</CardTitle>
          <CardDescription>Last 7 days compared with the 7 before.</CardDescription>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Whose numbers">
          {(['mine', 'team'] as const).map((s) => (
            <Button key={s} size="sm" variant={scope === s ? 'default' : 'ghost'} className="h-7" aria-pressed={scope === s} onClick={() => setScope(s)}>
              {s === 'mine' ? 'Mine' : 'Team'}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {feed.isPending ? (
          <Skeleton className="h-40" />
        ) : feed.error ? (
          <p role="alert" className="text-sm text-critical">
            {feed.error.message}
          </p>
        ) : feed.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to report yet. Insights appear as deals, emails and tasks are recorded.</p>
        ) : (
          <ul className="space-y-3">
            {feed.data.items.map((i) => (
              <InsightRow key={i.key} insight={i} />
            ))}
          </ul>
        )}
        {canAi && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-accent/40 hover:bg-accent/10 [&_svg]:text-accent"
            onClick={() => ask(scope === 'team' ? "Brief me on the team's week: what needs attention, and what went well?" : 'Brief me on my week: what needs attention, and what should I do first?')}
          >
            <Sparkles aria-hidden /> Ask Copilot for a briefing
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function InsightRow({ insight: i }: { insight: Insight }) {
  const Icon = ICON[i.tone];
  const m = i.metric;
  const delta = m && m.previous !== null ? m.current - m.previous : null;
  const body = (
    <>
      <p className="text-sm font-medium">
        {i.title}
        {delta !== null && delta !== 0 && (
          <span className={`ml-1.5 inline-flex items-center text-xs ${delta > 0 ? 'text-success' : 'text-critical'}`}>
            {delta > 0 ? <ArrowUpRight className="size-3" aria-hidden /> : <ArrowDownRight className="size-3" aria-hidden />}
            <span className="sr-only">{delta > 0 ? 'up' : 'down'} on the week before</span>
          </span>
        )}
      </p>
      <p className="text-xs text-muted-foreground">{i.detail}</p>
    </>
  );
  return (
    <li className="flex gap-2.5">
      <Icon className={`mt-0.5 size-4 shrink-0 ${COLOR[i.tone]}`} aria-hidden />
      <div className="min-w-0">
        {i.href ? (
          <Link href={i.href} className="block rounded hover:underline">
            {body}
          </Link>
        ) : (
          body
        )}
      </div>
    </li>
  );
}

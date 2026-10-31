'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import { NEXT_ACTION_LABELS, type NextAction, type NextActionList, type RecordIntelligence, type TimelineEntity } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lightbulb, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useId, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import { useCan } from '@/lib/session';
import { useCopilot } from '@/stores/copilot';

const TREND = { none: 'No engagement recorded', rising: 'Rising', steady: 'Steady', declining: 'Falling' } as const;
const TREND_TONE = { none: 'neutral', rising: 'success', steady: 'neutral', declining: 'critical' } as const;

/**
 * Sales intelligence for one record: engagement, buying signals, decision-makers, account value, and the record's
 * next best actions. "Summarise with Copilot" asks Copilot, which reads the same data and cites the record.
 */
export function RecordIntelligencePanel({ entity, id, name }: { entity: TimelineEntity; id: string; name: string }) {
  const canAi = useCan('ai:use');
  const ask = useCopilot((s) => s.ask);
  const intel = useQuery({ queryKey: ['record-intelligence', entity, id], queryFn: () => api<RecordIntelligence>(`/intelligence/${entity}/${id}`) });
  const d = intel.data;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="size-4 text-muted-foreground" aria-hidden /> Sales intelligence
        </CardTitle>
        {canAi && (
          <Button size="sm" variant="outline" className="gap-1.5 border-accent/40 hover:bg-accent/10 [&_svg]:text-accent" onClick={() => ask(`Summarise our relationship with ${name} (${entity} ${id}): what has happened, how engaged they are, who matters, and what I should do next.`)}>
            <Sparkles aria-hidden /> Summarise with Copilot
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {intel.isPending ? (
          <Skeleton className="h-32" />
        ) : intel.error ? (
          <p role="alert" className="text-critical">
            {intel.error.message}
          </p>
        ) : (
          <>
            {d!.flags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {d!.flags.map((f) => (
                  <Badge key={f.key} tone={f.key === 'high_intent' ? 'success' : 'warning'}>
                    {f.label}
                  </Badge>
                ))}
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-muted-foreground">Engagement, last 30 days</p>
              <p>
                <span className="font-semibold tabular-nums">{d!.engagement.last30}</span> touches ({d!.engagement.previous30} the 30 days before){' '}
                <Badge tone={TREND_TONE[d!.engagement.trend]}>{TREND[d!.engagement.trend]}</Badge>
              </p>
              <p className="text-xs text-muted-foreground">
                Last heard from them: {d!.engagement.lastInboundAt ? relativeTime(d!.engagement.lastInboundAt) : 'never by email'} · Last emailed: {d!.engagement.lastOutboundAt ? relativeTime(d!.engagement.lastOutboundAt) : 'never'}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Buying signals</p>
              {d!.buyingSignals.length === 0 ? (
                <p className="text-muted-foreground">None recently.</p>
              ) : (
                <ul className="space-y-1">
                  {d!.buyingSignals.map((s) => (
                    <li key={s.key}>
                      <span className="font-medium">{s.label}</span>
                      {!s.confirmed && <span className="text-xs text-muted-foreground"> (estimate)</span>}
                      {s.detail && <span className="text-muted-foreground">: {s.detail}</span>}{' '}
                      <time className="text-xs text-muted-foreground" dateTime={s.at}>
                        {relativeTime(s.at)}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {d!.decisionMakers && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Senior people at the company (by job title)</p>
                {d!.decisionMakers.length === 0 ? (
                  <p className="text-muted-foreground">None recorded. Add the people who sign off.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {d!.decisionMakers.map((m) => (
                      <li key={m.id}>
                        <Link href={`/app/contacts/${m.id}`} className="font-medium text-primary hover:underline">
                          {m.name}
                        </Link>{' '}
                        <span className="text-muted-foreground">
                          {m.jobTitle} · {m.lastEngagedAt ? `last engaged ${relativeTime(m.lastEngagedAt)}` : 'not engaged yet'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {d!.account && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Account value{entity !== 'company' ? ` (${d!.account.companyName})` : ''}</p>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                  <dt className="text-muted-foreground">Won</dt>
                  <dd className="tabular-nums">
                    {formatMoney(d!.account.wonTotal, d!.account.currency)} ({d!.account.wonDeals} deal{d!.account.wonDeals === 1 ? '' : 's'})
                  </dd>
                  <dt className="text-muted-foreground">Open pipeline</dt>
                  <dd className="tabular-nums">{formatMoney(d!.account.openPipeline, d!.account.currency)}</dd>
                  <dt className="text-muted-foreground">Active contracts</dt>
                  <dd className="tabular-nums">{formatMoney(d!.account.activeContractValue, d!.account.currency)}</dd>
                  {d!.account.customerSince && (
                    <>
                      <dt className="text-muted-foreground">Customer since</dt>
                      <dd>{formatDate(d!.account.customerSince)}</dd>
                    </>
                  )}
                </dl>
                {d!.account.otherCurrency > 0 && <p className="text-xs text-muted-foreground">{d!.account.otherCurrency} record(s) in other currencies are not in these totals.</p>}
                {d!.account.renewalWithin60Days && <p className="text-xs text-warning">A contract ends within 60 days.</p>}
                {d!.account.notYetBought.length > 0 && <p className="text-xs text-muted-foreground">Not bought yet: {d!.account.notYetBought.join(', ')}</p>}
              </div>
            )}
          </>
        )}
        <RecordNextActions entity={entity} id={id} />
      </CardContent>
    </Card>
  );
}

function RecordNextActions({ entity, id }: { entity: TimelineEntity; id: string }) {
  const qc = useQueryClient();
  const canTask = useCan('activities:write');
  const focus = { type: entity, id };
  const list = useQuery({ queryKey: ['next-actions', entity, id], queryFn: () => api<NextActionList>(`/next-actions?recordType=${entity}&recordId=${id}`) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['next-actions'] });
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['timeline'] });
  };
  const dismiss = useMutation({ mutationFn: (key: string) => api('/next-actions/dismiss', { method: 'POST', json: { key, focus } }), onSuccess: refresh });
  if (list.isPending || list.error || list.data.items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">Suggested next actions</p>
      <ul className="divide-y divide-border">
        {list.data.items.slice(0, 4).map((i) => (
          <RecordAction key={i.key} item={i} focus={focus} canTask={canTask} onDone={refresh} onDismiss={() => dismiss.mutate(i.key)} />
        ))}
      </ul>
    </div>
  );
}

function RecordAction({ item, focus, canTask, onDone, onDismiss }: { item: NextAction; focus: { type: TimelineEntity; id: string }; canTask: boolean; onDone: () => void; onDismiss: () => void }) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.suggestedTask?.title ?? '');
  const accept = useMutation({
    mutationFn: () =>
      item.recommendationId
        ? api(`/ai/recommendations/${item.recommendationId}/accept`, { method: 'POST', json: { title, dueInDays: item.suggestedTask!.dueInDays } })
        : api('/next-actions/accept', { method: 'POST', json: { key: item.key, focus, title, dueInDays: item.suggestedTask!.dueInDays } }),
    onSuccess: onDone,
  });
  return (
    <li className="space-y-1 py-2">
      <p>
        <span className="font-medium">{item.title}</span> <Badge>{NEXT_ACTION_LABELS[item.kind]}</Badge>
      </p>
      <p className="text-xs text-muted-foreground">{item.reason}</p>
      {editing ? (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) accept.mutate();
          }}
        >
          <label htmlFor={`${id}-t`} className="sr-only">
            Task title
          </label>
          <Input id={`${id}-t`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="h-8 min-w-40 flex-1" />
          <Button type="submit" size="sm" disabled={!title.trim() || accept.isPending}>
            Create task
          </Button>
        </form>
      ) : (
        <div className="flex gap-1">
          {item.suggestedTask && canTask && (
            <Button size="sm" variant="outline" className="h-7" onClick={() => setEditing(true)}>
              Make it a task
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7" onClick={onDismiss} aria-label={`Hide "${item.title}"`}>
            Hide
          </Button>
        </div>
      )}
      {accept.error && (
        <p role="alert" className="text-xs text-critical">
          {accept.error.message}
        </p>
      )}
    </li>
  );
}

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
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { useCopilot } from '@/stores/copilot';
import { InfoTip } from '@/components/info-tip';
import { gated } from '@/components/shell/feature-locked';

const TREND = { none: 'No engagement recorded', rising: 'Rising', steady: 'Steady', declining: 'Falling' } as const;
const TREND_TONE = { none: 'neutral', rising: 'success', steady: 'neutral', declining: 'critical' } as const;

/**
 * Sales intelligence for one record: engagement, buying signals, decision-makers, account value, and the record's
 * next best actions. "Summarise with Copilot" asks Copilot, which reads the same data and cites the record.
 */
function RecordIntelligencePanelPanel({ entity, id, name }: { entity: TimelineEntity; id: string; name: string }) {
  const canAi = useCan('ai:use');
  const t = useT();
  const ask = useCopilot((s) => s.ask);
  const intel = useQuery({ queryKey: ['record-intelligence', entity, id], queryFn: () => api<RecordIntelligence>(`/intelligence/${entity}/${id}`) });
  const d = intel.data;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex items-center gap-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Lightbulb className="size-4 text-muted-foreground" aria-hidden /> {t('Sales intelligence')}
          </CardTitle>
          <InfoTip topic="record.intelligence" />
        </div>
        {canAi && (
          <Button size="sm" variant="outline" className="gap-1.5 border-accent/40 hover:bg-accent/10 [&_svg]:text-accent" onClick={() => ask(`Summarise our relationship with ${name} (${entity} ${id}): what has happened, how engaged they are, who matters, and what I should do next.`)}>
            <Sparkles aria-hidden /> {t('Summarise with Copilot')}
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
                    {t.maybe(f.label)}
                  </Badge>
                ))}
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-muted-foreground">{t('Engagement, last 30 days')}</p>
              <p>
                {t('{count} touches ({previous} the 30 days before)', { count: d!.engagement.last30, previous: d!.engagement.previous30 })}{' '}
                <Badge tone={TREND_TONE[d!.engagement.trend]}>{t(TREND[d!.engagement.trend])}</Badge>
              </p>
              <p className="text-xs text-muted-foreground">
                {t('Last heard from them: {when}', { when: d!.engagement.lastInboundAt ? relativeTime(d!.engagement.lastInboundAt) : t('never by email') })} · {t('Last emailed: {when}', { when: d!.engagement.lastOutboundAt ? relativeTime(d!.engagement.lastOutboundAt) : t('never') })}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">{t('Buying signals')}</p>
              {d!.buyingSignals.length === 0 ? (
                <p className="text-muted-foreground">{t('None recently.')}</p>
              ) : (
                <ul className="space-y-1">
                  {d!.buyingSignals.map((s) => (
                    <li key={s.key}>
                      <span className="font-medium">{t.maybe(s.label)}</span>
                      {!s.confirmed && <span className="text-xs text-muted-foreground">{t(' (estimate)')}</span>}
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
                <p className="text-xs font-medium text-muted-foreground">{t('Senior people at the company (by job title)')}</p>
                {d!.decisionMakers.length === 0 ? (
                  <p className="text-muted-foreground">{t('None recorded. Add the people who sign off.')}</p>
                ) : (
                  <ul className="space-y-0.5">
                    {d!.decisionMakers.map((m) => (
                      <li key={m.id}>
                        <Link href={`/app/contacts/${m.id}`} className="font-medium text-primary hover:underline">
                          {m.name}
                        </Link>{' '}
                        <span className="text-muted-foreground">
                          {m.jobTitle} · {m.lastEngagedAt ? t('last engaged {when}', { when: relativeTime(m.lastEngagedAt) }) : t('not engaged yet')}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {d!.account && (
              <div>
                <p className="text-xs font-medium text-muted-foreground">{t('Account value')}{entity !== 'company' ? ` (${d!.account.companyName})` : ''}</p>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                  <dt className="text-muted-foreground">{t('Won')}</dt>
                  <dd className="tabular-nums">
                    {formatMoney(d!.account.wonTotal, d!.account.currency)} ({t.plural('count.deals', d!.account.wonDeals)})
                  </dd>
                  <dt className="text-muted-foreground">{t('Open pipeline')}</dt>
                  <dd className="tabular-nums">{formatMoney(d!.account.openPipeline, d!.account.currency)}</dd>
                  <dt className="text-muted-foreground">{t('Active contracts')}</dt>
                  <dd className="tabular-nums">{formatMoney(d!.account.activeContractValue, d!.account.currency)}</dd>
                  {d!.account.customerSince && (
                    <>
                      <dt className="text-muted-foreground">{t('Customer since')}</dt>
                      <dd>{formatDate(d!.account.customerSince)}</dd>
                    </>
                  )}
                </dl>
                {d!.account.otherCurrency > 0 && <p className="text-xs text-muted-foreground">{t('{count} record(s) in other currencies are not in these totals.', { count: d!.account.otherCurrency })}</p>}
                {d!.account.renewalWithin60Days && <p className="text-xs text-warning">{t('A contract ends within 60 days.')}</p>}
                {d!.account.notYetBought.length > 0 && <p className="text-xs text-muted-foreground">{t('Not bought yet: {items}', { items: d!.account.notYetBought.join(', ') })}</p>}
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
  const t = useT();
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
      <p className="text-xs font-medium text-muted-foreground">{t('Suggested next actions')}</p>
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
  const t = useT();
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
        <span className="font-medium">{item.title}</span> <Badge>{t.maybe(NEXT_ACTION_LABELS[item.kind])}</Badge>
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
            {t('Task title')}
          </label>
          <Input id={`${id}-t`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="h-8 min-w-40 flex-1" />
          <Button type="submit" size="sm" disabled={!title.trim() || accept.isPending}>
            {t('Create task')}
          </Button>
        </form>
      ) : (
        <div className="flex gap-1">
          {item.suggestedTask && canTask && (
            <Button size="sm" variant="outline" className="h-7" onClick={() => setEditing(true)}>
              {t('Make it a task')}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7" onClick={onDismiss} aria-label={t('Hide "{title}"', { title: item.title })}>
            {t('Hide')}
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

/** Shown only while the plan includes sales_intelligence (ADR 0057). */
export const RecordIntelligencePanel = gated('sales_intelligence', RecordIntelligencePanelPanel);

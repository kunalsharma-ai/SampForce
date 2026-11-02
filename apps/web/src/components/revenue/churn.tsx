'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import { CHURN_RISK, CHURN_TREND_DAYS, type ContactRow, type CustomerRow, followUpDates, type RetentionBrief } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Sparkles, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { aiErrorMessage } from '@/lib/ai';
import { api } from '@/lib/api';
import { formatDate, useRecordList } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import { useChurnTrends } from '@/lib/revenue';
import { useCan } from '@/lib/session';
import { inSentence, useT } from '@/lib/i18n';

const ymdLocal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const SERIES = [
  { key: 'high', label: 'High risk', color: 'hsl(var(--critical))' },
  { key: 'medium', label: 'Medium risk', color: 'hsl(var(--warning))' },
  { key: 'low', label: 'Low risk', color: 'hsl(var(--success))' },
] as const;

/** Customers by churn risk per day, with the biggest falls. Built from the stored daily scores. */
export function ChurnTrendCard() {
  const t = useT();
  const [days, setDays] = useState<(typeof CHURN_TREND_DAYS)[number]>(90);
  const q = useChurnTrends(days);
  const data = q.data?.days ?? [];
  const max = Math.max(1, ...data.map((d) => d.high + d.medium + d.low));
  const w = 640;
  const h = 140;
  const slot = data.length ? w / data.length : w;
  const bar = Math.max(2, Math.min(18, slot - 2));
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{t('Churn risk over time')}</CardTitle>
        <div role="group" aria-label={t('Time range')} className="inline-flex rounded-md border border-border p-0.5 text-xs">
          {CHURN_TREND_DAYS.map((d) => (
            <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={`rounded px-2.5 py-1 ${days === d ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
              {new Intl.NumberFormat(t.language, { style: 'unit', unit: 'day', unitDisplay: 'long' }).format(d)}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isPending ? (
          <Skeleton className="h-36" />
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('No scores yet. Customers are scored when this page opens and every hour.')}</p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label={t('Legend')}>
              {SERIES.map((s) => (
                <li key={s.key} className="flex items-center gap-1.5">
                  <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
                  {t.maybe(s.label)}
                </li>
              ))}
            </ul>
            <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" role="img" aria-label={t('Customers by churn risk per day over the last {days} days. Latest: {high} high, {medium} medium, {low} low.', { days, high: data.at(-1)!.high, medium: data.at(-1)!.medium, low: data.at(-1)!.low })}>
              <line x1={0} x2={w} y1={h - 0.5} y2={h - 0.5} stroke="hsl(var(--border))" />
              {data.map((d, i) => {
                let y = h;
                const x = i * slot + (slot - bar) / 2;
                return (
                  <g key={d.day}>
                    <title>{`${t('{date}: {high} high, {medium} medium, {low} low', { date: formatDate(d.day), high: d.high, medium: d.medium, low: d.low })}${d.averageScore !== null ? t(', average health {score}', { score: d.averageScore }) : ''}`}</title>
                    <rect x={i * slot} y={0} width={slot} height={h} fill="transparent" />
                    {SERIES.map((s) => {
                      const n = d[s.key];
                      if (!n) return null;
                      const bh = Math.max(2, (n / max) * (h - 8) - 2);
                      y -= bh + 2;
                      return <rect key={s.key} x={x} y={y + 2} width={bar} height={bh} rx={Math.min(4, bar / 2)} fill={s.color} />;
                    })}
                  </g>
                );
              })}
            </svg>
            <p className="text-xs text-muted-foreground">
              {data.length === 1 ? t('History starts {date}; a day is added each time customers are scored.', { date: formatDate(data[0]!.day) }) : `${t('{start} to {end}', { start: formatDate(data[0]!.day), end: formatDate(data.at(-1)!.day) })}. ${t('Rule-based scores, not a prediction model.')}`}
            </p>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">{t('Show as table')}</summary>
              <table className="mt-2 w-full text-start tabular-nums">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="py-1 font-medium">{t('Day')}</th>
                    <th className="font-medium">{t('High')}</th>
                    <th className="font-medium">{t('Medium')}</th>
                    <th className="font-medium">{t('Low')}</th>
                    <th className="font-medium">{t('Average health')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((d) => (
                    <tr key={d.day} className="border-t border-border">
                      <td className="py-1">{formatDate(d.day)}</td>
                      <td>{d.high}</td>
                      <td>{d.medium}</td>
                      <td>{d.low}</td>
                      <td>{d.averageScore ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
            {q.data!.movers.length > 0 && (
              <div className="space-y-1 border-t border-border pt-3">
                <h3 className="text-sm font-semibold">{t('Biggest falls in this period')}</h3>
                <ul className="space-y-1 text-sm" aria-label={t('Biggest falls')}>
                  {q.data!.movers.map((m) => (
                    <li key={m.company.id} className="flex flex-wrap items-center gap-2">
                      <TrendingDown className="size-4 text-critical" aria-hidden />
                      <Link href={`/app/customer-success?company=${m.company.id}`} className="text-primary hover:underline">
                        {m.company.name}
                      </Link>
                      <span className="tabular-nums text-muted-foreground">
                        {m.from} → {m.to}
                      </span>
                      <Badge tone={m.band === 'at_risk' ? 'critical' : m.band === 'watch' ? 'warning' : 'success'}>{t.maybe(CHURN_RISK[m.band].label)}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Engagement, deal history, open requests and the score's own history for one customer. */
export function CustomerInsights({ c }: { c: CustomerRow }) {
  const t = useT();
  const e = c.engagement;
  const pts = c.history;
  const w = 120;
  const h = 28;
  const path = pts.length > 1 ? pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (pts.length - 1)) * w).toFixed(1)},${(h - (p.score / 100) * h).toFixed(1)}`).join(' ') : null;
  const TrendIcon = e.trend === 'declining' ? TrendingDown : TrendingUp;
  return (
    <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <dt className="text-muted-foreground">{t('Engagement, last 30 days')}</dt>
        <dd className="flex items-center gap-1">
          {t('{n} touches ({before} before)', { n: e.last30, before: e.previous30 })}
          {e.trend !== 'none' && e.trend !== 'steady' && <TrendIcon className={`size-3.5 ${e.trend === 'declining' ? 'text-critical' : 'text-success'}`} aria-label={e.trend === 'declining' ? t('Falling') : t('Rising')} />}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t('Last heard from them')}</dt>
        <dd>{e.lastInboundAt ? relativeTime(e.lastInboundAt) : t('No email from them recorded')}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t('Deals')}</dt>
        <dd>
          {t('{won} won · {open} open · {lost} lost in 90 days', { won: c.deals.won, open: c.deals.open, lost: c.deals.lost90 })}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">{t('Health history')}</dt>
        <dd>
          {path ? (
            <svg viewBox={`0 0 ${w} ${h}`} className="h-7 w-32 text-primary" role="img" aria-label={t('Health over {days} days, from {from} to {to}', { days: pts.length, from: pts[0]!.score, to: pts.at(-1)!.score })} preserveAspectRatio="none">
              <path d={path} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
          ) : (
            <span className="text-muted-foreground">{t('Starts today')}</span>
          )}
        </dd>
      </div>
      {c.openRequests > 0 && (
        <div className="sm:col-span-2">
          <dt className="sr-only">{t('Open portal requests')}</dt>
          <dd>
            {t.plural('count.openPortalRequests', c.openRequests)}{' '}
            <Link href="/app/portal" className="text-primary hover:underline">
              {t('Open requests')}
            </Link>
          </dd>
        </div>
      )}
    </dl>
  );
}

/** Suggested retention actions and the follow-up schedule. Tasks are created only after the manager confirms them. */
export function RetentionPanel({ c }: { c: CustomerRow }) {
  const t = useT();
  const canSuccess = useCan('success:write');
  const canTasks = useCan('activities:write');
  const canWrite = canSuccess && canTasks;
  const canAi = useCan('ai:use');
  const [open, setOpen] = useState(false);
  const [extra, setExtra] = useState<{ title: string; dueInDays: number }[]>([]);
  const brief = useMutation({ mutationFn: () => api<RetentionBrief & { generatedAt: string }>(`/success/customers/${c.company.id}/retention-brief`, { method: 'POST' }) });
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{t('Retention plan')}</h3>
        <span className="text-xs text-muted-foreground">{t('Follow up: {cadence}', { cadence: inSentence(t, t.maybe(c.plan.cadence.label)) })}</span>
        <div className="ms-auto flex flex-wrap gap-2">
          {canAi && (
            <Button size="sm" variant="outline" onClick={() => brief.mutate()} disabled={brief.isPending}>
              <Sparkles aria-hidden /> {brief.isPending ? t('Writing…') : t('AI briefing')}
            </Button>
          )}
          {canWrite && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <CalendarPlus aria-hidden /> {t('Plan follow-ups')}
            </Button>
          )}
        </div>
      </div>
      {c.plan.actions.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('No risk signals, so no extra steps. Keep the regular check-ins.')}</p>
      ) : (
        <ol className="list-decimal space-y-0.5 ps-5 text-xs" aria-label={t('Suggested retention steps for {name}', { name: c.company.name })}>
          {c.plan.actions.map((a) => (
            <li key={a.key}>
              <span className="font-medium">{t.maybe(a.title)}</span> <span className="text-muted-foreground">({a.dueInDays === 0 ? t('today') : t('within {time}', { time: new Intl.NumberFormat(t.language, { style: 'unit', unit: 'day', unitDisplay: 'long' }).format(a.dueInDays) })}). {t.maybe(a.why)}</span>
            </li>
          ))}
        </ol>
      )}
      {brief.error && (
        <p role="alert" className="text-xs text-critical">
          {aiErrorMessage(brief.error)}
        </p>
      )}
      {brief.data && (
        <section aria-label={t('AI briefing')} className="space-y-2 rounded-md border border-border bg-background/60 p-3 text-sm">
          <div className="flex items-center gap-2">
            <Badge tone="accent">{t('AI draft')}</Badge>
            <span className="text-xs text-muted-foreground">{t('Check it against the record before you use it.')}</span>
          </div>
          <p>{brief.data.summary}</p>
          {brief.data.talkingPoints.length > 0 && (
            <>
              <h4 className="text-xs font-semibold">{t('Talking points')}</h4>
              <ul className="list-disc ps-5 text-xs">
                {brief.data.talkingPoints.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}
          {brief.data.steps.length > 0 && (
            <>
              <h4 className="text-xs font-semibold">{t('Suggested steps')}</h4>
              <ul className="space-y-0.5 text-xs">
                {brief.data.steps.map((s) => (
                  <li key={s.title}>
                    {s.title} <span className="text-muted-foreground">({t('in {time}', { time: new Intl.NumberFormat(t.language, { style: 'unit', unit: 'day', unitDisplay: 'long' }).format(s.dueInDays) })}). {s.why}</span>
                  </li>
                ))}
              </ul>
              {canWrite && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setExtra(brief.data!.steps.map((s) => ({ title: s.title, dueInDays: s.dueInDays })));
                    setOpen(true);
                  }}
                >
                  {t('Add these to follow-ups')}
                </Button>
              )}
            </>
          )}
        </section>
      )}
      {open && <FollowUpDialog c={c} extra={extra} onClose={() => setOpen(false)} />}
    </div>
  );
}

interface Draft {
  pick: boolean;
  title: string;
  dueDate: string;
}

function FollowUpDialog({ c, extra, onClose }: { c: CustomerRow; extra: { title: string; dueInDays: number }[]; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const today = ymdLocal();
  const contacts = useRecordList<ContactRow>('contacts', { companyId: c.company.id, pageSize: 50, sort: 'firstName', order: 'asc' });
  const [contactId, setContactId] = useState<string>('');
  const [items, setItems] = useState<Draft[]>(() => {
    const seen = new Set<string>();
    const out: Draft[] = [];
    for (const a of [...c.plan.actions, ...extra]) {
      if (seen.has(a.title)) continue;
      seen.add(a.title);
      out.push({ pick: true, title: t.maybe(a.title), dueDate: addDays(today, a.dueInDays) });
    }
    for (const d of followUpDates(today, c.plan.cadence)) out.push({ pick: true, title: t('Retention check-in'), dueDate: d });
    return out.slice(0, 12);
  });
  const create = useMutation({
    mutationFn: () =>
      api<{ created: { id: string; title: string; dueAt: string }[] }>(`/success/customers/${c.company.id}/follow-ups`, {
        method: 'POST',
        json: { contactId: contactId || null, timezoneOffsetMinutes: new Date().getTimezoneOffset(), items: items.filter((i) => i.pick).map((i) => ({ title: i.title, dueDate: i.dueDate })) },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
  const chosen = items.filter((i) => i.pick && i.title.trim() && i.dueDate).length;
  const set = (i: number, patch: Partial<Draft>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" className="flex flex-col gap-4 overflow-y-auto p-5 sm:max-w-2xl">
        <div className="pe-8">
          <DialogTitle className="text-lg font-semibold">{t('Follow-up schedule')}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {t('For {name}. Suggested from the risk signals and this cadence: {cadence}. Untick or change anything; tasks are created only when you confirm.', { name: c.company.name, cadence: inSentence(t, t.maybe(c.plan.cadence.label)) })}
          </DialogDescription>
        </div>
        {create.data ? (
          <div className="space-y-2 text-sm">
            <p className="font-medium text-success">
              {t.plural('count.tasksCreated', create.data.created.length)}
            </p>
            <ul className="list-disc ps-5 text-xs">
              {create.data.created.map((item) => (
                <li key={item.id}>
                  {t('{title}, due {when}', { title: item.title, when: relativeTime(item.dueAt) })}
                </li>
              ))}
            </ul>
            <Button asChild variant="outline" size="sm">
              <Link href="/app/activities">{t('Open tasks')}</Link>
            </Button>
          </div>
        ) : (
          <>
            <label className="space-y-1 text-sm" htmlFor="fu-contact">
              <span className="font-medium">{t('Contact')}</span>
              <Select id="fu-contact" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">{t('No contact (tasks name the company)')}</option>
                {(contacts.data?.items ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </Select>
            </label>
            <ul className="space-y-2" aria-label={t('Follow-ups to create')}>
              {items.map((it, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
                  <input type="checkbox" aria-label={t('Create follow-up {n}', { n: i + 1 })} className="size-4 accent-[hsl(var(--primary))]" checked={it.pick} onChange={(e) => set(i, { pick: e.target.checked })} />
                  <Input aria-label={t('Follow-up {n} title', { n: i + 1 })} className="min-w-0 flex-1" value={it.title} onChange={(e) => set(i, { title: e.target.value })} />
                  <Input aria-label={t('Follow-up {n} date', { n: i + 1 })} type="date" className="w-40" value={it.dueDate} min={today} onChange={(e) => set(i, { dueDate: e.target.value })} />
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{t('Each task is due at 9:00 your time and assigned to you.')}{c.health.band === 'at_risk' ? ` ${t('High priority because the risk is high.')}` : ''}</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => create.mutate()} disabled={!chosen || create.isPending}>
                {create.isPending ? t('Creating…') : t.plural('count.createTasks', chosen)}
              </Button>
              <Button variant="ghost" onClick={onClose}>
                {t('Cancel')}
              </Button>
            </div>
            {create.error && (
              <p role="alert" className="text-sm text-critical">
                {create.error.message}
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

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

const ymdLocal = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const SERIES = [
  { key: 'high', label: 'High risk', color: 'hsl(var(--critical))' },
  { key: 'medium', label: 'Medium risk', color: 'hsl(var(--warning))' },
  { key: 'low', label: 'Low risk', color: 'hsl(var(--success))' },
] as const;

/** Customers by churn risk per day, with the biggest falls. Built from the stored daily scores. */
export function ChurnTrendCard() {
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
        <CardTitle className="text-base">Churn risk over time</CardTitle>
        <div role="group" aria-label="Time range" className="inline-flex rounded-md border border-border p-0.5 text-xs">
          {CHURN_TREND_DAYS.map((d) => (
            <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={`rounded px-2.5 py-1 ${days === d ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
              {d} days
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isPending ? (
          <Skeleton className="h-36" />
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground">No scores yet. Customers are scored when this page opens and every hour.</p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="Legend">
              {SERIES.map((s) => (
                <li key={s.key} className="flex items-center gap-1.5">
                  <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
                  {s.label}
                </li>
              ))}
            </ul>
            <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" role="img" aria-label={`Customers by churn risk per day over the last ${days} days. Latest: ${data.at(-1)!.high} high, ${data.at(-1)!.medium} medium, ${data.at(-1)!.low} low.`}>
              <line x1={0} x2={w} y1={h - 0.5} y2={h - 0.5} stroke="hsl(var(--border))" />
              {data.map((d, i) => {
                let y = h;
                const x = i * slot + (slot - bar) / 2;
                return (
                  <g key={d.day}>
                    <title>{`${formatDate(d.day)}: ${d.high} high, ${d.medium} medium, ${d.low} low${d.averageScore !== null ? `, average health ${d.averageScore}` : ''}`}</title>
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
              {data.length === 1 ? `History starts ${formatDate(data[0]!.day)}; a day is added each time customers are scored.` : `${formatDate(data[0]!.day)} to ${formatDate(data.at(-1)!.day)}. Rule-based scores, not a prediction model.`}
            </p>
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
              <table className="mt-2 w-full text-left tabular-nums">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="py-1 font-medium">Day</th>
                    <th className="font-medium">High</th>
                    <th className="font-medium">Medium</th>
                    <th className="font-medium">Low</th>
                    <th className="font-medium">Average health</th>
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
                <h3 className="text-sm font-semibold">Biggest falls in this period</h3>
                <ul className="space-y-1 text-sm" aria-label="Biggest falls">
                  {q.data!.movers.map((m) => (
                    <li key={m.company.id} className="flex flex-wrap items-center gap-2">
                      <TrendingDown className="size-4 text-critical" aria-hidden />
                      <Link href={`/app/customer-success?company=${m.company.id}`} className="text-primary hover:underline">
                        {m.company.name}
                      </Link>
                      <span className="tabular-nums text-muted-foreground">
                        {m.from} → {m.to}
                      </span>
                      <Badge tone={m.band === 'at_risk' ? 'critical' : m.band === 'watch' ? 'warning' : 'success'}>{CHURN_RISK[m.band].label}</Badge>
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
  const e = c.engagement;
  const pts = c.history;
  const w = 120;
  const h = 28;
  const path = pts.length > 1 ? pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (pts.length - 1)) * w).toFixed(1)},${(h - (p.score / 100) * h).toFixed(1)}`).join(' ') : null;
  const TrendIcon = e.trend === 'declining' ? TrendingDown : TrendingUp;
  return (
    <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <dt className="text-muted-foreground">Engagement, last 30 days</dt>
        <dd className="flex items-center gap-1">
          <span className="font-semibold tabular-nums">{e.last30}</span> touches ({e.previous30} before)
          {e.trend !== 'none' && e.trend !== 'steady' && <TrendIcon className={`size-3.5 ${e.trend === 'declining' ? 'text-critical' : 'text-success'}`} aria-label={e.trend === 'declining' ? 'Falling' : 'Rising'} />}
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Last heard from them</dt>
        <dd>{e.lastInboundAt ? relativeTime(e.lastInboundAt) : 'No email from them recorded'}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Deals</dt>
        <dd>
          {c.deals.won} won · {c.deals.open} open · {c.deals.lost90} lost in 90 days
        </dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Health history</dt>
        <dd>
          {path ? (
            <svg viewBox={`0 0 ${w} ${h}`} className="h-7 w-32 text-primary" role="img" aria-label={`Health over ${pts.length} days, from ${pts[0]!.score} to ${pts.at(-1)!.score}`} preserveAspectRatio="none">
              <path d={path} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
          ) : (
            <span className="text-muted-foreground">Starts today</span>
          )}
        </dd>
      </div>
      {c.openRequests > 0 && (
        <div className="sm:col-span-2">
          <dt className="sr-only">Open portal requests</dt>
          <dd>
            {c.openRequests} open portal request{c.openRequests === 1 ? '' : 's'}.{' '}
            <Link href="/app/portal" className="text-primary hover:underline">
              Open requests
            </Link>
          </dd>
        </div>
      )}
    </dl>
  );
}

/** Suggested retention actions and the follow-up schedule. Tasks are created only after the manager confirms them. */
export function RetentionPanel({ c }: { c: CustomerRow }) {
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
        <h3 className="text-sm font-semibold">Retention plan</h3>
        <span className="text-xs text-muted-foreground">Follow up: {c.plan.cadence.label.toLowerCase()}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {canAi && (
            <Button size="sm" variant="outline" onClick={() => brief.mutate()} disabled={brief.isPending}>
              <Sparkles aria-hidden /> {brief.isPending ? 'Writing…' : 'AI briefing'}
            </Button>
          )}
          {canWrite && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              <CalendarPlus aria-hidden /> Plan follow-ups
            </Button>
          )}
        </div>
      </div>
      {c.plan.actions.length === 0 ? (
        <p className="text-xs text-muted-foreground">No risk signals, so no extra steps. Keep the regular check-ins.</p>
      ) : (
        <ol className="list-decimal space-y-0.5 pl-5 text-xs" aria-label={`Suggested retention steps for ${c.company.name}`}>
          {c.plan.actions.map((a) => (
            <li key={a.key}>
              <span className="font-medium">{a.title}</span> <span className="text-muted-foreground">({a.dueInDays === 0 ? 'today' : `within ${a.dueInDays} day${a.dueInDays === 1 ? '' : 's'}`}). {a.why}</span>
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
        <section aria-label="AI briefing" className="space-y-2 rounded-md border border-border bg-background/60 p-3 text-sm">
          <div className="flex items-center gap-2">
            <Badge tone="accent">AI draft</Badge>
            <span className="text-xs text-muted-foreground">Check it against the record before you use it.</span>
          </div>
          <p>{brief.data.summary}</p>
          {brief.data.talkingPoints.length > 0 && (
            <>
              <h4 className="text-xs font-semibold">Talking points</h4>
              <ul className="list-disc pl-5 text-xs">
                {brief.data.talkingPoints.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </>
          )}
          {brief.data.steps.length > 0 && (
            <>
              <h4 className="text-xs font-semibold">Suggested steps</h4>
              <ul className="space-y-0.5 text-xs">
                {brief.data.steps.map((s) => (
                  <li key={s.title}>
                    {s.title} <span className="text-muted-foreground">(in {s.dueInDays} days). {s.why}</span>
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
                  Add these to follow-ups
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
      out.push({ pick: true, title: a.title, dueDate: addDays(today, a.dueInDays) });
    }
    for (const d of followUpDates(today, c.plan.cadence)) out.push({ pick: true, title: 'Retention check-in', dueDate: d });
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
        <div className="pr-8">
          <DialogTitle className="text-lg font-semibold">Follow-up schedule</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            For {c.company.name}. Suggested from the risk signals and a {c.plan.cadence.label.toLowerCase()} cadence. Untick or change anything; tasks are created only when you confirm.
          </DialogDescription>
        </div>
        {create.data ? (
          <div className="space-y-2 text-sm">
            <p className="font-medium text-success">
              {create.data.created.length} task{create.data.created.length === 1 ? '' : 's'} created.
            </p>
            <ul className="list-disc pl-5 text-xs">
              {create.data.created.map((t) => (
                <li key={t.id}>
                  {t.title}, due {relativeTime(t.dueAt)}
                </li>
              ))}
            </ul>
            <Button asChild variant="outline" size="sm">
              <Link href="/app/activities">Open tasks</Link>
            </Button>
          </div>
        ) : (
          <>
            <label className="space-y-1 text-sm" htmlFor="fu-contact">
              <span className="font-medium">Contact</span>
              <Select id="fu-contact" value={contactId} onChange={(e) => setContactId(e.target.value)}>
                <option value="">No contact (tasks name the company)</option>
                {(contacts.data?.items ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}
                  </option>
                ))}
              </Select>
            </label>
            <ul className="space-y-2" aria-label="Follow-ups to create">
              {items.map((it, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
                  <input type="checkbox" aria-label={`Create follow-up ${i + 1}`} className="size-4 accent-[hsl(var(--primary))]" checked={it.pick} onChange={(e) => set(i, { pick: e.target.checked })} />
                  <Input aria-label={`Follow-up ${i + 1} title`} className="min-w-0 flex-1" value={it.title} onChange={(e) => set(i, { title: e.target.value })} />
                  <Input aria-label={`Follow-up ${i + 1} date`} type="date" className="w-40" value={it.dueDate} min={today} onChange={(e) => set(i, { dueDate: e.target.value })} />
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">Each task is due at 9:00 your time and assigned to you. {c.health.band === 'at_risk' ? 'High priority because the risk is high.' : ''}</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => create.mutate()} disabled={!chosen || create.isPending}>
                {create.isPending ? 'Creating…' : `Create ${chosen} task${chosen === 1 ? '' : 's'}`}
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Cancel
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

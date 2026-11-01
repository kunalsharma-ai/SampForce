'use client';

import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import type { AnalyticsCounts } from '@dealflow/types';
import Link from 'next/link';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { ErrorText } from '@/components/revenue/tabs';
import { titleCase } from '@/lib/crm';
import { pct, SEQUENCE_TONE, useEmailAnalytics } from '@/lib/sequences';
import { useCan } from '@/lib/session';

const PERIODS = [7, 30, 90, 365] as const;

function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function CountCells({ c }: { c: AnalyticsCounts }) {
  return (
    <>
      <td className="px-3 py-2 text-end tabular-nums">{c.sent}</td>
      <td className="px-3 py-2 text-end tabular-nums">
        {c.replied} <span className="text-xs text-muted-foreground">{pct(c.replied, c.sent)}</span>
      </td>
      <td className="px-3 py-2 text-end tabular-nums">
        {c.opened} <span className="text-xs text-muted-foreground">{pct(c.opened, c.sent)}</span>
      </td>
      <td className="px-3 py-2 text-end tabular-nums">{c.clicked}</td>
      <td className="px-3 py-2 text-end tabular-nums">{c.bounced}</td>
      <td className="px-3 py-2 text-end tabular-nums">{c.unsubscribed}</td>
    </>
  );
}

function CountHead({ first }: { first: string }) {
  return (
    <thead className="border-b border-border text-start text-xs text-muted-foreground">
      <tr>
        <th className="px-3 py-2 font-medium">{first}</th>
        <th className="px-3 py-2 text-end font-medium">Sent</th>
        <th className="px-3 py-2 text-end font-medium">Replied</th>
        <th className="px-3 py-2 text-end font-medium">Opened (estimate)</th>
        <th className="px-3 py-2 text-end font-medium">Clicked</th>
        <th className="px-3 py-2 text-end font-medium">Bounced</th>
        <th className="px-3 py-2 text-end font-medium">Unsubscribed</th>
      </tr>
    </thead>
  );
}

function Table({ title, first, rows }: { title: string; first: string; rows: { key: string; name: React.ReactNode; c: AnalyticsCounts }[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {rows.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">Nothing sent in this period.</p>
        ) : (
          <table className="w-full text-sm">
            <CountHead first={first} />
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="px-3 py-2">{r.name}</td>
                  <CountCells c={r.c} />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

/** Campaign results across sequences, sending mailboxes, templates and follow-up positions. */
export function EmailAnalyticsPanel() {
  const canTeam = useCan('marketing:manage');
  const [days, setDays] = useState<number>(30);
  const [scope, setScope] = useState<'mine' | 'team'>('mine');
  const q = useEmailAnalytics(days, scope);
  const t = q.data?.totals;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="ea-days" className="block text-xs font-medium">
            Period
          </label>
          <Select id="ea-days" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            {PERIODS.map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </Select>
        </div>
        {canTeam && (
          <div>
            <label htmlFor="ea-scope" className="block text-xs font-medium">
              Whose emails
            </label>
            <Select id="ea-scope" value={scope} onChange={(e) => setScope(e.target.value as 'mine' | 'team')}>
              <option value="mine">Mine</option>
              <option value="team">Whole team</option>
            </Select>
          </div>
        )}
      </div>
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.error ? (
        <ErrorText error={q.error} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Emails sent" value={t!.sent} />
            <Stat label="Reply rate" value={pct(t!.replied, t!.sent)} note={`${t!.replied} replies`} />
            <Stat label="Bounce rate" value={pct(t!.bounced, t!.sent)} note={`${t!.bounced} bounced`} />
            <Stat label="People enrolled" value={t!.enrolled} note={`${t!.completed} finished, ${t!.failed} failed`} />
          </div>
          <p className="text-xs text-muted-foreground">
            Replies and bounces come from your synced mailbox and are reliable. Opens are estimates: some mail apps load images by themselves and others block them. Some clicks come
            from security scanners. Delivery is not shown because mail providers do not report it.
          </p>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Tips</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {q.data.insights.length === 0 ? (
                <p className="text-muted-foreground">No tips yet. Tips appear once there is enough data, for example 20 emails from one step or 10 replies.</p>
              ) : (
                <ul className="space-y-3">
                  {q.data.insights.map((i) => (
                    <li key={`${i.kind}-${i.title}`}>
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <Badge tone={i.severity === 'warning' ? 'warning' : 'primary'}>{i.severity === 'warning' ? 'Check' : 'Tip'}</Badge>
                        {i.sequenceId ? (
                          <Link href={`/app/sequences/${i.sequenceId}`} className="underline underline-offset-2">
                            {i.title}
                          </Link>
                        ) : (
                          i.title
                        )}
                      </p>
                      <p className="text-muted-foreground">{i.detail}</p>
                      {i.people && (
                        <p className="text-xs">
                          {i.people.map((p, n) => (
                            <span key={`${p.leadId ?? p.contactId ?? p.name}-${n}`}>
                              {n > 0 && ', '}
                              <Link className="underline underline-offset-2" href={p.leadId ? `/app/leads/${p.leadId}` : `/app/contacts/${p.contactId}`}>
                                {p.name}
                              </Link>
                            </span>
                          ))}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Table
            title="By sequence"
            first="Sequence"
            rows={q.data.bySequence.map((s) => ({
              key: s.id,
              c: s,
              name: (
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={`/app/sequences/${s.id}`} className="font-medium underline underline-offset-2">
                    {s.name}
                  </Link>
                  <Badge tone={SEQUENCE_TONE[s.status]}>{titleCase(s.status)}</Badge>
                  {s.abTested && <Badge tone="accent">A/B test</Badge>}
                  <span className="text-xs text-muted-foreground">{s.enrolled} enrolled</span>
                </span>
              ),
            }))}
          />
          <Table
            title="By sending mailbox"
            first="Sender"
            rows={q.data.byMailbox.map((m) => ({ key: m.userId, c: m, name: <span>{m.name}{m.mailbox && <span className="block text-xs text-muted-foreground">{m.mailbox}</span>}</span> }))}
          />
          <Table title="By template" first="Template" rows={q.data.byTemplate.map((x) => ({ key: x.id ?? 'none', c: x, name: x.name }))} />
          <Table title="First email and follow-ups" first="Email in the sequence" rows={q.data.byStepPosition.map((x) => ({ key: String(x.position), c: x, name: x.position === 1 ? 'First email' : `Follow-up ${x.position - 1}` }))} />
        </>
      )}
    </div>
  );
}

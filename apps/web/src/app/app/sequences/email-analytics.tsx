'use client';

import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import type { AnalyticsCounts, EmailInsight } from '@dealflow/types';
import Link from 'next/link';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { ErrorText } from '@/components/revenue/tabs';
import { titleCase } from '@/lib/crm';
import { pct, SEQUENCE_TONE, useEmailAnalytics } from '@/lib/sequences';
import { type Translator, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

const PERIODS = [7, 30, 90, 365] as const;

/** "5 hours", "3 Tage": the language's own plural, from Intl. */
const unit = (t: Translator, n: number, u: 'hour' | 'day') => new Intl.NumberFormat(t.language, { style: 'unit', unit: u, unitDisplay: 'long' }).format(n);

/** A tip in the reader's language, written from its numbers. Unknown kinds keep the API's English. */
export function insightText(i: EmailInsight, t: Translator): { title: string; detail: string } {
  const f = i.facts ?? {};
  switch (i.kind) {
    case 'quiet_step':
      return {
        title: t('{sequence}: email {email} has no replies', f),
        detail: t('{sent} sent in this period and none answered. Try a different angle or a shorter email; the Email Assistant can rewrite it.', f),
      };
    case 'ab_leader':
      return {
        title: t('{sequence}: version {leader} of email {email} gets more replies', f),
        detail: t('Version A {rateA}% of {sentA}, version B {rateB}% of {sentB}. The gap is unlikely to be chance (95% level); consider keeping version {leader}.', f),
      };
    case 'high_bounce':
      return {
        title: t('{sequence}: {rate}% of emails bounced', f),
        detail: t("{bounced} of {sent} bounced. Verify addresses before enrolling more people; a high bounce rate can hurt your mailbox's reputation.", f),
      };
    case 'reply_timing':
      return {
        title: t('Half of replies arrive within {time}', { time: f.hours !== undefined ? unit(t, Number(f.hours), 'hour') : unit(t, Number(f.days), 'day') }),
        detail: t('From {replies} replies in this period. Waiting about {wait} before a follow-up gives most people time to answer first.', { replies: f.replies ?? 0, wait: unit(t, Number(f.waitDays), 'day') }),
      };
    case 'disengaged':
      return {
        title: t('People who had 3 or more emails with no reply, open or click: {people}', f),
        detail: t('Consider pausing them or trying another channel. Opens are often blocked, so some may still be reading.'),
      };
    default:
      return { title: i.title, detail: i.detail };
  }
}

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
  const t = useT();
  return (
    <thead className="border-b border-border text-start text-xs text-muted-foreground">
      <tr>
        <th className="px-3 py-2 font-medium">{first}</th>
        <th className="px-3 py-2 text-end font-medium">{t('Sent')}</th>
        <th className="px-3 py-2 text-end font-medium">{t('Replied')}</th>
        <th className="px-3 py-2 text-end font-medium">{t('Opened (estimate)')}</th>
        <th className="px-3 py-2 text-end font-medium">{t('Clicked')}</th>
        <th className="px-3 py-2 text-end font-medium">{t('Bounced')}</th>
        <th className="px-3 py-2 text-end font-medium">{t('Unsubscribed')}</th>
      </tr>
    </thead>
  );
}

function Table({ title, first, rows }: { title: string; first: string; rows: { key: string; name: React.ReactNode; c: AnalyticsCounts }[] }) {
  const t = useT();
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {rows.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground">{t('Nothing sent in this period.')}</p>
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
  const t = useT();
  const totals = q.data?.totals;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="ea-days" className="block text-xs font-medium">
            {t('Period')}
          </label>
          <Select id="ea-days" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            {PERIODS.map((d) => (
              <option key={d} value={d}>
                {t('Last {days} days', { days: d })}
              </option>
            ))}
          </Select>
        </div>
        {canTeam && (
          <div>
            <label htmlFor="ea-scope" className="block text-xs font-medium">
              {t('Whose emails')}
            </label>
            <Select id="ea-scope" value={scope} onChange={(e) => setScope(e.target.value as 'mine' | 'team')}>
              <option value="mine">{t('Mine')}</option>
              <option value="team">{t('Whole team')}</option>
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
            <Stat label={t('Emails sent')} value={totals!.sent} />
            <Stat label={t('Reply rate')} value={pct(totals!.replied, totals!.sent)} note={t('Replies: {count}', { count: totals!.replied })} />
            <Stat label={t('Bounce rate')} value={pct(totals!.bounced, totals!.sent)} note={t('Bounced: {count}', { count: totals!.bounced })} />
            <Stat label={t('People enrolled')} value={totals!.enrolled} note={t('Finished: {done}, failed: {failed}', { done: totals!.completed, failed: totals!.failed })} />
          </div>
          <p className="text-xs text-muted-foreground">
            {t('Replies and bounces come from your synced mailbox and are reliable. Opens are estimates: some mail apps load images by themselves and others block them. Some clicks come from security scanners. Delivery is not shown because mail providers do not report it.')}
          </p>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{t('Tips')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {q.data.insights.length === 0 ? (
                <p className="text-muted-foreground">{t('No tips yet. Tips appear once there is enough data, for example 20 emails from one step or 10 replies.')}</p>
              ) : (
                <ul className="space-y-3">
                  {q.data.insights.map((i) => {
                    const text = insightText(i, t);
                    return (
                    <li key={`${i.kind}-${i.title}`}>
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <Badge tone={i.severity === 'warning' ? 'warning' : 'primary'}>{i.severity === 'warning' ? t('Check') : t('Tip')}</Badge>
                        {i.sequenceId ? (
                          <Link href={`/app/sequences/${i.sequenceId}`} className="underline underline-offset-2">
                            {text.title}
                          </Link>
                        ) : (
                          text.title
                        )}
                      </p>
                      <p className="text-muted-foreground">{text.detail}</p>
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
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
          <Table
            title={t('By sequence')}
            first={t('Sequence')}
            rows={q.data.bySequence.map((s) => ({
              key: s.id,
              c: s,
              name: (
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={`/app/sequences/${s.id}`} className="font-medium underline underline-offset-2">
                    {s.name}
                  </Link>
                  <Badge tone={SEQUENCE_TONE[s.status]}>{t.maybe(titleCase(s.status))}</Badge>
                  {s.abTested && <Badge tone="accent">{t('A/B test')}</Badge>}
                  <span className="text-xs text-muted-foreground">{t('Enrolled: {count}', { count: s.enrolled })}</span>
                </span>
              ),
            }))}
          />
          <Table
            title={t('By sending mailbox')}
            first={t('Sender')}
            rows={q.data.byMailbox.map((m) => ({ key: m.userId, c: m, name: <span>{m.name}{m.mailbox && <span className="block text-xs text-muted-foreground">{m.mailbox}</span>}</span> }))}
          />
          <Table title={t('By template')} first={t('Template')} rows={q.data.byTemplate.map((x) => ({ key: x.id ?? 'none', c: x, name: x.id ? x.name : t.maybe(x.name) }))} />
          <Table
            title={t('First email and follow-ups')}
            first={t('Email in the sequence')}
            rows={q.data.byStepPosition.map((x) => ({ key: String(x.position), c: x, name: x.position === 1 ? t('First email') : t('Follow-up {n}', { n: x.position - 1 }) }))}
          />
        </>
      )}
    </div>
  );
}

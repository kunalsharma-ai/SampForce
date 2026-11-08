'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import { CONSENT_MODES, type ImportantPage, PAGE_KIND_LABELS, PAGE_KINDS, VISITOR_DASHBOARD_DAYS, type VisitorDetail, type VisitorRow, type VisitorSettings, type VisitorSettingsInput } from '@dealflow/types';
import Link from 'next/link';
import { useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { formatDate } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import { useCan } from '@/lib/session';
import { ENQUIRY_FORM_EXAMPLE, formatDuration, installSnippet, useRecordWebActivity, useVisitor, useVisitorDashboard, useVisitorMutation, useVisitors, useVisitorSettings, visitorsApi, type VisitorSegment } from '@/lib/visitors';
import { fmtLocale } from '@/lib/i18n/locale';
import { rich, useT } from '@/lib/i18n';
import { InfoTip } from '@/components/info-tip';
import { gated } from '@/components/shell/feature-locked';

type Tab = 'dashboard' | 'visitors' | 'settings';

export function VisitorsWorkspace() {
  const t = useT();
  const settings = useVisitorSettings();
  const canManage = useCan('visitors:manage');
  const [tab, setTab] = useState<Tab | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  if (settings.isPending) return <Skeleton className="h-64" />;
  if (!settings.data) return <p role="alert" className="text-sm text-critical">{settings.error?.message}</p>;
  const tabs: { key: Tab; label: string }[] = [
    { key: 'dashboard', label: t('Dashboard') },
    { key: 'visitors', label: t('Visitors') },
    { key: 'settings', label: canManage ? t('Install and settings') : t('Settings') },
  ];
  const current = tab ?? (settings.data.enabled ? 'dashboard' : 'settings');
  return (
    <div className="space-y-4">
      {!settings.data.enabled && (
        <Card>
          <CardContent className="p-5 text-sm">
            <p className="font-medium">{t('Website tracking is off.')}</p>
            <p className="mt-1 text-muted-foreground">{canManage ? t('Add your website, choose how consent works, then install the script and turn tracking on.') : t('An admin or manager can install the tracking script and turn it on.')}</p>
          </CardContent>
        </Card>
      )}
      <div role="tablist" aria-label={t('Website visitors')} className="flex flex-wrap gap-1 border-b border-border">
        {tabs.map((item) => (
          <button
            key={item.key}
            role="tab"
            id={`wv-tab-${item.key}`}
            aria-selected={current === item.key}
            aria-controls={`wv-panel-${item.key}`}
            onClick={() => (setTab(item.key), setJustSaved(false))}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', current === item.key ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`wv-panel-${current}`} aria-labelledby={`wv-tab-${current}`}>
        {current === 'dashboard' && <Dashboard />}
        {current === 'visitors' && <VisitorList />}
        {current === 'settings' && <SettingsPanel key={settings.data.updatedAt ?? 'new'} s={settings.data} canManage={canManage} justSaved={justSaved} onSaved={() => (setTab('settings'), setJustSaved(true))} />}
      </div>
      <p className="text-xs text-muted-foreground">
        {t('Visitors stay anonymous until they send an enquiry. SampForce does not look up IP addresses, fingerprint browsers or buy identity data, so most visitors will never have a name.')}
      </p>
    </div>
  );
}

// ───────────── dashboard ─────────────

function Dashboard() {
  const t = useT();
  const [days, setDays] = useState<number>(30);
  const [open, setOpen] = useState<string | null>(null);
  const q = useVisitorDashboard(days);
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div role="group" aria-label={t('Time range')} className="inline-flex rounded-md border border-border p-0.5 text-sm">
          {VISITOR_DASHBOARD_DAYS.map((n) => (
            <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)} className={cn('rounded px-3 py-1', days === n ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {t.plural('count.days', n)}
            </button>
          ))}
        </div>
      </div>
      {q.isPending ? (
        <Skeleton className="h-64" />
      ) : !d ? (
        <p role="alert" className="text-sm text-critical">{q.error?.message}</p>
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              [t('Visitors'), d.totals.visitors],
              [t('Visits'), d.totals.visits],
              [t('Page views'), d.totals.pageViews],
              [t('Returning visitors'), d.totals.returning],
              [t('Enquiries'), d.totals.enquiries],
              [t('Leads created'), d.totals.leadsCreated],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-surface/80 p-4 shadow-sm">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <VisitsChart daily={d.daily} />
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-1.5">
                  <CardTitle className="text-base">{t('High-intent visitors')}</CardTitle>
                  <InfoTip topic="visitors.highIntent" />
                </div>
              </CardHeader>
              <CardContent>
                {d.highIntent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('None in this period.')}</p>
                ) : (
                  <ul className="divide-y divide-border text-sm" aria-label={t('High-intent visitors')}>
                    {d.highIntent.map((v) => (
                      <li key={v.id} className="flex items-center justify-between gap-2 py-2">
                        <button type="button" className="text-start font-medium underline underline-offset-2" onClick={() => setOpen(v.id)}>
                          {v.label}
                        </button>
                        <span className="text-muted-foreground">{v.intent.score}/100 · {relativeTime(v.lastSeenAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('Important pages')}</CardTitle>
              </CardHeader>
              <CardContent>
                <SimpleTable caption={t('Views of important pages')} head={[t('Page'), t('Type'), t('Views'), t('Visitors')]} rows={d.importantPages.map((p) => [p.label, t.maybe(PAGE_KIND_LABELS[p.kind]), p.views, p.visitors])} empty={t('No views of important pages yet.')} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t('Top pages')}</CardTitle>
              </CardHeader>
              <CardContent>
                <SimpleTable caption={t('Most viewed pages')} head={[t('Path'), t('Views'), t('Visitors')]} rows={d.topPages.map((p) => [p.label ? `${p.path} (${p.label})` : p.path, p.views, p.visitors])} empty={t('No page views yet.')} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-1.5">
                  <CardTitle className="text-base">{t('Sources and campaigns')}</CardTitle>
                  <InfoTip topic="visitors.sources" />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <SimpleTable caption={t('Visits by source')} head={[t('Source'), t('Visits')]} rows={d.sources.map((s) => [s.source, s.visits])} empty={t('No visits yet.')} />
                <SimpleTable
                  caption={t('Visits by UTM campaign')}
                  head={[t('Campaign'), t('Visits'), t('Visitors'), t('Leads')]}
                  rows={d.campaigns.map((c) => [c.campaign ? c.campaign.name : t('{value} (no matching campaign)', { value: c.utmCampaign ?? '' }), c.visits, c.visitors, c.leads])}
                  empty={t('No visits with a utm_campaign yet.')}
                />
                <p className="text-xs text-muted-foreground">{t("Source is utm_source, otherwise the referring site. A utm_campaign is matched to a SampForce campaign by its UTM campaign value; leads from enquiries take the visitor's first campaign.")}</p>
              </CardContent>
            </Card>
          </div>
        </>
      )}
      {open && <VisitorDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function VisitsChart({ daily }: { daily: { day: string; visitors: number; visits: number; pageViews: number }[] }) {
  const t = useT();
  const w = 720;
  const h = 140;
  const max = Math.max(1, ...daily.map((d) => d.visits));
  const slot = w / Math.max(1, daily.length);
  const bar = Math.max(2, Math.min(18, slot - 2));
  const total = daily.reduce((a, d) => a + d.visits, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('Visits per day')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" role="img" aria-label={total === 0 ? t('Visits per day, none yet.') : t('Visits per day, {total} in total. Busiest day {max} visits.', { total, max })}>
          <line x1={0} x2={w} y1={h - 0.5} y2={h - 0.5} stroke="hsl(var(--border))" />
          {daily.map((d, i) => {
            const bh = d.visits ? Math.max(2, (d.visits / max) * (h - 8)) : 0;
            return (
              <g key={d.day}>
                <title>{t('{day}: {visits} visits, {visitors} visitors, {views} page views', { day: formatDate(d.day), visits: d.visits, visitors: d.visitors, views: d.pageViews })}</title>
                <rect x={i * slot} y={0} width={slot} height={h} fill="transparent" />
                {bh > 0 && <rect x={i * slot + (slot - bar) / 2} y={h - bh} width={bar} height={bh} rx={Math.min(4, bar / 2)} fill="hsl(var(--primary))" />}
              </g>
            );
          })}
        </svg>
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">{t('Show as table')}</summary>
          <SimpleTable caption={t('Visits per day')} head={[t('Day'), t('Visits'), t('Visitors'), t('Page views')]} rows={daily.map((d) => [formatDate(d.day), d.visits, d.visitors, d.pageViews])} empty="" />
        </details>
      </CardContent>
    </Card>
  );
}

function SimpleTable({ caption, head, rows, empty }: { caption: string; head: string[]; rows: (string | number)[][]; empty: string }) {
  if (!rows.length) return empty ? <p className="text-sm text-muted-foreground">{empty}</p> : null;
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead className="text-start text-xs text-muted-foreground">
        <tr>
          {head.map((x, i) => (
            <th key={x} scope="col" className={cn('py-1.5 font-medium', i > 0 && typeof rows[0]![i] === 'number' && 'text-end')}>{x}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) =>
              j === 0 ? (
                <th key={j} scope="row" className="max-w-[18rem] truncate py-1.5 text-start font-normal">{c}</th>
              ) : (
                <td key={j} className={cn('py-1.5', typeof c === 'number' && 'text-end tabular-nums')}>{c}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ───────────── visitors ─────────────

const SEGMENTS: { key: VisitorSegment; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'identified', label: 'Known' },
  { key: 'high_intent', label: 'High intent' },
  { key: 'anonymous', label: 'Anonymous' },
];

function VisitorList() {
  const t = useT();
  const [segment, setSegment] = useState<VisitorSegment>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const q = useVisitors(segment, search.trim());
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-end justify-between gap-3 space-y-0">
        <div role="group" aria-label={t('Show')} className="inline-flex rounded-md border border-border p-0.5 text-sm">
          {SEGMENTS.map((s) => (
            <button key={s.key} type="button" aria-pressed={segment === s.key} onClick={() => setSegment(s.key)} className={cn('rounded px-3 py-1', segment === s.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {t.maybe(s.label)}
            </button>
          ))}
        </div>
        <Input aria-label={t('Search known visitors')} placeholder={t('Search name or email')} value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-64" />
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {q.isPending ? (
          <Skeleton className="h-40" />
        ) : !q.data?.length ? (
          <p className="text-sm text-muted-foreground">{t('No visitors to show.')}</p>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">{t('Website visitors')}</caption>
            <thead className="text-start text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 font-medium">{t('Visitor')}</th>
                <th scope="col" className="py-2 font-medium">{t('Intent')}</th>
                <th scope="col" className="py-2 text-end font-medium">{t('Visits')}</th>
                <th scope="col" className="py-2 text-end font-medium">{t('Pages')}</th>
                <th scope="col" className="py-2 text-end font-medium">{t('Time')}</th>
                <th scope="col" className="py-2 font-medium">{t('First source')}</th>
                <th scope="col" className="py-2 font-medium">{t('Last seen')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data.map((v) => (
                <tr key={v.id}>
                  <th scope="row" className="py-2 text-start font-normal">
                    <button type="button" className="font-medium underline underline-offset-2" onClick={() => setOpen(v.id)}>{v.label}</button>
                    {v.identified && <span className="block text-xs text-muted-foreground">{v.identified.type === 'lead' ? t('Lead') : t('Contact')}{v.identified.email ? ` · ${v.identified.email}` : ''}</span>}
                  </th>
                  <td className="py-2"><IntentBadge v={v} /></td>
                  <td className="py-2 text-end tabular-nums">{v.visits}</td>
                  <td className="py-2 text-end tabular-nums">{v.pageViews}</td>
                  <td className="py-2 text-end tabular-nums">{formatDuration(v.engagedSeconds)}</td>
                  <td className="py-2">{v.campaign?.name ?? v.firstTouch?.source ?? v.firstTouch?.referrer ?? t('Direct')}</td>
                  <td className="py-2 text-muted-foreground">{relativeTime(v.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
      {open && <VisitorDialog id={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function IntentBadge({ v }: { v: Pick<VisitorRow, 'intent'> }) {
  const t = useT();
  return <Badge tone={v.intent.high ? 'warning' : v.intent.score > 0 ? 'primary' : 'neutral'}>{v.intent.high ? t('High') : v.intent.score > 0 ? t('Some') : t('None')} · {v.intent.score}</Badge>;
}

function VisitorDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const q = useVisitor(id);
  const canManage = useCan('visitors:manage');
  const [confirm, setConfirm] = useState(false);
  const erase = useVisitorMutation(() => visitorsApi.erase(id), onClose);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" className="flex flex-col gap-4 overflow-y-auto p-5 sm:max-w-xl">
        <div>
          <DialogTitle className="text-lg font-semibold">{q.data?.label ?? t('Visitor')}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{t('Visits recorded by the tracking script on your website.')}</DialogDescription>
        </div>
        {q.isPending ? <Skeleton className="h-40" /> : q.data ? <VisitorBody v={q.data} /> : <p role="alert" className="text-sm text-critical">{q.error?.message}</p>}
        {canManage && q.data && (
          <div className="border-t border-border pt-3">
            {erase.error && <p role="alert" className="mb-2 text-sm text-critical">{erase.error.message}</p>}
            {confirm ? (
              <Button variant="destructive" size="sm" disabled={erase.isPending} onClick={() => erase.mutate(undefined)}>{t('Delete this browsing history')}</Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>{t('Delete browsing history')}</Button>
            )}
            <p className="mt-1 text-xs text-muted-foreground">{t('For privacy requests. Removes the visits and page views; the lead or contact stays.')}</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function VisitorBody({ v }: { v: VisitorDetail }) {
  const t = useT();
  return (
    <div className="space-y-4 text-sm">
      {v.identified ? (
        <p>
          {rich(v.identified.type === 'lead' ? t('Identified by an enquiry as {name} (lead).') : t('Identified by an enquiry as {name} (contact).'), {
            name: (
              <Link className="font-medium text-primary underline underline-offset-2" href={`/app/${v.identified.type === 'lead' ? 'leads' : 'contacts'}/${v.identified.id}`}>
                {v.identified.name}
              </Link>
            ),
          })}
        </p>
      ) : (
        <p className="text-muted-foreground">{t('Anonymous. This visitor has not sent an enquiry.')}</p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          [t('Visits'), v.visits],
          [t('Page views'), v.pageViews],
          [t('Time on site'), formatDuration(v.engagedSeconds)],
          [t('First seen'), formatDate(v.firstSeenAt)],
        ].map(([k, x]) => (
          <div key={k}>
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className="font-medium">{x}</p>
          </div>
        ))}
      </div>
      <div>
        <p className="font-medium">
          {t('Intent {score}/100', { score: v.intent.score })} {v.intent.high && <Badge tone="warning">{t('High intent')}</Badge>}
        </p>
        {v.intent.signals.length ? (
          <ul className="mt-1 space-y-0.5" aria-label={t('Intent signals')}>
            {v.intent.signals.map((s) => (
              <li key={s.key} className="flex justify-between gap-2">
                <span>{t.maybe(s.label)}</span>
                <span className="tabular-nums text-muted-foreground">{s.points > 0 ? `+${s.points}` : s.points}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">{t('No intent signals yet.')}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{t('Rule-based: repeat visits, important pages, time on site and enquiries. Not a prediction.')}</p>
      </div>
      {(v.firstTouch || v.campaign) && (
        <p>
          <span className="text-muted-foreground">{t('First came from')} </span>
          {[v.campaign?.name, v.firstTouch?.source && `utm_source ${v.firstTouch.source}`, v.firstTouch?.medium && `utm_medium ${v.firstTouch.medium}`, v.firstTouch?.referrer].filter(Boolean).join(' · ')}
        </p>
      )}
      <ol className="space-y-3" aria-label={t('Visits')}>
        {v.sessions.map((s) => (
          <li key={s.id} className="rounded-md border border-border p-3">
            <p className="font-medium">
              {formatDate(s.startedAt)} {new Date(s.startedAt).toLocaleTimeString(fmtLocale(), { hour: 'numeric', minute: '2-digit' })}
              <span className="font-normal text-muted-foreground">
                {s.referrer ? ` · ${t('from {name}', { name: s.referrer })}` : ''}
                {s.utm?.campaign ? ` · ${s.utm.campaign}` : ''}
                {s.engagedSeconds ? ` · ${formatDuration(s.engagedSeconds)}` : ''}
              </span>
            </p>
            <ul className="mt-1 space-y-0.5">
              {s.events.map((e, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">
                    {e.type === 'enquiry' ? <strong>{t('Sent an enquiry')}</strong> : e.type === 'event' ? t('Event: {name}', { name: e.name ?? '' }) : e.path}
                    {e.label && <Badge className="ms-2">{e.label}</Badge>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{new Date(e.at).toLocaleTimeString(fmtLocale(), { hour: 'numeric', minute: '2-digit' })}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Website activity on a lead or contact page. Hidden when the person has no recorded visits. */
function RecordWebActivityCardPanel({ type, id }: { type: 'lead' | 'contact'; id: string }) {
  const t = useT();
  const can = useCan('visitors:read');
  const q = useRecordWebActivity(type, id, can);
  const [open, setOpen] = useState<string | null>(null);
  if (!can || !q.data?.visitors.length) return null;
  const v = q.data.visitors[0]!;
  const visits = q.data.visitors.reduce((a, x) => a + x.visits, 0);
  const lastPages = v.sessions.flatMap((s) => s.events).filter((e) => e.type === 'page').slice(-5).reverse();
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{t('Website activity')}</CardTitle>
        <IntentBadge v={v} />
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {t.plural('count.visitsLast', visits, { time: relativeTime(v.lastSeenAt) })}
          {v.campaign ? ` · ${t('first from {name}', { name: v.campaign.name })}` : ''}
        </p>
        {v.intent.signals.length > 0 && (
          <ul className="space-y-0.5" aria-label={t('Website intent signals')}>
            {v.intent.signals.slice(0, 4).map((s) => (
              <li key={s.key}>{t.maybe(s.label)}</li>
            ))}
          </ul>
        )}
        {lastPages.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground">{t('Recent pages')}</p>
            <ul className="mt-0.5 space-y-0.5">
              {lastPages.map((e, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">{e.path}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(e.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Button size="sm" variant="outline" onClick={() => setOpen(v.id)}>{t('All visits')}</Button>
      </CardContent>
      {open && <VisitorDialog id={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

// ───────────── install and settings ─────────────

function SettingsPanel({ s, canManage, justSaved, onSaved }: { s: VisitorSettings; canManage: boolean; justSaved: boolean; onSaved: () => void }) {
  const t = useT();
  const [form, setForm] = useState<VisitorSettingsInput>({
    enabled: s.enabled, consentMode: s.consentMode, allowedDomains: s.allowedDomains, retentionDays: s.retentionDays, createLeads: s.createLeads,
    enquiryConsentText: s.enquiryConsentText, highIntentScore: s.highIntentScore, importantPages: s.importantPages,
  });
  const [domains, setDomains] = useState(s.allowedDomains.join('\n'));
  // The panel remounts with the saved values, so "Saved." is carried over by the parent.
  const [saved, setSaved] = useState(justSaved);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const save = useVisitorMutation((b: VisitorSettingsInput) => visitorsApi.saveSettings(b), onSaved);
  const rotate = useVisitorMutation(() => visitorsApi.rotateKey(), () => setConfirmRotate(false));
  const set = (p: Partial<VisitorSettingsInput>) => {
    setSaved(false);
    setForm((f) => ({ ...f, ...p }));
  };
  const setPage = (i: number, p: Partial<ImportantPage>) => set({ importantPages: form.importantPages.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const disabled = !canManage;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({ ...form, allowedDomains: domains.split(/[\s,]+/).map((d) => d.trim().toLowerCase()).filter(Boolean) });
  };
  return (
    <form className="space-y-4" onSubmit={submit}>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle className="text-base">{t('Install on your website')}</CardTitle>
            <InfoTip topic="visitors.install" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>{t('Paste this before the closing </head> tag on every page. It only works on the websites listed below.')}</p>
          <pre tabIndex={0} className="overflow-x-auto rounded-md bg-muted p-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t('Install snippet')}><code>{installSnippet(origin, s.siteKey, form.consentMode)}</code></pre>
          <details>
            <summary className="cursor-pointer">{t('Enquiry form example')}</summary>
            <p className="mt-2 text-muted-foreground">{t('Any form with data-sampforce-enquiry is sent to SampForce as an enquiry. Field names: fullName, email, companyName, phone, message and consent.')}</p>
            <pre tabIndex={0} aria-label={t('Enquiry form example code')} className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><code>{ENQUIRY_FORM_EXAMPLE}</code></pre>
          </details>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              {confirmRotate ? (
                <Button type="button" size="sm" variant="destructive" disabled={rotate.isPending} onClick={() => rotate.mutate(undefined)}>{t('Replace the key (the current snippet stops working)')}</Button>
              ) : (
                <Button type="button" size="sm" variant="outline" onClick={() => setConfirmRotate(true)}>{t('New site key')}</Button>
              )}
              <span className="text-xs text-muted-foreground">{t('The site key is public; it only names your workspace.')}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle className="text-base">{t('Tracking and consent')}</CardTitle>
            <InfoTip topic="visitors.consent" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={disabled} checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            <span className="font-medium">{t('Record website visits')}</span>
          </label>
          <label className="block space-y-1">
            <span className="font-medium">{t('Websites allowed to send data')}</span>
            <Textarea disabled={disabled} rows={3} value={domains} onChange={(e) => (setSaved(false), setDomains(e.target.value))} placeholder={'www.example.com\n*.example.com'} />
            <span className="block text-xs text-muted-foreground">{t('One host name per line. *.example.com covers its subdomains.')}</span>
          </label>
          <fieldset className="space-y-2">
            <legend className="font-medium">{t('Consent')}</legend>
            {CONSENT_MODES.map((m) => (
              <label key={m} className="flex items-start gap-2">
                <input type="radio" name="consentMode" disabled={disabled} checked={form.consentMode === m} onChange={() => set({ consentMode: m })} className="mt-1" />
                <span>
                  {m === 'opt_in' ? (
                    <>
                      <span className="font-medium">{t('Ask first (recommended).')}</span> {t("Nothing is recorded until your cookie banner calls sampforce('consent', true). Required in the EU, UK and similar regions.")}
                    </>
                  ) : (
                    <>
                      <span className="font-medium">{t('Notice only.')}</span> {t('Recorded unless the visitor declines. Use only where your lawyers confirm this is allowed for your visitors.')}
                    </>
                  )}
                </span>
              </label>
            ))}
            <p className="text-xs text-muted-foreground">{t('Either way, browsers sending Global Privacy Control or Do Not Track are never recorded.')}</p>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="font-medium">{t('Keep visit data for (days)')}</span>
              <Input type="number" min={30} max={730} disabled={disabled} value={form.retentionDays} onChange={(e) => set({ retentionDays: Number(e.target.value) })} />
              <span className="block text-xs text-muted-foreground">{t('Older visits are deleted every hour. Enquiries and links to leads and contacts are kept.')}</span>
            </label>
            <label className="block space-y-1">
              <span className="font-medium">{t('High intent from score')}</span>
              <Input type="number" min={10} max={100} disabled={disabled} value={form.highIntentScore} onChange={(e) => set({ highIntentScore: Number(e.target.value) })} />
              <span className="block text-xs text-muted-foreground">{t('Known visitors reaching it notify the record owner and can start a workflow ("They show high intent on your website").')}</span>
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={disabled} checked={form.createLeads} onChange={(e) => set({ createLeads: e.target.checked })} />
            {t('Create a lead from an enquiry when the email matches no contact or open lead')}
          </label>
          <label className="block space-y-1">
            <span className="font-medium">{t('Marketing consent text on enquiry forms')}</span>
            <Textarea disabled={disabled} rows={2} maxLength={500} value={form.enquiryConsentText ?? ''} onChange={(e) => set({ enquiryConsentText: e.target.value || null })} placeholder={t('Send me product news. I can unsubscribe at any time.')} />
            <span className="block text-xs text-muted-foreground">{t('Leave empty to hide the checkbox. Consent is recorded only when this text was shown and ticked.')}</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-1.5">
            <CardTitle className="text-base">{t('Important pages')}</CardTitle>
            <InfoTip topic="visitors.importantPages" />
          </div>
        </CardHeader>
        <CardContent className="space-y-2 overflow-x-auto text-sm">
          <table className="w-full min-w-[620px]">
            <caption className="sr-only">{t('Important pages and their intent points')}</caption>
            <thead className="text-start text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-1.5 font-medium">{t('Path')}</th>
                <th scope="col" className="py-1.5 font-medium">{t('Name')}</th>
                <th scope="col" className="py-1.5 font-medium">{t('Type')}</th>
                <th scope="col" className="py-1.5 font-medium">{t('Intent points')}</th>
                <th scope="col" className="py-1.5"><span className="sr-only">{t('Remove')}</span></th>
              </tr>
            </thead>
            <tbody>
              {form.importantPages.map((p, i) => (
                <tr key={i}>
                  <td className="py-1 pe-2"><Input aria-label={t('Page {n} path', { n: i + 1 })} disabled={disabled} className="h-9" value={p.pattern} onChange={(e) => setPage(i, { pattern: e.target.value })} /></td>
                  <td className="py-1 pe-2"><Input aria-label={t('Page {n} name', { n: i + 1 })} disabled={disabled} className="h-9" value={p.label} onChange={(e) => setPage(i, { label: e.target.value })} /></td>
                  <td className="py-1 pe-2">
                    <Select aria-label={t('Page {n} type', { n: i + 1 })} disabled={disabled} className="h-9" value={p.kind} onChange={(e) => setPage(i, { kind: e.target.value as ImportantPage['kind'] })}>
                      {PAGE_KINDS.map((k) => (
                        <option key={k} value={k}>{t.maybe(PAGE_KIND_LABELS[k])}</option>
                      ))}
                    </Select>
                  </td>
                  <td className="py-1 pe-2"><Input aria-label={t('Page {n} intent points', { n: i + 1 })} type="number" min={0} max={50} disabled={disabled} className="h-9 w-24" value={p.weight} onChange={(e) => setPage(i, { weight: Number(e.target.value) })} /></td>
                  <td className="py-1">{canManage && <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${p.label || `page ${i + 1}`}`} onClick={() => set({ importantPages: form.importantPages.filter((_, j) => j !== i) })}>{t('Remove')}</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {canManage && form.importantPages.length < 30 && (
            <Button type="button" size="sm" variant="outline" onClick={() => set({ importantPages: [...form.importantPages, { pattern: '/', label: '', kind: 'product', weight: 10 }] })}>{t('Add page')}</Button>
          )}
          <p className="text-xs text-muted-foreground">{t('/pricing matches /pricing and everything under it. A path ending in * matches anything that starts with it.')}</p>
        </CardContent>
      </Card>

      {save.error && <p role="alert" className="text-sm text-critical">{save.error.message}</p>}
      {canManage && (
        <div className="flex items-center justify-end gap-3">
          {saved && <p role="status" className="text-sm text-success">{t('Saved.')}</p>}
          <Button type="submit" disabled={save.isPending}>{t('Save settings')}</Button>
        </div>
      )}
    </form>
  );
}

/** Shown only while the plan includes website_visitors (ADR 0057). */
export const RecordWebActivityCard = gated('website_visitors', RecordWebActivityCardPanel);

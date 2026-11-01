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

type Tab = 'dashboard' | 'visitors' | 'settings';

export function VisitorsWorkspace() {
  const settings = useVisitorSettings();
  const canManage = useCan('visitors:manage');
  const [tab, setTab] = useState<Tab | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  if (settings.isPending) return <Skeleton className="h-64" />;
  if (!settings.data) return <p role="alert" className="text-sm text-critical">{settings.error?.message}</p>;
  const tabs: { key: Tab; label: string }[] = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'visitors', label: 'Visitors' },
    { key: 'settings', label: canManage ? 'Install and settings' : 'Settings' },
  ];
  const current = tab ?? (settings.data.enabled ? 'dashboard' : 'settings');
  return (
    <div className="space-y-4">
      {!settings.data.enabled && (
        <Card>
          <CardContent className="p-5 text-sm">
            <p className="font-medium">Website tracking is off.</p>
            <p className="mt-1 text-muted-foreground">{canManage ? 'Add your website, choose how consent works, then install the script and turn tracking on.' : 'An admin or manager can install the tracking script and turn it on.'}</p>
          </CardContent>
        </Card>
      )}
      <div role="tablist" aria-label="Website visitors" className="flex flex-wrap gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            id={`wv-tab-${t.key}`}
            aria-selected={current === t.key}
            aria-controls={`wv-panel-${t.key}`}
            onClick={() => (setTab(t.key), setJustSaved(false))}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', current === t.key ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`wv-panel-${current}`} aria-labelledby={`wv-tab-${current}`}>
        {current === 'dashboard' && <Dashboard />}
        {current === 'visitors' && <VisitorList />}
        {current === 'settings' && <SettingsPanel key={settings.data.updatedAt ?? 'new'} s={settings.data} canManage={canManage} justSaved={justSaved} onSaved={() => (setTab('settings'), setJustSaved(true))} />}
      </div>
      <p className="text-xs text-muted-foreground">
        Visitors stay anonymous until they send an enquiry. DealFlow does not look up IP addresses, fingerprint browsers or buy identity data, so most visitors will never have a name.
      </p>
    </div>
  );
}

// ───────────── dashboard ─────────────

function Dashboard() {
  const [days, setDays] = useState<number>(30);
  const [open, setOpen] = useState<string | null>(null);
  const q = useVisitorDashboard(days);
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <div role="group" aria-label="Time range" className="inline-flex rounded-md border border-border p-0.5 text-sm">
          {VISITOR_DASHBOARD_DAYS.map((n) => (
            <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)} className={cn('rounded px-3 py-1', days === n ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {n} days
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
              ['Visitors', d.totals.visitors],
              ['Visits', d.totals.visits],
              ['Page views', d.totals.pageViews],
              ['Returning visitors', d.totals.returning],
              ['Enquiries', d.totals.enquiries],
              ['Leads created', d.totals.leadsCreated],
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
                <CardTitle className="text-base">High-intent visitors</CardTitle>
              </CardHeader>
              <CardContent>
                {d.highIntent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None in this period.</p>
                ) : (
                  <ul className="divide-y divide-border text-sm" aria-label="High-intent visitors">
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
                <CardTitle className="text-base">Important pages</CardTitle>
              </CardHeader>
              <CardContent>
                <SimpleTable caption="Views of important pages" head={['Page', 'Type', 'Views', 'Visitors']} rows={d.importantPages.map((p) => [p.label, PAGE_KIND_LABELS[p.kind], p.views, p.visitors])} empty="No views of important pages yet." />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top pages</CardTitle>
              </CardHeader>
              <CardContent>
                <SimpleTable caption="Most viewed pages" head={['Path', 'Views', 'Visitors']} rows={d.topPages.map((p) => [p.label ? `${p.path} (${p.label})` : p.path, p.views, p.visitors])} empty="No page views yet." />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sources and campaigns</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <SimpleTable caption="Visits by source" head={['Source', 'Visits']} rows={d.sources.map((s) => [s.source, s.visits])} empty="No visits yet." />
                <SimpleTable
                  caption="Visits by UTM campaign"
                  head={['Campaign', 'Visits', 'Visitors', 'Leads']}
                  rows={d.campaigns.map((c) => [c.campaign ? c.campaign.name : `${c.utmCampaign} (no matching campaign)`, c.visits, c.visitors, c.leads])}
                  empty="No visits with a utm_campaign yet."
                />
                <p className="text-xs text-muted-foreground">Source is utm_source, otherwise the referring site. A utm_campaign is matched to a DealFlow campaign by its UTM campaign value; leads from enquiries take the visitor&apos;s first campaign.</p>
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
  const w = 720;
  const h = 140;
  const max = Math.max(1, ...daily.map((d) => d.visits));
  const slot = w / Math.max(1, daily.length);
  const bar = Math.max(2, Math.min(18, slot - 2));
  const total = daily.reduce((a, d) => a + d.visits, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Visits per day</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" role="img" aria-label={`Visits per day, ${total} in total. Busiest day ${max === 1 && total === 0 ? 'none' : max} visits.`}>
          <line x1={0} x2={w} y1={h - 0.5} y2={h - 0.5} stroke="hsl(var(--border))" />
          {daily.map((d, i) => {
            const bh = d.visits ? Math.max(2, (d.visits / max) * (h - 8)) : 0;
            return (
              <g key={d.day}>
                <title>{`${formatDate(d.day)}: ${d.visits} visits, ${d.visitors} visitors, ${d.pageViews} page views`}</title>
                <rect x={i * slot} y={0} width={slot} height={h} fill="transparent" />
                {bh > 0 && <rect x={i * slot + (slot - bar) / 2} y={h - bh} width={bar} height={bh} rx={Math.min(4, bar / 2)} fill="hsl(var(--primary))" />}
              </g>
            );
          })}
        </svg>
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
          <SimpleTable caption="Visits per day" head={['Day', 'Visits', 'Visitors', 'Page views']} rows={daily.map((d) => [formatDate(d.day), d.visits, d.visitors, d.pageViews])} empty="" />
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
  const [segment, setSegment] = useState<VisitorSegment>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const q = useVisitors(segment, search.trim());
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-end justify-between gap-3 space-y-0">
        <div role="group" aria-label="Show" className="inline-flex rounded-md border border-border p-0.5 text-sm">
          {SEGMENTS.map((s) => (
            <button key={s.key} type="button" aria-pressed={segment === s.key} onClick={() => setSegment(s.key)} className={cn('rounded px-3 py-1', segment === s.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {s.label}
            </button>
          ))}
        </div>
        <Input aria-label="Search known visitors" placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-64" />
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {q.isPending ? (
          <Skeleton className="h-40" />
        ) : !q.data?.length ? (
          <p className="text-sm text-muted-foreground">No visitors to show.</p>
        ) : (
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">Website visitors</caption>
            <thead className="text-start text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 font-medium">Visitor</th>
                <th scope="col" className="py-2 font-medium">Intent</th>
                <th scope="col" className="py-2 text-end font-medium">Visits</th>
                <th scope="col" className="py-2 text-end font-medium">Pages</th>
                <th scope="col" className="py-2 text-end font-medium">Time</th>
                <th scope="col" className="py-2 font-medium">First source</th>
                <th scope="col" className="py-2 font-medium">Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data.map((v) => (
                <tr key={v.id}>
                  <th scope="row" className="py-2 text-start font-normal">
                    <button type="button" className="font-medium underline underline-offset-2" onClick={() => setOpen(v.id)}>{v.label}</button>
                    {v.identified && <span className="block text-xs text-muted-foreground">{v.identified.type === 'lead' ? 'Lead' : 'Contact'}{v.identified.email ? ` · ${v.identified.email}` : ''}</span>}
                  </th>
                  <td className="py-2"><IntentBadge v={v} /></td>
                  <td className="py-2 text-end tabular-nums">{v.visits}</td>
                  <td className="py-2 text-end tabular-nums">{v.pageViews}</td>
                  <td className="py-2 text-end tabular-nums">{formatDuration(v.engagedSeconds)}</td>
                  <td className="py-2">{v.campaign?.name ?? v.firstTouch?.source ?? v.firstTouch?.referrer ?? 'Direct'}</td>
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
  return <Badge tone={v.intent.high ? 'warning' : v.intent.score > 0 ? 'primary' : 'neutral'}>{v.intent.high ? 'High' : v.intent.score > 0 ? 'Some' : 'None'} · {v.intent.score}</Badge>;
}

function VisitorDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useVisitor(id);
  const canManage = useCan('visitors:manage');
  const [confirm, setConfirm] = useState(false);
  const erase = useVisitorMutation(() => visitorsApi.erase(id), onClose);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" className="flex flex-col gap-4 overflow-y-auto p-5 sm:max-w-xl">
        <div>
          <DialogTitle className="text-lg font-semibold">{q.data?.label ?? 'Visitor'}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">Visits recorded by the tracking script on your website.</DialogDescription>
        </div>
        {q.isPending ? <Skeleton className="h-40" /> : q.data ? <VisitorBody v={q.data} /> : <p role="alert" className="text-sm text-critical">{q.error?.message}</p>}
        {canManage && q.data && (
          <div className="border-t border-border pt-3">
            {erase.error && <p role="alert" className="mb-2 text-sm text-critical">{erase.error.message}</p>}
            {confirm ? (
              <Button variant="destructive" size="sm" disabled={erase.isPending} onClick={() => erase.mutate(undefined)}>Delete this browsing history</Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>Delete browsing history</Button>
            )}
            <p className="mt-1 text-xs text-muted-foreground">For privacy requests. Removes the visits and page views; the lead or contact stays.</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function VisitorBody({ v }: { v: VisitorDetail }) {
  return (
    <div className="space-y-4 text-sm">
      {v.identified ? (
        <p>
          Identified by an enquiry as{' '}
          <Link className="font-medium text-primary underline underline-offset-2" href={`/app/${v.identified.type === 'lead' ? 'leads' : 'contacts'}/${v.identified.id}`}>
            {v.identified.name}
          </Link>{' '}
          ({v.identified.type}).
        </p>
      ) : (
        <p className="text-muted-foreground">Anonymous. This visitor has not sent an enquiry.</p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['Visits', v.visits],
          ['Page views', v.pageViews],
          ['Time on site', formatDuration(v.engagedSeconds)],
          ['First seen', formatDate(v.firstSeenAt)],
        ].map(([k, x]) => (
          <div key={k}>
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className="font-medium">{x}</p>
          </div>
        ))}
      </div>
      <div>
        <p className="font-medium">
          Intent {v.intent.score}/100 {v.intent.high && <Badge tone="warning">High intent</Badge>}
        </p>
        {v.intent.signals.length ? (
          <ul className="mt-1 space-y-0.5" aria-label="Intent signals">
            {v.intent.signals.map((s) => (
              <li key={s.key} className="flex justify-between gap-2">
                <span>{s.label}</span>
                <span className="tabular-nums text-muted-foreground">{s.points > 0 ? `+${s.points}` : s.points}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No intent signals yet.</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">Rule-based: repeat visits, important pages, time on site and enquiries. Not a prediction.</p>
      </div>
      {(v.firstTouch || v.campaign) && (
        <p>
          <span className="text-muted-foreground">First came from </span>
          {[v.campaign?.name, v.firstTouch?.source && `utm_source ${v.firstTouch.source}`, v.firstTouch?.medium && `utm_medium ${v.firstTouch.medium}`, v.firstTouch?.referrer].filter(Boolean).join(' · ')}
        </p>
      )}
      <ol className="space-y-3" aria-label="Visits">
        {v.sessions.map((s) => (
          <li key={s.id} className="rounded-md border border-border p-3">
            <p className="font-medium">
              {formatDate(s.startedAt)} {new Date(s.startedAt).toLocaleTimeString(fmtLocale(), { hour: 'numeric', minute: '2-digit' })}
              <span className="font-normal text-muted-foreground">
                {s.referrer ? ` · from ${s.referrer}` : ''}
                {s.utm?.campaign ? ` · ${s.utm.campaign}` : ''}
                {s.engagedSeconds ? ` · ${formatDuration(s.engagedSeconds)}` : ''}
              </span>
            </p>
            <ul className="mt-1 space-y-0.5">
              {s.events.map((e, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">
                    {e.type === 'enquiry' ? <strong>Sent an enquiry</strong> : e.type === 'event' ? `Event: ${e.name}` : e.path}
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
export function RecordWebActivityCard({ type, id }: { type: 'lead' | 'contact'; id: string }) {
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
        <CardTitle className="text-base">Website activity</CardTitle>
        <IntentBadge v={v} />
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {visits} {visits === 1 ? 'visit' : 'visits'}, last {relativeTime(v.lastSeenAt)}
          {v.campaign ? ` · first from ${v.campaign.name}` : ''}
        </p>
        {v.intent.signals.length > 0 && (
          <ul className="space-y-0.5" aria-label="Website intent signals">
            {v.intent.signals.slice(0, 4).map((s) => (
              <li key={s.key}>{s.label}</li>
            ))}
          </ul>
        )}
        {lastPages.length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground">Recent pages</p>
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
        <Button size="sm" variant="outline" onClick={() => setOpen(v.id)}>All visits</Button>
      </CardContent>
      {open && <VisitorDialog id={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

// ───────────── install and settings ─────────────

function SettingsPanel({ s, canManage, justSaved, onSaved }: { s: VisitorSettings; canManage: boolean; justSaved: boolean; onSaved: () => void }) {
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
          <CardTitle className="text-base">Install on your website</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>Paste this before the closing &lt;/head&gt; tag on every page. It only works on the websites listed below.</p>
          <pre tabIndex={0} className="overflow-x-auto rounded-md bg-muted p-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Install snippet"><code>{installSnippet(origin, s.siteKey, form.consentMode)}</code></pre>
          <details>
            <summary className="cursor-pointer">Enquiry form example</summary>
            <p className="mt-2 text-muted-foreground">Any form with data-dealflow-enquiry is sent to DealFlow as an enquiry. Field names: fullName, email, companyName, phone, message and consent.</p>
            <pre tabIndex={0} aria-label="Enquiry form example code" className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><code>{ENQUIRY_FORM_EXAMPLE}</code></pre>
          </details>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2">
              {confirmRotate ? (
                <Button type="button" size="sm" variant="destructive" disabled={rotate.isPending} onClick={() => rotate.mutate(undefined)}>Replace the key (the current snippet stops working)</Button>
              ) : (
                <Button type="button" size="sm" variant="outline" onClick={() => setConfirmRotate(true)}>New site key</Button>
              )}
              <span className="text-xs text-muted-foreground">The site key is public; it only names your workspace.</span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tracking and consent</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={disabled} checked={form.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
            <span className="font-medium">Record website visits</span>
          </label>
          <label className="block space-y-1">
            <span className="font-medium">Websites allowed to send data</span>
            <Textarea disabled={disabled} rows={3} value={domains} onChange={(e) => (setSaved(false), setDomains(e.target.value))} placeholder={'www.example.com\n*.example.com'} />
            <span className="block text-xs text-muted-foreground">One host name per line. *.example.com covers its subdomains.</span>
          </label>
          <fieldset className="space-y-2">
            <legend className="font-medium">Consent</legend>
            {CONSENT_MODES.map((m) => (
              <label key={m} className="flex items-start gap-2">
                <input type="radio" name="consentMode" disabled={disabled} checked={form.consentMode === m} onChange={() => set({ consentMode: m })} className="mt-1" />
                <span>
                  {m === 'opt_in' ? (
                    <>
                      <span className="font-medium">Ask first (recommended).</span> Nothing is recorded until your cookie banner calls dealflow(&apos;consent&apos;, true). Required in the EU, UK and similar regions.
                    </>
                  ) : (
                    <>
                      <span className="font-medium">Notice only.</span> Recorded unless the visitor declines. Use only where your lawyers confirm this is allowed for your visitors.
                    </>
                  )}
                </span>
              </label>
            ))}
            <p className="text-xs text-muted-foreground">Either way, browsers sending Global Privacy Control or Do Not Track are never recorded.</p>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="font-medium">Keep visit data for (days)</span>
              <Input type="number" min={30} max={730} disabled={disabled} value={form.retentionDays} onChange={(e) => set({ retentionDays: Number(e.target.value) })} />
              <span className="block text-xs text-muted-foreground">Older visits are deleted every hour. Enquiries and links to leads and contacts are kept.</span>
            </label>
            <label className="block space-y-1">
              <span className="font-medium">High intent from score</span>
              <Input type="number" min={10} max={100} disabled={disabled} value={form.highIntentScore} onChange={(e) => set({ highIntentScore: Number(e.target.value) })} />
              <span className="block text-xs text-muted-foreground">Known visitors reaching it notify the record owner and can start a workflow (&quot;They show high intent on your website&quot;).</span>
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={disabled} checked={form.createLeads} onChange={(e) => set({ createLeads: e.target.checked })} />
            Create a lead from an enquiry when the email matches no contact or open lead
          </label>
          <label className="block space-y-1">
            <span className="font-medium">Marketing consent text on enquiry forms</span>
            <Textarea disabled={disabled} rows={2} maxLength={500} value={form.enquiryConsentText ?? ''} onChange={(e) => set({ enquiryConsentText: e.target.value || null })} placeholder="Send me product news. I can unsubscribe at any time." />
            <span className="block text-xs text-muted-foreground">Leave empty to hide the checkbox. Consent is recorded only when this text was shown and ticked.</span>
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Important pages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 overflow-x-auto text-sm">
          <table className="w-full min-w-[620px]">
            <caption className="sr-only">Important pages and their intent points</caption>
            <thead className="text-start text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-1.5 font-medium">Path</th>
                <th scope="col" className="py-1.5 font-medium">Name</th>
                <th scope="col" className="py-1.5 font-medium">Type</th>
                <th scope="col" className="py-1.5 font-medium">Intent points</th>
                <th scope="col" className="py-1.5"><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {form.importantPages.map((p, i) => (
                <tr key={i}>
                  <td className="py-1 pe-2"><Input aria-label={`Page ${i + 1} path`} disabled={disabled} className="h-9" value={p.pattern} onChange={(e) => setPage(i, { pattern: e.target.value })} /></td>
                  <td className="py-1 pe-2"><Input aria-label={`Page ${i + 1} name`} disabled={disabled} className="h-9" value={p.label} onChange={(e) => setPage(i, { label: e.target.value })} /></td>
                  <td className="py-1 pe-2">
                    <Select aria-label={`Page ${i + 1} type`} disabled={disabled} className="h-9" value={p.kind} onChange={(e) => setPage(i, { kind: e.target.value as ImportantPage['kind'] })}>
                      {PAGE_KINDS.map((k) => (
                        <option key={k} value={k}>{PAGE_KIND_LABELS[k]}</option>
                      ))}
                    </Select>
                  </td>
                  <td className="py-1 pe-2"><Input aria-label={`Page ${i + 1} intent points`} type="number" min={0} max={50} disabled={disabled} className="h-9 w-24" value={p.weight} onChange={(e) => setPage(i, { weight: Number(e.target.value) })} /></td>
                  <td className="py-1">{canManage && <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${p.label || `page ${i + 1}`}`} onClick={() => set({ importantPages: form.importantPages.filter((_, j) => j !== i) })}>Remove</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {canManage && form.importantPages.length < 30 && (
            <Button type="button" size="sm" variant="outline" onClick={() => set({ importantPages: [...form.importantPages, { pattern: '/', label: '', kind: 'product', weight: 10 }] })}>Add page</Button>
          )}
          <p className="text-xs text-muted-foreground">/pricing matches /pricing and everything under it. A path ending in * matches anything that starts with it.</p>
        </CardContent>
      </Card>

      {save.error && <p role="alert" className="text-sm text-critical">{save.error.message}</p>}
      {canManage && (
        <div className="flex items-center justify-end gap-3">
          {saved && <p role="status" className="text-sm text-success">Saved.</p>}
          <Button type="submit" disabled={save.isPending}>Save settings</Button>
        </div>
      )}
    </form>
  );
}

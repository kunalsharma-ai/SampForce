'use client';

import { type AppStatus, SAMPBIDX_FIELD_MAP, type SampbidxBatchRow, type SampbidxCheckStep, type SampbidxCheckStepKey, type SampbidxDiagnosis, type SampbidxTransferKind } from '@dealflow/types';
import { Button, Card, CardContent, CardHeader, CardTitle, cn, Input, Label, Skeleton } from '@dealflow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, Building2, ChevronDown, CircleCheck, CircleDashed, FileText, Handshake, KeyRound, Mail, PlugZap, RotateCw, Send, ShieldCheck, TriangleAlert, Wifi, X } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { Progress } from '@/components/sampbidx/bulk-send';
import { SampbidxCallbackSetup } from '@/components/sampbidx/callback-setup';
import { useSampbidxEnabled } from '@/components/sampbidx/sampbidx';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { type MessageKey, useT } from '@/lib/i18n';
import { useRetrySampbidxTransfer, useSampbidxDiagnose, useSampbidxOverview } from '@/lib/sampbidx-bulk';
import { useCan } from '@/lib/session';

/*
 * The SampBidx settings page (ADR 0099). Everything on it is read from the server: the state is the saved
 * connection's (connected only after SampBidx accepted the key, an error after a refused call or a failed test),
 * the key shows only its last four characters, and every count is a real transfer.
 */

const STEP: Record<SampbidxCheckStepKey, { label: MessageKey; Icon: typeof Wifi }> = {
  address: { label: 'Address', Icon: FileText },
  network: { label: 'Allowed to call it', Icon: ShieldCheck },
  reachable: { label: 'SampBidx answers', Icon: Wifi },
  api: { label: 'SampForce API is there', Icon: PlugZap },
  key: { label: 'API key accepted', Icon: KeyRound },
  callback: { label: 'Status updates from SampBidx', Icon: Mail },
};

const KIND: Record<SampbidxTransferKind, { label: MessageKey; Icon: typeof Wifi }> = {
  CLIENT: { label: 'Clients', Icon: Building2 },
  DEAL: { label: 'Deals', Icon: Handshake },
  RFQ: { label: 'RFQs', Icon: FileText },
  MAILBOX_EMAIL: { label: 'RFQ emails from the mailbox', Icon: Mail },
  EMAIL_FILE: { label: 'RFQ email files', Icon: Mail },
  PASTED_EMAIL: { label: 'Pasted RFQ emails', Icon: Mail },
};

const OBJECT: Record<(typeof SAMPBIDX_FIELD_MAP)[number]['object'], MessageKey> = { Client: 'Client', Contact: 'Contact', RFQ: 'RFQ', Deal: 'Deal' };

export function SampbidxSettings() {
  const t = useT();
  const enabled = useSampbidxEnabled();
  const canManage = useCan('integrations:manage');
  const overview = useSampbidxOverview(enabled && canManage);
  if (!enabled) return <p className="text-sm text-muted-foreground">{t('SampBidx is not part of this workspace’s plan.')}</p>;
  if (!canManage) return <p className="text-sm text-muted-foreground">{t('Only workspace admins can open the SampBidx settings.')}</p>;
  if (overview.error) return <p role="alert" className="text-sm text-critical">{overview.error.message}</p>;
  const o = overview.data;
  if (!o) return <Skeleton className="h-96" />;
  return (
    <div className="space-y-6">
      <StatusCard o={o} />
      <ConnectionCard baseUrl={o.baseUrl} connected={o.state !== 'NOT_CONNECTED'} />
      <SyncCard o={o} />
      <ErrorLog o={o} />
      <Batches batches={o.batches} />
      <FieldMap />
    </div>
  );
}

function StatusCard({ o }: { o: NonNullable<ReturnType<typeof useSampbidxOverview>['data']> }) {
  const t = useT();
  const diagnose = useSampbidxDiagnose();
  const tone = o.state === 'CONNECTED' ? 'success' : o.state === 'ERROR' ? 'critical' : 'neutral';
  const label: MessageKey = o.state === 'CONNECTED' ? 'Connected' : o.state === 'ERROR' ? 'Connection problem' : 'Not connected';
  return (
    <Card role="region" aria-label={t('SampBidx connection status')} className="overflow-hidden">
      <div className="relative px-5 py-5">
        <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-teal-500/15 via-sky-500/10 to-violet-500/10" />
        <div className="relative flex flex-wrap items-start gap-4">
          <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-sky-600 text-white shadow-md">
            <Send className="size-6" />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{o.accountName ?? 'SampBidx'}</h2>
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                  tone === 'success' ? 'border-success/30 bg-success/10 text-success' : tone === 'critical' ? 'border-critical/30 bg-critical/10 text-critical' : 'border-border bg-muted text-muted-foreground',
                )}
              >
                <span aria-hidden className={cn('size-2 rounded-full', tone === 'success' ? 'bg-success' : tone === 'critical' ? 'bg-critical' : 'bg-muted-foreground')} />
                {t(label)}
              </span>
            </div>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <Fact label="API address" value={o.baseUrl} mono />
              <Fact label="API key" value={o.keyHint ? t('Stored encrypted, ends in {last}', { last: o.keyHint.replace('…', '') }) : null} />
              <Fact label="Connected" value={o.connectedAt ? `${relativeTime(o.connectedAt)}${o.connectedBy ? ` · ${o.connectedBy}` : ''}` : null} />
              <Fact label="Last connection test" value={o.lastCheckedAt ? relativeTime(o.lastCheckedAt) : t('Not tested yet')} />
              <Fact label="Last status update from SampBidx" value={o.lastCallbackAt ? relativeTime(o.lastCallbackAt) : t('None yet')} />
            </dl>
            {o.lastError && (
              <p className="flex items-start gap-1.5 break-words text-sm text-critical">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" /> {t.maybe(o.lastError)}
              </p>
            )}
          </div>
          {o.state !== 'NOT_CONNECTED' && (
            <Button variant="outline" disabled={diagnose.isPending} onClick={() => diagnose.mutate({})}>
              <RotateCw aria-hidden className={cn('size-4', diagnose.isPending && 'animate-spin motion-reduce:animate-none')} /> {diagnose.isPending ? t('Testing…') : t('Test the saved connection')}
            </Button>
          )}
        </div>
      </div>
      {(diagnose.data || diagnose.error) && (
        <CardContent className="border-t border-border pt-4">
          {diagnose.error ? <p role="alert" className="text-sm text-critical">{diagnose.error.message}</p> : <Steps d={diagnose.data!} />}
        </CardContent>
      )}
    </Card>
  );
}

function Fact({ label, value, mono }: { label: MessageKey; value: string | null; mono?: boolean }) {
  const t = useT();
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{t(label)}</dt>
      <dd className={cn('break-all', mono && 'font-mono text-xs')}>{value ?? '—'}</dd>
    </div>
  );
}

/** The test's answer, one line per step: passed, failed with what to do, or not reached. */
function Steps({ d }: { d: SampbidxDiagnosis }) {
  const t = useT();
  return (
    <div className="space-y-3" role="status">
      <p className={cn('flex items-center gap-2 text-sm font-medium', d.ok ? 'text-success' : 'text-critical')}>
        {d.ok ? <CircleCheck aria-hidden className="size-4" /> : <X aria-hidden className="size-4" />}
        {d.ok ? t('SampBidx accepted the address and the key ({ms} ms).', { ms: d.latencyMs ?? 0 }) : t('The connection does not work yet. The first red step says why.')}
        {!d.saved && <span className="font-normal text-muted-foreground">{t('(tested only, nothing saved)')}</span>}
      </p>
      <ol className="space-y-2" aria-label={t('Connection test steps')}>
        {d.steps.map((s, i) => (
          <StepRow key={s.key} s={s} n={i + 1} />
        ))}
      </ol>
    </div>
  );
}

function StepRow({ s, n }: { s: SampbidxCheckStep; n: number }) {
  const t = useT();
  const meta = STEP[s.key];
  const skipped = s.ok === null && !s.message;
  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-lg border px-3 py-2 transition-colors motion-safe:animate-in motion-safe:fade-in',
        s.ok === true ? 'border-success/30 bg-success/5' : s.ok === false ? 'border-critical/40 bg-critical/5' : 'border-border bg-muted/30',
      )}
      style={{ animationDelay: `${n * 60}ms` }}
    >
      <span aria-hidden className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full', s.ok === true ? 'bg-success text-white' : s.ok === false ? 'bg-critical text-white' : 'bg-muted text-muted-foreground')}>
        {s.ok === true ? <CircleCheck className="size-4" /> : s.ok === false ? <X className="size-4" /> : skipped ? <CircleDashed className="size-4" /> : <meta.Icon className="size-3.5" />}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">
          {t(meta.label)} <span className="sr-only">{s.ok === true ? t('passed') : s.ok === false ? t('failed') : t('not checked')}</span>
        </p>
        <p className="break-words text-muted-foreground">{skipped ? t('Not checked: an earlier step failed.') : t.maybe(s.message)}</p>
        {s.hint && <p className="mt-1 break-words text-xs text-foreground/80">{t.maybe(s.hint)}</p>}
      </div>
    </li>
  );
}

function ConnectionCard({ baseUrl, connected }: { baseUrl: string | null; connected: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [url, setUrl] = React.useState(baseUrl ?? '');
  const [key, setKey] = React.useState('');
  const diagnose = useSampbidxDiagnose();
  const save = useMutation({
    mutationFn: () => api<AppStatus>('/apps/sampbidx/keys', { method: 'POST', json: { baseUrl: url, apiKey: key } }),
    onSuccess: () => {
      setKey('');
      // The earlier test was of unsaved values; the status card above now shows the saved connection.
      diagnose.reset();
      return Promise.all([qc.invalidateQueries({ queryKey: ['sampbidx'] }), qc.invalidateQueries({ queryKey: ['apps'] })]);
    },
  });
  return (
    <Card role="region" aria-labelledby="sbx-conn-title">
      <CardHeader className="pb-2">
        <CardTitle id="sbx-conn-title" className="text-base">
          {connected ? t('Change the address or key') : t('Connect SampBidx')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!connected && <SampbidxCallbackSetup idPrefix="sbx-settings-setup" />}
        <p className="text-muted-foreground">{t('Test first: SampForce calls SampBidx and shows each step, without saving. Save stores the key encrypted on the server; it never comes back to the browser.')}</p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sbx-settings-url">{t('SampBidx API address')}</Label>
              <Input id="sbx-settings-url" type="url" autoComplete="off" placeholder="https://sampbidx.example.com/api" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sbx-settings-key">{t('API key')}</Label>
              <Input id="sbx-settings-key" type="password" autoComplete="off" placeholder={connected ? t('Leave empty to test with the saved key') : ''} value={key} onChange={(e) => setKey(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={diagnose.isPending || !url.trim() || (!key.trim() && !connected)} onClick={() => diagnose.mutate({ baseUrl: url.trim(), ...(key.trim() ? { apiKey: key.trim() } : {}) })}>
              <PlugZap aria-hidden className="size-4" /> {diagnose.isPending ? t('Testing…') : t('Test these details')}
            </Button>
            <Button type="submit" disabled={save.isPending || !url.trim() || !key.trim()}>
              {save.isPending ? t('Checking with SampBidx…') : t('Check and save')}
            </Button>
          </div>
        </form>
        {save.isSuccess && (
          <p role="status" className="flex items-center gap-1.5 text-success">
            <CircleCheck aria-hidden className="size-4" /> {t('SampBidx accepted the key. It is saved.')}
          </p>
        )}
        {save.error && (
          <p role="alert" className="break-words text-critical">
            {save.error.message}
          </p>
        )}
        {diagnose.error && (
          <p role="alert" className="break-words text-critical">
            {diagnose.error.message}
          </p>
        )}
        {diagnose.data && <Steps d={diagnose.data} />}
        <details className="rounded-lg border border-border bg-muted/30 p-3">
          <summary className="cursor-pointer font-medium">{t('Still cannot connect? What to check')}</summary>
          <ul className="mt-2 list-disc space-y-1.5 ps-5 text-muted-foreground">
            <li>{t('The address is SampBidx’s API root, where its /v1 paths begin (often ending in /api), not its sign-in page.')}</li>
            <li>{t('SampBidx must have built the SampForce API: GET /v1/ping, PUT /v1/clients, PUT /v1/deals, POST /v1/rfqs and POST /v1/rfq-emails. Without it the test stops at “SampForce API is there”.')}</li>
            <li>{t('A public address must use https://. If SampBidx runs on the same server or your own network, a SampForce operator must approve its address in Console → Providers → Workspace servers → Approved private hosts.')}</li>
            <li>{t('Inside Docker, localhost is SampForce itself: use SampBidx’s container name or server address.')}</li>
            <li>{t('The API key is one SampBidx made for SampForce. A refused key needs a new one from SampBidx.')}</li>
            <li>{t('If the key test passes but a send says SampBidx refused a path (403), SampBidx has not allowed or built that path yet. A new key does not change this: ask the SampBidx team to add it.')}</li>
          </ul>
          <p className="mt-2">
            <Link href="/app/integrations#app-sampbidx" className="font-medium text-primary hover:underline">
              {t('Status callback URL and signing secret are on the Integrations page')}
            </Link>
          </p>
        </details>
      </CardContent>
    </Card>
  );
}

function SyncCard({ o }: { o: NonNullable<ReturnType<typeof useSampbidxOverview>['data']> }) {
  const t = useT();
  return (
    <Card role="region" aria-labelledby="sbx-sync-title">
      <CardHeader className="pb-2">
        <CardTitle id="sbx-sync-title" className="text-base">
          {t('Sync status')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {o.sync.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('Nothing has been sent to SampBidx yet.')}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {o.sync.map((s) => {
              const k = KIND[s.kind];
              return (
                <li key={s.kind} className="rounded-xl border border-border p-3">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <k.Icon aria-hidden className="size-4 text-primary" /> {t(k.label)}
                  </p>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-md bg-success/10 px-1 py-1.5">
                      <dt className="text-[11px] text-success">{t('Sent')}</dt>
                      <dd className="text-lg font-semibold tabular-nums">{s.sent}</dd>
                    </div>
                    <div className="rounded-md bg-critical/10 px-1 py-1.5">
                      <dt className="text-[11px] text-critical">{t('Failed')}</dt>
                      <dd className="text-lg font-semibold tabular-nums">{s.failed}</dd>
                    </div>
                    <div className="rounded-md bg-muted px-1 py-1.5">
                      <dt className="text-[11px] text-muted-foreground">{t('Sending')}</dt>
                      <dd className="text-lg font-semibold tabular-nums">{s.sending}</dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-xs text-muted-foreground">{s.lastSentAt ? t('Last confirmed {time}', { time: relativeTime(s.lastSentAt) }) : t('None confirmed yet')}</p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ErrorLog({ o }: { o: NonNullable<ReturnType<typeof useSampbidxOverview>['data']> }) {
  const t = useT();
  const retry = useRetrySampbidxTransfer();
  return (
    <Card role="region" aria-labelledby="sbx-errors-title">
      <CardHeader className="pb-2">
        <CardTitle id="sbx-errors-title" className="text-base">
          {t('Error log')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {o.errors.length === 0 ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CircleCheck aria-hidden className="size-4 text-success" /> {t('No failed sends.')}
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border" aria-label={t('Failed sends')}>
            {o.errors.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">{e.title}</p>
                  <p className="break-words text-xs text-critical">{t.maybe(e.lastError ?? '')}</p>
                  <p className="text-xs text-muted-foreground">
                    {[t(KIND[e.kind].label), e.company?.name, e.sentBy, relativeTime(e.createdAt), t('{count} attempts', { count: e.attempts })].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Button size="sm" variant="outline" disabled={retry.isPending && retry.variables === e.id} onClick={() => retry.mutate(e.id)} aria-label={t('Retry {title}', { title: e.title })}>
                  <RotateCw aria-hidden className="size-3.5" /> {t('Retry')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {retry.error && (
          <p role="alert" className="text-sm text-critical">
            {retry.error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Batches({ batches }: { batches: SampbidxBatchRow[] }) {
  const t = useT();
  const [open, setOpen] = React.useState<string | null>(null);
  return (
    <Card role="region" aria-labelledby="sbx-batches-title">
      <CardHeader className="pb-2">
        <CardTitle id="sbx-batches-title" className="text-base">
          {t('Bulk sends')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('No bulk sends yet. Select deals or companies in their tables and choose Send to SampBidx.')}</p>
        ) : (
          <ul className="space-y-2">
            {batches.map((b) => (
              <li key={b.id} className="overflow-hidden rounded-lg border border-border">
                <button type="button" className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-start text-sm hover:bg-muted/40" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{b.kind === 'DEALS' ? t('Deals') : t('Won companies')}</span>
                    <span className="block text-xs text-muted-foreground">{[relativeTime(b.createdAt), b.createdBy].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="flex flex-wrap gap-1.5 text-xs">
                    <span className="rounded-full bg-success/10 px-2 py-0.5 text-success">{t('{count} sent', { count: b.counts.sent })}</span>
                    {b.counts.failed > 0 && <span className="rounded-full bg-critical/10 px-2 py-0.5 text-critical">{t('{count} failed', { count: b.counts.failed })}</span>}
                    {b.counts.skipped > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                        <Ban aria-hidden className="size-3" /> {t('{count} skipped', { count: b.counts.skipped })}
                      </span>
                    )}
                    {b.status === 'RUNNING' && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">{t('Sending…')}</span>}
                  </span>
                  <ChevronDown aria-hidden className={cn('size-4 text-muted-foreground transition-transform', open === b.id && 'rotate-180')} />
                </button>
                {open === b.id && (
                  <div className="flex flex-col border-t border-border">
                    <Progress batch={b} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function FieldMap() {
  const t = useT();
  return (
    <Card role="region" aria-labelledby="sbx-map-title">
      <CardHeader className="pb-2">
        <CardTitle id="sbx-map-title" className="text-base">
          {t('Field mapping')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">{t('Each SampForce record is sent with its SampForce id as the externalId, so a second send updates the same SampBidx record. Prices, taxes, discounts and prepayment are never sent: the bid manager sets them in SampBidx.')}</p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[36rem] text-start text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 text-start font-medium">{t('Object')}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">{t('SampForce field')}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">{t('SampBidx field')}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">{t('Required')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {SAMPBIDX_FIELD_MAP.map((f) => (
                <tr key={`${f.object}-${f.sampbidx}`}>
                  <td className="px-3 py-1.5">{t(OBJECT[f.object])}</td>
                  <td className="px-3 py-1.5">{t.maybe(f.sampforce)}</td>
                  <td className="break-all px-3 py-1.5 font-mono text-xs">{f.sampbidx}</td>
                  <td className="px-3 py-1.5">{f.required ? <span className="text-xs font-medium text-warning">{t('Required')}</span> : <span className="text-xs text-muted-foreground">{t('Optional')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

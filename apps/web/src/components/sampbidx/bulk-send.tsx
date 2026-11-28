'use client';

import type { SampbidxBatchCompletion, SampbidxBatchItem, SampbidxBatchKind, SampbidxBatchRow, SampbidxBulkFix, SampbidxBulkPreview, SampbidxBulkPreviewItem } from '@dealflow/types';
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import { Ban, Check, CircleCheck, Clock, ExternalLink, RotateCw, Send, Settings2, TriangleAlert, X } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { CountrySelect, TimeZoneSelect } from '@/components/forms/inputs';
import { type MessageKey, useT } from '@/lib/i18n';
import { useRetrySampbidxBatch, useSampbidxBatch, useSampbidxBulkPreview, useStartSampbidxBatch } from '@/lib/sampbidx-bulk';
import { useCan } from '@/lib/session';
import { useSampbidxEnabled } from './sampbidx';

/*
 * Many deals or won companies to SampBidx at once (ADR 0099). Step one checks every record and asks only for the
 * details SampBidx needs that are missing (saved to the records, so they are typed once). Step two sends them one
 * at a time and shows SampBidx's real answer for each: sent with its reference, failed with the reason (and a retry),
 * or skipped with why. Nothing shows as sent before SampBidx confirms it.
 */

type Fixes = Record<string, string>;
const fixKey = (f: SampbidxBulkFix) => `${f.record}:${f.recordId}:${f.field}`;
const FIX_LABEL: Record<SampbidxBulkFix['field'], MessageKey> = { email: 'Email', country: 'Country', timeZone: 'Time zone', amount: 'Amount' };
const NOUN: Record<SampbidxBatchKind, { one: MessageKey; many: MessageKey }> = { DEALS: { one: 'deal', many: 'deals' }, WON_COMPANIES: { one: 'won company', many: 'won companies' } };

function completionOf(fixes: Fixes): SampbidxBatchCompletion {
  const out: Required<SampbidxBatchCompletion> = { companies: {}, contacts: {}, deals: {} };
  for (const [key, raw] of Object.entries(fixes)) {
    const value = raw.trim();
    if (!value) continue;
    const [record, id, field] = key.split(':') as [SampbidxBulkFix['record'], string, SampbidxBulkFix['field']];
    if (record === 'deal') out.deals[id] = { amount: Number(value.replace(/,/g, '')) };
    else if (record === 'contact') out.contacts[id] = { ...out.contacts[id], [field]: value };
    else out.companies[id] = { ...out.companies[id], [field]: value };
  }
  return out;
}

/** Whether every detail an item needs has been typed (amounts must be numbers above 0, emails look like emails). */
function fixed(item: SampbidxBulkPreviewItem, fixes: Fixes) {
  return item.fixes.every((f) => {
    const v = (fixes[fixKey(f)] ?? '').trim();
    if (f.field === 'amount') return Number(v.replace(/,/g, '')) > 0;
    if (f.field === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    return !!v;
  });
}

export function SampbidxBulkDialog({ kind, ids, allWon = false, open, onOpenChange, onSent }: { kind: SampbidxBatchKind; ids: string[]; allWon?: boolean; open: boolean; onOpenChange: (o: boolean) => void; onSent?: () => void }) {
  const t = useT();
  const preview = useSampbidxBulkPreview();
  const start = useStartSampbidxBatch();
  const [resend, setResend] = React.useState(false);
  const [fixes, setFixes] = React.useState<Fixes>({});
  const [batchId, setBatchId] = React.useState<string | null>(null);
  const [scope, setScope] = React.useState<{ ids: string[]; allWon: boolean }>({ ids, allWon });
  const batch = useSampbidxBatch(batchId);
  const run = preview.mutate;

  React.useEffect(() => {
    if (!open) return;
    setBatchId(null);
    setFixes({});
    setResend(false);
    setScope({ ids, allWon });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  React.useEffect(() => {
    if (open && !batchId) run({ kind, ids: scope.ids, allWon: scope.allWon, resend });
  }, [open, batchId, kind, scope, resend, run]);

  const p = preview.data;
  const goes = p ? p.items.filter((i) => i.status === 'READY' || (i.status === 'NEEDS_FIX' && fixed(i, fixes))) : [];
  const waiting = p ? p.items.filter((i) => i.status === 'NEEDS_FIX' && !fixed(i, fixes)).length : 0;
  const noun = NOUN[kind];
  const send = () =>
    start.mutate(
      { kind, ids: scope.ids, allWon: scope.allWon, resend, completion: completionOf(fixes) },
      {
        onSuccess: (b) => {
          setBatchId(b.id);
          onSent?.();
        },
      },
    );
  const again = (b: SampbidxBatchRow) => {
    // Back to the check, with only the items that were skipped for missing details.
    setScope({ ids: b.items.filter((i) => i.outcome === 'SKIPPED' && i.reason?.startsWith('Needs correction')).map((i) => i.recordId), allWon: false });
    setFixes({});
    setBatchId(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[4%] flex max-h-[92vh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <div className="relative overflow-hidden border-b border-border px-5 py-4 pe-12">
          <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-teal-500/15 via-sky-500/10 to-violet-500/10" />
          <div className="relative flex items-start gap-3">
            <span aria-hidden className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-sky-600 text-white shadow-md">
              <Send className="size-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="break-words text-lg font-semibold">{kind === 'DEALS' ? t('Send deals to SampBidx') : t('Send won companies to SampBidx')}</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">
                {kind === 'DEALS'
                  ? t('Each deal goes with its company as the SampBidx client. SampBidx gets the client first when it does not have it yet or it changed.')
                  : t('Each won company goes as a SampBidx client with its win, the won deal’s contact and the employees who shared RFQs.')}
              </DialogDescription>
            </div>
          </div>
          <ol className="relative mt-4 flex flex-wrap items-center gap-2 text-xs font-medium" aria-label={t('Steps')}>
            {(['Check', 'Send'] as MessageKey[]).map((label, i) => {
              const at = batchId ? 1 : 0;
              return (
                <li key={label} className="flex items-center gap-2" aria-current={at === i ? 'step' : undefined}>
                  <span className={cn('flex size-6 items-center justify-center rounded-full border text-[11px] transition-colors', at === i ? 'border-primary bg-primary text-primary-foreground' : i < at ? 'border-success bg-success text-white' : 'border-border bg-surface text-muted-foreground')}>
                    {i < at ? <Check aria-hidden className="size-3.5" /> : i + 1}
                  </span>
                  <span className={cn(at === i ? 'text-foreground' : 'text-muted-foreground')}>{t(label)}</span>
                  {i < 1 && <span aria-hidden className="h-px w-6 bg-border" />}
                </li>
              );
            })}
          </ol>
        </div>

        {!batchId ? (
          <>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {preview.isPending && !p && <CheckSkeleton />}
              {preview.error && (
                <p role="alert" className="text-sm text-critical">
                  {preview.error.message}
                </p>
              )}
              {p && (
                <>
                  {p.connectionProblem && <ConnectionProblem text={p.connectionProblem} />}
                  <Summary
                    tiles={[
                      { label: 'Ready', value: p.counts.ready, tone: 'success' },
                      { label: 'Need correction', value: p.counts.needsFix, tone: 'warning' },
                      { label: 'Will be skipped', value: p.counts.skip, tone: 'neutral' },
                    ]}
                    caption={t('{count} selected', { count: p.items.length })}
                  />
                  <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" className="size-4 accent-primary" checked={resend} onChange={(e) => setResend(e.target.checked)} />
                    {t('Send again what SampBidx already has, even if nothing changed')}
                  </label>
                  <ul className="divide-y divide-border rounded-lg border border-border" aria-label={t('Records to send')}>
                    {p.items.map((item) => (
                      <PreviewRow key={item.recordId} item={item} fixes={fixes} onFix={(k, v) => setFixes((f) => ({ ...f, [k]: v }))} />
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-5 py-3">
              <p className="text-xs text-muted-foreground" role="status">
                {p && waiting > 0 ? t('{count} still need details. They are skipped unless you fill them in.', { count: waiting }) : p ? t('Typed details are saved to the SampForce records too.') : ''}
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  {t('Cancel')}
                </Button>
                <Button onClick={send} disabled={!p || !!p.connectionProblem || goes.length === 0 || start.isPending}>
                  <Send aria-hidden className="size-4" />
                  {start.isPending ? t('Starting…') : t('Send {count} to SampBidx', { count: goes.length })}
                </Button>
              </div>
            </div>
            {start.error && (
              <p role="alert" className="px-5 pb-3 text-sm text-critical">
                {start.error.message}
              </p>
            )}
          </>
        ) : (
          <Progress batch={batch.data ?? null} noun={noun} onAgain={again} onClose={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CheckSkeleton() {
  return (
    <div className="space-y-3" aria-busy>
      <div className="grid grid-cols-3 gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </div>
  );
}

function ConnectionProblem({ text }: { text: string }) {
  const t = useT();
  const canManage = useCan('integrations:manage');
  return (
    <div role="alert" className="flex flex-wrap items-start gap-2 rounded-lg border border-critical/40 bg-critical/10 p-3 text-sm">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-critical" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="break-words font-medium">{t('Nothing can be sent yet.')}</p>
        <p className="break-words text-muted-foreground">{t.maybe(text)}</p>
        {canManage ? (
          <Link href="/app/integrations/sampbidx" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            <Settings2 aria-hidden className="size-3.5" /> {t('Open SampBidx settings')}
          </Link>
        ) : (
          <p className="text-muted-foreground">{t('A workspace admin can fix this on the SampBidx settings page.')}</p>
        )}
      </div>
    </div>
  );
}

const TILE_TONE = {
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  critical: 'border-critical/30 bg-critical/10 text-critical',
  neutral: 'border-border bg-muted/50 text-muted-foreground',
  primary: 'border-primary/30 bg-primary/10 text-primary',
} as const;

function Summary({ tiles, caption }: { tiles: { label: MessageKey; value: number; tone: keyof typeof TILE_TONE }[]; caption: string }) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{caption}</p>
      <dl className={cn('grid gap-2', tiles.length > 3 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3')}>
        {tiles.map((x) => (
          <div key={x.label} className={cn('rounded-lg border px-3 py-2', TILE_TONE[x.tone])}>
            <dt className="break-words text-xs font-medium">{t(x.label)}</dt>
            <dd className="text-2xl font-semibold tabular-nums text-foreground">{x.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function PreviewRow({ item, fixes, onFix }: { item: SampbidxBulkPreviewItem; fixes: Fixes; onFix: (key: string, value: string) => void }) {
  const t = useT();
  const done = item.status === 'NEEDS_FIX' && fixed(item, fixes);
  const chip =
    item.status === 'READY' || done
      ? { label: 'Ready' as MessageKey, tone: 'success' as const, Icon: CircleCheck }
      : item.status === 'NEEDS_FIX'
        ? { label: 'Needs correction' as MessageKey, tone: 'warning' as const, Icon: TriangleAlert }
        : { label: 'Skipped' as MessageKey, tone: 'neutral' as const, Icon: Ban };
  return (
    <li className="space-y-2 px-3 py-2.5" aria-label={item.label}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-medium">{item.label}</p>
          {item.sub && <p className="break-words text-xs text-muted-foreground">{item.sub}</p>}
        </div>
        {item.inSampbidx && <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{t('In SampBidx')}</span>}
        <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', TILE_TONE[chip.tone])}>
          <chip.Icon aria-hidden className="size-3.5" /> {t(chip.label)}
        </span>
      </div>
      {item.status === 'SKIP' && item.reason && <p className="break-words text-xs text-muted-foreground">{t.maybe(item.reason)}</p>}
      {item.status === 'NEEDS_FIX' && (
        <div className="grid gap-2 rounded-md border border-dashed border-warning/40 bg-warning/5 p-2 sm:grid-cols-2">
          {item.fixes.map((f) => {
            const key = fixKey(f);
            const id = `fix-${key.replace(/[^a-z0-9]/gi, '-')}`;
            const label = t('{field} of {who}', { field: t(FIX_LABEL[f.field]), who: f.record === 'deal' ? t('the deal') : f.recordLabel });
            const value = fixes[key] ?? '';
            return (
              <div key={key} className="min-w-0 space-y-1">
                <label htmlFor={id} className="block break-words text-xs font-medium">
                  {label}
                </label>
                {f.field === 'country' ? (
                  <CountrySelect id={id} value={value} onChange={(v) => onFix(key, v)} />
                ) : f.field === 'timeZone' ? (
                  <TimeZoneSelect id={id} value={value} onChange={(v) => onFix(key, v)} />
                ) : (
                  <Input id={id} type={f.field === 'email' ? 'email' : 'text'} inputMode={f.field === 'amount' ? 'decimal' : undefined} autoComplete="off" value={value} onChange={(e) => onFix(key, e.target.value)} />
                )}
              </div>
            );
          })}
        </div>
      )}
      {item.warnings.map((w) => (
        <p key={w} className="flex items-start gap-1.5 break-words text-xs text-warning">
          <TriangleAlert aria-hidden className="mt-0.5 size-3 shrink-0" /> {t.maybe(w)}
        </p>
      ))}
    </li>
  );
}

const OUTCOME: Record<SampbidxBatchItem['outcome'], { label: MessageKey; tone: keyof typeof TILE_TONE; Icon: typeof Check }> = {
  PENDING: { label: 'Waiting', tone: 'neutral', Icon: Clock },
  SENDING: { label: 'Sending…', tone: 'primary', Icon: RotateCw },
  SENT: { label: 'Sent', tone: 'success', Icon: CircleCheck },
  FAILED: { label: 'Failed', tone: 'critical', Icon: X },
  SKIPPED: { label: 'Skipped', tone: 'neutral', Icon: Ban },
};

/** Step two: SampBidx's answer for each record as it comes, and the summary once all are answered. */
export function Progress({ batch, noun, onAgain, onClose }: { batch: SampbidxBatchRow | null; noun?: { one: MessageKey; many: MessageKey }; onAgain?: (b: SampbidxBatchRow) => void; onClose?: () => void }) {
  const t = useT();
  const retry = useRetrySampbidxBatch();
  if (!batch) return <div className="p-5"><CheckSkeleton /></div>;
  const answered = batch.total - batch.counts.pending;
  const needCorrection = batch.items.filter((i) => i.outcome === 'SKIPPED' && i.reason?.startsWith('Needs correction')).length;
  const pct = batch.total ? Math.round((answered / batch.total) * 100) : 100;
  return (
    <>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <p className="font-medium" role="status">
              {batch.status === 'RUNNING' ? t('Sending {done} of {total}…', { done: Math.min(answered + 1, batch.total), total: batch.total }) : t('Finished: every record has SampBidx’s answer.')}
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">{pct}%</p>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={batch.total} aria-valuenow={answered} aria-label={t('Progress')}>
            <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-sky-500 transition-[width] duration-500 ease-out" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <Summary
          tiles={[
            { label: 'Sent', value: batch.counts.sent, tone: 'success' },
            { label: 'Failed', value: batch.counts.failed, tone: 'critical' },
            { label: 'Skipped', value: batch.counts.skipped, tone: 'neutral' },
            { label: 'Waiting', value: batch.counts.pending, tone: 'primary' },
          ]}
          caption={[
            t('{count} selected', { count: batch.total }),
            t('{count} sent', { count: batch.counts.sent }),
            ...(batch.counts.failed ? [t('{count} failed', { count: batch.counts.failed })] : []),
            ...(needCorrection ? [t('{count} need correction', { count: needCorrection })] : []),
          ].join(' · ')}
        />
        <ul className="divide-y divide-border rounded-lg border border-border" aria-label={t('Results')}>
          {batch.items.map((i) => {
            const o = OUTCOME[i.outcome];
            return (
              <li key={i.recordId} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2.5" aria-label={i.label}>
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium">{i.label}</p>
                  {i.sub && <p className="break-words text-xs text-muted-foreground">{i.sub}</p>}
                  {i.reason && <p className={cn('break-words text-xs', i.outcome === 'FAILED' ? 'text-critical' : 'text-muted-foreground')}>{t.maybe(i.reason)}</p>}
                  {i.warnings.map((w) => (
                    <p key={w} className="break-words text-xs text-warning">
                      {t.maybe(w)}
                    </p>
                  ))}
                </div>
                {i.outcome === 'SENT' && i.remoteId && (
                  <span className="text-xs text-muted-foreground">
                    {t('SampBidx reference {id}', { id: i.remoteId })}
                    {i.remoteUrl && (
                      <a href={i.remoteUrl} target="_blank" rel="noreferrer" className="ms-1 inline-flex items-center text-primary hover:underline" aria-label={t('Open in SampBidx')}>
                        <ExternalLink aria-hidden className="size-3.5" />
                      </a>
                    )}
                  </span>
                )}
                <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', TILE_TONE[o.tone])}>
                  <o.Icon aria-hidden className={cn('size-3.5', i.outcome === 'SENDING' && 'animate-spin motion-reduce:animate-none')} /> {t(o.label)}
                </span>
              </li>
            );
          })}
        </ul>
        {retry.error && (
          <p role="alert" className="text-sm text-critical">
            {retry.error.message}
          </p>
        )}
      </div>
      {(onClose || batch.counts.failed > 0) && (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/30 px-5 py-3">
          {batch.status === 'DONE' && needCorrection > 0 && onAgain && (
            <Button variant="outline" onClick={() => onAgain(batch)}>
              {t('Correct and send the {count} skipped', { count: needCorrection })}
            </Button>
          )}
          {batch.status === 'DONE' && batch.counts.failed > 0 && (
            <Button variant="outline" disabled={retry.isPending} onClick={() => retry.mutate(batch.id)}>
              <RotateCw aria-hidden className="size-4" /> {t('Retry {count} failed', { count: batch.counts.failed })}
            </Button>
          )}
          {onClose && <Button onClick={onClose}>{batch.status === 'RUNNING' ? t('Keep sending in the background') : t('Done')}</Button>}
        </div>
      )}
      {noun && <span className="sr-only">{t.maybe(noun.many)}</span>}
    </>
  );
}

/** "Send to SampBidx" in the bulk bar of the Deals and Companies tables. Hidden without SampBidx on the plan or the rights to change them. */
export function SampbidxBulkButton({ kind, ids, onDone }: { kind: SampbidxBatchKind; ids: string[]; onDone?: () => void }) {
  const t = useT();
  const enabled = useSampbidxEnabled();
  const canWrite = useCan(kind === 'DEALS' ? 'deals:write' : 'companies:write');
  const canContacts = useCan('contacts:write');
  const [open, setOpen] = React.useState(false);
  if (!enabled || !canWrite || !canContacts || !ids.length) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Send aria-hidden /> {t('Send to SampBidx')}
      </Button>
      <SampbidxBulkDialog kind={kind} ids={ids} open={open} onOpenChange={(o) => {
        setOpen(o);
        if (!o) onDone?.();
      }} />
    </>
  );
}

/** "Send won companies to SampBidx" on the Companies page: every won company the person can see. */
export function SendWonCompaniesButton() {
  const t = useT();
  const enabled = useSampbidxEnabled();
  const canWrite = useCan('companies:write');
  const canContacts = useCan('contacts:write');
  const [open, setOpen] = React.useState(false);
  if (!enabled || !canWrite || !canContacts) return null;
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Send aria-hidden /> {t('Send won companies to SampBidx')}
      </Button>
      <SampbidxBulkDialog kind="WON_COMPANIES" ids={[]} allWon open={open} onOpenChange={setOpen} />
    </>
  );
}

export type { SampbidxBulkPreview };

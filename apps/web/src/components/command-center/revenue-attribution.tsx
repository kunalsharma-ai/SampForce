'use client';

import type { ExecutiveDashboard, RevenueRecordUpdate } from '@dealflow/types';
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  Input,
  Skeleton,
} from '@dealflow/ui';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { PersonSelect } from '@/components/crm/lead-fields';
import { Select } from '@/components/crm/select';
import { useRevenueRecord, useRevenueRecordMutations } from '@/lib/command-center';
import { formatDate } from '@/lib/crm';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';
import { CREDIT_ROLE_LABEL, PAYMENT_STATUS_LABEL, PERIOD_LABEL } from './cc-labels';
import { count, money, pct } from './tier-parts';

/**
 * Revenue credited to one person (ADR 0063): their share of each won deal or won RFQ, by period, and the records
 * behind it. A record's full value is counted once in any total of several people; each person's share is theirs.
 */
export function RevenueAttribution({
  revenue,
  currency,
  periodLabel,
}: {
  revenue: NonNullable<ExecutiveDashboard['revenue']>;
  currency: string;
  periodLabel: string;
}) {
  const t = useT();
  const [open, setOpen] = React.useState<string | null>(null);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('Credited revenue by period')}</caption>
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-2 text-start font-medium">
                {t('Period')}
              </th>
              <th scope="col" className="px-4 py-2 text-end font-medium">
                {t('Your share')}
              </th>
              <th scope="col" className="px-4 py-2 text-end font-medium">
                {t('Deals')}
              </th>
            </tr>
          </thead>
          <tbody>
            {revenue.periods.map((p) => (
              <tr key={p.period} className="border-b border-border last:border-0">
                <th scope="row" className="px-4 py-2 text-start font-medium">
                  {t(PERIOD_LABEL[p.period])}
                </th>
                <td className="tabular px-4 py-2 text-end">{money(p.amount, currency)}</td>
                <td className="tabular px-4 py-2 text-end">{count(p.deals)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card className="overflow-x-auto p-0">
        <table className="w-full text-sm" data-testid="revenue-lines">
          <caption className="px-4 pt-3 text-start text-xs text-muted-foreground">
            {t('Won deals and RFQs you hold a share of, {period}.', { period: periodLabel })}
          </caption>
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-2 text-start font-medium">
                {t('Company and project')}
              </th>
              <th scope="col" className="px-4 py-2 text-end font-medium">
                {t('Won value')}
              </th>
              <th scope="col" className="px-4 py-2 text-start font-medium">
                {t('Your role')}
              </th>
              <th scope="col" className="px-4 py-2 text-end font-medium">
                {t('Share')}
              </th>
              <th scope="col" className="px-4 py-2 text-end font-medium">
                {t('Your contribution')}
              </th>
            </tr>
          </thead>
          <tbody>
            {!revenue.lines.length && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                  {t('No won revenue credited to you in this period.')}
                </td>
              </tr>
            )}
            {revenue.lines.map((l) => (
              <tr key={l.recordId} className="border-b border-border last:border-0">
                <td className="px-4 py-2">
                  <button
                    type="button"
                    className="text-start font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setOpen(l.recordId)}
                  >
                    {l.company?.name ?? t('No company')}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    {[
                      l.project,
                      formatDate(l.closedAt),
                      l.closer && t('Closed by {name}', { name: l.closer.name }),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </td>
                <td className="tabular px-4 py-2 text-end">{money(l.value, l.currency)}</td>
                <td className="px-4 py-2">
                  <span className="flex flex-wrap gap-1">
                    {l.roles.map((r) => (
                      <Badge key={r}>{t(CREDIT_ROLE_LABEL[r])}</Badge>
                    ))}
                  </span>
                </td>
                <td className="tabular px-4 py-2 text-end">{pct(l.percent)}</td>
                <td className="tabular px-4 py-2 text-end font-medium">
                  {money(l.contribution, currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {revenue.unconverted.length > 0 && (
          <p className="px-4 pb-3 text-xs text-warning">
            {t('Left out of the totals until an exchange rate is entered: {amounts}.', {
              amounts: revenue.unconverted.map((u) => money(u.amount, u.currency)).join(', '),
            })}
          </p>
        )}
      </Card>
      <RevenueRecordSheet id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

const PAYMENT = ['NOT_DUE', 'PENDING', 'PARTIAL', 'PAID', 'OVERDUE'] as const;

/** One revenue record: who holds which share, recognised and collected amounts, and a split entered by hand. */
export function RevenueRecordSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useT();
  const q = useRevenueRecord(id);
  const r = q.data;
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" className="max-w-xl overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">
          {r ? (r.company?.name ?? r.project) : t('Revenue record')}
        </DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">
          {r
            ? [r.project, money(r.value, r.currency), formatDate(r.closedAt)].join(' · ')
            : t('Loading')}
        </DialogDescription>
        {!r ? (
          q.error ? (
            <p role="alert" className="text-sm text-critical">
              {q.error.message}
            </p>
          ) : (
            <Skeleton className="h-40" />
          )
        ) : (
          <RecordBody
            key={`${r.recordId}-${r.manual}-${r.credits.map((c) => c.percent).join()}`}
            record={r}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecordBody({
  record: r,
}: {
  record: NonNullable<ReturnType<typeof useRevenueRecord>['data']>;
}) {
  const t = useT();
  const canWrite = useCan('deals:write');
  const canSplit = useCan('pipelines:manage');
  const m = useRevenueRecordMutations(r.recordId);
  const [amounts, setAmounts] = React.useState({
    recognised: r.recognised?.toString() ?? '',
    collected: r.collected?.toString() ?? '',
    paymentStatus: r.paymentStatus ?? '',
  });
  const [split, setSplit] = React.useState<{ userId: string; percent: string }[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const total = (split ?? []).reduce((s, c) => s + (Number(c.percent) || 0), 0);

  const saveAmounts = async () => {
    const num = (v: string) => (v.trim() === '' ? null : Number(v));
    const input: RevenueRecordUpdate = {
      recognisedAmount: num(amounts.recognised),
      collectedAmount: num(amounts.collected),
      paymentStatus: (amounts.paymentStatus || null) as RevenueRecordUpdate['paymentStatus'],
    };
    try {
      setError(null);
      await m.update.mutateAsync(input);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not save.'));
    }
  };
  const saveSplit = async () => {
    if (!split) return;
    try {
      setError(null);
      await m.setCredits.mutateAsync(
        split
          .filter((c) => c.userId)
          .map((c) => ({ userId: c.userId, percent: Number(c.percent) || 0 })),
      );
      setSplit(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not save.'));
    }
  };

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3 text-sm">
        {(
          [
            ['Lead created by', r.leadCreator?.name],
            ['Closed by', r.closer?.name],
            ['Manager', r.manager?.name],
            ['Source', r.source === 'DEAL' ? t('Won deal') : t('Won RFQ')],
          ] as const
        ).map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-muted-foreground">{t(k)}</dt>
            <dd>{v ?? '—'}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2 text-sm">
        {r.dealId && (
          <Link className="text-primary hover:underline" href={`/app/deals/${r.dealId}`}>
            {t('Open the deal')}
          </Link>
        )}
        {r.rfqId && (
          <Link className="text-primary hover:underline" href={`/app/rfqs?open=${r.rfqId}`}>
            {t('Open the RFQ')}
          </Link>
        )}
      </div>

      <section aria-labelledby="credits-h">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 id="credits-h" className="text-sm font-semibold">
            {t('Credit split')} {r.manual && <Badge tone="accent">{t('Set by hand')}</Badge>}
          </h3>
          {canSplit && !split && (
            <div className="flex gap-2">
              {r.manual && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => m.reset.mutate()}
                  disabled={m.reset.isPending}
                >
                  <RotateCcw aria-hidden /> {t('Use the workspace rule')}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setSplit(
                    r.credits
                      .filter((c) => c.user)
                      .map((c) => ({ userId: c.user!.id, percent: String(c.percent) })),
                  )
                }
              >
                {t('Change split')}
              </Button>
            </div>
          )}
        </div>
        {!split ? (
          <ul
            className="divide-y divide-border rounded-md border border-border text-sm"
            data-testid="record-credits"
          >
            {r.credits.map((c, i) => (
              <li
                key={c.user?.id ?? i}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <span>
                  {c.user?.name ?? t('Nobody')}{' '}
                  <span className="text-xs text-muted-foreground">
                    {c.roles.map((x) => t(CREDIT_ROLE_LABEL[x])).join(', ')}
                  </span>
                </span>
                <span className="tabular">
                  {pct(c.percent)} · {money(c.amount, r.currency)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-2">
            {split.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_6rem_auto] items-center gap-2">
                <PersonSelect
                  aria-label={t('Person {n}', { n: String(i + 1) })}
                  value={c.userId}
                  onChange={(userId) =>
                    setSplit(split.map((x, j) => (j === i ? { ...x, userId } : x)))
                  }
                />
                <Input
                  aria-label={t('Share for person {n}', { n: String(i + 1) })}
                  inputMode="decimal"
                  value={c.percent}
                  onChange={(e) =>
                    setSplit(split.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))
                  }
                />
                <button
                  type="button"
                  className="rounded p-1 hover:bg-muted"
                  onClick={() => setSplit(split.filter((_, j) => j !== i))}
                  aria-label={t('Remove person {n}', { n: String(i + 1) })}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSplit([...split, { userId: '', percent: '' }])}
              >
                <Plus aria-hidden /> {t('Add person')}
              </Button>
              <span className={total === 100 ? 'text-sm text-success' : 'text-sm text-warning'}>
                {t('Total {percent}', { percent: pct(total) })}
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setSplit(null)}>
                {t('Cancel')}
              </Button>
              <Button size="sm" onClick={saveSplit} disabled={m.setCredits.isPending}>
                {t('Save split')}
              </Button>
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="collect-h" className="space-y-3">
        <h3 id="collect-h" className="text-sm font-semibold">
          {t('Recognised and collected')}
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field id="rec-recognised" label={t('Recognised')}>
            <Input
              inputMode="decimal"
              disabled={!canWrite}
              value={amounts.recognised}
              onChange={(e) => setAmounts({ ...amounts, recognised: e.target.value })}
            />
          </Field>
          <Field id="rec-collected" label={t('Collected')}>
            <Input
              inputMode="decimal"
              disabled={!canWrite}
              value={amounts.collected}
              onChange={(e) => setAmounts({ ...amounts, collected: e.target.value })}
            />
          </Field>
          <Field id="rec-payment" label={t('Payment status')}>
            <Select
              disabled={!canWrite}
              value={amounts.paymentStatus}
              onChange={(e) => setAmounts({ ...amounts, paymentStatus: e.target.value })}
            >
              <option value="">—</option>
              {PAYMENT.map((p) => (
                <option key={p} value={p}>
                  {t(PAYMENT_STATUS_LABEL[p])}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {canWrite && (
          <div className="flex justify-end">
            <Button size="sm" onClick={saveAmounts} disabled={m.update.isPending}>
              {m.update.isPending ? t('Saving…') : t('Save amounts')}
            </Button>
          </div>
        )}
      </section>
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
    </div>
  );
}

'use client';

import { Button, cn, Input } from '@dealflow/ui';
import { Plus, Trash2 } from 'lucide-react';
import { CountrySelect } from '@/components/forms/inputs';
import { useT } from '@/lib/i18n';

/**
 * The RFQ's country rows (ADR 0080): one row per country and target group, each with its own quota, LOI, IR and
 * CPI. Rows are never merged: two target groups in one country are two rows, and SampBidx gets them that way.
 */

export interface RfqLineDraft {
  country: string;
  targetGroup: string;
  quota: string;
  loi: string;
  ir: string;
  cpi: string;
  description: string;
}

export const EMPTY_LINE: RfqLineDraft = { country: '', targetGroup: '', quota: '', loi: '', ir: '', cpi: '', description: '' };
const str = (v: number | null | undefined) => (v == null ? '' : String(v));

export function lineDrafts(lines: { country: string; targetGroup: string; quota: number | null; loi: number | null; ir: number | null; cpi: number | null; description: string | null }[] | undefined): RfqLineDraft[] {
  return (lines ?? []).map((l) => ({ country: l.country, targetGroup: l.targetGroup, quota: str(l.quota), loi: str(l.loi), ir: str(l.ir), cpi: str(l.cpi), description: l.description ?? '' }));
}

/** What the API takes: numbers as typed (the schema reads them), empty text as null. */
export function linesPayload(rows: RfqLineDraft[]) {
  return rows.map((r) => ({ country: r.country, targetGroup: r.targetGroup, quota: r.quota, loi: r.loi, ir: r.ir, cpi: r.cpi, description: r.description || null }));
}

export function RfqLinesEditor({ rows, onChange, errors, currency }: { rows: RfqLineDraft[]; onChange: (rows: RfqLineDraft[]) => void; errors: Record<string, string>; currency: string }) {
  const t = useT();
  const set = (i: number, p: Partial<RfqLineDraft>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const totalQuota = rows.reduce((n, r) => n + (Number(r.quota) || 0), 0);
  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">{t('No country rows yet. Add one per country and target group when the RFQ covers several.')}</p>
      ) : (
        <ol className="space-y-2" aria-label={t('Country rows')}>
          {rows.map((r, i) => {
            const err = (k: keyof RfqLineDraft) => errors[`lines.${i}.${k}`];
            const id = (k: string) => `rfq-line-${i}-${k}`;
            return (
              <li key={i} className="animate-in fade-in-0 slide-in-from-top-1 rounded-lg border border-border bg-muted/30 p-3 duration-200">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Row {n}', { n: i + 1 })}</span>
                  <Button type="button" variant="ghost" size="icon" aria-label={t('Remove row {n}', { n: i + 1 })} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                    <Trash2 aria-hidden />
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                  <div className="min-w-0 lg:col-span-2">
                    <label htmlFor={id('country')} className="mb-1 block text-xs font-medium">
                      {t('Country')} *
                    </label>
                    <CountrySelect id={id('country')} aria-invalid={!!err('country')} value={r.country} onChange={(code) => set(i, { country: code })} />
                    {err('country') && <p className="mt-1 text-xs text-critical">{err('country')}</p>}
                  </div>
                  <div className="min-w-0 lg:col-span-4">
                    <label htmlFor={id('tg')} className="mb-1 block text-xs font-medium">
                      {t('Target group')} *
                    </label>
                    <Input id={id('tg')} aria-invalid={!!err('targetGroup')} maxLength={300} value={r.targetGroup} placeholder={t('e.g. IT decision makers, 1000+ employees')} onChange={(e) => set(i, { targetGroup: e.target.value })} />
                    {err('targetGroup') && <p className="mt-1 text-xs text-critical">{err('targetGroup')}</p>}
                  </div>
                  {(
                    [
                      ['quota', t('Quota'), 'numeric'],
                      ['loi', t('LOI (min)'), 'decimal'],
                      ['ir', t('IR %'), 'decimal'],
                      ['cpi', t('CPI ({currency})', { currency: currency.toUpperCase() || 'USD' }), 'decimal'],
                    ] as const
                  ).map(([k, label, mode]) => (
                    <div key={k} className="min-w-0">
                      <label htmlFor={id(k)} className="mb-1 block text-xs font-medium">
                        {label}
                      </label>
                      <Input id={id(k)} inputMode={mode} aria-invalid={!!err(k)} value={r[k]} onChange={(e) => set(i, { [k]: e.target.value })} className={cn('tabular-nums', err(k) && 'border-critical')} />
                      {err(k) && <p className="mt-1 text-xs text-critical">{err(k)}</p>}
                    </div>
                  ))}
                  <div className="min-w-0 sm:col-span-2">
                    <label htmlFor={id('desc')} className="mb-1 block text-xs font-medium">
                      {t('Notes for this row')}
                    </label>
                    <Input id={id('desc')} maxLength={1000} value={r.description} onChange={(e) => set(i, { description: e.target.value })} />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" size="sm" variant="outline" disabled={rows.length >= 50} onClick={() => onChange([...rows, { ...EMPTY_LINE }])}>
          <Plus aria-hidden /> {t('Add a country row')}
        </Button>
        {rows.length > 0 && <span className="text-xs text-muted-foreground tabular-nums">{t('{rows} rows · total quota {quota}', { rows: rows.length, quota: totalQuota.toLocaleString() })}</span>}
      </div>
    </div>
  );
}

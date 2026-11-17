'use client';

import { type KpiCard, REPORT_PERIODS, type ReportPeriod } from '@dealflow/types';
import {
  Badge,
  Card,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@dealflow/ui';
import { ArrowDown, ArrowUp, ChevronRight, Eye, EyeOff, Info } from 'lucide-react';
import Link from 'next/link';
import { Select } from '@/components/crm/select';
import { StatusChip } from '@/components/crm/status-chip';
import { formatDate } from '@/lib/crm';
import { type DrillTarget, type PeriodChoice, useDrill } from '@/lib/command-center';
import { useT } from '@/lib/i18n';
import { fmtLocale } from '@/lib/i18n/locale';
import { METRIC_DEFINITION, METRIC_LABEL, PERIOD_LABEL } from './cc-labels';

/** Parts shared by the executive, manager and senior management dashboards (ADR 0063). */

export function money(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(fmtLocale(), {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(fmtLocale(), { maximumFractionDigits: 1 }).format(value);
}

/** A percentage already on the 0–100 scale. */
export function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${new Intl.NumberFormat(fmtLocale(), { maximumFractionDigits: 1 }).format(value)}%`;
}

export function kpiValue(k: Pick<KpiCard, 'value' | 'format'>, currency: string): string {
  return k.format === 'currency'
    ? money(k.value, currency)
    : k.format === 'percent'
      ? pct(k.value)
      : count(k.value);
}

/** The reporting period: calendar and financial periods in the viewer's time zone, or two dates. */
export function PeriodPicker({
  value,
  onChange,
}: {
  value: PeriodChoice;
  onChange: (v: PeriodChoice) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="cc-period">
        {t('Period')}
      </label>
      <Select
        id="cc-period"
        className="w-auto"
        value={value.period}
        onChange={(e) => onChange({ ...value, period: e.target.value as ReportPeriod })}
      >
        {REPORT_PERIODS.map((p) => (
          <option key={p} value={p}>
            {t(PERIOD_LABEL[p])}
          </option>
        ))}
      </Select>
      {value.period === 'custom' && (
        <>
          <Input
            type="date"
            className="h-9 w-auto"
            aria-label={t('From')}
            value={value.from ?? ''}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
          <Input
            type="date"
            className="h-9 w-auto"
            aria-label={t('To')}
            value={value.to ?? ''}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
          />
        </>
      )}
    </div>
  );
}

/** KPI cards that each open the records they count. */
export function KpiCards({
  kpis,
  currency,
  onOpen,
  label,
}: {
  kpis: KpiCard[];
  currency: string;
  onOpen: (k: KpiCard) => void;
  label: string;
}) {
  const t = useT();
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label={label}>
      {kpis.map((k) => {
        const name = t(METRIC_LABEL[k.key]);
        const def = METRIC_DEFINITION[k.key];
        return (
          <li key={k.key}>
            <Card
              data-testid={`cc-kpi-${k.key}`}
              className="group relative h-full p-4 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-glow"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">{name}</p>
                {def && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="relative z-10 rounded text-muted-foreground hover:text-foreground"
                        aria-label={t('How {kpi} is calculated', { kpi: name })}
                      >
                        <Info className="size-3.5" aria-hidden />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">{t(def)}</TooltipContent>
                  </Tooltip>
                )}
              </div>
              <button
                type="button"
                onClick={() => onOpen(k)}
                className="tabular mt-2 block text-start text-xl font-semibold tracking-tight after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
                aria-label={t('{kpi}: {value}. Show the records', {
                  kpi: name,
                  value: kpiValue(k, currency),
                })}
              >
                {kpiValue(k, currency)}
              </button>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/** The records behind a number, in a side panel. The total is the number on the card. */
export function DrillPanel({
  target,
  period,
  currency,
  onClose,
}: {
  target: DrillTarget | null;
  period: PeriodChoice;
  currency: string;
  onClose: () => void;
}) {
  const t = useT();
  const q = useDrill(target, period);
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" className="max-w-xl overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{target?.title}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">
          {q.data
            ? t('{count} records. Open one to see it in full.', { count: count(q.data.total) })
            : t('Loading')}
        </DialogDescription>
        {q.isPending ? (
          <Skeleton className="h-40" />
        ) : q.error ? (
          <p role="alert" className="text-sm text-critical">
            {q.error.message}
          </p>
        ) : !q.data?.rows.length ? (
          <p className="text-sm text-muted-foreground">{t('No records in this period.')}</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="cc-drill-rows">
            {q.data.rows.map((r) => {
              const body = (
                <div className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {[r.subtitle && t.maybe(r.subtitle), r.person?.name, r.at && formatDate(r.at)]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {r.status && (
                      <StatusChip status={r.status as Parameters<typeof StatusChip>[0]['status']} />
                    )}
                    {r.amount !== null && (
                      <span className="tabular text-sm">
                        {money(r.amount, r.currency ?? currency)}
                      </span>
                    )}
                    {r.href && (
                      <ChevronRight
                        className="size-4 text-muted-foreground rtl:rotate-180"
                        aria-hidden
                      />
                    )}
                  </div>
                </div>
              );
              return (
                <li key={`${r.kind}-${r.id}`}>
                  {r.href ? (
                    <Link
                      href={r.href}
                      className="block rounded hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {q.data && q.data.total > q.data.rows.length && (
          <p className="mt-3 text-xs text-muted-foreground">
            {t('Showing the first {count}.', { count: count(q.data.rows.length) })}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One row of the customise list: move up, move down, show or hide. */
export function ArrangeRow({
  label,
  hidden,
  first,
  last,
  onMove,
  onToggle,
}: {
  label: string;
  hidden: boolean;
  first: boolean;
  last: boolean;
  onMove: (dir: -1 | 1) => void;
  onToggle: () => void;
}) {
  const t = useT();
  return (
    <li
      className={cn(
        'flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm',
        hidden && 'opacity-60',
      )}
    >
      <span>{label}</span>
      <span className="flex items-center gap-1">
        {hidden && <Badge>{t('Hidden')}</Badge>}
        <button
          type="button"
          className="rounded p-1 hover:bg-muted disabled:opacity-40"
          disabled={first}
          onClick={() => onMove(-1)}
          aria-label={t('Move {name} up', { name: label })}
        >
          <ArrowUp className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          className="rounded p-1 hover:bg-muted disabled:opacity-40"
          disabled={last}
          onClick={() => onMove(1)}
          aria-label={t('Move {name} down', { name: label })}
        >
          <ArrowDown className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          className="rounded p-1 hover:bg-muted"
          onClick={onToggle}
          aria-label={
            hidden ? t('Show {name}', { name: label }) : t('Hide {name}', { name: label })
          }
        >
          {hidden ? (
            <Eye className="size-4" aria-hidden />
          ) : (
            <EyeOff className="size-4" aria-hidden />
          )}
        </button>
      </span>
    </li>
  );
}

export function move<T>(list: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/** A thin progress bar for target achievement. */
export function Progress({ value, label }: { value: number | null; label: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
      className="h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div
        className={cn(
          'h-full rounded-full',
          v >= 100 ? 'bg-success' : v >= 60 ? 'bg-primary' : 'bg-warning',
        )}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

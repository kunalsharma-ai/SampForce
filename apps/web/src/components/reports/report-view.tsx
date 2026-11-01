'use client';

import { Button } from '@dealflow/ui';
import type { ReportChart, ReportResult } from '@dealflow/types';
import { BarChart3, Table2 } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatValue } from '@/lib/reports';
import { useMotionLevel } from '@/lib/motion';

export const SERIES = [1, 2, 3, 4, 5, 6].map((i) => `hsl(var(--chart-${i}))`);
const PIE_SLICES = 6;

const axis = { fill: 'hsl(var(--muted-foreground))', fontSize: 11 };
const tooltipStyle = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--popover-foreground))' };

/** Pies beyond six slices fold the smallest groups into "Other" so every slice stays readable. */
function pieRows(rows: ReportResult['rows']) {
  if (rows.length <= PIE_SLICES) return rows;
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const rest = sorted.slice(PIE_SLICES - 1).reduce((s, r) => s + r.value, 0);
  return [...sorted.slice(0, PIE_SLICES - 1), { key: '__other', label: 'Other', value: Math.round(rest * 100) / 100 }];
}

/**
 * Draws a report result as its chart type, always with an equivalent table one click away (and the table alone
 * for "table" reports). Notes say when groups were cut or records could not be converted.
 */
export function ReportView({ result, chart, height = 256, compact = false }: { result: ReportResult; chart: ReportChart; height?: number; compact?: boolean }) {
  const [asTable, setAsTable] = useState(false);
  const motion = useMotionLevel();
  const animate = motion === 'full';
  const fmt = (v: number) => formatValue(v, result.currency);
  const showTable = chart === 'table' || asTable;
  const empty = result.records === 0;

  return (
    <div className="space-y-3">
      {chart !== 'table' && chart !== 'number' && !empty && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setAsTable(!asTable)} aria-pressed={asTable}>
            {asTable ? <BarChart3 aria-hidden /> : <Table2 aria-hidden />}
            {asTable ? 'Chart' : 'Table'}
          </Button>
        </div>
      )}
      {empty ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No records match this report yet.</p>
      ) : chart === 'number' ? (
        <div className="py-4">
          <p className="text-4xl font-semibold tabular" aria-label={`${result.metricLabel}: ${fmt(result.total)}`}>{fmt(result.total)}</p>
          <p className="mt-1 text-sm text-muted-foreground">{result.metricLabel}</p>
        </div>
      ) : showTable ? (
        <ResultTable result={result} fmt={fmt} compact={compact} />
      ) : (
        <div style={{ height }} role="img" aria-label={`${chart === 'line' ? 'Line' : chart === 'pie' ? 'Pie' : 'Bar'} chart of ${result.metricLabel.toLowerCase()}${result.groupLabel ? ` by ${result.groupLabel.toLowerCase()}` : ''}, ${result.rows.length} groups. Use the Table button for exact values.`}>
          <ResponsiveContainer width="100%" height="100%">
            {chart === 'line' ? (
              <LineChart data={result.rows} margin={{ left: 8, right: 16, top: 8 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} minTickGap={16} />
                <YAxis tickFormatter={fmt} tick={axis} tickLine={false} axisLine={false} width={76} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [fmt(v), result.metricLabel]} />
                <Line type="monotone" dataKey="value" stroke={SERIES[0]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={animate} />
              </LineChart>
            ) : chart === 'pie' ? (
              <PieChart>
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [fmt(v), name]} />
                <Pie data={pieRows(result.rows)} dataKey="value" nameKey="label" innerRadius="55%" outerRadius="85%" paddingAngle={1} isAnimationActive={animate}
                  label={false} labelLine={false}>
                  {pieRows(result.rows).map((r, i) => (
                    <Cell key={r.key ?? `none-${i}`} fill={SERIES[i % SERIES.length]} stroke="hsl(var(--background))" />
                  ))}
                </Pie>
              </PieChart>
            ) : (
              <BarChart data={result.rows} margin={{ left: 8, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} interval={result.rows.length > 8 ? 'preserveStartEnd' : 0} />
                <YAxis tickFormatter={fmt} tick={axis} tickLine={false} axisLine={false} width={76} />
                <Tooltip cursor={{ fill: 'hsl(var(--muted))' }} contentStyle={tooltipStyle} formatter={(v: number) => [fmt(v), result.metricLabel]} />
                <Bar dataKey="value" fill={SERIES[0]} radius={[6, 6, 0, 0]} isAnimationActive={animate} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
      {chart === 'pie' && !showTable && !empty && <PieLegend result={result} fmt={fmt} />}
      <ResultNotes result={result} />
    </div>
  );
}

function ResultTable({ result, fmt, compact }: { result: ReportResult; fmt: (v: number) => string; compact: boolean }) {
  return (
    <div className={compact ? 'max-h-64 overflow-auto' : 'overflow-x-auto'}>
      <table className="w-full text-sm">
        <caption className="sr-only">
          {result.metricLabel}
          {result.groupLabel ? ` by ${result.groupLabel}` : ''}
        </caption>
        <thead className="text-start text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-2 font-medium">{result.groupLabel ?? 'Group'}</th>
            <th scope="col" className="py-2 text-end font-medium">{result.metricLabel}</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {result.rows.map((r, i) => (
            <tr key={r.key ?? `none-${i}`} className="border-t border-border">
              <th scope="row" className="py-2 text-start font-normal">{r.label}</th>
              <td className="py-2 text-end">{fmt(r.value)}</td>
            </tr>
          ))}
        </tbody>
        {result.rows.length > 1 && (
          <tfoot>
            <tr className="border-t border-border font-medium">
              <th scope="row" className="py-2 text-start">All matching records</th>
              <td className="py-2 text-end tabular">{fmt(result.total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function ResultNotes({ result }: { result: ReportResult }) {
  const notes: string[] = [];
  if (result.truncated) notes.push(`Showing the first ${result.rows.length} groups; raise the row limit to see more.`);
  if (result.excluded) {
    notes.push(
      `${result.excluded.records} record${result.excluded.records === 1 ? '' : 's'} in ${result.excluded.currencies.join(', ')} left out: no exchange rate to ${result.currency} yet (add one in Revenue Intelligence).`,
    );
  }
  if (notes.length === 0) return null;
  return (
    <ul className="space-y-1 text-xs text-muted-foreground">
      {notes.map((n) => (
        <li key={n}>{n}</li>
      ))}
    </ul>
  );
}

function PieLegend({ result, fmt }: { result: ReportResult; fmt: (v: number) => string }) {
  const rows = pieRows(result.rows);
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  return (
    <ul className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2" aria-hidden>
      {rows.map((r, i) => (
        <li key={r.key ?? `none-${i}`} className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} />
          <span className="min-w-0 flex-1 truncate">{r.label}</span>
          <span className="tabular text-muted-foreground">{fmt(r.value)} · {Math.round((r.value / total) * 100)}%</span>
        </li>
      ))}
    </ul>
  );
}

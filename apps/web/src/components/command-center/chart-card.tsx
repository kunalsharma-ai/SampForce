'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dealflow/ui';
import { BarChart3, Download, Table2 } from 'lucide-react';
import { useState } from 'react';
import { downloadCsv } from '@/lib/dashboard';
import { useT } from '@/lib/i18n';

export interface TableSpec {
  caption: string;
  header: string[];
  /** Raw values for the CSV file. */
  rows: (string | number | null)[][];
  /** Formatted values for the on-screen table (same shape as rows). */
  display: string[][];
  /** Columns aligned right (numbers). */
  numeric?: number[];
}

/**
 * A Command Center chart: the chart, an equivalent table (WCAG 1.1.1: every chart has a readable alternative) and a
 * CSV export of the same rows. `summary` is what a screen reader hears for the chart image.
 */
export function ChartCard({
  title,
  description,
  summary,
  table,
  filename,
  empty,
  children,
}: {
  title: string;
  description: string;
  summary: string;
  table: TableSpec;
  filename: string;
  empty?: string | null;
  children: React.ReactNode;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const t = useT();
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => setView(view === 'chart' ? 'table' : 'chart')} aria-label={view === 'chart' ? t('{title}: show as table', { title }) : t('{title}: show as chart', { title })}>
            {view === 'chart' ? <Table2 aria-hidden /> : <BarChart3 aria-hidden />}
            <span className="hidden sm:inline">{view === 'chart' ? t('Table') : t('Chart')}</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => downloadCsv(filename, table.header, table.rows)} aria-label={t('{title}: download CSV', { title })} disabled={table.rows.length === 0}>
            <Download aria-hidden />
            <span className="hidden sm:inline">CSV</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        {empty ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>
        ) : view === 'chart' ? (
          <div className="h-60" role="img" aria-label={`${summary} ${t('Switch to table view for exact values.')}`}>
            {children}
          </div>
        ) : (
          <div className="max-h-60 overflow-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{table.caption}</caption>
              <thead className="sticky top-0 bg-surface text-start text-xs text-muted-foreground">
                <tr>
                  {table.header.map((h, i) => (
                    <th key={h} scope="col" className={`py-2 pe-2 font-medium ${table.numeric?.includes(i) ? 'text-end' : ''}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular">
                {table.display.map((r, ri) => (
                  <tr key={ri} className="border-t border-border">
                    {r.map((c, ci) =>
                      ci === 0 ? (
                        <th key={ci} scope="row" className="py-2 pe-2 text-start font-normal">
                          {c}
                        </th>
                      ) : (
                        <td key={ci} className={`py-2 pe-2 ${table.numeric?.includes(ci) ? 'text-end' : ''}`}>
                          {c}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export const axisTick = { fill: 'hsl(var(--muted-foreground))', fontSize: 11 };
export const tooltipStyle = { background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--popover-foreground))' };

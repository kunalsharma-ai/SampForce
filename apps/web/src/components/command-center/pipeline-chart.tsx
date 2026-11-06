'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dealflow/ui';
import type { DashboardSummary } from '@dealflow/types';
import { BarChart3, Table2 } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatKpi } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { usePreferences } from '@/stores/preferences';
import { InfoTip } from '@/components/info-tip';

/** Pipeline value by stage, with an equivalent table view for screen readers and keyboard users. */
export function PipelineChart({ pipeline, currency }: { pipeline: NonNullable<DashboardSummary['pipeline']>; currency: string }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const t = useT();
  const animate = usePreferences((s) => s.appearance.motion !== 'off' && s.appearance.motion !== 'minimal');
  const money = (n: number) => formatKpi(n, 'currency', currency);
  const empty = pipeline.stages.every((s) => s.dealCount === 0);

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <div className="flex items-center gap-1.5">
            <CardTitle>{t('Pipeline by stage')}</CardTitle>
            <InfoTip topic="commandCenter.pipeline" />
          </div>
          <CardDescription>{pipeline.name}</CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setView(view === 'chart' ? 'table' : 'chart')}
          aria-label={view === 'chart' ? t('{title}: show as table', { title: t('Pipeline by stage') }) : t('{title}: show as chart', { title: t('Pipeline by stage') })}
        >
          {view === 'chart' ? <Table2 aria-hidden /> : <BarChart3 aria-hidden />}
          {view === 'chart' ? t('Table') : t('Chart')}
        </Button>
      </CardHeader>
      <CardContent>
        {empty && (
          <p className="mb-3 text-sm text-muted-foreground">{t('No deals yet. Stage values will appear as deals are added in the Deals module.')}</p>
        )}
        {view === 'chart' ? (
          <div className="h-64" role="img" aria-label={`${t('Bar chart of deal value across {stages} stages.', { stages: pipeline.stages.length })} ${t('Switch to table view for exact values.')}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pipeline.stages} margin={{ left: 8, right: 8 }}>
                <defs>
                  <linearGradient id="stageFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="hsl(var(--primary))" stopOpacity={0.9} />
                    <stop offset="1" stopColor="hsl(var(--accent))" stopOpacity={0.6} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickLine={false} axisLine={false} interval={0} />
                <YAxis tickFormatter={money} tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }} tickLine={false} axisLine={false} width={72} />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--muted))' }}
                  contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                  formatter={(v: number) => [money(v), t('Value')]}
                />
                <Bar dataKey="value" fill="url(#stageFill)" radius={[6, 6, 0, 0]} isAnimationActive={animate} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">{t('Deals and value by pipeline stage')}</caption>
            <thead className="text-start text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 font-medium">{t('Stage')}</th>
                <th scope="col" className="py-2 text-end font-medium">{t('Probability')}</th>
                <th scope="col" className="py-2 text-end font-medium">{t('Deals')}</th>
                <th scope="col" className="py-2 text-end font-medium">{t('Value')}</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {pipeline.stages.map((s) => (
                <tr key={s.stageId} className="border-t border-border">
                  <th scope="row" className="py-2 text-start font-normal">{s.name}</th>
                  <td className="py-2 text-end">{s.probability}%</td>
                  <td className="py-2 text-end">{s.dealCount}</td>
                  <td className="py-2 text-end">{money(s.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dealflow/ui';
import type { DashboardSummary } from '@dealflow/types';
import { BarChart3, Table2 } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatKpi } from '@/lib/format';
import { usePreferences } from '@/stores/preferences';

/** Pipeline value by stage, with an equivalent table view for screen readers and keyboard users. */
export function PipelineChart({ pipeline, currency }: { pipeline: NonNullable<DashboardSummary['pipeline']>; currency: string }) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const animate = usePreferences((s) => s.appearance.motion !== 'off' && s.appearance.motion !== 'minimal');
  const money = (n: number) => formatKpi(n, 'currency', currency);
  const empty = pipeline.stages.every((s) => s.dealCount === 0);

  return (
    <Card className="h-full">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>Pipeline by stage</CardTitle>
          <CardDescription>{pipeline.name}</CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setView(view === 'chart' ? 'table' : 'chart')}
          aria-label={view === 'chart' ? 'Show as table' : 'Show as chart'}
        >
          {view === 'chart' ? <Table2 aria-hidden /> : <BarChart3 aria-hidden />}
          {view === 'chart' ? 'Table' : 'Chart'}
        </Button>
      </CardHeader>
      <CardContent>
        {empty && (
          <p className="mb-3 text-sm text-muted-foreground">No deals yet. Stage values will appear as deals are added in the Deals module.</p>
        )}
        {view === 'chart' ? (
          <div className="h-64" role="img" aria-label={`Bar chart of deal value across ${pipeline.stages.length} stages. Switch to table view for exact values.`}>
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
                  formatter={(v: number) => [money(v), 'Value']}
                />
                <Bar dataKey="value" fill="url(#stageFill)" radius={[6, 6, 0, 0]} isAnimationActive={animate} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">Deals and value by pipeline stage</caption>
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 font-medium">Stage</th>
                <th scope="col" className="py-2 text-right font-medium">Probability</th>
                <th scope="col" className="py-2 text-right font-medium">Deals</th>
                <th scope="col" className="py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {pipeline.stages.map((s) => (
                <tr key={s.stageId} className="border-t border-border">
                  <th scope="row" className="py-2 text-left font-normal">{s.name}</th>
                  <td className="py-2 text-right">{s.probability}%</td>
                  <td className="py-2 text-right">{s.dealCount}</td>
                  <td className="py-2 text-right">{money(s.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

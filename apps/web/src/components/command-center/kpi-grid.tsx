'use client';

import { Card, cn, Tooltip, TooltipContent, TooltipTrigger } from '@dealflow/ui';
import type { KpiKey, KpiValue } from '@dealflow/types';
import { Info } from 'lucide-react';
import { motion } from 'motion/react';
import { formatKpi } from '@/lib/format';
import { AnimatedNumber } from './animated-number';

const HIGHLIGHT: KpiKey[] = ['pipelineValue', 'weightedPipelineValue', 'closedWonRevenue', 'forecastRevenue'];

export function KpiGrid({ kpis, currency }: { kpis: KpiValue[]; currency: string }) {
  const ordered = [...kpis.filter((k) => HIGHLIGHT.includes(k.key)), ...kpis.filter((k) => !HIGHLIGHT.includes(k.key))];
  return (
    <section aria-labelledby="kpi-heading">
      <h2 id="kpi-heading" className="sr-only">
        Key performance indicators
      </h2>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {ordered.map((k, i) => {
          const highlight = HIGHLIGHT.includes(k.key);
          return (
            <motion.li
              key={k.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.025, duration: 0.3 }}
              className={cn(highlight && 'col-span-2 md:col-span-1')}
            >
              <Card
                data-testid={`kpi-${k.key}`}
                className={cn(
                  'group h-full p-4 transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-glow',
                  highlight && 'bg-gradient-to-br from-primary/[0.08] to-accent/[0.06]',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium text-muted-foreground">{k.label}</p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="rounded text-muted-foreground hover:text-foreground" aria-label={`How ${k.label} is calculated`}>
                        <Info className="size-3.5" aria-hidden />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{k.definition}</TooltipContent>
                  </Tooltip>
                </div>
                <p className={cn('tabular mt-2 font-semibold tracking-tight', highlight ? 'text-2xl' : 'text-xl')}>
                  {k.value === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <AnimatedNumber value={k.value} format={(n) => formatKpi(n, k.format, currency)} />
                  )}
                </p>
                {k.value === null && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {k.availableFrom ? `Available with ${k.availableFrom}` : 'Not enough data yet'}
                  </p>
                )}
              </Card>
            </motion.li>
          );
        })}
      </ul>
    </section>
  );
}

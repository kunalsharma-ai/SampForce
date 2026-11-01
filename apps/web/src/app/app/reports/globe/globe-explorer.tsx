'use client';

import { Card, CardContent, CardHeader, CardTitle, cn, Skeleton } from '@dealflow/ui';
import type { GlobeCountry, GlobeData } from '@dealflow/types';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import type { GlobeBar } from '@/components/immersive/globe-scene';
import { useViewMode, ViewModeSwitch } from '@/components/immersive/view-controls';
import { Select } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import anchors from '@/lib/geo/anchors.json';
import { useMotionLevel } from '@/lib/motion';
import { countryName, formatValue, useGlobe } from '@/lib/reports';
import { fmtLocale } from '@/lib/i18n/locale';

const GlobeScene = dynamic(() => import('@/components/immersive/globe-scene'), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> });

const METRICS = {
  openValue: 'Open pipeline value',
  wonValue: 'Won in the last 12 months',
  openDeals: 'Open deals',
  companies: 'Companies',
} as const;
type Metric = keyof typeof METRICS;
const ANCHORS = anchors as unknown as Record<string, [number, number]>;

export function GlobeExplorer() {
  const globe = useGlobe();
  const view = useViewMode();
  const motion = useMotionLevel();
  const [metric, setMetric] = useState<Metric>('openValue');
  const [selected, setSelected] = useState<string | null>(null);
  const [showFps, setShowFps] = useState(false);

  const fmt = (c: GlobeCountry, m: Metric, d: GlobeData) => (m === 'openValue' || m === 'wonValue' ? formatValue(c[m], d.currency) : c[m].toLocaleString(fmtLocale()));
  const { bars, offMap } = useMemo(() => {
    const rows = globe.data?.countries ?? [];
    const max = Math.max(0, ...rows.map((r) => r[metric]));
    const out: GlobeBar[] = [];
    const missing: string[] = [];
    for (const r of rows) {
      if (r[metric] <= 0) continue;
      const a = ANCHORS[r.country];
      if (!a) missing.push(r.country);
      else out.push({ country: r.country, label: countryName(r.country), lat: a[0], lng: a[1], share: max ? r[metric] / max : 0 });
    }
    return { bars: out, offMap: missing };
  }, [globe.data, metric]);

  if (globe.isPending || !view.support.ready) return <Skeleton className="h-[32rem]" />;
  if (globe.error) return <ErrorText error={globe.error} />;
  const d = globe.data;
  const describe = (code: string) => {
    const c = d.countries.find((x) => x.country === code);
    return c ? `${METRICS[metric]}: ${fmt(c, metric, d)}` : '';
  };
  const sel = selected ? d.countries.find((c) => c.country === selected) : undefined;
  const sorted = [...d.countries].sort((a, b) => b[metric] - a[metric] || a.country.localeCompare(b.country));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <ViewModeSwitch view={view} label="Revenue Globe" />
        <div className="flex items-end gap-3">
          <Field id="g-metric" label="Show">
            <Select id="g-metric" value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
              {(Object.keys(METRICS) as Metric[]).map((m) => <option key={m} value={m}>{METRICS[m]}</option>)}
            </Select>
          </Field>
          {view.mode === '3d' && (
            <label className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <input type="checkbox" checked={showFps} onChange={(e) => setShowFps(e.target.checked)} /> Frame rate
            </label>
          )}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="relative h-[32rem] overflow-hidden">
          {d.countries.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">Set a country on your companies to place them on the globe.</div>
          ) : view.mode === '3d' ? (
            <GlobeScene bars={bars} selected={selected} onSelect={setSelected} motion={motion} showFps={showFps} onContextLost={view.contextLost} onSwitch2D={() => view.setMode('2d')} describe={describe} />
          ) : (
            <FlatMap bars={bars} selected={selected} onSelect={setSelected} />
          )}
        </Card>
        <div className="space-y-4">
          {sel && (
            <Card aria-live="polite">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{countryName(sel.country)}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {(Object.keys(METRICS) as Metric[]).map((m) => (
                    <div key={m}>
                      <dt className="text-xs text-muted-foreground">{METRICS[m]}</dt>
                      <dd className="font-medium tabular">{fmt(sel, m, d)}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">By country</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">{METRICS[metric]} by country</caption>
                  <thead className="text-start text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="py-1 font-medium">Country</th>
                      <th scope="col" className="py-1 text-end font-medium">{METRICS[metric]}</th>
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {sorted.map((c) => (
                      <tr key={c.country} className={cn('border-t border-border', c.country === selected && 'bg-muted')}>
                        <th scope="row" className="py-1 text-start font-normal">
                          <button type="button" className="hover:underline" onClick={() => setSelected(c.country)} aria-pressed={c.country === selected}>
                            {countryName(c.country)}
                          </button>
                        </th>
                        <td className="py-1 text-end">{fmt(c, metric, d)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {(d.unplaced.companies > 0 || d.unplaced.openDeals > 0) && (
                  <li>
                    Not on the map: {d.unplaced.companies} compan{d.unplaced.companies === 1 ? 'y' : 'ies'} without a country and {d.unplaced.openDeals} open deal{d.unplaced.openDeals === 1 ? '' : 's'} without a company country.
                  </li>
                )}
                {offMap.length > 0 && <li>No map position for: {offMap.map(countryName).join(', ')} (listed in the table).</li>}
                {d.excludedDeals > 0 && <li>{d.excludedDeals} deal{d.excludedDeals === 1 ? '' : 's'} left out of values: no exchange rate to {d.currency}.</li>}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Equirectangular 2D map: the same borders and values, drawn as SVG. */
function FlatMap({ bars, selected, onSelect }: { bars: GlobeBar[]; selected: string | null; onSelect: (c: string) => void }) {
  const [lines, setLines] = useState<number[][]>([]);
  useEffect(() => {
    let cancelled = false;
    void fetch('/geo/borders-110m.json').then((r) => r.json() as Promise<number[][]>).then((l) => !cancelled && setLines(l)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const paths = useMemo(() => lines.map((l) => {
    let d = '';
    for (let i = 0; i < l.length; i += 2) d += `${i === 0 ? 'M' : 'L'}${l[i]} ${-l[i + 1]!}`;
    return d;
  }), [lines]);
  return (
    <svg viewBox="-180 -90 360 180" className="h-full w-full" preserveAspectRatio="xMidYMid meet" role="img" aria-label="World map in 2D. The table beside it holds the same figures.">
      <g fill="none" stroke="hsl(var(--muted-foreground))" strokeOpacity={0.4} strokeWidth={0.3}>
        {paths.map((p, i) => <path key={i} d={p} />)}
      </g>
      {bars.map((b) => (
        <circle
          key={b.country}
          cx={b.lng}
          cy={-b.lat}
          r={1.2 + 6 * Math.sqrt(b.share)}
          fill={b.country === selected ? 'hsl(var(--chart-4))' : 'hsl(var(--chart-1))'}
          fillOpacity={0.7}
          stroke="hsl(var(--background))"
          strokeWidth={0.3}
          className="cursor-pointer"
          onClick={() => onSelect(b.country)}
        >
          <title>{b.label}</title>
        </circle>
      ))}
    </svg>
  );
}

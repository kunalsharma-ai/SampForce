'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import type { PipelineReplay } from '@dealflow/types';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Select } from '@/components/crm/select';
import { ErrorText } from '@/components/revenue/tabs';
import { useMotionLevel } from '@/lib/motion';
import { formatValue, useReplay } from '@/lib/reports';
import { WindowControls } from '../window-controls';
import { buildTimeline } from './replay-model';

const DAY = 86_400_000;
const COL_W = 150;
const DOT = 9;
const PER_ROW = 12;
const fmtDay = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

export function ReplayExplorer() {
  const [pipelineId, setPipelineId] = useState<string | undefined>();
  const [days, setDays] = useState(90);
  const replay = useReplay({ pipelineId, days });
  return (
    <div className="space-y-4">
      <WindowControls id="replay" pipelineId={pipelineId} setPipelineId={setPipelineId} days={days} setDays={setDays} />
      {replay.isPending ? <Skeleton className="h-96" /> : replay.error ? <ErrorText error={replay.error} /> : <Player r={replay.data} key={`${replay.data.pipelineId}:${replay.data.from}`} />}
    </div>
  );
}

function Player({ r }: { r: PipelineReplay }) {
  const motion = useMotionLevel();
  const from = Date.parse(r.from);
  const to = Date.parse(r.to);
  const totalDays = Math.max(1, Math.round((to - from) / DAY));
  const [day, setDay] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const frameAt = useMemo(() => buildTimeline(r), [r]);
  const t = day >= totalDays ? to : from + day * DAY;
  const frame = useMemo(() => frameAt(t), [frameAt, t]);
  const stages = useMemo(() => {
    const rank = { OPEN: 0, WON: 1, LOST: 2 } as const;
    return [...r.stages].sort((a, b) => rank[a.category] - rank[b.category] || a.position - b.position);
  }, [r.stages]);
  const names = useMemo(() => new Map(r.deals.map((d) => [d.id, d.name])), [r.deals]);

  // Playback: the whole window in about 20 seconds at 1×. Under reduced motion, one day per step with no tweening.
  const last = useRef<number | null>(null);
  const acc = useRef(0);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const step = (now: number) => {
      if (last.current !== null) acc.current += ((now - last.current) / 1000) * (totalDays / 20) * speed;
      last.current = now;
      if (acc.current >= 1) {
        const n = Math.floor(acc.current);
        acc.current -= n;
        setDay((d) => {
          const next = Math.min(totalDays, d + n);
          if (next >= totalDays) setPlaying(false);
          return next;
        });
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      last.current = null;
    };
  }, [playing, speed, totalDays]);

  // Dot positions: each stage column holds its deals in a stable order, wrapped into rows.
  const byStage = new Map<string, string[]>();
  for (const [deal, stage] of frame.stageOf) byStage.set(stage, [...(byStage.get(stage) ?? []), deal]);
  for (const list of byStage.values()) list.sort();
  const rows = Math.max(1, ...[...byStage.values()].map((l) => Math.ceil(l.length / PER_ROW)));
  const height = 40 + rows * (DOT + 3) + 20;
  const width = stages.length * COL_W;
  const tween = motion === 'full' ? 'transform 450ms ease-out, opacity 300ms' : 'none';

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{r.pipelineName}</CardTitle>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            <span className="font-medium text-foreground">{fmtDay(t)}</span> · {frame.openDeals} open deal{frame.openDeals === 1 ? '' : 's'} worth {formatValue(frame.openValue, r.currency)} · {frame.wonSinceStart} won and {frame.lostSinceStart} lost since {fmtDay(from)}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => { if (day >= totalDays) setDay(0); setPlaying(!playing); }} aria-label={playing ? 'Pause replay' : 'Play replay'}>
              {playing ? <Pause aria-hidden /> : <Play aria-hidden />} {playing ? 'Pause' : 'Play'}
            </Button>
            <Button variant="outline" onClick={() => { setPlaying(false); setDay(0); }}>
              <RotateCcw aria-hidden /> Start
            </Button>
            <label className="inline-flex items-center gap-2 text-sm">
              Speed
              <Select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="h-9 w-20" aria-label="Playback speed">
                <option value={0.5}>½×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={4}>4×</option>
              </Select>
            </label>
            <input
              type="range"
              min={0}
              max={totalDays}
              value={day}
              onChange={(e) => { setPlaying(false); setDay(Number(e.target.value)); }}
              aria-label="Replay date"
              aria-valuetext={fmtDay(t)}
              className="min-w-48 flex-1 accent-[hsl(var(--primary))]"
            />
          </div>
          {r.deals.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deals were in this pipeline during the period.</p>
          ) : (
            <div className="overflow-x-auto">
              <svg viewBox={`0 0 ${width} ${height}`} style={{ minWidth: Math.min(width, 800) }} className="h-auto w-full" role="img" aria-label={`Deals by stage on ${fmtDay(t)}. The table below lists the same counts.`}>
                {stages.map((s, i) => (
                  <g key={s.id} transform={`translate(${i * COL_W} 0)`}>
                    <rect x={4} y={0} width={COL_W - 8} height={height} rx={8} fill="hsl(var(--muted))" fillOpacity={0.35} />
                    <text x={12} y={20} fontSize={12} fontWeight={600} fill="hsl(var(--foreground))">{s.name.length > 16 ? `${s.name.slice(0, 15)}…` : s.name}</text>
                    <text x={COL_W - 12} y={20} fontSize={12} textAnchor="end" fill="hsl(var(--muted-foreground))">{byStage.get(s.id)?.length ?? 0}</text>
                  </g>
                ))}
                {r.deals.map((d) => {
                  const stage = frame.stageOf.get(d.id);
                  const col = stage ? stages.findIndex((s) => s.id === stage) : -1;
                  const list = stage ? byStage.get(stage)! : [];
                  const k = list.indexOf(d.id);
                  const cat = col >= 0 ? stages[col]!.category : 'OPEN';
                  const x = col * COL_W + 14 + (k % PER_ROW) * (DOT + 2);
                  const y = 36 + Math.floor(k / PER_ROW) * (DOT + 3);
                  return (
                    <circle
                      key={d.id}
                      r={DOT / 2}
                      cx={0}
                      cy={0}
                      fill={cat === 'WON' ? 'hsl(var(--chart-3))' : cat === 'LOST' ? 'hsl(var(--chart-5))' : 'hsl(var(--chart-1))'}
                      style={{ transform: `translate(${col < 0 ? 0 : x}px, ${col < 0 ? 0 : y}px)`, opacity: col < 0 ? 0 : 1, transition: tween }}
                    >
                      <title>{names.get(d.id)}</title>
                    </circle>
                  );
                })}
              </svg>
            </div>
          )}
          {r.truncated && <p className="text-xs text-muted-foreground">Showing the 400 most recently active deals.</p>}
          {r.reconstructed && <p className="text-xs text-muted-foreground">Moves made before stage history was recorded were rebuilt from the audit log, so some early dates may be approximate.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">On {fmtDay(t)}</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <caption className="sr-only">Deals in each stage on {fmtDay(t)}</caption>
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 font-medium">Stage</th>
                <th scope="col" className="py-1 text-right font-medium">Deals</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {stages.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <th scope="row" className="py-1 text-left font-normal">{s.name}</th>
                  <td className="py-1 text-right">{byStage.get(s.id)?.length ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

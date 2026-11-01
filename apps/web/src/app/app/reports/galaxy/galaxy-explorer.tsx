'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, cn, Input, Skeleton } from '@dealflow/ui';
import type { GalaxyGraph, GalaxyNode } from '@dealflow/types';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { nodeColorToken } from '@/lib/galaxy-style';
import { useViewMode, ViewModeSwitch } from '@/components/immersive/view-controls';
import { ErrorText } from '@/components/revenue/tabs';
import { useMotionLevel } from '@/lib/motion';
import { formatValue, useGalaxy } from '@/lib/reports';

const GalaxyScene = dynamic(() => import('@/components/immersive/galaxy-scene'), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> });

/** Lays the graph out in a worker (3D or 2D), falling back to the main thread where workers are unavailable. */
function useLayout(graph: GalaxyGraph | undefined, dims: 2 | 3): Float32Array | null {
  const [state, setState] = useState<{ key: string; positions: Float32Array } | null>(null);
  const key = graph ? `${dims}:${graph.nodes.length}:${graph.edges.length}:${graph.nodes[0]?.id ?? ''}` : '';
  useEffect(() => {
    if (!graph) return;
    let cancelled = false;
    const payload = { nodes: graph.nodes.map((n) => ({ id: n.id, kind: n.kind })), edges: graph.edges, dims };
    let worker: Worker | null = null;
    try {
      worker = new Worker(new URL('../../../../components/immersive/galaxy.worker.ts', import.meta.url));
      worker.onmessage = (e: MessageEvent<{ positions: Float32Array }>) => !cancelled && setState({ key, positions: e.data.positions });
      worker.postMessage(payload);
    } catch {
      void import('@/lib/galaxy-layout').then(({ layoutGraph }) => !cancelled && setState({ key, positions: layoutGraph(payload.nodes, payload.edges, dims).positions }));
    }
    return () => {
      cancelled = true;
      worker?.terminate();
    };
  }, [graph, dims, key]);
  return state?.key === key ? state.positions : null;
}

const KIND_LABEL = { company: 'Companies', contact: 'Contacts', deal: 'Deals' } as const;

export function GalaxyExplorer() {
  const graph = useGalaxy();
  const view = useViewMode();
  const motion = useMotionLevel();
  const [kinds, setKinds] = useState({ company: true, contact: true, deal: true });
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showFps, setShowFps] = useState(false);
  const positions = useLayout(graph.data, view.mode === '3d' ? 3 : 2);
  const q = query.trim().toLowerCase();
  const visible = useCallback((n: GalaxyNode) => kinds[n.kind] && (!q || n.label.toLowerCase().includes(q)), [kinds, q]);

  if (graph.isPending || !view.support.ready) return <Skeleton className="h-[32rem]" />;
  if (graph.error) return <ErrorText error={graph.error} />;
  const g = graph.data;
  const companies = g.nodes.filter((n) => n.kind === 'company');
  if (companies.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          No companies yet. The galaxy draws each company with its contacts and deals once you <Link href="/app/companies" className="text-primary underline">add companies</Link>.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewModeSwitch view={view} label="Relationship Galaxy" />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {(Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).map((k) => (
            <label key={k} className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={kinds[k]} onChange={(e) => setKinds({ ...kinds, [k]: e.target.checked })} />
              {KIND_LABEL[k]} ({g.nodes.filter((n) => n.kind === k).length})
            </label>
          ))}
          {view.mode === '3d' && (
            <label className="inline-flex items-center gap-1.5 text-muted-foreground">
              <input type="checkbox" checked={showFps} onChange={(e) => setShowFps(e.target.checked)} /> Frame rate
            </label>
          )}
        </div>
      </div>
      {g.truncated && <p className="text-xs text-muted-foreground">Showing the {companies.length} companies with the most open pipeline.</p>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="relative h-[34rem] overflow-hidden">
          {!positions ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground" role="status">Arranging {g.nodes.length} records…</div>
          ) : view.mode === '3d' ? (
            <GalaxyScene nodes={g.nodes} edges={g.edges} positions={positions} visible={visible} selectedId={selectedId} onSelect={setSelectedId} motion={motion} showFps={showFps} onContextLost={view.contextLost} onSwitch2D={() => view.setMode('2d')} />
          ) : (
            <Galaxy2D graph={g} positions={positions} visible={visible} selectedId={selectedId} onSelect={setSelectedId} />
          )}
          <Legend />
        </Card>
        <div className="space-y-4">
          <Details graph={g} id={selectedId} onSelect={setSelectedId} />
          <AccountList graph={g} query={query} setQuery={setQuery} selectedId={selectedId} onSelect={setSelectedId} />
        </div>
      </div>
    </div>
  );
}

function Legend() {
  const items: [string, string][] = [['chart-2', 'Company'], ['chart-6', 'Contact'], ['chart-1', 'Open deal'], ['chart-3', 'Won deal'], ['chart-5', 'Lost deal']];
  return (
    <ul className="absolute end-2 top-2 flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-background/80 px-2 py-1 text-[11px] text-muted-foreground" aria-label="Legend">
      {items.map(([t, l]) => (
        <li key={t} className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full" style={{ background: `hsl(var(--${t}))` }} aria-hidden />
          {l}
        </li>
      ))}
    </ul>
  );
}

/** The same layout flattened to 2D and drawn as SVG: no WebGL, no animation. */
function Galaxy2D({ graph, positions, visible, selectedId, onSelect }: { graph: GalaxyGraph; positions: Float32Array; visible: (n: GalaxyNode) => boolean; selectedId: string | null; onSelect: (id: string) => void }) {
  const index = useMemo(() => new Map(graph.nodes.map((n, i) => [n.id, i])), [graph]);
  const maxCompany = Math.max(1, ...graph.nodes.filter((n) => n.kind === 'company').map((n) => n.value ?? 0));
  const r = (n: GalaxyNode) => (n.kind === 'company' ? 0.3 + 0.45 * Math.sqrt((n.value ?? 0) / maxCompany) : n.kind === 'deal' ? 0.2 : 0.14);
  return (
    <svg viewBox="-11 -11 22 22" className="h-full w-full" role="img" aria-label="Relationship network in 2D. The list beside it holds the same records.">
      <g stroke="hsl(var(--muted-foreground))" strokeOpacity={0.25} strokeWidth={0.04}>
        {graph.edges.map((e, k) => {
          const a = index.get(e.source);
          const b = index.get(e.target);
          if (a === undefined || b === undefined || !visible(graph.nodes[a]!) || !visible(graph.nodes[b]!)) return null;
          return <line key={k} x1={positions[a * 3]} y1={positions[a * 3 + 1]} x2={positions[b * 3]} y2={positions[b * 3 + 1]} />;
        })}
      </g>
      {graph.nodes.map((n, i) =>
        visible(n) ? (
          <circle
            key={n.id}
            cx={positions[i * 3]}
            cy={positions[i * 3 + 1]}
            r={r(n) * (n.id === selectedId ? 1.6 : 1)}
            fill={`hsl(var(--${nodeColorToken(n)}))`}
            stroke={n.id === selectedId ? 'hsl(var(--foreground))' : 'none'}
            strokeWidth={0.06}
            className="cursor-pointer"
            onClick={() => onSelect(n.id)}
          >
            <title>{n.label}</title>
          </circle>
        ) : null,
      )}
    </svg>
  );
}

function Details({ graph, id, onSelect }: { graph: GalaxyGraph; id: string | null; onSelect: (id: string | null) => void }) {
  const node = id ? graph.nodes.find((n) => n.id === id) : undefined;
  if (!node) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">Select a company, person or deal in the galaxy or the list to see how it connects.</CardContent>
      </Card>
    );
  }
  const linked = graph.edges.filter((e) => e.source === node.id || e.target === node.id).map((e) => (e.source === node.id ? e.target : e.source));
  const neighbours = graph.nodes.filter((n) => linked.includes(n.id));
  return (
    <Card aria-live="polite">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{node.label}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {node.kind === 'company' ? `Company · ${formatValue(node.value ?? 0, graph.currency)} open pipeline` : node.kind === 'deal' ? `Deal · ${node.status?.toLowerCase()}${node.value != null ? ` · ${formatValue(node.value, graph.currency)}` : ''}` : 'Contact'}
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Link href={node.href} className="text-primary underline">Open record</Link>
        {neighbours.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Connected ({neighbours.length})</p>
            <ul className="max-h-40 space-y-1 overflow-auto">
              {neighbours.map((n) => (
                <li key={n.id}>
                  <button type="button" className="text-start hover:underline" onClick={() => onSelect(n.id)}>
                    {n.label} <span className="text-xs text-muted-foreground">({n.kind})</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Button variant="ghost" size="sm" onClick={() => onSelect(null)}>Clear selection</Button>
      </CardContent>
    </Card>
  );
}

/** The accessible equivalent of the galaxy: every company with its people and deals, searchable. */
function AccountList({ graph, query, setQuery, selectedId, onSelect }: { graph: GalaxyGraph; query: string; setQuery: (q: string) => void; selectedId: string | null; onSelect: (id: string) => void }) {
  const [limit, setLimit] = useState(25);
  const q = query.trim().toLowerCase();
  const byCompany = useMemo(() => {
    const m = new Map<string, GalaxyNode[]>();
    for (const n of graph.nodes) if (n.kind !== 'company' && n.companyId) m.set(n.companyId, [...(m.get(n.companyId) ?? []), n]);
    return m;
  }, [graph]);
  const rows = graph.nodes.filter((n) => n.kind === 'company' && (!q || n.label.toLowerCase().includes(q) || (byCompany.get(n.id) ?? []).some((c) => c.label.toLowerCase().includes(q))));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Accounts</CardTitle>
        <Input aria-label="Search the galaxy" placeholder="Search companies, people, deals" value={query} onChange={(e) => setQuery(e.target.value)} />
      </CardHeader>
      <CardContent>
        <ul className="max-h-80 space-y-2 overflow-auto text-sm">
          {rows.slice(0, limit).map((c) => {
            const kids = byCompany.get(c.id) ?? [];
            return (
              <li key={c.id}>
                <button type="button" onClick={() => onSelect(c.id)} aria-pressed={selectedId === c.id} className={cn('w-full rounded px-1 text-start font-medium hover:bg-muted', selectedId === c.id && 'bg-muted')}>
                  {c.label}
                </button>
                {kids.length > 0 && (
                  <ul className="ms-3 border-s border-border ps-2 text-xs text-muted-foreground">
                    {kids.map((k) => (
                      <li key={k.id}>
                        <button type="button" onClick={() => onSelect(k.id)} aria-pressed={selectedId === k.id} className={cn('w-full rounded px-1 text-start hover:bg-muted', selectedId === k.id && 'bg-muted text-foreground')}>
                          {k.label} · {k.kind === 'deal' ? `deal, ${k.status?.toLowerCase()}` : 'contact'}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        {rows.length > limit && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setLimit(limit + 25)}>
            Show more ({rows.length - limit} left)
          </Button>
        )}
        {rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing matches “{query}”.</p>}
      </CardContent>
    </Card>
  );
}

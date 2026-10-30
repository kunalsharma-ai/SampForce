import type { GalaxyEdge, GalaxyNode } from '@dealflow/types';
import { forceCenter, forceLink, forceManyBody, forceSimulation, type SimNode } from 'd3-force-3d';

export interface LayoutResult {
  /** x, y, z per node in input order (z is 0 for 2D layouts), scaled to fit a sphere of radius `radius`. */
  positions: Float32Array;
}

const LINK_DISTANCE: Record<GalaxyEdge['kind'], number> = { works_at: 10, deal_of: 12, contact_on: 14, parent: 36 };

/**
 * Force-directed layout of the relationship graph. Deterministic for the same input (d3 seeds positions on a
 * phyllotaxis spiral), so the galaxy looks the same each time it opens.
 */
export function layoutGraph(nodes: Pick<GalaxyNode, 'id' | 'kind'>[], edges: GalaxyEdge[], dims: 2 | 3, radius = 10, ticks = 220): LayoutResult {
  const sim = nodes.map((n) => ({ id: n.id, kind: n.kind })) as (SimNode & { id: string; kind: string })[];
  const ids = new Set(sim.map((n) => n.id));
  const links = edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ source: e.source, target: e.target, kind: e.kind }));
  const s = forceSimulation(sim, dims)
    .force('link', forceLink(links).id((n) => n.id as string).distance((l) => LINK_DISTANCE[l.kind as GalaxyEdge['kind']] ?? 12).strength(0.6))
    .force('charge', forceManyBody().strength((n) => (n.kind === 'company' ? -60 : -12)).theta(0.9).distanceMax(220))
    .force('center', forceCenter())
    .stop();
  s.tick(ticks);
  let max = 1;
  for (const n of sim) max = Math.max(max, Math.hypot(n.x ?? 0, n.y ?? 0, dims === 3 ? (n.z ?? 0) : 0));
  const k = radius / max;
  const positions = new Float32Array(sim.length * 3);
  sim.forEach((n, i) => {
    positions[i * 3] = (n.x ?? 0) * k;
    positions[i * 3 + 1] = (n.y ?? 0) * k;
    positions[i * 3 + 2] = dims === 3 ? (n.z ?? 0) * k : 0;
  });
  return { positions };
}

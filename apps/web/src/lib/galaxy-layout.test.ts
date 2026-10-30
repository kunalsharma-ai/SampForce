import { describe, expect, it } from 'vitest';
import { layoutGraph } from './galaxy-layout';

describe('galaxy layout', () => {
  const nodes = [
    { id: 'c1', kind: 'company' as const }, { id: 'c2', kind: 'company' as const },
    { id: 'p1', kind: 'contact' as const }, { id: 'd1', kind: 'deal' as const },
  ];
  const edges = [
    { source: 'p1', target: 'c1', kind: 'works_at' as const },
    { source: 'd1', target: 'c1', kind: 'deal_of' as const },
    { source: 'c2', target: 'missing', kind: 'parent' as const },
  ];

  it('is deterministic, fits the radius and keeps 2D flat', () => {
    const a = layoutGraph(nodes, edges, 3);
    const b = layoutGraph(nodes, edges, 3);
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    for (let i = 0; i < nodes.length; i++) expect(Math.hypot(a.positions[i * 3]!, a.positions[i * 3 + 1]!, a.positions[i * 3 + 2]!)).toBeLessThanOrEqual(10.0001);
    const flat = layoutGraph(nodes, edges, 2);
    expect([0, 1, 2, 3].map((i) => flat.positions[i * 3 + 2])).toEqual([0, 0, 0, 0]);
  });

  it('keeps linked records closer than unlinked companies', () => {
    const { positions: p } = layoutGraph(nodes, edges, 3);
    const d = (i: number, j: number) => Math.hypot(p[i * 3]! - p[j * 3]!, p[i * 3 + 1]! - p[j * 3 + 1]!, p[i * 3 + 2]! - p[j * 3 + 2]!);
    expect(d(2, 0)).toBeLessThan(d(2, 1));
  });
});

import type { PipelineReplay } from '@dealflow/types';
import { describe, expect, it } from 'vitest';
import { buildTimeline } from './replay-model';

const r: PipelineReplay = {
  pipelineId: 'p', pipelineName: 'Sales', currency: 'USD', reconstructed: false, truncated: false,
  from: '2026-01-10T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z',
  stages: [{ id: 'a', name: 'New', category: 'OPEN', position: 0 }, { id: 'w', name: 'Won', category: 'WON', position: 1 }, { id: 'l', name: 'Lost', category: 'LOST', position: 2 }],
  deals: [{ id: 'd1', name: 'One', value: 100 }, { id: 'd2', name: 'Two', value: 50 }, { id: 'd3', name: 'Old win', value: 10 }],
  events: [
    { dealId: 'd1', at: '2026-01-01T00:00:00.000Z', fromStageId: null, toStageId: 'a' },
    { dealId: 'd3', at: '2026-01-02T00:00:00.000Z', fromStageId: 'a', toStageId: 'w' },
    { dealId: 'd2', at: '2026-01-15T00:00:00.000Z', fromStageId: null, toStageId: 'a' },
    { dealId: 'd1', at: '2026-01-20T00:00:00.000Z', fromStageId: 'a', toStageId: 'w' },
  ],
};

describe('replay timeline', () => {
  const at = buildTimeline(r);
  it('places each deal in its stage at a moment', () => {
    const start = at(Date.parse('2026-01-10T00:00:00.000Z'));
    expect([...start.stageOf]).toEqual([['d1', 'a'], ['d3', 'w']]);
    expect(start.openDeals).toBe(1);
    expect(start.wonSinceStart).toBe(0);
    const mid = at(Date.parse('2026-01-16T00:00:00.000Z'));
    expect(mid.openValue).toBe(150);
    const end = at(Date.parse('2026-02-01T00:00:00.000Z'));
    expect(end.stageOf.get('d1')).toBe('w');
    expect(end.openDeals).toBe(1);
    expect(end.wonSinceStart).toBe(1);
  });
});

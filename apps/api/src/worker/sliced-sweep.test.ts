import { describe, expect, it } from 'vitest';
import { SlicedSweep } from './sliced-sweep';

const slow = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('SlicedSweep', () => {
  it('spreads a round across ticks within the time budget and resumes where it stopped', async () => {
    const sweep = new SlicedSweep(60_000, 25);
    const done: string[] = [];
    let loads = 0;
    const load = async () => { loads++; return ['a', 'b', 'c', 'd', 'e', 'f']; };
    const each = async (t: string) => { await slow(15); done.push(t); };

    const first = await sweep.run(false, load, each);
    expect(first).toBeGreaterThanOrEqual(1);
    expect(first).toBeLessThan(6);
    while (sweep.remaining > 0) await sweep.run(false, load, each);
    expect(done).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(loads).toBe(1);
    // The round is over and the interval has not passed, so nothing more runs.
    expect(await sweep.run(false, load, each)).toBe(0);
  });

  it('force runs a whole round at once, and always makes progress even when one item exceeds the budget', async () => {
    const sweep = new SlicedSweep(60_000, 1);
    const done: string[] = [];
    expect(await sweep.run(true, async () => ['x', 'y', 'x'], async (t) => { done.push(t); })).toBe(2);
    expect(done).toEqual(['x', 'y']);
    const slowSweep = new SlicedSweep(0, 1);
    expect(await slowSweep.run(false, async () => ['p', 'q'], async () => slow(10))).toBe(1);
  });
});

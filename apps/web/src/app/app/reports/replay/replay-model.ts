import type { PipelineReplay } from '@dealflow/types';

export interface ReplayFrame {
  /** Stage id per deal id at the moment (deals not yet created are absent). */
  stageOf: Map<string, string>;
  openDeals: number;
  openValue: number;
  wonSinceStart: number;
  lostSinceStart: number;
}

/** Precomputes each deal's timeline so any moment can be read in O(deals × log moves). */
export function buildTimeline(r: PipelineReplay) {
  const byDeal = new Map<string, { at: number; to: string }[]>();
  for (const e of r.events) {
    const list = byDeal.get(e.dealId) ?? [];
    list.push({ at: Date.parse(e.at), to: e.toStageId });
    byDeal.set(e.dealId, list);
  }
  for (const list of byDeal.values()) list.sort((a, b) => a.at - b.at);
  const category = new Map(r.stages.map((s) => [s.id, s.category]));
  const value = new Map(r.deals.map((d) => [d.id, d.value ?? 0]));
  const start = Date.parse(r.from);

  const stageAt = (list: { at: number; to: string }[], t: number): string | null => {
    let lo = 0;
    let hi = list.length - 1;
    let found: string | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid]!.at <= t) {
        found = list[mid]!.to;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return found;
  };

  return (t: number): ReplayFrame => {
    const stageOf = new Map<string, string>();
    let openDeals = 0;
    let openValue = 0;
    let wonSinceStart = 0;
    let lostSinceStart = 0;
    for (const [deal, list] of byDeal) {
      const s = stageAt(list, t);
      if (!s) continue;
      stageOf.set(deal, s);
      const c = category.get(s);
      if (c === 'OPEN') {
        openDeals += 1;
        openValue += value.get(deal) ?? 0;
      } else if (stageAt(list, start) !== s) {
        // Closed during the window (it was not already in this closed stage when the window began).
        if (c === 'WON') wonSinceStart += 1;
        else if (c === 'LOST') lostSinceStart += 1;
      }
    }
    return { stageOf, openDeals, openValue: Math.round(openValue * 100) / 100, wonSinceStart, lostSinceStart };
  };
}

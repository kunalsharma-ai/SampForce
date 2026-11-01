/**
 * A periodic per-workspace sweep spread across worker ticks. Each tick spends at most `budgetMs` on it and
 * resumes where the last tick stopped, so a sweep over thousands of workspaces never holds up the queues
 * that share the tick (workflow events, sends, approvals). A new round starts once the previous one has
 * finished and `everyMs` has passed since it started. `force` runs a whole round now (tests, "run now").
 */
export class SlicedSweep {
  private pending: string[] = [];
  private roundStartedAt = 0;

  constructor(
    private readonly everyMs: number,
    private readonly budgetMs = 2_000,
  ) {}

  async run(force: boolean, load: () => Promise<string[]>, each: (tenantId: string) => Promise<void>): Promise<number> {
    if (force || (this.pending.length === 0 && Date.now() - this.roundStartedAt >= this.everyMs)) {
      this.roundStartedAt = Date.now();
      this.pending = [...new Set(await load())];
    }
    const started = Date.now();
    let n = 0;
    while (this.pending.length > 0 && (force || n === 0 || Date.now() - started < this.budgetMs)) {
      await each(this.pending.shift()!);
      n++;
    }
    return n;
  }

  /** Workspaces still waiting in the current round. */
  get remaining(): number {
    return this.pending.length;
  }
}

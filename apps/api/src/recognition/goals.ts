import type { TenantTx } from '@dealflow/database';
import {
  GOAL_MEASURE_LABEL,
  GOAL_RULE,
  type GoalEvaluation,
  type GoalInput,
  type GoalMeasure,
  type GoalPer,
  type GoalProgress,
  goalUnit,
  type TargetMetric,
  TARGET_METRICS,
} from '@dealflow/types';
import { randomUUID } from 'node:crypto';
import { addDays, weekday } from '../task-plans/calendar';
import { Measures } from '../workspace-work/measures';

/*
 * Counting goals for Employee of the Month and improvement plans (ADR 0102). Counts and money go through Measures, the
 * engine targets, recurring tasks and rankings use (ADR 0096), so a goal never disagrees with a target for the same
 * work. Task completion, target achievement and training are worked out here from the same records. Nothing is
 * estimated: a measure that cannot be counted says so instead of showing zero as if it were a result.
 */

export interface StoredGoal {
  id: string;
  measure: GoalMeasure;
  amount: number;
  per: GoalPer;
  label?: string | null;
}

export interface StoredEvaluation {
  id: string;
  goalId: string;
  score: number;
  comments: string;
  evaluatorId: string;
  at: string;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Goals as typed, with ids kept for goals that already had one (so their evaluations stay with them). */
export function storeGoals(input: GoalInput[], previous: StoredGoal[] = []): StoredGoal[] {
  const known = new Set(previous.map((g) => g.id));
  return input.map((g) => ({
    id: g.id && known.has(g.id) ? g.id : randomUUID().slice(0, 12),
    measure: g.measure,
    amount: g.amount,
    per: goalUnit(g.measure) === 'percent' ? 'PERIOD' : (g.per ?? 'PERIOD'),
    ...(g.label ? { label: g.label } : {}),
  }));
}

export function goalsOf(json: unknown): StoredGoal[] {
  return Array.isArray(json) ? (json as StoredGoal[]).filter((g) => g && typeof g.id === 'string' && typeof g.amount === 'number') : [];
}

export function evaluationsOf(json: unknown): StoredEvaluation[] {
  return Array.isArray(json) ? (json as StoredEvaluation[]).filter((e) => e && typeof e.goalId === 'string') : [];
}

/** Working days (Monday to Friday) from `first` to `last`, both included. */
export function workingDays(first: string, last: string): number {
  let n = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) if (weekday(d) <= 5) n++;
  return n;
}

/** One goal in plain words: "20 Qualified companies created per working day". */
export function describeGoal(g: StoredGoal): string {
  const what = g.label || GOAL_MEASURE_LABEL[g.measure];
  if (goalUnit(g.measure) === 'percent') return `${what}: ${g.amount}%`;
  return `${what}: ${g.amount}${g.per === 'DAY' ? ' per working day' : ''}`;
}

export interface Window {
  start: Date;
  /** Exclusive. */
  end: Date;
  first: string;
  last: string;
}

/** Counts goals for one person. One instance per request: Measures caches the currency and exchange rates. */
export class GoalCounter {
  readonly measures: Measures;
  private learning: { findMany: (args: unknown) => Promise<LearningRow[]> } | null | undefined;

  constructor(
    private readonly tx: TenantTx,
    private readonly tenantId: string,
  ) {
    this.measures = new Measures(tx, tenantId);
  }

  async progress(goals: StoredGoal[], userId: string, w: Window, opts: { evaluations?: StoredEvaluation[]; names?: Map<string, string>; now?: Date } = {}): Promise<GoalProgress[]> {
    const out: GoalProgress[] = [];
    for (const g of goals) out.push(await this.one(g, userId, w, opts));
    return out;
  }

  private async one(g: StoredGoal, userId: string, w: Window, opts: { evaluations?: StoredEvaluation[]; names?: Map<string, string>; now?: Date }): Promise<GoalProgress> {
    const unit = goalUnit(g.measure);
    const required = g.per === 'DAY' && unit !== 'percent' ? g.amount * Math.max(1, workingDays(w.first, w.last)) : g.amount;
    const evaluations: GoalEvaluation[] = (g.measure === 'MANUAL' ? (opts.evaluations ?? []).filter((e) => e.goalId === g.id) : [])
      .map((e) => ({ id: e.id, score: e.score, comments: e.comments, evaluator: { id: e.evaluatorId, name: opts.names?.get(e.evaluatorId) ?? '' }, at: e.at }))
      .reverse();
    const done = await this.count(g.measure, userId, w, evaluations, opts.now ?? new Date());
    const measurable = done !== null;
    const value = done ?? 0;
    const percent = required > 0 ? r1((value / required) * 100) : 0;
    return {
      id: g.id,
      measure: g.measure,
      label: g.label || GOAL_MEASURE_LABEL[g.measure],
      rule: GOAL_RULE[g.measure],
      unit,
      per: g.per,
      amount: g.amount,
      required: r2(required),
      done: done === null ? null : r2(value),
      remaining: r2(Math.max(0, required - value)),
      percent,
      met: measurable && value >= required - 1e-9,
      measurable,
      evaluations,
    };
  }

  /** What the person reached for one measure in the window; null when it cannot be measured (yet). */
  async count(m: GoalMeasure, userId: string, w: Window, evaluations: GoalEvaluation[] = [], now = new Date()): Promise<number | null> {
    if ((TARGET_METRICS as readonly string[]).includes(m)) return this.measures.count(m as TargetMetric, [userId], w.start, w.end);
    switch (m) {
      case 'TASK_COMPLETION':
        return this.taskCompletion(userId, w, now);
      case 'TARGET_ACHIEVEMENT':
        return this.targetAchievement(userId, w);
      case 'LEARNING_MODULES':
      case 'LEARNING_SCORE':
        return this.learningFigure(m, userId, w);
      case 'MANUAL':
        return evaluations[0]?.score ?? null;
      default:
        return null;
    }
  }

  /**
   * Tasks assigned to the person that fell due in the window (up to now) and recurring task days that ended in it:
   * the share completed. Null when nothing fell due, so an empty month is not a 0% month.
   */
  async taskCompletion(userId: string, w: Window, now = new Date()): Promise<number | null> {
    const until = now < w.end ? now : w.end;
    let total = 0;
    let done = 0;
    if (until > w.start) {
      const tasks = await this.tx.task.groupBy({
        by: ['status'],
        where: { tenantId: this.tenantId, deletedAt: null, assigneeId: userId, dueAt: { gte: w.start, lt: until }, status: { in: ['OPEN', 'DONE'] } },
        _count: { _all: true },
      });
      total += tasks.reduce((a, t) => a + t._count._all, 0);
      done += tasks.find((t) => t.status === 'DONE')?._count._all ?? 0;
    }
    const days = await this.tx.taskPlanInstance.groupBy({
      by: ['status'],
      where: { tenantId: this.tenantId, userId, endsAt: { gt: w.start, lte: w.end }, status: { in: ['COMPLETED', 'PARTIALLY_COMPLETED', 'NOT_COMPLETED'] } },
      _count: { _all: true },
    });
    total += days.reduce((a, t) => a + t._count._all, 0);
    done += days.find((t) => t.status === 'COMPLETED')?._count._all ?? 0;
    return total ? r1((done / total) * 100) : null;
  }

  /** The targets of the person's workspace that overlap the window, each counted over its own period up to 100%. */
  async targetAchievement(userId: string, w: Window): Promise<number | null> {
    const member = await this.tx.membership.findFirst({ where: { tenantId: this.tenantId, userId, status: 'ACTIVE' }, select: { workspaceNodeId: true } });
    if (!member?.workspaceNodeId) return null;
    const people = (await this.tx.membership.findMany({ where: { tenantId: this.tenantId, status: 'ACTIVE', workspaceNodeId: member.workspaceNodeId }, select: { userId: true }, take: 200 })).map((p) => p.userId);
    const targets = await this.tx.workspaceTarget.findMany({ where: { tenantId: this.tenantId, workspaceNodeId: member.workspaceNodeId, archivedAt: null, startsAt: { lt: w.end }, endsAt: { gt: w.start } }, take: 50 });
    if (!targets.length) return null;
    let sum = 0;
    for (const t of targets) sum += Math.min(100, t.amount > 0 ? ((await this.measures.count(t.metric as TargetMetric, people, t.startsAt, t.endsAt)) / t.amount) * 100 : 0);
    return r1(sum / targets.length);
  }

  /**
   * Training from the Learning section (its learning_assignments collection): modules completed (and passed) as a
   * share of those assigned for the window, or the average best score of the completed ones. Null when the
   * organisation has no Learning section yet or nothing was assigned, so a plan never shows a made-up figure.
   */
  async learningFigure(m: 'LEARNING_MODULES' | 'LEARNING_SCORE', userId: string, w: Window): Promise<number | null> {
    if (this.learning === undefined) {
      const delegate = (this.tx as unknown as Record<string, unknown>).learningAssignment as { findMany?: unknown } | undefined;
      this.learning = delegate && typeof delegate.findMany === 'function' ? (delegate as { findMany: (args: unknown) => Promise<LearningRow[]> }) : null;
    }
    if (!this.learning) return null;
    const rows = await this.learning.findMany({
      where: { tenantId: this.tenantId, userId, removedAt: null, assignedAt: { lte: w.end }, OR: [{ dueAt: null }, { dueAt: { gte: w.start } }] },
      select: { status: true, passed: true, completedAt: true, bestScore: true },
      take: 500,
    });
    if (!rows.length) return null;
    const completed = rows.filter((r) => r.status === 'COMPLETED' && r.passed && r.completedAt && r.completedAt >= w.start && r.completedAt < w.end);
    if (m === 'LEARNING_MODULES') return r1((completed.length / rows.length) * 100);
    const scores = completed.map((r) => r.bestScore).filter((s): s is number => typeof s === 'number');
    return scores.length ? r1(scores.reduce((a, s) => a + s, 0) / scores.length) : null;
  }
}

interface LearningRow {
  status: string;
  passed: boolean | null;
  completedAt: Date | null;
  bestScore: number | null;
}

/** The average of the goals' percentages: uncapped for ranking, each capped at 100 for a plan's completion. */
export function averagePercent(goals: GoalProgress[], cap: boolean): number {
  if (!goals.length) return 0;
  return r1(goals.reduce((a, g) => a + (cap ? Math.min(100, g.percent) : g.percent), 0) / goals.length);
}

import type { Prisma, PrismaClient } from '@dealflow/database';

type Db = Prisma.TransactionClient | PrismaClient;

export interface LearningProgressSummary {
  /** Modules assigned to the person that were live in the range: assigned on or before `to`, not removed, not due before `from`. */
  assigned: number;
  /** Of those, the ones the person completed (passed) with completedAt inside the range. */
  completed: number;
  /** Passed assessments with completedAt in the range (same as completed: a module completes when its assessment passes). */
  passed: number;
  /** Average best score (percent) of the completed ones, null when none. */
  averageScore: number | null;
}

/**
 * Learning progress of one person over a date range, for other sections (Performance Improvement Plans, reports).
 * An assignment counts as assigned when it was not removed, was assigned on or before `to`, and has no due date or is
 * due on or after `from`. It counts as completed when it passed with completedAt inside the range.
 */
export async function learningProgressFor(db: Db, tenantId: string, userId: string, from: Date, to: Date): Promise<LearningProgressSummary> {
  const rows = await db.learningAssignment.findMany({
    where: { tenantId, userId, removedAt: null, assignedAt: { lte: to } },
    select: { assignedAt: true, dueAt: true, status: true, completedAt: true, passed: true, bestScore: true },
  });
  const inRange = (d: Date | null) => !!d && d >= from && d <= to;
  const assigned = rows.filter((r) => !r.dueAt || r.dueAt >= from);
  const done = assigned.filter((r) => r.status === 'COMPLETED' && r.passed === true && inRange(r.completedAt));
  const scores = done.map((r) => r.bestScore).filter((s): s is number => typeof s === 'number');
  return {
    assigned: assigned.length,
    completed: done.length,
    passed: done.length,
    averageScore: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null,
  };
}

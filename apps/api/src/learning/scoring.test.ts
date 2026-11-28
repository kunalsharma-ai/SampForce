import { describe, expect, it } from 'vitest';
import { learnerQuestion, markAnswer, snapshot, totals, type QuestionSource } from './scoring';
import { reminderFor } from './reminders.service';

const q = (over: Partial<QuestionSource>): QuestionSource => ({
  id: 'q', type: 'MCQ', text: 'Q', instructions: null, options: [], correctOptionIds: [], correctBoolean: null, blanks: [], pairs: [], acceptedAnswers: [], rubric: null, marks: 2, difficulty: 'MEDIUM', explanation: null, required: true, lessonId: null, ...over,
});

describe('marking (ADR 0097)', () => {
  it('marks each objective type against the key, with partial credit where it applies', () => {
    const [mcq, multi, tf, fill, match, short, long] = snapshot([
      q({ id: 'mcq', type: 'MCQ', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correctOptionIds: ['b'] }),
      q({ id: 'multi', type: 'MULTI', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }, { id: 'd', text: 'D' }], correctOptionIds: ['a', 'b'], marks: 4 }),
      q({ id: 'tf', type: 'TRUE_FALSE', correctBoolean: false }),
      q({ id: 'fill', type: 'FILL_BLANK', text: '_____ and _____', blanks: [['Budget'], ['Authority', 'decision power']] }),
      q({ id: 'match', type: 'MATCHING', pairs: [{ id: 'p1', left: 'L1', right: 'R1' }, { id: 'p2', left: 'L2', right: 'R2' }, { id: 'p3', left: 'L3', right: 'R3' }], marks: 3 }),
      q({ id: 'short', type: 'SHORT', acceptedAnswers: ['Need-payoff'] }),
      q({ id: 'long', type: 'LONG', rubric: 'r' }),
    ], false);
    expect(markAnswer(mcq!, { optionIds: ['b'] })).toMatchObject({ marks: 2, correct: true });
    expect(markAnswer(mcq!, { optionIds: ['a', 'b'] })).toMatchObject({ marks: 0, correct: false });
    expect(markAnswer(multi!, { optionIds: ['a', 'b'] })).toMatchObject({ marks: 4, correct: true });
    expect(markAnswer(multi!, { optionIds: ['a'] })).toMatchObject({ marks: 2, correct: false });
    expect(markAnswer(multi!, { optionIds: ['a', 'c'] })).toMatchObject({ marks: 0 });
    expect(markAnswer(multi!, { optionIds: ['a', 'b', 'c', 'd'] })).toMatchObject({ marks: 0 });
    expect(markAnswer(tf!, { value: false })).toMatchObject({ marks: 2, correct: true });
    expect(markAnswer(tf!, {})).toMatchObject({ marks: 0 });
    expect(markAnswer(fill!, { blanks: ['  budget ', 'Decision Power.'] })).toMatchObject({ marks: 2, correct: true });
    expect(markAnswer(fill!, { blanks: ['budget', 'nope'] })).toMatchObject({ marks: 1, correct: false });
    const lq = learnerQuestion(match!);
    // The right-hand items have their own ids, so the answer key cannot be read from them.
    expect(lq.right.map((r) => r.id).some((id) => id.startsWith('p'))).toBe(false);
    const pick = (text: string) => lq.right.find((r) => r.text === text)!.id;
    expect(markAnswer(match!, { pairs: { p1: pick('R1'), p2: pick('R2'), p3: pick('R3') } })).toMatchObject({ marks: 3, correct: true });
    expect(markAnswer(match!, { pairs: { p1: pick('R1'), p2: pick('R3'), p3: pick('R2') } })).toMatchObject({ marks: 1 });
    expect(markAnswer(short!, { text: 'need-payoff' })).toMatchObject({ marks: 2, correct: true });
    expect(markAnswer(long!, { text: 'essay' })).toMatchObject({ marks: null, correct: null });
    expect(JSON.stringify(learnerQuestion(fill!))).not.toContain('Budget');
  });

  it('gives a score only once every question has its marks', () => {
    const snap = snapshot([q({ id: 'a', type: 'TRUE_FALSE', correctBoolean: true }), q({ id: 'b', type: 'LONG' })], false);
    const waiting = totals(snap, { a: { marks: 2, correct: true, feedback: null }, b: { marks: null, correct: null, feedback: null } });
    expect(waiting).toMatchObject({ autoScore: 2, score: null, percent: null, waiting: 1, maxScore: 4 });
    expect(totals(snap, { a: { marks: 2, correct: true, feedback: null }, b: { marks: 1, correct: false, feedback: null } })).toMatchObject({ score: 3, percent: 75, waiting: 0 });
  });
});

describe('deadline reminders (ADR 0097)', () => {
  const m = { reminderDaysBefore: [3, 1], remindOnDueDay: true, overdueEveryDays: 2 };
  const due = new Date('2026-12-10T17:00:00Z');
  const at = (iso: string, sent: string[] = []) => reminderFor(m, { dueAt: due, remindersSent: sent }, new Date(iso), 'UTC');

  it('sends the nearest reached reminder once, then the day itself, then overdue every few days', () => {
    expect(at('2026-12-05T09:00:00Z')).toBeNull();
    expect(at('2026-12-08T09:00:00Z')).toEqual({ key: 'before:3:2026-12-10', kind: 'before', days: 3 });
    expect(at('2026-12-08T09:00:00Z', ['before:3:2026-12-10'])).toBeNull();
    expect(at('2026-12-09T18:00:00Z', ['before:3:2026-12-10'])).toEqual({ key: 'before:1:2026-12-10', kind: 'before', days: 1 });
    expect(at('2026-12-10T08:00:00Z')).toEqual({ key: 'due:2026-12-10', kind: 'due' });
    expect(at('2026-12-10T18:00:00Z')).toEqual({ key: 'overdue:2026-12-10:0', kind: 'overdue' });
    expect(at('2026-12-11T18:00:00Z', ['overdue:2026-12-10:0'])).toBeNull();
    expect(at('2026-12-12T18:00:00Z', ['overdue:2026-12-10:0'])).toEqual({ key: 'overdue:2026-12-10:1', kind: 'overdue' });
    expect(at('2027-03-01T18:00:00Z')).toBeNull();
  });
});

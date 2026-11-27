import { randomBytes, randomInt } from 'node:crypto';
import {
  type AnswerInput,
  isManualQuestion,
  type LearnerQuestion,
  normaliseAnswer,
  type QuestionDifficulty,
  type QuestionResult,
  type QuestionType,
} from '@dealflow/types';

/*
 * Marking (ADR 0097). An attempt keeps a copy of its questions, answer key included, taken when it started: changing
 * the module later never changes how an attempt already taken is marked. Objective answers are marked here, on the
 * server, the moment they are submitted; written answers wait for a person. Nothing the learner sends can set a score.
 */

export interface SnapQuestion {
  id: string;
  position: number;
  type: QuestionType;
  text: string;
  instructions: string | null;
  options: { id: string; text: string }[];
  correctOptionIds: string[];
  correctBoolean: boolean | null;
  blanks: string[][];
  pairs: { id: string; left: string; right: string }[];
  /** MATCHING: the right-hand items as the learner sees them (own ids, shuffled), each pointing at its pair. */
  right: { id: string; pairId: string }[];
  acceptedAnswers: string[];
  rubric: string | null;
  marks: number;
  difficulty: QuestionDifficulty;
  explanation: string | null;
  required: boolean;
  lessonId: string | null;
  manual: boolean;
}

export interface StoredResult {
  marks: number | null;
  correct: boolean | null;
  feedback: string | null;
}

export interface QuestionSource {
  id: string;
  type: string;
  text: string;
  instructions: string | null;
  options: unknown;
  correctOptionIds: string[];
  correctBoolean: boolean | null;
  blanks: unknown;
  pairs: unknown;
  acceptedAnswers: string[];
  rubric: string | null;
  marks: number;
  difficulty: string;
  explanation: string | null;
  required: boolean;
  lessonId: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function shuffled<T>(list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** The copy of the module's approved questions an attempt is marked against. */
export function snapshot(questions: QuestionSource[], shuffle: boolean): SnapQuestion[] {
  const list = shuffle ? shuffled(questions) : questions;
  return list.map((q, i) => {
    const type = q.type as QuestionType;
    const options = (Array.isArray(q.options) ? q.options : []) as { id: string; text: string }[];
    const pairs = (Array.isArray(q.pairs) ? q.pairs : []) as { id: string; left: string; right: string }[];
    let right = type === 'MATCHING' ? shuffled(pairs).map((p) => ({ id: `r${randomBytes(4).toString('hex')}`, pairId: p.id })) : [];
    // A shuffle that left every item in place would give the answers away.
    if (right.length > 1 && right.every((r, k) => r.pairId === pairs[k]!.id)) right = [...right.slice(1), right[0]!];
    return {
      id: q.id,
      position: i + 1,
      type,
      text: q.text,
      instructions: q.instructions,
      options,
      correctOptionIds: q.correctOptionIds,
      correctBoolean: q.correctBoolean,
      blanks: (Array.isArray(q.blanks) ? q.blanks : []) as string[][],
      pairs,
      right,
      acceptedAnswers: q.acceptedAnswers,
      rubric: q.rubric,
      marks: q.marks,
      difficulty: q.difficulty as QuestionDifficulty,
      explanation: q.explanation,
      required: q.required,
      lessonId: q.lessonId,
      manual: isManualQuestion({ type, acceptedAnswers: q.acceptedAnswers, options }),
    };
  });
}

/** A question as the learner sees it: no answer key. */
export function learnerQuestion(q: SnapQuestion): LearnerQuestion {
  const byPair = new Map(q.pairs.map((p) => [p.id, p]));
  return {
    id: q.id,
    position: q.position,
    type: q.type,
    text: q.text,
    instructions: q.instructions,
    options: q.options.map((o) => ({ id: o.id, text: o.text })),
    left: q.type === 'MATCHING' ? q.pairs.map((p) => ({ id: p.id, text: p.left })) : [],
    right: q.type === 'MATCHING' ? q.right.map((r) => ({ id: r.id, text: byPair.get(r.pairId)?.right ?? '' })) : [],
    blanks: q.type === 'FILL_BLANK' ? q.blanks.length : 0,
    marks: q.marks,
    required: q.required,
    manual: q.manual,
  };
}

/** Whether an answer says anything (for required questions and "answered" counts). */
export function answered(q: SnapQuestion, a: AnswerInput | undefined): boolean {
  if (!a) return false;
  switch (q.type) {
    case 'MCQ':
    case 'MULTI':
      return (a.optionIds?.length ?? 0) > 0;
    case 'TRUE_FALSE':
      return typeof a.value === 'boolean';
    case 'FILL_BLANK':
      return (a.blanks ?? []).some((b) => b.trim());
    case 'MATCHING':
      return Object.keys(a.pairs ?? {}).length > 0;
    case 'FILE_UPLOAD':
      return !!a.fileId;
    case 'SCENARIO':
      return q.options.length ? (a.optionIds?.length ?? 0) > 0 : !!a.text?.trim();
    default:
      return !!a.text?.trim() || !!a.fileId;
  }
}

/** Marks one answer against the key. Null marks for a question a person marks. */
export function markAnswer(q: SnapQuestion, a: AnswerInput | undefined): StoredResult {
  if (q.manual) return { marks: null, correct: null, feedback: null };
  const full = (ok: boolean): StoredResult => ({ marks: ok ? q.marks : 0, correct: ok, feedback: null });
  const part = (fraction: number): StoredResult => {
    const f = Math.max(0, Math.min(1, fraction));
    return { marks: r2(q.marks * f), correct: f >= 1, feedback: null };
  };
  if (!a) return full(false);
  switch (q.type) {
    case 'MCQ':
    case 'SCENARIO': {
      const chosen = new Set(a.optionIds ?? []);
      return full(chosen.size === 1 && q.correctOptionIds.includes([...chosen][0]!));
    }
    case 'MULTI': {
      const right = new Set(q.correctOptionIds);
      const chosen = new Set((a.optionIds ?? []).filter((id) => q.options.some((o) => o.id === id)));
      if (!right.size) return full(false);
      let hits = 0;
      let wrong = 0;
      for (const id of chosen) (right.has(id) ? hits++ : wrong++);
      // Each right option chosen earns its share; each wrong one takes a share away.
      return part((hits - wrong) / right.size);
    }
    case 'TRUE_FALSE':
      return full(typeof a.value === 'boolean' && a.value === q.correctBoolean);
    case 'FILL_BLANK': {
      if (!q.blanks.length) return full(false);
      const given = a.blanks ?? [];
      const ok = q.blanks.filter((accepted, i) => {
        const g = normaliseAnswer(given[i] ?? '');
        return !!g && accepted.some((x) => normaliseAnswer(x) === g);
      }).length;
      return part(ok / q.blanks.length);
    }
    case 'MATCHING': {
      if (!q.pairs.length) return full(false);
      const rightOf = new Map(q.right.map((r) => [r.id, r.pairId]));
      const given = a.pairs ?? {};
      const ok = q.pairs.filter((p) => rightOf.get(given[p.id] ?? '') === p.id).length;
      return part(ok / q.pairs.length);
    }
    case 'SHORT': {
      const g = normaliseAnswer(a.text ?? '');
      return full(!!g && q.acceptedAnswers.some((x) => normaliseAnswer(x) === g));
    }
    default:
      return { marks: null, correct: null, feedback: null };
  }
}

/** The right answer in words, for the result page. */
export function correctAnswerText(q: SnapQuestion): string | null {
  const optionText = (ids: string[]) => q.options.filter((o) => ids.includes(o.id)).map((o) => o.text).join('; ');
  switch (q.type) {
    case 'MCQ':
    case 'MULTI':
      return optionText(q.correctOptionIds) || null;
    case 'SCENARIO':
      return q.options.length ? optionText(q.correctOptionIds) || null : q.rubric;
    case 'TRUE_FALSE':
      return q.correctBoolean === null ? null : q.correctBoolean ? 'True' : 'False';
    case 'FILL_BLANK':
      return q.blanks.map((b) => b[0] ?? '').join(' / ') || null;
    case 'MATCHING':
      return q.pairs.map((p) => `${p.left} → ${p.right}`).join('; ') || null;
    case 'SHORT':
      return q.acceptedAnswers[0] ?? q.rubric;
    default:
      return q.rubric;
  }
}

export interface Totals {
  autoScore: number;
  score: number | null;
  maxScore: number;
  percent: number | null;
  waiting: number;
}

/** Adds up the marks. The score is final only once every question has its marks. */
export function totals(questions: SnapQuestion[], results: Record<string, StoredResult>): Totals {
  let auto = 0;
  let max = 0;
  let waiting = 0;
  for (const q of questions) {
    max += q.marks;
    const r = results[q.id];
    if (r?.marks === null || r?.marks === undefined) waiting++;
    else auto += r.marks;
  }
  const done = waiting === 0;
  return { autoScore: r2(auto), score: done ? r2(auto) : null, maxScore: r2(max), percent: done ? (max > 0 ? r2((auto / max) * 100) : 0) : null, waiting };
}

export function questionResults(questions: SnapQuestion[], results: Record<string, StoredResult>, showAnswers: boolean): QuestionResult[] {
  return questions.map((q) => {
    const r = results[q.id];
    return {
      questionId: q.id,
      marks: r?.marks ?? null,
      maxMarks: q.marks,
      correct: r?.correct ?? null,
      feedback: r?.feedback ?? null,
      correctAnswer: showAnswers ? correctAnswerText(q) : null,
      explanation: showAnswers ? q.explanation : null,
    };
  });
}

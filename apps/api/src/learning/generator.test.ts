import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BLANK, normaliseAnswer } from '@dealflow/types';
import { analyse, generateQuestions, summarise } from './generator';

const text = readFileSync(join(__dirname, 'fixtures/sales-communication.txt'), 'utf8');
const src = [{ lessonId: 'l1', title: 'Sales communication', text }];
const flat = normaliseAnswer(text.replace(/\s+/g, ' '));

describe('rule-based question drafting (ADR 0097)', () => {
  it('drafts every asked type from the material, each tied to a sentence it was made from', () => {
    const r = generateQuestions(src, { types: ['MCQ', 'TRUE_FALSE', 'FILL_BLANK', 'MATCHING', 'MULTI'], count: 12, variant: 0 });
    expect(r.questions.length).toBe(12);
    expect(new Set(r.questions.map((q) => q.type))).toEqual(new Set(['MCQ', 'TRUE_FALSE', 'FILL_BLANK', 'MATCHING', 'MULTI']));
    for (const q of r.questions) {
      expect(q.lessonId).toBe('l1');
      expect(q.sourceExcerpt.length).toBeGreaterThan(10);
      // Every excerpt is the material's own words.
      for (const piece of q.sourceExcerpt.split(/\s*[\n:;]\s*/).filter((p) => p.length > 3)) expect(flat).toContain(normaliseAnswer(piece).slice(0, 40));
      if (q.type === 'MCQ') {
        expect(q.options.length).toBeGreaterThanOrEqual(3);
        expect(q.correctOptionIds).toHaveLength(1);
        expect(new Set(q.options.map((o) => normaliseAnswer(o.text))).size).toBe(q.options.length);
      }
      if (q.type === 'MULTI') expect(q.correctOptionIds.length).toBeGreaterThanOrEqual(1);
      if (q.type === 'TRUE_FALSE') expect(typeof q.correctBoolean).toBe('boolean');
      if (q.type === 'FILL_BLANK') {
        expect(q.text.split(BLANK).length - 1).toBe(q.blanks.length);
        for (const answers of q.blanks) expect(flat).toContain(normaliseAnswer(answers[0]!));
      }
      if (q.type === 'MATCHING') expect(q.pairs.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('is repeatable, and another variant picks other sentences', () => {
    const opts = { types: ['FILL_BLANK', 'MCQ'] as const, count: 6, variant: 0 };
    const a = generateQuestions(src, opts).questions.map((q) => q.text);
    expect(generateQuestions(src, opts).questions.map((q) => q.text)).toEqual(a);
    const b = generateQuestions(src, { ...opts, variant: 1 }).questions.map((q) => q.text);
    expect(b).not.toEqual(a);
  });

  it('does not repeat sentences already used by existing questions', () => {
    const first = generateQuestions(src, { types: ['FILL_BLANK'], count: 4, variant: 0 }).questions;
    const again = generateQuestions(src, { types: ['FILL_BLANK'], count: 4, variant: 0, existing: first.map((q) => q.sourceExcerpt) }).questions;
    const used = new Set(first.map((q) => q.sourceExcerpt));
    for (const q of again) expect(used.has(q.sourceExcerpt)).toBe(false);
  });

  it('says how many it could not make instead of inventing questions from too little text', () => {
    const r = generateQuestions([{ lessonId: 'x', title: 'Tiny', text: 'Call the client.' }], { types: ['MCQ', 'MATCHING'], count: 5, variant: 0 });
    expect(r.questions.length).toBeLessThan(5);
    expect(r.shortBy).toBe(5 - r.questions.length);
  });

  it('finds definitions and summarises key points and objectives from the text', () => {
    const a = analyse(src);
    expect(a.definitions.length).toBeGreaterThan(2);
    const s = summarise(src);
    expect(s.keyPoints.length).toBeGreaterThan(2);
    expect(s.objectives.length).toBeGreaterThan(0);
    expect(s.words).toBeGreaterThan(200);
  });
});

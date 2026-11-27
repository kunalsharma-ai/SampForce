import { readFileSync } from 'node:fs';
import { it } from 'vitest';
import { generateQuestions, summarise } from './generator';
it('shows', () => {
  const text = readFileSync('/home/user/sampledge_dealflow/apps/api/src/learning/fixtures/sales-communication.txt', 'utf8');
  const src = [{ lessonId: 'l1', title: 'Sales', text }];
  const r = generateQuestions(src, { types: ['MCQ', 'TRUE_FALSE', 'FILL_BLANK', 'MATCHING', 'MULTI'], count: 12, variant: 0 });
  for (const q of r.questions) console.log(JSON.stringify({ t: q.type, q: q.text, o: q.options.map((o) => o.text), c: q.correctOptionIds, b: q.correctBoolean, bl: q.blanks, p: q.pairs }));
  console.log('short', r.shortBy);
  console.log(JSON.stringify(summarise(src), null, 1));
});

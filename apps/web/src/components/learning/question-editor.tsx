'use client';

import { BLANK, QUESTION_DIFFICULTIES, QUESTION_DIFFICULTY_LABEL, QUESTION_TYPE_LABEL, QUESTION_TYPES, type LessonView, type QuestionDifficulty, type QuestionType, type QuestionView } from '@dealflow/types';
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Label } from '@dealflow/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { ErrorLine } from './bits';

interface Draft {
  type: QuestionType;
  text: string;
  instructions: string;
  options: { id: string; text: string }[];
  correct: string[];
  correctBoolean: boolean | null;
  blanks: string[];
  pairs: { id: string; left: string; right: string }[];
  accepted: string;
  rubric: string;
  marks: number;
  difficulty: QuestionDifficulty;
  explanation: string;
  required: boolean;
  lessonId: string;
  withOptions: boolean;
}

const rid = () => Math.random().toString(36).slice(2, 10);

function draftOf(q: QuestionView | null): Draft {
  if (!q)
    return {
      type: 'MCQ',
      text: '',
      instructions: '',
      options: [{ id: rid(), text: '' }, { id: rid(), text: '' }, { id: rid(), text: '' }, { id: rid(), text: '' }],
      correct: [],
      correctBoolean: null,
      blanks: [],
      pairs: [{ id: rid(), left: '', right: '' }, { id: rid(), left: '', right: '' }],
      accepted: '',
      rubric: '',
      marks: 1,
      difficulty: 'MEDIUM',
      explanation: '',
      required: true,
      lessonId: '',
      withOptions: false,
    };
  return {
    type: q.type,
    text: q.text,
    instructions: q.instructions ?? '',
    options: q.options.length ? q.options : [{ id: rid(), text: '' }, { id: rid(), text: '' }],
    correct: q.correctOptionIds,
    correctBoolean: q.correctBoolean,
    blanks: q.blanks.map((b) => b.join(' | ')),
    pairs: q.pairs.length ? q.pairs : [{ id: rid(), left: '', right: '' }, { id: rid(), left: '', right: '' }],
    accepted: q.acceptedAnswers.join('\n'),
    rubric: q.rubric ?? '',
    marks: q.marks,
    difficulty: q.difficulty,
    explanation: q.explanation ?? '',
    required: q.required,
    lessonId: q.lessonId ?? '',
    withOptions: q.type === 'SCENARIO' && q.options.length > 0,
  };
}

/** The input the API expects for the draft. */
function inputOf(d: Draft): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: d.type,
    text: d.text.trim(),
    ...(d.instructions.trim() ? { instructions: d.instructions.trim() } : {}),
    marks: d.marks,
    difficulty: d.difficulty,
    ...(d.explanation.trim() ? { explanation: d.explanation.trim() } : {}),
    required: d.required,
    lessonId: d.lessonId || null,
  };
  const options = d.options.filter((o) => o.text.trim()).map((o) => ({ id: o.id, text: o.text.trim() }));
  if (d.type === 'MCQ' || d.type === 'MULTI' || (d.type === 'SCENARIO' && d.withOptions)) {
    base.options = options;
    base.correctOptionIds = d.correct.filter((id) => options.some((o) => o.id === id));
  }
  if (d.type === 'TRUE_FALSE' && d.correctBoolean !== null) base.correctBoolean = d.correctBoolean;
  if (d.type === 'FILL_BLANK') base.blanks = d.blanks.map((b) => b.split('|').map((x) => x.trim()).filter(Boolean));
  if (d.type === 'MATCHING') base.pairs = d.pairs.filter((p) => p.left.trim() && p.right.trim()).map((p) => ({ id: p.id, left: p.left.trim(), right: p.right.trim() }));
  if (d.type === 'SHORT') base.acceptedAnswers = d.accepted.split('\n').map((x) => x.trim()).filter(Boolean);
  if (d.type === 'LONG' || d.type === 'PRACTICAL' || d.type === 'FILE_UPLOAD' || (d.type === 'SCENARIO' && !d.withOptions)) base.rubric = d.rubric.trim();
  return base;
}

/** Writes or changes one question of any type. */
export function QuestionEditor({ open, onOpenChange, question, lessons, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; question: QuestionView | null; lessons: LessonView[]; onSave: (input: Record<string, unknown>) => Promise<unknown> }) {
  const t = useT();
  const [d, setD] = useState<Draft>(() => draftOf(question));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const key = `${open}-${question?.id ?? 'new'}`;
  if (key !== lastKey) {
    setLastKey(key);
    setD(draftOf(question));
    setError(null);
  }
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((s) => ({ ...s, [k]: v }));
  const blankCount = d.text.split(BLANK).length - 1;
  const blanks = Array.from({ length: blankCount }, (_, i) => d.blanks[i] ?? '');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave(inputOf({ ...d, blanks }));
      onOpenChange(false);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const choice = d.type === 'MCQ' || d.type === 'MULTI' || (d.type === 'SCENARIO' && d.withOptions);
  const area = 'w-full rounded-md border bg-surface p-2 text-sm';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <form onSubmit={save} className="space-y-4" data-question-editor>
          <DialogTitle className="text-lg font-semibold">{question ? t('Edit question') : t('New question')}</DialogTitle>
          <DialogDescription className="sr-only">{t('Write the question and its answer key.')}</DialogDescription>
          <div className="space-y-1.5">
            <Label htmlFor="lrn-q-type">{t('Question type')}</Label>
            <select id="lrn-q-type" value={d.type} onChange={(e) => set('type', e.target.value as QuestionType)} className="h-10 w-full rounded-md border bg-surface px-2 text-sm">
              {QUESTION_TYPES.map((q) => <option key={q} value={q}>{t.maybe(QUESTION_TYPE_LABEL[q])}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lrn-q-text">{t('Question')}</Label>
            <textarea id="lrn-q-text" value={d.text} onChange={(e) => set('text', e.target.value)} rows={3} className={area} required minLength={3} />
            {d.type === 'FILL_BLANK' && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{t('Put {blank} where each blank goes.', { blank: BLANK })}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => set('text', `${d.text}${d.text.endsWith(' ') || !d.text ? '' : ' '}${BLANK}`)}>{t('Add a blank')}</Button>
              </div>
            )}
          </div>

          {choice && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{d.type === 'MULTI' ? t('Options (tick every right one)') : t('Options (tick the right one)')}</legend>
              {d.options.map((o, i) => (
                <div key={o.id} className="flex items-center gap-2">
                  <input
                    type={d.type === 'MULTI' ? 'checkbox' : 'radio'}
                    name="lrn-correct"
                    aria-label={t('Option {n} is right', { n: i + 1 })}
                    checked={d.correct.includes(o.id)}
                    onChange={(e) => set('correct', d.type === 'MULTI' ? (e.target.checked ? [...d.correct, o.id] : d.correct.filter((x) => x !== o.id)) : [o.id])}
                    className="size-4 accent-violet-600"
                  />
                  <Input value={o.text} onChange={(e) => set('options', d.options.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)))} placeholder={t('Option {n}', { n: i + 1 })} aria-label={t('Option {n}', { n: i + 1 })} />
                  <Button type="button" size="icon" variant="ghost" disabled={d.options.length <= 2} onClick={() => set('options', d.options.filter((x) => x.id !== o.id))} aria-label={t('Remove option')}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              ))}
              {d.options.length < 10 && <Button type="button" size="sm" variant="outline" onClick={() => set('options', [...d.options, { id: rid(), text: '' }])}><Plus className="size-4" aria-hidden />{t('Add option')}</Button>}
            </fieldset>
          )}
          {d.type === 'SCENARIO' && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={d.withOptions} onChange={(e) => set('withOptions', e.target.checked)} className="size-4" />
              {t('Answer by choosing an option (marked automatically)')}
            </label>
          )}
          {d.type === 'TRUE_FALSE' && (
            <fieldset className="flex gap-3">
              <legend className="mb-1 text-sm font-medium">{t('The statement is')}</legend>
              {([true, false] as const).map((b) => (
                <label key={String(b)} className={cn('lrn-option flex cursor-pointer items-center gap-2 px-4 py-2 text-sm')}>
                  <input type="radio" name="lrn-tf" checked={d.correctBoolean === b} onChange={() => set('correctBoolean', b)} className="accent-violet-600" />
                  {b ? t('True') : t('False')}
                </label>
              ))}
            </fieldset>
          )}
          {d.type === 'FILL_BLANK' && blankCount > 0 && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('Accepted answers for each blank (separate alternatives with |)')}</legend>
              {blanks.map((b, i) => (
                <Input key={i} value={b} onChange={(e) => { const next = [...blanks]; next[i] = e.target.value; set('blanks', next); }} placeholder={t('Blank {n}', { n: i + 1 })} aria-label={t('Blank {n}', { n: i + 1 })} />
              ))}
            </fieldset>
          )}
          {d.type === 'MATCHING' && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('Pairs to match')}</legend>
              {d.pairs.map((p, i) => (
                <div key={p.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <Input value={p.left} onChange={(e) => set('pairs', d.pairs.map((x) => (x.id === p.id ? { ...x, left: e.target.value } : x)))} placeholder={t('Item {n}', { n: i + 1 })} aria-label={t('Item {n}', { n: i + 1 })} />
                  <Input value={p.right} onChange={(e) => set('pairs', d.pairs.map((x) => (x.id === p.id ? { ...x, right: e.target.value } : x)))} placeholder={t('Its match')} aria-label={t('Match for item {n}', { n: i + 1 })} />
                  <Button type="button" size="icon" variant="ghost" disabled={d.pairs.length <= 2} onClick={() => set('pairs', d.pairs.filter((x) => x.id !== p.id))} aria-label={t('Remove pair')}><Trash2 className="size-4" aria-hidden /></Button>
                </div>
              ))}
              {d.pairs.length < 10 && <Button type="button" size="sm" variant="outline" onClick={() => set('pairs', [...d.pairs, { id: rid(), left: '', right: '' }])}><Plus className="size-4" aria-hidden />{t('Add pair')}</Button>}
            </fieldset>
          )}
          {d.type === 'SHORT' && (
            <div className="space-y-1.5">
              <Label htmlFor="lrn-q-acc">{t('Accepted answers, one per line')}</Label>
              <textarea id="lrn-q-acc" value={d.accepted} onChange={(e) => set('accepted', e.target.value)} rows={3} className={area} />
              <p className="text-xs text-muted-foreground">{t('Leave empty to have a manager mark it. Case and extra spaces do not matter.')}</p>
            </div>
          )}
          {(d.type === 'LONG' || d.type === 'PRACTICAL' || d.type === 'FILE_UPLOAD' || (d.type === 'SCENARIO' && !d.withOptions)) && (
            <div className="space-y-1.5">
              <Label htmlFor="lrn-q-rubric">{t('What the marker looks for')}</Label>
              <textarea id="lrn-q-rubric" value={d.rubric} onChange={(e) => set('rubric', e.target.value)} rows={3} className={area} />
              <p className="text-xs text-muted-foreground">{t('A manager marks this answer by hand.')}</p>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="lrn-q-marks">{t('Marks')}</Label>
              <Input id="lrn-q-marks" type="number" min={0.5} max={100} step={0.5} value={d.marks} onChange={(e) => set('marks', Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lrn-q-diff">{t('Difficulty')}</Label>
              <select id="lrn-q-diff" value={d.difficulty} onChange={(e) => set('difficulty', e.target.value as QuestionDifficulty)} className="h-10 w-full rounded-md border bg-surface px-2 text-sm">
                {QUESTION_DIFFICULTIES.map((x) => <option key={x} value={x}>{t.maybe(QUESTION_DIFFICULTY_LABEL[x])}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lrn-q-lesson">{t('Lesson')}</Label>
              <select id="lrn-q-lesson" value={d.lessonId} onChange={(e) => set('lessonId', e.target.value)} className="h-10 w-full rounded-md border bg-surface px-2 text-sm">
                <option value="">{t('Whole module')}</option>
                {lessons.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lrn-q-expl">{t('Explanation shown with the result (optional)')}</Label>
            <textarea id="lrn-q-expl" value={d.explanation} onChange={(e) => set('explanation', e.target.value)} rows={2} className={area} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lrn-q-instr">{t('Instructions (optional)')}</Label>
            <Input id="lrn-q-instr" value={d.instructions} onChange={(e) => set('instructions', e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.required} onChange={(e) => set('required', e.target.checked)} className="size-4" />
            {t('Required')}
          </label>
          <ErrorLine error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
            <Button type="submit" disabled={busy}>{busy ? t('Saving…') : t('Save question')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

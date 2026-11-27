'use client';

import { type AnswerInput, type AttemptView, BLANK, type LearnerQuestion, QUESTION_TYPE_LABEL } from '@dealflow/types';
import { Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Skeleton } from '@dealflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Award, BookOpen, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, Download, Hourglass, Paperclip, RotateCcw, Send, Sparkles, Trophy, X, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Confetti } from '@/components/achievements/confetti';
import { PageHelp } from '@/components/page-help';
import { useT } from '@/lib/i18n';
import { certificatePdfUrl, LEARNING_KEY, learningApi, uploadLearningFile, useAttempt, usePlayer } from '@/lib/learning';
import { dateText, ErrorLine, pct, Ring } from './bits';

/** The assessment: answers are saved as they are given; the score and the pass come from the API. */
export function Assessment({ moduleId, attemptId }: { moduleId: string; attemptId: string }) {
  const q = useAttempt(attemptId);
  const player = usePlayer(moduleId);
  if (q.isLoading || player.isLoading) return <Skeleton className="h-[30rem] rounded-3xl" />;
  if (q.error || !q.data) return <ErrorLine error={q.error ?? new Error()} />;
  return q.data.status === 'IN_PROGRESS' ? <Taker moduleId={moduleId} a={q.data} title={player.data?.module.title ?? ''} /> : <Result moduleId={moduleId} a={q.data} />;
}

function isAnswered(q: LearnerQuestion, a: AnswerInput | undefined): boolean {
  if (!a) return false;
  switch (q.type) {
    case 'MCQ':
    case 'MULTI':
      return !!a.optionIds?.length;
    case 'TRUE_FALSE':
      return a.value !== undefined;
    case 'FILL_BLANK':
      return !!a.blanks?.some((b) => b.trim());
    case 'MATCHING':
      return Object.keys(a.pairs ?? {}).length > 0;
    case 'FILE_UPLOAD':
      return !!a.fileId;
    case 'SCENARIO':
      return q.options.length ? !!a.optionIds?.length : !!a.text?.trim();
    default:
      return !!a.text?.trim();
  }
}

function useCountdown(expiresAt: string | null): number | null {
  const [left, setLeft] = useState<number | null>(expiresAt ? Math.max(0, new Date(expiresAt).getTime() - Date.now()) : null);
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setLeft(Math.max(0, new Date(expiresAt).getTime() - Date.now())), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return left;
}

function Taker({ moduleId, a, title }: { moduleId: string; a: AttemptView; title: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, AnswerInput>>(a.answers ?? {});
  const [index, setIndex] = useState(0);
  const [saved, setSaved] = useState<'saved' | 'saving' | 'error' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const dirty = useRef(false);
  const latest = useRef(answers);
  latest.current = answers;
  const left = useCountdown(a.expiresAt);
  const question = a.questions[index]!;
  const answered = a.questions.filter((x) => isAnswered(x, answers[x.id])).length;
  const missingRequired = a.questions.filter((x) => x.required && !isAnswered(x, answers[x.id]));

  const save = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    setSaved('saving');
    try {
      await learningApi.saveAnswers(a.id, latest.current);
      setSaved('saved');
    } catch {
      dirty.current = true;
      setSaved('error');
    }
  }, [a.id]);

  useEffect(() => {
    const id = setInterval(() => void save(), 4000);
    return () => {
      clearInterval(id);
      void save();
    };
  }, [save]);

  const setAnswer = (qid: string, v: AnswerInput) => {
    dirty.current = true;
    setSaved(null);
    setAnswers((s) => ({ ...s, [qid]: v }));
  };

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await learningApi.submit(a.id, latest.current);
      dirty.current = false;
      qc.setQueryData([...LEARNING_KEY, 'attempt', a.id], out);
      void qc.invalidateQueries({ queryKey: [...LEARNING_KEY, 'player', moduleId] });
      void qc.invalidateQueries({ queryKey: [...LEARNING_KEY, 'me'] });
      window.scrollTo({ top: 0 });
    } catch (e) {
      setError(e);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }, [a.id, qc, moduleId]);

  // When the time runs out the answers given so far are handed in.
  const handedIn = useRef(false);
  useEffect(() => {
    if (left === 0 && !handedIn.current) {
      handedIn.current = true;
      void submit();
    }
  }, [left, submit]);

  const mins = left === null ? null : Math.floor(left / 60000);
  const secs = left === null ? null : Math.floor((left % 60000) / 1000);

  return (
    <div className="space-y-5" data-assessment>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/app/learning/${moduleId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> {t('Back to the module')}
        </Link>
        <PageHelp />
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {saved === 'saving' ? t('Saving…') : saved === 'saved' ? t('All answers saved') : saved === 'error' ? t('Not saved yet. Trying again…') : ''}
        </p>
      </div>
      <section className="lrn-hero p-5">
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-white/75">{t('Assessment · attempt {n}', { n: a.number })}</p>
            <h2 className="text-xl font-extrabold">{title}</h2>
            <p className="text-sm text-white/85">{t('{done} of {all} answered', { done: answered, all: a.questions.length })}</p>
          </div>
          {left !== null && (
            <div className={cn('lrn-glass flex items-center gap-2 rounded-2xl px-4 py-2 text-lg font-bold tabular-nums', left < 60_000 && 'animate-pulse bg-rose-500/40')} role="timer" aria-label={t('Time left')}>
              <Clock className="size-5" aria-hidden /> {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
            </div>
          )}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[1fr_15rem]">
        <section className="rounded-2xl border bg-surface p-5 sm:p-7" data-question={question.position} data-question-type={question.type}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="font-semibold uppercase tracking-wide">{t('Question {n} of {all}', { n: index + 1, all: a.questions.length })} · {t.maybe(QUESTION_TYPE_LABEL[question.type])}</span>
            <span>{t.plural('learning.marks', question.marks)}{question.required ? '' : ` · ${t('Optional')}`}</span>
          </div>
          {question.type !== 'FILL_BLANK' && <h3 className="whitespace-pre-wrap text-lg font-semibold leading-snug">{question.text}</h3>}
          {question.instructions && <p className="mt-1 text-sm text-muted-foreground">{question.instructions}</p>}
          <div className="mt-5">
            <AnswerField key={question.id} q={question} value={answers[question.id]} onChange={(v) => setAnswer(question.id, v)} attemptId={a.id} />
          </div>
          <div className="mt-6 flex justify-between gap-2">
            <Button variant="outline" disabled={index === 0} onClick={() => setIndex(index - 1)}>
              <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden /> {t('Previous')}
            </Button>
            {index < a.questions.length - 1 ? (
              <Button onClick={() => { void save(); setIndex(index + 1); }}>
                {t('Next')} <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
              </Button>
            ) : (
              <Button onClick={() => setConfirm(true)} data-review-submit>
                <Send className="size-4" aria-hidden /> {t('Review and submit')}
              </Button>
            )}
          </div>
        </section>
        <aside className="space-y-3">
          <div className="lrn-tile">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Questions')}</p>
            <div className="grid grid-cols-5 gap-1.5">
              {a.questions.map((x, i) => {
                const done = isAnswered(x, answers[x.id]);
                return (
                  <button
                    key={x.id}
                    onClick={() => setIndex(i)}
                    aria-label={t('Question {n}', { n: i + 1 })}
                    aria-current={i === index}
                    className={cn('grid aspect-square place-items-center rounded-lg border text-xs font-semibold', i === index && 'ring-2 ring-violet-500', done ? 'border-transparent bg-violet-600 text-white' : 'hover:bg-muted')}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          </div>
          <Button className="w-full" variant="accent" onClick={() => setConfirm(true)} data-submit-answers>
            <Send className="size-4" aria-hidden /> {t('Submit answers')}
          </Button>
          <ErrorLine error={error} />
        </aside>
      </div>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="max-w-md space-y-4">
          <DialogTitle className="text-lg font-semibold">{t('Submit your answers?')}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {answered < a.questions.length ? t('You have answered {done} of {all} questions. Unanswered questions get no marks.', { done: answered, all: a.questions.length }) : t('You have answered every question.')}{' '}
            {t('You cannot change your answers after submitting.')}
          </DialogDescription>
          {missingRequired.length > 0 && (
            <p className="rounded-lg bg-amber-100 p-2 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
              {t('Answer the required questions first: {list}.', { list: missingRequired.map((x) => a.questions.indexOf(x) + 1).join(', ') })}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(false)}>{t('Keep answering')}</Button>
            <Button onClick={submit} disabled={busy || missingRequired.length > 0} data-confirm-submit>{busy ? t('Submitting…') : t('Submit')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AnswerField({ q, value, onChange, attemptId }: { q: LearnerQuestion; value: AnswerInput | undefined; onChange: (v: AnswerInput) => void; attemptId: string }) {
  const t = useT();
  const name = `q-${q.id}`;
  if (q.type === 'MCQ' || (q.type === 'SCENARIO' && q.options.length)) {
    return (
      <div className="space-y-2" role="radiogroup">
        {q.options.map((o, i) => (
          <label key={o.id} className="lrn-option flex cursor-pointer items-center gap-3 p-3">
            <input type="radio" name={name} className="size-4 accent-violet-600" checked={value?.optionIds?.[0] === o.id} onChange={() => onChange({ optionIds: [o.id] })} />
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-bold">{String.fromCharCode(65 + i)}</span>
            <span className="text-sm">{o.text}</span>
          </label>
        ))}
      </div>
    );
  }
  if (q.type === 'MULTI') {
    const chosen = new Set(value?.optionIds ?? []);
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{t('Choose every answer that is right.')}</p>
        {q.options.map((o) => (
          <label key={o.id} className="lrn-option flex cursor-pointer items-center gap-3 p-3">
            <input
              type="checkbox"
              className="size-4 accent-violet-600"
              checked={chosen.has(o.id)}
              onChange={(e) => {
                const next = new Set(chosen);
                if (e.target.checked) next.add(o.id);
                else next.delete(o.id);
                onChange({ optionIds: q.options.map((x) => x.id).filter((id) => next.has(id)) });
              }}
            />
            <span className="text-sm">{o.text}</span>
          </label>
        ))}
      </div>
    );
  }
  if (q.type === 'TRUE_FALSE') {
    return (
      <div className="grid grid-cols-2 gap-3" role="radiogroup">
        {([true, false] as const).map((b) => (
          <label key={String(b)} className="lrn-option flex cursor-pointer items-center justify-center gap-2 p-5 text-base font-semibold">
            <input type="radio" name={name} className="sr-only" checked={value?.value === b} onChange={() => onChange({ value: b })} />
            {b ? <Check className="size-5 text-emerald-500" aria-hidden /> : <X className="size-5 text-rose-500" aria-hidden />}
            {b ? t('True') : t('False')}
          </label>
        ))}
      </div>
    );
  }
  if (q.type === 'FILL_BLANK') {
    const parts = q.text.split(BLANK);
    const blanks = value?.blanks ?? Array.from({ length: q.blanks }, () => '');
    return (
      <p className="text-lg leading-[2.6rem]">
        {parts.map((p, i) => (
          <span key={i}>
            <span className="whitespace-pre-wrap">{p}</span>
            {i < parts.length - 1 && (
              <input
                aria-label={t('Blank {n}', { n: i + 1 })}
                value={blanks[i] ?? ''}
                onChange={(e) => {
                  const next = [...blanks];
                  next[i] = e.target.value;
                  onChange({ blanks: next });
                }}
                className="mx-1 inline-block w-40 rounded-md border-b-2 border-violet-500 bg-violet-50 px-2 py-0.5 text-base dark:bg-violet-950/40"
              />
            )}
          </span>
        ))}
      </p>
    );
  }
  if (q.type === 'MATCHING') {
    const pairs = value?.pairs ?? {};
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">{t('Match each item on the left with one on the right.')}</p>
        {q.left.map((l) => (
          <div key={l.id} className="grid items-center gap-2 rounded-xl border p-3 sm:grid-cols-2">
            <span className="text-sm font-medium">{l.text}</span>
            <select
              aria-label={t('Match for {item}', { item: l.text })}
              value={pairs[l.id] ?? ''}
              onChange={(e) => {
                const next = { ...pairs };
                if (e.target.value) next[l.id] = e.target.value;
                else delete next[l.id];
                onChange({ pairs: next });
              }}
              className="h-10 rounded-md border bg-surface px-2 text-sm"
            >
              <option value="">{t('Choose a match')}</option>
              {q.right.map((r) => <option key={r.id} value={r.id}>{r.text}</option>)}
            </select>
          </div>
        ))}
      </div>
    );
  }
  if (q.type === 'SHORT') {
    return <input value={value?.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} maxLength={300} aria-label={t('Your answer')} placeholder={t('Your answer')} className="h-11 w-full rounded-lg border bg-surface px-3 text-base" />;
  }
  if (q.type === 'FILE_UPLOAD') return <FileAnswer value={value} onChange={onChange} attemptId={attemptId} />;
  return (
    <div className="space-y-1">
      <textarea value={value?.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} rows={q.type === 'LONG' || q.type === 'PRACTICAL' ? 10 : 6} maxLength={20_000} aria-label={t('Your answer')} placeholder={t('Write your answer…')} className="w-full rounded-lg border bg-surface p-3 text-sm leading-6" />
      <p className="text-end text-xs text-muted-foreground">{t('{n} words', { n: (value?.text ?? '').trim().split(/\s+/).filter(Boolean).length })}</p>
    </div>
  );
}

function FileAnswer({ value, onChange, attemptId }: { value: AnswerInput | undefined; onChange: (v: AnswerInput) => void; attemptId: string }) {
  const t = useT();
  const [progress, setProgress] = useState<number | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="space-y-2 rounded-xl border border-dashed p-5 text-center">
      <Paperclip className="mx-auto size-7 text-violet-500" aria-hidden />
      {value?.fileId ? <p className="text-sm font-medium">{name ? t('Uploaded: {name}', { name }) : t('A file is attached.')}</p> : <p className="text-sm text-muted-foreground">{t('Attach your work (up to 50 MB).')}</p>}
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted">
        {value?.fileId ? t('Replace file') : t('Choose a file')}
        <input
          type="file"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setError(null);
            setProgress(0);
            try {
              const ref = await uploadLearningFile(f, setProgress, attemptId);
              setName(ref.name);
              onChange({ fileId: ref.id });
            } catch (err) {
              setError(err);
            } finally {
              setProgress(null);
            }
          }}
        />
      </label>
      {progress !== null && <p className="text-xs text-muted-foreground">{t('Uploading… {n}%', { n: Math.round(progress * 100) })}</p>}
      <ErrorLine error={error} />
    </div>
  );
}

const CELEBRATED = 'sampforce.learning.celebrated';
function alreadyCelebrated(id: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(CELEBRATED) ?? '[]') as string[]).includes(id);
  } catch {
    return false;
  }
}
function rememberCelebrated(id: string) {
  try {
    const list = (JSON.parse(localStorage.getItem(CELEBRATED) ?? '[]') as string[]).slice(-50);
    localStorage.setItem(CELEBRATED, JSON.stringify([...list, id]));
  } catch {
    /* the celebration may show again; nothing else depends on it */
  }
}

function Result({ moduleId, a }: { moduleId: string; a: AttemptView }) {
  const t = useT();
  const router = useRouter();
  const player = usePlayer(moduleId);
  const [celebrate, setCelebrate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const p = player.data;
  const waiting = a.status === 'AWAITING_MARKING';
  const passed = a.passed === true;

  useEffect(() => {
    if (passed && !alreadyCelebrated(a.id)) {
      setCelebrate(true);
      rememberCelebrated(a.id);
    }
  }, [passed, a.id]);

  const retry = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await learningApi.startAttempt(moduleId);
      router.push(`/app/learning/${moduleId}/attempts/${next.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const byId = useMemo(() => new Map((a.results ?? []).map((r) => [r.questionId, r])), [a.results]);
  const right = (a.results ?? []).filter((r) => r.correct === true).length;
  const left = p?.assignment ? Math.max(0, p.assignment.attemptsAllowed - p.assignment.attemptsUsed) : 0;
  const certificate = p?.certificate ?? null;

  return (
    <div className="space-y-5" data-result={waiting ? 'waiting' : passed ? 'passed' : 'failed'}>
      <Link href={`/app/learning/${moduleId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {t('Back to the module')}
      </Link>
      <section className="lrn-hero p-6 sm:p-8" data-tone={waiting ? undefined : passed ? 'pass' : 'fail'}>
        <div className="relative z-10 flex flex-wrap items-center gap-6">
          <Ring percent={waiting ? null : a.percent} size={130} caption={t('Score')} light />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-xs uppercase tracking-wider text-white/75">{t('Attempt {n}', { n: a.number })} · {dateText(a.submittedAt)}</p>
            <h2 className="text-2xl font-extrabold sm:text-3xl">
              {waiting ? t('Submitted for marking') : passed ? t('You passed!') : t('Not passed this time')}
            </h2>
            <p className="max-w-xl text-sm text-white/90">
              {waiting
                ? t('Your written answers are with your manager for marking. You will get a notification with your result. Marks so far: {score} of {max}.', { score: a.autoScore, max: a.maxScore })
                : passed
                  ? t('You scored {score} of {max} marks. Great work!', { score: a.score ?? 0, max: a.maxScore })
                  : t('You scored {score} of {max} marks. Look at the lessons below again, then try again.', { score: a.score ?? 0, max: a.maxScore })}
            </p>
            {!waiting && a.results && <p className="text-sm text-white/85">{t('{right} of {all} questions right', { right, all: a.results.length })}</p>}
          </div>
          <div className="flex flex-col gap-2">
            {passed && certificate && (
              <Button onClick={() => setCelebrate(true)} className="bg-white text-violet-700 hover:bg-white/90"><Award className="size-4" aria-hidden />{t('View certificate')}</Button>
            )}
            {!waiting && !passed && left > 0 && (
              <Button onClick={retry} disabled={busy} className="bg-white text-orange-700 hover:bg-white/90" data-retry>
                <RotateCcw className="size-4" aria-hidden /> {t('Try again')} ({t.plural('learning.attemptsLeft', left)})
              </Button>
            )}
          </div>
        </div>
      </section>
      <ErrorLine error={error} />
      {!waiting && !passed && left === 0 && p?.assignment && (
        <p className="rounded-xl bg-muted p-3 text-sm">{t('You have used all your attempts. Your manager can give you more.')}</p>
      )}

      {a.feedback && (
        <section className="lrn-tile space-y-1">
          <h3 className="text-sm font-semibold">{t('Feedback from {name}', { name: a.markedBy?.name ?? t('your manager') })}</h3>
          <p className="whitespace-pre-wrap text-sm">{a.feedback}</p>
        </section>
      )}

      {a.improve.length > 0 && !passed && (
        <section className="lrn-tile space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><BookOpen className="size-4 text-orange-500" aria-hidden />{t('Worth another look')}</h3>
          <ul className="flex flex-wrap gap-2">{a.improve.map((x) => <li key={x} className="rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-900 dark:bg-orange-950/40 dark:text-orange-100">{x}</li>)}</ul>
        </section>
      )}

      <section className="space-y-3">
        <h3 className="font-semibold">{t('Your answers')}</h3>
        {a.questions.map((q, i) => {
          const r = byId.get(q.id);
          const state = r ? (r.correct === null ? 'waiting' : r.correct ? 'right' : (r.marks ?? 0) > 0 ? 'part' : 'wrong') : 'waiting';
          return (
            <article key={q.id} className="rounded-2xl border bg-surface p-4" data-answer-state={state}>
              <div className="flex items-start gap-3">
                {state === 'right' ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-500" aria-label={t('Right')} /> : state === 'wrong' ? <XCircle className="mt-0.5 size-5 shrink-0 text-rose-500" aria-label={t('Wrong')} /> : state === 'part' ? <Sparkles className="mt-0.5 size-5 shrink-0 text-amber-500" aria-label={t('Partly right')} /> : <Hourglass className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-label={t('Being marked')} />}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm font-medium">{i + 1}. {q.text}</p>
                    <span className="shrink-0 text-xs font-semibold tabular-nums">{r?.marks === null || !r ? '—' : r.marks} / {q.marks}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{t('Your answer: {answer}', { answer: answerText(q, a.answers[q.id], t) })}</p>
                  {r?.correctAnswer && state !== 'right' && <p className="text-xs"><span className="font-semibold text-emerald-600">{t('Right answer:')}</span> {r.correctAnswer}</p>}
                  {r?.explanation && <p className="rounded-lg bg-muted p-2 text-xs">{r.explanation}</p>}
                  {r?.feedback && <p className="rounded-lg bg-violet-50 p-2 text-xs dark:bg-violet-950/40">{r.feedback}</p>}
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {celebrate && <Celebration onClose={() => setCelebrate(false)} title={p?.module.title ?? ''} percent={a.percent ?? 0} certificate={certificate} />}
    </div>
  );
}

function answerText(q: LearnerQuestion, a: AnswerInput | undefined, t: ReturnType<typeof useT>): string {
  if (!a || !isAnswered(q, a)) return t('No answer');
  if (q.type === 'TRUE_FALSE') return a.value ? t('True') : t('False');
  if (a.optionIds?.length) return a.optionIds.map((id) => q.options.find((o) => o.id === id)?.text ?? '').join(', ');
  if (q.type === 'FILL_BLANK') return (a.blanks ?? []).join(' / ');
  if (q.type === 'MATCHING') return q.left.map((l) => `${l.text} → ${q.right.find((r) => r.id === a.pairs?.[l.id])?.text ?? '—'}`).join('; ');
  if (q.type === 'FILE_UPLOAD') return t('A file is attached.');
  const text = a.text ?? '';
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

/** The completion celebration, only after the API says the module was passed. */
function Celebration({ onClose, title, percent, certificate }: { onClose: () => void; title: string; percent: number; certificate: { id: string; number: string } | null }) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="lrn-celebrate" role="dialog" aria-modal="true" aria-labelledby="lrn-celebrate-title" data-celebration>
      <Confetti style="gold" colors={['#fde68a', '#f59e0b', '#a855f7', '#ec4899', '#ffffff']} origin={{ x: 0.5, y: 0.6 }} />
      <div className="lrn-celebrate-card p-7 text-center sm:p-9">
        <button ref={closeRef} onClick={onClose} className="absolute end-3 top-3 rounded-full p-2 text-white/80 hover:bg-white/15" aria-label={t('Close')}>
          <X className="size-5" aria-hidden />
        </button>
        <div className="lrn-badge"><Trophy className="size-12 text-amber-950" aria-hidden /></div>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.25em] text-amber-200">{t('Module complete')}</p>
        <h2 id="lrn-celebrate-title" className="mt-2 text-3xl font-extrabold">{t('Congratulations!')}</h2>
        <p className="mt-2 text-sm text-white/90">{t('You passed “{title}” with {score}.', { title, score: pct(percent) })}</p>
        {certificate ? (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-white/85">{t('Your certificate {number} is ready.', { number: certificate.number })}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild className="bg-white text-violet-700 hover:bg-white/90">
                <a href={certificatePdfUrl(certificate.id)} target="_blank" rel="noreferrer"><Award className="size-4" aria-hidden />{t('Open certificate')}</a>
              </Button>
              <Button asChild variant="outline" className="border-white/50 bg-transparent text-white hover:bg-white/15">
                <a href={certificatePdfUrl(certificate.id, true)}><Download className="size-4" aria-hidden />{t('Download PDF')}</a>
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-6">
            <Button onClick={onClose} className="bg-white text-violet-700 hover:bg-white/90">{t('Continue')}</Button>
          </div>
        )}
      </div>
    </div>
  );
}

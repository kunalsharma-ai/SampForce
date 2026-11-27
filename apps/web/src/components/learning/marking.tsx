'use client';

import { QUESTION_TYPE_LABEL } from '@dealflow/types';
import { Button, Input, Label, Skeleton } from '@dealflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, ClipboardCheck, Download, PenLine, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageHelp } from '@/components/page-help';
import { useT } from '@/lib/i18n';
import { fileUrl, LEARNING_KEY, learningApi, useMarking, useMarkingDetail } from '@/lib/learning';
import { dateText, EmptyState, ErrorLine } from './bits';

/** Written answers waiting for a manager to mark them. */
export function MarkingQueue() {
  const t = useT();
  const q = useMarking();
  if (q.isLoading) return <Skeleton className="h-60 rounded-2xl" />;
  if (q.error) return <ErrorLine error={q.error} />;
  const rows = q.data ?? [];
  return (
    <div className="space-y-4" data-marking-queue>
      <Link href="/app/learning/manage" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> {t('Learning management')}</Link>
      {rows.length ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <li key={r.attemptId}>
              <Link href={`/app/learning/marking/${r.attemptId}`} className="lrn-card flex-row items-center gap-4 p-4" data-marking-row={r.user.name}>
                <span className="lrn-tile-icon shrink-0" style={{ ['--lrn-from' as string]: '#f59e0b', ['--lrn-to' as string]: '#f97316' }}><PenLine className="size-5" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{r.user.name}</p>
                  <p className="truncate text-sm">{r.moduleTitle}</p>
                  <p className="text-xs text-muted-foreground">{t('Attempt {n}', { n: r.number })} · {dateText(r.submittedAt)} · {t.plural('learning.questionsToMark', r.questions)}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{t('Marks so far: {score} of {max}', { score: r.autoScore, max: r.maxScore })}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={ClipboardCheck} title={t('Nothing to mark')} body={t('Written answers, practical work and uploads appear here when someone submits them.')} />
      )}
    </div>
  );
}

export function MarkingSheet({ attemptId }: { attemptId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const router = useRouter();
  const q = useMarkingDetail(attemptId);
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (q.isLoading) return <Skeleton className="h-[30rem] rounded-2xl" />;
  if (q.error || !q.data) return <ErrorLine error={q.error ?? new Error()} />;
  const d = q.data;
  const a = d.attempt;
  const results = new Map((a.results ?? []).map((r) => [r.questionId, r]));
  const manual = d.questions.filter((x) => x.manual);
  const waiting = a.status === 'AWAITING_MARKING';
  const given = manual.reduce((s, x) => s + (Number(marks[x.id]) || 0), 0);
  const total = a.autoScore + given;
  const percent = a.maxScore ? Math.round((total / a.maxScore) * 1000) / 10 : 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await learningApi.mark(attemptId, { marks: manual.map((x) => ({ questionId: x.id, marks: Number(marks[x.id] ?? 0), ...(notes[x.id]?.trim() ? { feedback: notes[x.id]!.trim() } : {}) })), ...(feedback.trim() ? { feedback: feedback.trim() } : {}) });
      void qc.invalidateQueries({ queryKey: [...LEARNING_KEY, 'marking'] });
      void qc.invalidateQueries({ queryKey: [...LEARNING_KEY, 'manage'] });
      router.push('/app/learning/marking');
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5" data-marking-sheet>
      <Link href="/app/learning/marking" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> {t('Marking')}</Link>
      <PageHelp />
      <section className="lrn-hero p-6" data-tone="manage">
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-white/75">{t('Attempt {n}', { n: a.number })} · {dateText(a.submittedAt)}</p>
            <h2 className="text-2xl font-extrabold">{d.user.name}</h2>
            <p className="text-sm text-white/85">{d.module.title} · {t('Pass mark {score}', { score: `${d.module.passingScore}%` })}</p>
          </div>
          <div className="lrn-glass rounded-2xl px-5 py-3 text-center">
            <p className="text-3xl font-extrabold tabular-nums">{waiting ? `${percent}%` : `${a.percent ?? 0}%`}</p>
            <p className="text-xs text-white/80">{waiting ? t('{score} of {max} with your marks', { score: total, max: a.maxScore }) : a.passed ? t('Passed') : t('Not passed')}</p>
          </div>
        </div>
      </section>

      {d.questions.map((x, i) => {
        const r = results.get(x.id);
        const ans = a.answers[x.id];
        const file = ans?.fileId ? d.files[ans.fileId] : null;
        return (
          <article key={x.id} className="rounded-2xl border bg-surface p-4" data-mark-question={x.type}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="text-sm font-medium">{i + 1}. {x.text}</p>
              <span className="text-xs text-muted-foreground">{t.maybe(QUESTION_TYPE_LABEL[x.type])} · {t('{n} marks', { n: x.marks })}</span>
            </div>
            <div className="mt-2 rounded-lg bg-muted/60 p-3 text-sm">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('Answer')}</p>
              {file ? (
                <a href={fileUrl(file.id, true)} className="inline-flex items-center gap-1 text-primary hover:underline"><Download className="size-4" aria-hidden />{file.name}</a>
              ) : ans?.text ? (
                <p className="whitespace-pre-wrap">{ans.text}</p>
              ) : ans?.optionIds?.length ? (
                <p>{ans.optionIds.map((id) => x.options.find((o) => o.id === id)?.text).join(', ')}</p>
              ) : ans?.value !== undefined ? (
                <p>{ans.value ? t('True') : t('False')}</p>
              ) : ans?.blanks ? (
                <p>{ans.blanks.join(' / ')}</p>
              ) : ans?.pairs ? (
                <p>{t('{n} pairs matched', { n: Object.keys(ans.pairs).length })}</p>
              ) : (
                <p className="text-muted-foreground">{t('No answer')}</p>
              )}
            </div>
            {x.manual ? (
              <div className="mt-3 space-y-2">
                {x.rubric && <p className="text-xs text-muted-foreground">{t('Marker looks for: {rubric}', { rubric: x.rubric })}</p>}
                {waiting ? (
                  <div className="grid gap-2 sm:grid-cols-[8rem_1fr]">
                    <div className="space-y-1"><Label htmlFor={`m-${x.id}`}>{t('Marks (out of {n})', { n: x.marks })}</Label><Input id={`m-${x.id}`} type="number" min={0} max={x.marks} step={0.5} value={marks[x.id] ?? ''} onChange={(e) => setMarks((s) => ({ ...s, [x.id]: e.target.value }))} required /></div>
                    <div className="space-y-1"><Label htmlFor={`f-${x.id}`}>{t('Feedback (optional)')}</Label><Input id={`f-${x.id}`} value={notes[x.id] ?? ''} onChange={(e) => setNotes((s) => ({ ...s, [x.id]: e.target.value }))} /></div>
                  </div>
                ) : (
                  <p className="text-sm">{t('Marked: {score} of {max}', { score: r?.marks ?? 0, max: x.marks })}{r?.feedback ? ` · ${r.feedback}` : ''}</p>
                )}
              </div>
            ) : (
              <p className="mt-2 inline-flex items-center gap-1 text-xs">
                {r?.correct ? <CheckCircle2 className="size-4 text-emerald-500" aria-hidden /> : <XCircle className="size-4 text-rose-500" aria-hidden />}
                {t('Marked automatically: {score} of {max}', { score: r?.marks ?? 0, max: x.marks })}
              </p>
            )}
          </article>
        );
      })}

      {waiting && (
        <section className="lrn-tile space-y-3">
          <div className="space-y-1.5"><Label htmlFor="m-feedback">{t('Overall feedback for {name}', { name: d.user.name })}</Label><textarea id="m-feedback" value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={3} maxLength={4000} className="w-full rounded-md border bg-surface p-2 text-sm" /></div>
          <ErrorLine error={error} />
          <div className="flex items-center justify-end gap-3">
            <span className="text-sm text-muted-foreground">{t('Result: {percent}% ({verdict})', { percent, verdict: percent >= d.module.passingScore ? t('pass') : t('not a pass') })}</span>
            <Button onClick={submit} disabled={busy || manual.some((x) => marks[x.id] === undefined || marks[x.id] === '')} data-save-marks><ClipboardCheck className="size-4" aria-hidden />{t('Save marks')}</Button>
          </div>
        </section>
      )}
    </div>
  );
}

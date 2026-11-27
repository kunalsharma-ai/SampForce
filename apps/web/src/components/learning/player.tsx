'use client';

import { LESSON_KIND_LABEL, type LessonView, type PlayerView } from '@dealflow/types';
import { Button, cn, Skeleton } from '@dealflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Award,
  Bookmark,
  BookmarkPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Clock,
  Download,
  ExternalLink,
  Lock,
  NotebookPen,
  PlayCircle,
  Target,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHelp } from '@/components/page-help';
import { useT } from '@/lib/i18n';
import { fileUrl, LEARNING_KEY, learningApi, minutesText, useLessonText, usePlayer } from '@/lib/learning';
import { Bar, dateText, dueText, ErrorLine, MATERIAL_ICON, pct, StatusBadge, useErrorText } from './bits';

type PlayerLesson = PlayerView['lessons'][number];

/** The module player: lessons in order, notes and bookmarks, and the way into the assessment. */
export function LearningPlayer({ moduleId }: { moduleId: string }) {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const q = usePlayer(moduleId);
  const errorText = useErrorText();
  const [lessonId, setLessonId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const v = q.data;

  useEffect(() => {
    if (v && !lessonId) setLessonId(v.lastLessonId ?? v.lessons.find((l) => !l.done)?.id ?? v.lessons[0]?.id ?? null);
  }, [v, lessonId]);

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: [...LEARNING_KEY, 'player', moduleId] }), [qc, moduleId]);

  if (q.isLoading) return <Skeleton className="h-[32rem] rounded-3xl" />;
  if (q.error || !v) return <ErrorLine error={q.error ?? new Error()} />;

  const lesson = v.lessons.find((l) => l.id === lessonId) ?? v.lessons[0] ?? null;
  const index = lesson ? v.lessons.indexOf(lesson) : -1;
  const done = v.lessons.filter((l) => l.done).length;
  const overall = v.assignment?.progress ?? (v.lessons.length ? Math.round((done / v.lessons.length) * 100) : 0);

  const enrol = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await learningApi.enrol(moduleId);
      qc.setQueryData([...LEARNING_KEY, 'player', moduleId], out);
      void qc.invalidateQueries({ queryKey: [...LEARNING_KEY, 'me'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const startAssessment = async () => {
    if (v.openAttemptId) return router.push(`/app/learning/${moduleId}/attempts/${v.openAttemptId}`);
    setBusy(true);
    setError(null);
    try {
      const a = await learningApi.startAttempt(moduleId);
      router.push(`/app/learning/${moduleId}/attempts/${a.id}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5" data-learning-player>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/app/learning" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> {t('My learning')}
        </Link>
        <PageHelp />
        {v.assignment && <StatusBadge status={v.assignment.status} overdue={v.assignment.overdue} />}
      </div>

      <section className="lrn-hero p-6">
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <p className="font-mono text-xs text-white/75">{v.module.number}</p>
            <h2 className="text-2xl font-extrabold tracking-tight">{v.module.title}</h2>
            {v.module.description && <p className="max-w-2xl text-sm text-white/85">{v.module.description}</p>}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="lrn-glass inline-flex items-center gap-1 rounded-full px-2.5 py-1"><Clock className="size-3.5" aria-hidden />{minutesText(v.module.estimatedMinutes, t)}</span>
              <span className="lrn-glass rounded-full px-2.5 py-1">{t.plural('learning.lessons', v.lessons.length)}</span>
              <span className="lrn-glass rounded-full px-2.5 py-1">{t('Pass mark {score}', { score: `${v.module.passingScore}%` })}</span>
              {v.module.certificate && <span className="lrn-glass inline-flex items-center gap-1 rounded-full px-2.5 py-1"><Award className="size-3.5" aria-hidden />{t('Certificate on passing')}</span>}
              {v.assignment?.dueAt && <span className="lrn-glass rounded-full px-2.5 py-1">{dueText(t, v.assignment.dueAt, v.assignment.overdue)}</span>}
            </div>
          </div>
          <div className="w-full max-w-xs space-y-1.5">
            <div className="flex justify-between text-xs text-white/85">
              <span>{t('{done} of {all} lessons done', { done, all: v.lessons.length })}</span>
              <span className="font-semibold tabular-nums">{overall}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-white/20"><div className="h-full rounded-full bg-white transition-all" style={{ width: `${overall}%` }} /></div>
          </div>
        </div>
      </section>

      {v.preview && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-300 bg-violet-50 p-4 text-violet-950 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100">
          <p className="text-sm">{t('This module is open to you. Start it to save your progress, take the assessment and earn its certificate.')}</p>
          <Button onClick={enrol} disabled={busy}><PlayCircle className="size-4" aria-hidden /> {t('Start learning')}</Button>
        </div>
      )}
      <ErrorLine error={error} />

      <div className="grid gap-5 lg:grid-cols-[17rem_1fr]">
        <nav aria-label={t('Lessons')} className="space-y-2">
          <ol className="space-y-1.5">
            {v.lessons.map((l, i) => {
              const Icon = MATERIAL_ICON[l.kind === 'VIDEO' ? 'VIDEO' : l.kind === 'AUDIO' ? 'AUDIO' : l.kind === 'TEXT' ? 'TEXT' : l.kind === 'PRESENTATION' ? 'PRESENTATION' : 'DOCUMENT'];
              return (
                <li key={l.id}>
                  <button onClick={() => setLessonId(l.id)} data-active={l.id === lesson?.id} className="lrn-lesson flex w-full items-start gap-3 rounded-xl border border-transparent p-2.5 text-start hover:bg-muted" data-lesson={i + 1}>
                    {l.done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-500" aria-label={t('Done')} /> : <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-snug">{i + 1}. {l.title}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Icon className="size-3" aria-hidden /> {t.maybe(LESSON_KIND_LABEL[l.kind])} · {minutesText(l.minutes, t)}
                        {!l.required && <> · {t('Optional')}</>}
                      </span>
                      {!l.done && l.percent > 0 && <Bar percent={l.percent} label={t('Progress')} className="mt-1.5 h-1" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <AssessmentCard v={v} busy={busy} onStart={startAssessment} />
        </nav>

        <div className="min-w-0 space-y-4">
          {lesson ? (
            <LessonPane key={lesson.id} moduleId={moduleId} lesson={lesson} tracking={!v.preview && !!v.assignment} onChanged={refresh} />
          ) : (
            <p className="text-sm text-muted-foreground">{t('This module has no lessons yet.')}</p>
          )}
          {lesson && (
            <div className="flex justify-between">
              <Button variant="ghost" disabled={index <= 0} onClick={() => setLessonId(v.lessons[index - 1]!.id)}>
                <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden /> {t('Previous lesson')}
              </Button>
              {index < v.lessons.length - 1 ? (
                <Button variant="ghost" onClick={() => setLessonId(v.lessons[index + 1]!.id)}>
                  {t('Next lesson')} <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
                </Button>
              ) : (
                v.canAttempt && (
                  <Button onClick={startAssessment} disabled={busy}>
                    <ClipboardCheck className="size-4" aria-hidden /> {t('Take the assessment')}
                  </Button>
                )
              )}
            </div>
          )}
          {(v.module.objectives.length > 0 || v.module.keyPoints.length > 0 || v.module.instructions) && (
            <section className="grid gap-4 md:grid-cols-2">
              {v.module.objectives.length > 0 && (
                <div className="lrn-tile space-y-2">
                  <h3 className="flex items-center gap-2 text-sm font-semibold"><Target className="size-4 text-violet-500" aria-hidden />{t('Learning objectives')}</h3>
                  <ul className="list-disc space-y-1 ps-5 text-sm">{v.module.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul>
                </div>
              )}
              {v.module.keyPoints.length > 0 && (
                <div className="lrn-tile space-y-2">
                  <h3 className="text-sm font-semibold">{t('Key learning points')}</h3>
                  <ul className="list-disc space-y-1 ps-5 text-sm">{v.module.keyPoints.map((o, i) => <li key={i}>{o}</li>)}</ul>
                </div>
              )}
              {v.module.instructions && (
                <div className="lrn-tile space-y-2 md:col-span-2">
                  <h3 className="text-sm font-semibold">{t('Instructions')}</h3>
                  <p className="whitespace-pre-wrap text-sm">{v.module.instructions}</p>
                </div>
              )}
            </section>
          )}
          {!v.preview && <Notes moduleId={moduleId} v={v} lesson={lesson} onChanged={refresh} />}
          {error ? <p className="sr-only">{errorText(error)}</p> : null}
        </div>
      </div>
    </div>
  );
}

function AssessmentCard({ v, busy, onStart }: { v: PlayerView; busy: boolean; onStart: () => void }) {
  const t = useT();
  const a = v.assignment;
  const left = a ? Math.max(0, a.attemptsAllowed - a.attemptsUsed) : v.module.maxAttempts;
  return (
    <section className="lrn-tile mt-3 space-y-3" data-assessment-card>
      <h3 className="flex items-center gap-2 text-sm font-semibold"><ClipboardCheck className="size-4 text-violet-500" aria-hidden />{t('Assessment')}</h3>
      {v.module.questions ? (
        <>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>{t.plural('learning.questions', v.module.questions)} · {t.plural('learning.marks', v.module.totalMarks)}</li>
            <li>{t('Pass mark {score}', { score: `${v.module.passingScore}%` })}</li>
            {v.module.timeLimitMinutes && <li>{t('Time limit {time}', { time: minutesText(v.module.timeLimitMinutes, t) })}</li>}
            <li>{t.plural('learning.attemptsLeft', left)}</li>
          </ul>
          {v.certificate ? (
            <Button asChild variant="outline" className="w-full"><Link href={`/app/learning/certificates?open=${v.certificate.id}`}><Award className="size-4" aria-hidden />{t('View certificate')}</Link></Button>
          ) : v.canAttempt || v.openAttemptId ? (
            <Button className="w-full" onClick={onStart} disabled={busy} data-start-assessment>
              <PlayCircle className="size-4" aria-hidden /> {v.openAttemptId ? t('Continue assessment') : a?.attemptsUsed ? t('Try again') : t('Start assessment')}
            </Button>
          ) : (
            <p className="flex items-start gap-2 rounded-lg bg-muted p-2 text-xs"><Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />{v.attemptBlockedReason ? t.maybe(v.attemptBlockedReason) : t('Finish the lessons first.')}</p>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">{t('No assessment: finishing the lessons completes this module.')}</p>
      )}
      {v.attempts.length > 0 && (
        <ul className="space-y-1 border-t pt-2">
          {v.attempts.map((x) => (
            <li key={x.id}>
              <Link href={`/app/learning/${v.module.id}/attempts/${x.id}`} className="flex items-center justify-between rounded-md px-1.5 py-1 text-xs hover:bg-muted">
                <span>{t('Attempt {n}', { n: x.number })}</span>
                <span className={cn('font-semibold', x.status !== 'MARKED' ? 'text-muted-foreground' : x.passed ? 'text-success' : 'text-critical')}>
                  {x.status === 'IN_PROGRESS' ? t('In progress') : x.status === 'AWAITING_MARKING' ? t('Being marked') : pct(x.percent)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Reports time spent and how far the lesson got, at most every 20 seconds, while the tab is visible. */
function useLessonTracking(moduleId: string, lesson: PlayerLesson, enabled: boolean, onChanged: () => void) {
  const percent = useRef(lesson.percent);
  const position = useRef<number | null>(lesson.positionSeconds);
  const since = useRef(Date.now());
  const done = useRef(lesson.done);

  const send = useCallback(
    async (extra: { done?: boolean } = {}) => {
      if (!enabled) return;
      const seconds = Math.min(600, Math.round((Date.now() - since.current) / 1000));
      since.current = Date.now();
      try {
        const out = await learningApi.progress(moduleId, lesson.id, { percent: Math.round(percent.current), ...(position.current !== null ? { positionSeconds: Math.round(position.current) } : {}), seconds, ...extra });
        if (out.done !== done.current) {
          done.current = out.done;
          onChanged();
        }
      } catch {
        /* progress is saved again on the next report */
      }
    },
    [enabled, moduleId, lesson.id, onChanged],
  );

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void send();
      else since.current = Date.now();
    }, 20_000);
    return () => {
      clearInterval(timer);
      void send();
    };
  }, [enabled, send]);

  return {
    report: (p: number, pos?: number) => {
      percent.current = Math.max(percent.current, p);
      if (pos !== undefined) position.current = pos;
      if (p >= 95 && !done.current) void send();
    },
    markDone: () => {
      percent.current = 100;
      void send({ done: true });
    },
    position,
  };
}

function LessonPane({ moduleId, lesson, tracking, onChanged }: { moduleId: string; lesson: PlayerLesson; tracking: boolean; onChanged: () => void }) {
  const t = useT();
  const track = useLessonTracking(moduleId, lesson, tracking, onChanged);
  const file = lesson.file;
  const isPdf = file?.contentType === 'application/pdf';
  const needsManualDone = (lesson.kind === 'VIDEO' && lesson.video && lesson.video.provider !== 'FILE_LINK') || lesson.kind === 'IMAGE' || ((lesson.kind === 'DOCUMENT' || lesson.kind === 'PRESENTATION' || lesson.kind === 'SPREADSHEET' || lesson.kind === 'FILE') && (isPdf || !file?.viewable));

  return (
    <article className="overflow-hidden rounded-2xl border bg-surface" data-lesson-pane={lesson.kind}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
        <div className="min-w-0">
          <h3 className="font-semibold">{lesson.title}</h3>
          <p className="text-xs text-muted-foreground">{t.maybe(LESSON_KIND_LABEL[lesson.kind])} · {minutesText(lesson.minutes, t)}</p>
        </div>
        <div className="flex gap-2">
          {file && lesson.allowDownload && (
            <Button asChild size="sm" variant="outline">
              <a href={fileUrl(file.id, true)}><Download className="size-4" aria-hidden />{t('Download')}</a>
            </Button>
          )}
          {lesson.done ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-success"><CheckCircle2 className="size-4" aria-hidden />{t('Done')}</span>
          ) : (
            tracking &&
            needsManualDone && (
              <Button size="sm" onClick={track.markDone} data-mark-done>
                <CheckCircle2 className="size-4" aria-hidden /> {lesson.kind === 'VIDEO' ? t('Mark as watched') : t('Mark as read')}
              </Button>
            )
          )}
        </div>
      </header>
      <div className="bg-black/[0.02]">
        <LessonBody moduleId={moduleId} lesson={lesson} onProgress={track.report} />
      </div>
      {lesson.objectives.length > 0 && (
        <div className="border-t p-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('In this lesson')}</p>
          <ul className="list-disc space-y-0.5 ps-5 text-sm">{lesson.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul>
        </div>
      )}
    </article>
  );
}

function LessonBody({ moduleId, lesson, onProgress }: { moduleId: string; lesson: PlayerLesson; onProgress: (p: number, pos?: number) => void }) {
  const file = lesson.file;
  const media = useRef<HTMLMediaElement | null>(null);
  const resumed = useRef(false);
  const onTime = () => {
    const m = media.current;
    if (!m || !m.duration || !Number.isFinite(m.duration)) return;
    onProgress((m.currentTime / m.duration) * 100, m.currentTime);
  };
  const onLoaded = () => {
    const m = media.current;
    if (m && !resumed.current && lesson.positionSeconds && lesson.positionSeconds < (m.duration || Infinity) - 5) m.currentTime = lesson.positionSeconds;
    resumed.current = true;
  };

  if (lesson.kind === 'VIDEO' && lesson.video && lesson.video.provider !== 'FILE_LINK') {
    return (
      <div className="aspect-video w-full bg-black">
        <iframe src={lesson.video.embedUrl} title={lesson.title} className="size-full" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      </div>
    );
  }
  if (lesson.kind === 'VIDEO' && (lesson.video?.provider === 'FILE_LINK' || file)) {
    const src = file ? fileUrl(file.id) : lesson.video!.embedUrl;
    return (
      <video ref={(el) => { media.current = el; }} src={src} controls playsInline className="aspect-video w-full bg-black" onTimeUpdate={onTime} onLoadedMetadata={onLoaded} onEnded={() => onProgress(100)}>
        {lesson.captionsFile && <track kind="captions" src={fileUrl(lesson.captionsFile.id)} default />}
      </video>
    );
  }
  if (lesson.kind === 'AUDIO' && file) {
    return (
      <div className="grid place-items-center gap-4 p-10">
        <div className="lrn-tile-icon size-20 rounded-full"><PlayCircle className="size-10" aria-hidden /></div>
        <audio ref={(el) => { media.current = el; }} src={fileUrl(file.id)} controls className="w-full max-w-xl" onTimeUpdate={onTime} onLoadedMetadata={onLoaded} onEnded={() => onProgress(100)} />
      </div>
    );
  }
  if (lesson.kind === 'IMAGE' && file) {
    // eslint-disable-next-line @next/next/no-img-element -- served by the API with its own access check
    return <img src={fileUrl(file.id)} alt={lesson.title} className="mx-auto max-h-[70vh] w-auto" />;
  }
  if (lesson.kind === 'TEXT') return <Reader text={lesson.body ?? ''} onProgress={onProgress} />;
  if (file?.contentType === 'application/pdf') {
    return <iframe src={fileUrl(file.id)} title={lesson.title} className="h-[75vh] w-full bg-white" />;
  }
  return <ReadingView moduleId={moduleId} lesson={lesson} onProgress={onProgress} />;
}

/** Documents, presentations and spreadsheets the browser cannot show: the text SampForce read from them. */
function ReadingView({ moduleId, lesson, onProgress }: { moduleId: string; lesson: LessonView; onProgress: (p: number) => void }) {
  const t = useT();
  const ready = lesson.text.status === 'READY';
  const q = useLessonText(moduleId, lesson.id, ready);
  if (!ready || (q.data && !q.data.text)) {
    return (
      <div className="space-y-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">{t('This file cannot be shown inside the page.')}</p>
        {lesson.file && lesson.allowDownload ? (
          <Button asChild><a href={fileUrl(lesson.file.id, true)}><Download className="size-4" aria-hidden />{t('Download {name}', { name: lesson.file.name })}</a></Button>
        ) : lesson.video ? (
          <Button asChild><a href={lesson.video.url} target="_blank" rel="noreferrer"><ExternalLink className="size-4" aria-hidden />{t('Open the video')}</a></Button>
        ) : null}
      </div>
    );
  }
  if (q.isLoading) return <Skeleton className="m-4 h-64" />;
  return (
    <div>
      <p className="border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">{t('Reading view: the text of {name}', { name: lesson.file?.name ?? lesson.title })}</p>
      <Reader text={q.data?.text ?? ''} onProgress={onProgress} />
    </div>
  );
}

/** Written text with headings ("# "), and reading progress from the scroll position. */
/** A block with bullet lines: lines before the first bullet stay a paragraph, the bullets become a list. */
function ReaderList({ block }: { block: string }) {
  const lines = block.split('\n');
  const first = lines.findIndex((x) => /^[-*] /.test(x));
  const lead = lines.slice(0, first).join('\n').trim();
  return (
    <>
      {lead && <p className="whitespace-pre-wrap">{lead}</p>}
      <ul className="list-disc space-y-1 ps-6">{lines.slice(first).map((x, j) => <li key={j}>{x.replace(/^[-*]\s+/, '')}</li>)}</ul>
    </>
  );
}

function Reader({ text, onProgress }: { text: string; onProgress: (p: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    // Within a few pixels of the end counts as the end: browsers stop scrolling at fractions of a pixel.
    onProgress(max <= 4 || el.scrollTop >= max - 4 ? 100 : (el.scrollTop / max) * 100);
  };
  useEffect(() => {
    const el = box.current;
    if (el && el.scrollHeight <= el.clientHeight + 4) onProgress(100);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, after the text is laid out
  }, [text]);
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div ref={box} onScroll={onScroll} className="max-h-[70vh] overflow-y-auto px-6 py-6 sm:px-10" data-reader>
      <div className="mx-auto max-w-2xl space-y-4 text-[15px] leading-7">
        {blocks.map((b, i) =>
          b.startsWith('# ') ? (
            <h4 key={i} className="pt-2 text-lg font-bold">{b.slice(2)}</h4>
          ) : b.startsWith('## ') ? (
            <h5 key={i} className="pt-1 font-semibold">{b.slice(3)}</h5>
          ) : /^[-*] /m.test(b) ? (
            <ReaderList key={i} block={b} />
          ) : (
            <p key={i} className="whitespace-pre-wrap">{b}</p>
          ),
        )}
      </div>
    </div>
  );
}

function Notes({ moduleId, v, lesson, onChanged }: { moduleId: string; v: PlayerView; lesson: PlayerLesson | null; onChanged: () => void }) {
  const t = useT();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const save = async (bookmark: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await learningApi.addNote(moduleId, { lessonId: lesson?.id ?? null, ...(body.trim() ? { body: body.trim() } : {}), bookmark });
      setBody('');
      onChanged();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    try {
      await learningApi.removeNote(id);
      onChanged();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <section className="lrn-tile space-y-3" data-notes>
      <h3 className="flex items-center gap-2 text-sm font-semibold"><NotebookPen className="size-4 text-violet-500" aria-hidden />{t('My notes and bookmarks')}</h3>
      <div className="space-y-2">
        <label className="sr-only" htmlFor="lrn-note">{t('Write a note')}</label>
        <textarea id="lrn-note" value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={5000} placeholder={lesson ? t('A note on “{lesson}”…', { lesson: lesson.title }) : t('Write a note')} className="w-full rounded-lg border bg-surface p-2 text-sm" />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => save(false)} disabled={busy || !body.trim()}>{t('Save note')}</Button>
          {lesson && <Button size="sm" variant="outline" onClick={() => save(true)} disabled={busy}><BookmarkPlus className="size-4" aria-hidden />{t('Bookmark this lesson')}</Button>}
        </div>
        <ErrorLine error={error} />
      </div>
      {v.notes.length > 0 && (
        <ul className="divide-y">
          {v.notes.map((n) => (
            <li key={n.id} className="flex items-start gap-2 py-2 text-sm">
              {n.bookmark ? <Bookmark className="mt-0.5 size-4 shrink-0 text-amber-500" aria-label={t('Bookmark')} /> : <NotebookPen className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
              <div className="min-w-0 flex-1">
                {n.body && <p className="whitespace-pre-wrap">{n.body}</p>}
                <p className="text-xs text-muted-foreground">{n.lessonTitle ?? t('Whole module')} · {dateText(n.createdAt)}</p>
              </div>
              <button onClick={() => remove(n.id)} className="rounded p-1 text-muted-foreground hover:text-critical" aria-label={t('Delete note')}>
                <Trash2 className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

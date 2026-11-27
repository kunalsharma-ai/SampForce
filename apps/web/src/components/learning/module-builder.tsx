'use client';

import {
  GENERATABLE_TYPES,
  LEARNING_LEVEL_LABEL,
  LEARNING_LEVELS,
  LEARNING_MEDIA_MAX_BYTES,
  LEARNING_FILE_MAX_BYTES,
  LEARNING_MODULE_STATUS_LABEL,
  LESSON_KIND_LABEL,
  LESSON_TEXT_SOURCE_LABEL,
  QUESTION_DIFFICULTIES,
  QUESTION_DIFFICULTY_LABEL,
  QUESTION_TYPE_LABEL,
  VIDEO_PROVIDER_LABEL,
  type GenerateResult,
  type GeneratableType,
  type LearningModuleDetail,
  type LessonKind,
  type LessonView,
  type QuestionDifficulty,
  type QuestionView,
  type VideoInfo,
} from '@dealflow/types';
import { Badge, Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Label, Skeleton } from '@dealflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpenCheck,
  Check,
  CheckCircle2,
  ClipboardList,
  Eye,
  FileUp,
  History,
  Library,
  Link2,
  Pencil,
  Plus,
  Rocket,
  Save,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Type,
  Upload,
  UserPlus,
  Video,
  Wand2,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { formatBytes } from '@/components/forms/upload-zone';
import { PageHelp } from '@/components/page-help';
import { useT } from '@/lib/i18n';
import { LEARNING_KEY, learningApi, uploadLearningFile, useAssignees, useBank, useCategories, useModule, useModuleAssignments } from '@/lib/learning';
import { CategoryChip, EmptyState, ErrorLine, pct, StatusBadge } from './bits';
import { QuestionEditor } from './question-editor';

type Tab = 'details' | 'lessons' | 'questions' | 'assign' | 'history';

/** Builds one module: details, lessons, questions (written or drafted from the material), assignments and history. */
export function ModuleBuilder({ id }: { id: string }) {
  const t = useT();
  const qc = useQueryClient();
  const router = useRouter();
  const q = useModule(id);
  const [tab, setTab] = useState<Tab>('lessons');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const m = q.data;

  /** Runs a change and keeps the fresh module the API sends back. */
  const change = async (fn: () => Promise<LearningModuleDetail | (GenerateResult & { module: LearningModuleDetail })>) => {
    setBusy(true);
    setError(null);
    try {
      const out = await fn();
      const fresh = 'module' in out ? out.module : out;
      qc.setQueryData([...LEARNING_KEY, 'module', id], fresh);
      void qc.invalidateQueries({ queryKey: [...LEARNING_KEY, 'manage'] });
      return out;
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const quiet = (fn: () => Promise<LearningModuleDetail | (GenerateResult & { module: LearningModuleDetail })>) => change(fn).catch(() => undefined);

  if (q.isLoading) return <Skeleton className="h-[34rem] rounded-3xl" />;
  if (q.error || !m) return <ErrorLine error={q.error ?? new Error()} />;

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await learningApi.removeModule(id);
      void qc.invalidateQueries({ queryKey: [...LEARNING_KEY, 'manage'] });
      router.push('/app/learning/manage');
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  const pending = m.questionList.filter((x) => !x.approved).length;
  const tabs: [Tab, string, typeof Video, number | null][] = [
    ['lessons', t('Lessons'), BookOpenCheck, m.lessonList.length],
    ['questions', t('Assessment'), ClipboardList, m.questionList.length],
    ['details', t('Details and rules'), Settings2, null],
    ['assign', t('Assign'), UserPlus, m.stats.assigned],
    ['history', t('History'), History, null],
  ];

  return (
    <div className="space-y-5" data-module-builder={m.number}>
      <Link href="/app/learning/manage" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {t('Learning management')}
      </Link>
      <PageHelp />
      <section className="lrn-hero p-6" data-tone="manage">
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono text-white/80">{m.number}</span>
              <span className="rounded-full bg-white/20 px-2 py-0.5 font-semibold" data-module-status={m.status}>{t.maybe(LEARNING_MODULE_STATUS_LABEL[m.status])}</span>
              {m.category && <span className="rounded-full bg-white/90 px-2 py-0.5"><CategoryChip category={m.category} /></span>}
            </div>
            <h2 className="text-2xl font-extrabold tracking-tight">{m.title}</h2>
            <p className="text-sm text-white/85">
              {t.plural('learning.lessons', m.lessonList.length)} · {t.plural('learning.questions', m.questionList.filter((x) => x.approved).length)} · {t.plural('learning.marks', m.totalMarks)} · {t('Pass mark {score}', { score: `${m.passingScore}%` })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" className="border-white/40 bg-white/10 text-white hover:bg-white/20">
              <Link href={`/app/learning/${m.id}`}><Eye className="size-4" aria-hidden />{t('Preview as learner')}</Link>
            </Button>
            {m.canEdit && m.status !== 'PUBLISHED' && (
              <Button onClick={() => quiet(() => learningApi.publish(id))} disabled={busy || m.publishProblems.length > 0} className="bg-white text-teal-800 hover:bg-white/90" data-publish>
                <Rocket className="size-4" aria-hidden /> {m.status === 'ARCHIVED' ? t('Publish again') : t('Publish')}
              </Button>
            )}
            {m.canEdit && m.status === 'PUBLISHED' && (
              <Button onClick={() => quiet(() => learningApi.archive(id))} disabled={busy} variant="outline" className="border-white/40 bg-white/10 text-white hover:bg-white/20">
                <Archive className="size-4" aria-hidden /> {t('Archive')}
              </Button>
            )}
            {m.canEdit && m.status === 'DRAFT' && m.stats.assigned === 0 && (
              <Button onClick={remove} disabled={busy} variant="outline" className="border-white/40 bg-white/10 text-white hover:bg-rose-500/40">
                <Trash2 className="size-4" aria-hidden /> {t('Delete')}
              </Button>
            )}
          </div>
        </div>
      </section>

      {m.status !== 'PUBLISHED' && m.publishProblems.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-publish-problems>
          <p className="font-semibold">{t('Before you can publish')}</p>
          <ul className="mt-1 list-disc ps-5">{m.publishProblems.map((p) => <li key={p}>{t.maybe(p)}</li>)}</ul>
        </div>
      )}
      {!m.canEdit && <p className="rounded-xl bg-muted p-3 text-sm">{t('This module belongs to another workspace. You can assign it and see results, but not change it.')}</p>}
      <ErrorLine error={error} />

      <div role="tablist" className="flex flex-wrap gap-2">
        {tabs.map(([key, label, Icon, n]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={cn('inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium', tab === key ? 'border-transparent bg-gradient-to-r from-teal-600 to-indigo-600 text-white shadow' : 'hover:bg-muted')} data-tab={key}>
            <Icon className="size-4" aria-hidden /> {label}
            {n !== null && <span className={cn('rounded-full px-1.5 text-xs', tab === key ? 'bg-white/25' : 'bg-muted')}>{n}</span>}
            {key === 'questions' && pending > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-xs font-bold text-amber-950">{t('{n} to review', { n: pending })}</span>}
          </button>
        ))}
      </div>

      {tab === 'details' && <DetailsForm m={m} busy={busy} onSave={(input) => change(() => learningApi.updateModule(id, input))} />}
      {tab === 'lessons' && <Lessons m={m} busy={busy} change={change} quiet={quiet} />}
      {tab === 'questions' && <Questions m={m} busy={busy} change={change} quiet={quiet} />}
      {tab === 'assign' && <Assign m={m} />}
      {tab === 'history' && (
        <ol className="relative space-y-4 border-s ps-6">
          {m.history.map((h) => (
            <li key={h.id} className="relative">
              <span className="absolute -start-[1.95rem] top-1 size-3 rounded-full bg-gradient-to-br from-teal-500 to-indigo-500" aria-hidden />
              <p className="text-sm">{t.maybe(h.summary)}</p>
              <p className="text-xs text-muted-foreground">{h.actor?.name ?? t('SampForce')} · {new Date(h.at).toLocaleString(t.formatLocale)}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

type Change = (fn: () => Promise<LearningModuleDetail | (GenerateResult & { module: LearningModuleDetail })>) => Promise<LearningModuleDetail | (GenerateResult & { module: LearningModuleDetail }) | undefined>;

// ───────────── Details ─────────────

function DetailsForm({ m, busy, onSave }: { m: LearningModuleDetail; busy: boolean; onSave: (input: object) => Promise<unknown> }) {
  const t = useT();
  const categories = useCategories();
  const assignees = useAssignees(m.canEdit);
  const [f, setF] = useState(() => ({
    title: m.title,
    categoryId: m.category?.id ?? '',
    description: m.description ?? '',
    objectives: m.objectives.join('\n'),
    keyPoints: m.keyPoints.join('\n'),
    instructions: m.instructions ?? '',
    level: m.level,
    estimatedMinutes: '',
    mandatory: m.mandatory,
    visibility: m.visibility,
    passingScore: m.passingScore,
    maxAttempts: m.maxAttempts,
    timeLimitMinutes: m.timeLimitMinutes ? String(m.timeLimitMinutes) : '',
    deadline: m.dueAt ? 'date' : m.dueInDays ? 'days' : 'none',
    dueAt: m.dueAt ? m.dueAt.slice(0, 10) : '',
    dueInDays: m.dueInDays ? String(m.dueInDays) : '14',
    certificate: m.certificate,
    showAnswers: m.showAnswers,
    shuffleQuestions: m.shuffleQuestions,
    responsibleUserId: m.responsible?.id ?? '',
    reminderDaysBefore: m.reminderDaysBefore.join(', '),
    remindOnDueDay: m.remindOnDueDay,
    overdueEveryDays: m.overdueEveryDays ? String(m.overdueEveryDays) : '',
  }));
  const [saved, setSaved] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setSaved(false);
    setF((s) => ({ ...s, [k]: v }));
  };
  const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter((x) => x.length >= 2);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSave({
      title: f.title.trim(),
      categoryId: f.categoryId || null,
      description: f.description.trim(),
      objectives: lines(f.objectives),
      keyPoints: lines(f.keyPoints),
      instructions: f.instructions.trim(),
      level: f.level,
      ...(f.estimatedMinutes ? { estimatedMinutes: Number(f.estimatedMinutes) } : {}),
      mandatory: f.mandatory,
      visibility: f.visibility,
      passingScore: Number(f.passingScore),
      maxAttempts: Number(f.maxAttempts),
      timeLimitMinutes: f.timeLimitMinutes ? Number(f.timeLimitMinutes) : null,
      dueAt: f.deadline === 'date' && f.dueAt ? new Date(`${f.dueAt}T23:59:00`).toISOString() : null,
      dueInDays: f.deadline === 'days' ? Number(f.dueInDays) : null,
      certificate: f.certificate,
      showAnswers: f.showAnswers,
      shuffleQuestions: f.shuffleQuestions,
      responsibleUserId: f.responsibleUserId || null,
      reminderDaysBefore: f.reminderDaysBefore.split(/[,\s]+/).map(Number).filter((n) => n >= 1 && n <= 60).slice(0, 5),
      remindOnDueDay: f.remindOnDueDay,
      overdueEveryDays: f.overdueEveryDays ? Number(f.overdueEveryDays) : null,
    })
      .then(() => setSaved(true))
      .catch(() => undefined);
  };
  const area = 'w-full rounded-md border bg-surface p-2 text-sm';
  const sel = 'h-10 w-full rounded-md border bg-surface px-2 text-sm';
  const check = (k: 'mandatory' | 'certificate' | 'showAnswers' | 'shuffleQuestions' | 'remindOnDueDay', label: string, hint?: string) => (
    <label className="flex items-start gap-2 rounded-xl border p-3 text-sm">
      <input type="checkbox" checked={f[k]} onChange={(e) => set(k, e.target.checked)} className="mt-0.5 size-4" disabled={!m.canEdit} />
      <span><span className="font-medium">{label}</span>{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
    </label>
  );
  return (
    <form onSubmit={submit} className="space-y-6" data-details-form>
      <fieldset disabled={!m.canEdit} className="grid gap-6 lg:grid-cols-2">
        <section className="lrn-tile space-y-4">
          <h3 className="font-semibold">{t('About the module')}</h3>
          <div className="space-y-1.5"><Label htmlFor="d-title">{t('Title')}</Label><Input id="d-title" value={f.title} onChange={(e) => set('title', e.target.value)} required minLength={3} maxLength={160} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="d-cat">{t('Category')}</Label>
              <select id="d-cat" className={sel} value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                <option value="">{t('No category')}</option>
                {categories.data?.map((c) => <option key={c.id} value={c.id}>{t.maybe(c.name)}</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="d-level">{t('Difficulty level')}</Label>
              <select id="d-level" className={sel} value={f.level} onChange={(e) => set('level', e.target.value as typeof f.level)}>
                {LEARNING_LEVELS.map((l) => <option key={l} value={l}>{t.maybe(LEARNING_LEVEL_LABEL[l])}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="d-desc">{t('Description')}</Label><textarea id="d-desc" className={area} rows={4} value={f.description} onChange={(e) => set('description', e.target.value)} maxLength={4000} /></div>
          <div className="space-y-1.5"><Label htmlFor="d-obj">{t('Learning objectives, one per line')}</Label><textarea id="d-obj" className={area} rows={4} value={f.objectives} onChange={(e) => set('objectives', e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="d-key">{t('Key learning points, one per line')}</Label><textarea id="d-key" className={area} rows={4} value={f.keyPoints} onChange={(e) => set('keyPoints', e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="d-ins">{t('Instructions for learners')}</Label><textarea id="d-ins" className={area} rows={3} value={f.instructions} onChange={(e) => set('instructions', e.target.value)} maxLength={2000} /></div>
          <div className="space-y-1.5"><Label htmlFor="d-min">{t('Estimated time in minutes')}</Label><Input id="d-min" type="number" min={1} max={10000} placeholder={t('Worked out: {time}', { time: `${m.estimatedMinutes}` })} value={f.estimatedMinutes} onChange={(e) => set('estimatedMinutes', e.target.value)} /></div>
        </section>
        <section className="space-y-4">
          <div className="lrn-tile space-y-4">
            <h3 className="font-semibold">{t('Assessment rules')}</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5"><Label htmlFor="d-pass">{t('Pass mark (%)')}</Label><Input id="d-pass" type="number" min={1} max={100} value={f.passingScore} onChange={(e) => set('passingScore', Number(e.target.value))} /></div>
              <div className="space-y-1.5"><Label htmlFor="d-att">{t('Attempts allowed')}</Label><Input id="d-att" type="number" min={1} max={20} value={f.maxAttempts} onChange={(e) => set('maxAttempts', Number(e.target.value))} /></div>
              <div className="space-y-1.5"><Label htmlFor="d-time">{t('Time limit (minutes)')}</Label><Input id="d-time" type="number" min={1} max={600} placeholder={t('None')} value={f.timeLimitMinutes} onChange={(e) => set('timeLimitMinutes', e.target.value)} /></div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {check('certificate', t('Award a certificate'), t('Issued automatically on a pass.'))}
              {check('showAnswers', t('Show right answers'), t('On the result page, with explanations.'))}
              {check('shuffleQuestions', t('Shuffle questions'), t('A different order for each attempt.'))}
              {check('mandatory', t('Mandatory'), t('Shown first and flagged to the learner.'))}
            </div>
          </div>
          <div className="lrn-tile space-y-4">
            <h3 className="font-semibold">{t('Who and when')}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="d-vis">{t('Visibility')}</Label>
                <select id="d-vis" className={sel} value={f.visibility} onChange={(e) => set('visibility', e.target.value as typeof f.visibility)}>
                  <option value="ASSIGNED">{t('Only people it is assigned to')}</option>
                  <option value="OPEN">{t('Open to everyone below this workspace')}</option>
                </select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="d-resp">{t('Responsible manager')}</Label>
                <select id="d-resp" className={sel} value={f.responsibleUserId} onChange={(e) => set('responsibleUserId', e.target.value)}>
                  <option value="">{m.responsible ? m.responsible.name : t('The creator')}</option>
                  {assignees.data?.filter((a) => a.level !== 'EXECUTIVE' && a.id !== m.responsible?.id).map((a) => <option key={a.id} value={a.id}>{a.name} · {t.maybe(a.workspace)}</option>)}
                </select>
              </div>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t('Deadline')}</legend>
              <div className="flex flex-wrap gap-3 text-sm">
                {(
                  [
                    ['none', t('No deadline')],
                    ['date', t('A fixed date')],
                    ['days', t('Days after assigning')],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-1.5"><input type="radio" name="d-deadline" checked={f.deadline === k} onChange={() => set('deadline', k)} />{label}</label>
                ))}
              </div>
              {f.deadline === 'date' && <Input type="date" aria-label={t('Deadline')} value={f.dueAt} onChange={(e) => set('dueAt', e.target.value)} />}
              {f.deadline === 'days' && <Input type="number" min={1} max={365} aria-label={t('Days after assigning')} value={f.dueInDays} onChange={(e) => set('dueInDays', e.target.value)} />}
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="d-rem">{t('Reminders, days before the deadline')}</Label><Input id="d-rem" value={f.reminderDaysBefore} onChange={(e) => set('reminderDaysBefore', e.target.value)} placeholder="3, 1" /></div>
              <div className="space-y-1.5"><Label htmlFor="d-over">{t('After the deadline, remind every (days)')}</Label><Input id="d-over" type="number" min={1} max={30} placeholder={t('Never')} value={f.overdueEveryDays} onChange={(e) => set('overdueEveryDays', e.target.value)} /></div>
            </div>
            {check('remindOnDueDay', t('Remind on the day it is due'))}
          </div>
        </section>
      </fieldset>
      {m.canEdit && (
        <div className="flex items-center justify-end gap-3">
          {saved && <span className="inline-flex items-center gap-1 text-sm text-success" role="status"><Check className="size-4" aria-hidden />{t('Saved')}</span>}
          <Button type="submit" disabled={busy}><Save className="size-4" aria-hidden />{t('Save details')}</Button>
        </div>
      )}
    </form>
  );
}

// ───────────── Lessons ─────────────

function TextStatus({ l }: { l: LessonView }) {
  const t = useT();
  if (l.text.status === 'READY')
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success" title={l.text.note ? t.maybe(l.text.note) : undefined}>
        <CheckCircle2 className="size-3" aria-hidden /> {t('Readable: {source}', { source: l.text.source ? t.maybe(LESSON_TEXT_SOURCE_LABEL[l.text.source]) : '' })} · {t('{n} characters', { n: l.text.chars })}
      </span>
    );
  if (l.text.status === 'UNREADABLE')
    return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">{t('Could not be read for questions')}</span>;
  return null;
}

function Lessons({ m, busy, change, quiet }: { m: LearningModuleDetail; busy: boolean; change: Change; quiet: Change }) {
  const t = useT();
  const [adding, setAdding] = useState<'video' | 'upload' | 'text' | null>(m.lessonList.length ? null : 'video');
  const [editing, setEditing] = useState<LessonView | null>(null);
  const move = (i: number, d: -1 | 1) => {
    const ids = m.lessonList.map((l) => l.id);
    [ids[i], ids[i + d]] = [ids[i + d]!, ids[i]!];
    void quiet(() => learningApi.reorderLessons(m.id, ids));
  };
  return (
    <div className="space-y-5">
      {m.canEdit && (
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ['video', Video, t('Paste a video link'), t('YouTube, Vimeo, Loom, Wistia, Dailymotion or a video file link')],
              ['upload', Upload, t('Upload files'), t('Video, audio, PDF, Word, PowerPoint, Excel, images, text')],
              ['text', Type, t('Write a lesson'), t('Text you type or paste here')],
            ] as const
          ).map(([k, Icon, title, body]) => (
            <button key={k} onClick={() => setAdding(adding === k ? null : k)} aria-pressed={adding === k} className={cn('lrn-card items-start gap-2 p-4 text-start', adding === k && 'ring-2 ring-violet-500')} data-add-lesson={k}>
              <span className="lrn-tile-icon"><Icon className="size-5" aria-hidden /></span>
              <span className="font-semibold">{title}</span>
              <span className="text-xs text-muted-foreground">{body}</span>
            </button>
          ))}
        </div>
      )}
      {adding === 'video' && <AddVideo m={m} change={change} onDone={() => setAdding(null)} />}
      {adding === 'upload' && <AddUpload m={m} change={change} onDone={() => setAdding(null)} />}
      {adding === 'text' && <AddText m={m} change={change} onDone={() => setAdding(null)} />}

      {m.lessonList.length ? (
        <ol className="space-y-2">
          {m.lessonList.map((l, i) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 rounded-2xl border bg-surface p-3" data-lesson-row={l.title}>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-sm font-bold">{i + 1}</span>
              {l.video?.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- provider preview image
                <img src={l.video.thumbnailUrl} alt="" className="h-12 w-20 shrink-0 rounded-lg object-cover" />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="font-medium">{l.title}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{t.maybe(LESSON_KIND_LABEL[l.kind])}</span>
                  {l.video && <span>{t.maybe(VIDEO_PROVIDER_LABEL[l.video.provider])}</span>}
                  {l.file && <span>{l.file.name} · {formatBytes(l.file.sizeBytes)}</span>}
                  <span>{t('{n} min', { n: l.minutes })}</span>
                  {!l.required && <Badge>{t('Optional')}</Badge>}
                  <TextStatus l={l} />
                </div>
                {l.text.status === 'UNREADABLE' && l.text.note && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{t.maybe(l.text.note)}</p>}
              </div>
              {m.canEdit && (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" disabled={busy || i === 0} onClick={() => move(i, -1)} aria-label={t('Move up')}><ArrowUp className="size-4" aria-hidden /></Button>
                  <Button size="icon" variant="ghost" disabled={busy || i === m.lessonList.length - 1} onClick={() => move(i, 1)} aria-label={t('Move down')}><ArrowDown className="size-4" aria-hidden /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setEditing(l)} aria-label={t('Edit lesson')}><Pencil className="size-4" aria-hidden /></Button>
                  <Button size="icon" variant="ghost" disabled={busy} onClick={() => quiet(() => learningApi.removeLesson(m.id, l.id))} aria-label={t('Delete lesson')}><Trash2 className="size-4" aria-hidden /></Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : (
        !adding && <EmptyState icon={BookOpenCheck} title={t('No lessons yet')} body={t('Add a video link, upload documents or write a lesson.')} />
      )}
      {editing && <EditLesson m={m} lesson={editing} change={change} onClose={() => setEditing(null)} />}
    </div>
  );
}

function Panel({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const t = useT();
  return (
    <section className="space-y-4 rounded-2xl border-2 border-violet-300 bg-violet-50/50 p-5 dark:border-violet-800 dark:bg-violet-950/20">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label={t('Close')}><X className="size-4" aria-hidden /></Button>
      </div>
      {children}
    </section>
  );
}

function AddVideo({ m, change, onDone }: { m: LearningModuleDetail; change: Change; onDone: () => void }) {
  const t = useT();
  const [url, setUrl] = useState('');
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [title, setTitle] = useState('');
  const [transcript, setTranscript] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const inspect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const v = await learningApi.inspectVideo(url.trim());
      setInfo(v);
      if (!title) setTitle(v.title ?? '');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    setBusy(true);
    try {
      await change(() => learningApi.addLesson(m.id, { title: title.trim() || info?.title || t('Video lesson'), kind: 'VIDEO', videoUrl: info!.url, ...(transcript.trim() ? { transcript: transcript.trim() } : {}) }));
      onDone();
    } catch {
      setBusy(false);
    }
  };
  return (
    <Panel title={t('Add a video from a link')} onClose={onDone}>
      <form onSubmit={inspect} className="flex flex-wrap gap-2">
        <label htmlFor="lrn-video-url" className="sr-only">{t('Video link')}</label>
        <div className="relative min-w-[16rem] flex-1">
          <Link2 className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input id="lrn-video-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" className="ps-9" required />
        </div>
        <Button type="submit" disabled={busy || url.trim().length < 8} data-inspect-video><Search className="size-4" aria-hidden />{busy && !info ? t('Checking…') : t('Check link')}</Button>
      </form>
      <ErrorLine error={error} />
      {info && (
        <div className="space-y-4" data-video-preview>
          <div className="flex flex-wrap gap-4 rounded-xl border bg-surface p-3">
            {info.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- provider preview image
              <img src={info.thumbnailUrl} alt="" className="h-24 w-40 rounded-lg object-cover" />
            ) : (
              <div className="grid h-24 w-40 place-items-center rounded-lg bg-muted"><Video className="size-8 text-muted-foreground" aria-hidden /></div>
            )}
            <div className="min-w-0 flex-1 space-y-1 text-sm">
              <p className="font-semibold">{info.title ?? t('Untitled video')}</p>
              <p className="text-xs text-muted-foreground">
                {t.maybe(VIDEO_PROVIDER_LABEL[info.provider])}
                {info.author ? ` · ${info.author}` : ''}
                {info.durationSeconds ? ` · ${t('{n} min', { n: Math.max(1, Math.round(info.durationSeconds / 60)) })}` : ''}
              </p>
              {info.captions === 'AVAILABLE' ? (
                <p className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-medium text-success" data-captions="available"><CheckCircle2 className="size-3.5" aria-hidden />{t('Captions found: SampForce can draft questions from what is said in the video.')}</p>
              ) : (
                <p className="rounded-lg bg-amber-100 p-2 text-xs text-amber-950 dark:bg-amber-950/40 dark:text-amber-100" data-captions="missing">
                  {info.note ? t.maybe(info.note) : t('SampForce could not read captions for this video, so it cannot draft questions from it. Paste a transcript below, or write the questions yourself.')}
                </p>
              )}
            </div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="lrn-video-title">{t('Lesson title')}</Label><Input id="lrn-video-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} /></div>
          <div className="space-y-1.5">
            <Label htmlFor="lrn-video-tr">{t('Transcript or notes (optional)')}</Label>
            <textarea id="lrn-video-tr" value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={4} className="w-full rounded-md border bg-surface p-2 text-sm" placeholder={t('Paste what the video says. SampForce uses it to draft questions when captions cannot be read.')} />
          </div>
          <div className="flex justify-end"><Button onClick={add} disabled={busy} data-add-video><Plus className="size-4" aria-hidden />{t('Add lesson')}</Button></div>
        </div>
      )}
    </Panel>
  );
}

function kindOf(file: File): LessonKind {
  const n = file.name.toLowerCase();
  const ty = file.type;
  if (ty.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/.test(n)) return 'VIDEO';
  if (ty.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|aac)$/.test(n)) return 'AUDIO';
  if (ty.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/.test(n)) return 'IMAGE';
  if (/\.(pptx?|odp|key)$/.test(n)) return 'PRESENTATION';
  if (/\.(xlsx?|csv|ods)$/.test(n)) return 'SPREADSHEET';
  if (/\.(pdf|docx?|odt|rtf|txt|md)$/.test(n)) return 'DOCUMENT';
  return 'FILE';
}

function AddUpload({ m, change, onDone }: { m: LearningModuleDetail; change: Change; onDone: () => void }) {
  const t = useT();
  const [items, setItems] = useState<{ name: string; progress: number; state: 'uploading' | 'reading' | 'done' | 'error'; error?: unknown }[]>([]);
  const [allowDownload, setAllowDownload] = useState(true);
  const upload = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      const kind = kindOf(file);
      const max = kind === 'VIDEO' || kind === 'AUDIO' ? LEARNING_MEDIA_MAX_BYTES : LEARNING_FILE_MAX_BYTES;
      const idx = items.length;
      setItems((s) => [...s, { name: file.name, progress: 0, state: 'uploading' }]);
      const update = (patch: Partial<(typeof items)[number]>) => setItems((s) => s.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
      if (file.size > max) {
        update({ state: 'error', error: new Error(t('{name} is larger than {max}.', { name: file.name, max: formatBytes(max) })) });
        continue;
      }
      try {
        const ref = await uploadLearningFile(file, (p) => update({ progress: p }));
        update({ state: 'reading', progress: 1 });
        await change(() => learningApi.addLesson(m.id, { title: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || file.name, kind, fileId: ref.id, allowDownload }));
        update({ state: 'done' });
      } catch (e) {
        update({ state: 'error', error: e });
      }
    }
  };
  return (
    <Panel title={t('Upload lesson files')} onClose={onDone}>
      <label className="grid cursor-pointer place-items-center gap-2 rounded-2xl border-2 border-dashed border-violet-300 bg-surface p-8 text-center hover:bg-violet-50/60 dark:border-violet-800 dark:hover:bg-violet-950/30" data-upload-zone>
        <FileUp className="size-9 text-violet-500" aria-hidden />
        <span className="font-medium">{t('Choose files or drop them here')}</span>
        <span className="text-xs text-muted-foreground">{t('Each file becomes a lesson. Video and audio up to 500 MB, other files up to 50 MB.')}</span>
        <input type="file" multiple className="sr-only" onChange={(e) => void upload(e.target.files)} accept="video/*,audio/*,image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.txt,.md,.odt,.odp,.ods,.rtf" />
      </label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} className="size-4" />{t('Learners may download the files')}</label>
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((x, i) => (
            <li key={i} className="rounded-xl border bg-surface p-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="truncate font-medium">{x.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {x.state === 'uploading' ? `${Math.round(x.progress * 100)}%` : x.state === 'reading' ? t('Reading the file…') : x.state === 'done' ? t('Added') : t('Failed')}
                </span>
              </div>
              <div className="lrn-bar mt-2 h-1.5" data-tone={x.state === 'done' ? 'done' : undefined}><span style={{ width: `${Math.round(x.progress * 100)}%` }} /></div>
              {x.state === 'error' && <ErrorLine error={x.error} />}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AddText({ m, change, onDone }: { m: LearningModuleDetail; change: Change; onDone: () => void }) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await change(() => learningApi.addLesson(m.id, { title: title.trim(), kind: 'TEXT', body }));
      onDone();
    } catch {
      setBusy(false);
    }
  };
  return (
    <Panel title={t('Write a lesson')} onClose={onDone}>
      <form onSubmit={add} className="space-y-3">
        <div className="space-y-1.5"><Label htmlFor="lrn-text-title">{t('Lesson title')}</Label><Input id="lrn-text-title" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={160} /></div>
        <div className="space-y-1.5">
          <Label htmlFor="lrn-text-body">{t('Lesson text')}</Label>
          <textarea id="lrn-text-body" value={body} onChange={(e) => setBody(e.target.value)} rows={12} className="w-full rounded-md border bg-surface p-3 text-sm leading-6" required />
          <p className="text-xs text-muted-foreground">{t('Leave a blank line between paragraphs. Start a line with “# ” for a heading and “- ” for a list.')}</p>
        </div>
        <div className="flex justify-end"><Button type="submit" disabled={busy}><Plus className="size-4" aria-hidden />{t('Add lesson')}</Button></div>
      </form>
    </Panel>
  );
}

function EditLesson({ m, lesson, change, onClose }: { m: LearningModuleDetail; lesson: LessonView; change: Change; onClose: () => void }) {
  const t = useT();
  const [title, setTitle] = useState(lesson.title);
  const [minutes, setMinutes] = useState(String(lesson.minutes));
  const [required, setRequired] = useState(lesson.required);
  const [allowDownload, setAllowDownload] = useState(lesson.allowDownload);
  const [body, setBody] = useState(lesson.body ?? '');
  const [transcript, setTranscript] = useState('');
  const [objectives, setObjectives] = useState(lesson.objectives.join('\n'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await change(() =>
        learningApi.updateLesson(m.id, lesson.id, {
          title: title.trim(),
          minutes: minutes ? Number(minutes) : null,
          required,
          allowDownload,
          objectives: objectives.split('\n').map((x) => x.trim()).filter((x) => x.length >= 2),
          ...(lesson.kind === 'TEXT' ? { body } : {}),
          ...(transcript.trim() ? { transcript: transcript.trim() } : {}),
        }),
      );
      onClose();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <form onSubmit={save} className="space-y-3">
          <DialogTitle className="text-lg font-semibold">{t('Edit lesson')}</DialogTitle>
          <DialogDescription className="sr-only">{lesson.title}</DialogDescription>
          <div className="space-y-1.5"><Label htmlFor="el-title">{t('Lesson title')}</Label><Input id="el-title" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} /></div>
          <div className="space-y-1.5"><Label htmlFor="el-min">{t('Minutes')}</Label><Input id="el-min" type="number" min={1} max={1000} value={minutes} onChange={(e) => setMinutes(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="el-obj">{t('Lesson objectives, one per line')}</Label><textarea id="el-obj" value={objectives} onChange={(e) => setObjectives(e.target.value)} rows={3} className="w-full rounded-md border bg-surface p-2 text-sm" /></div>
          {lesson.kind === 'TEXT' && <div className="space-y-1.5"><Label htmlFor="el-body">{t('Lesson text')}</Label><textarea id="el-body" value={body} onChange={(e) => setBody(e.target.value)} rows={10} className="w-full rounded-md border bg-surface p-2 text-sm" /></div>}
          {(lesson.kind === 'VIDEO' || lesson.kind === 'AUDIO') && (
            <div className="space-y-1.5">
              <Label htmlFor="el-tr">{t('Transcript (replaces the text used for questions)')}</Label>
              <textarea id="el-tr" value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={5} className="w-full rounded-md border bg-surface p-2 text-sm" />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="size-4" />{t('Required before the assessment')}</label>
          {lesson.file && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} className="size-4" />{t('Learners may download the file')}</label>}
          <ErrorLine error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
            <Button type="submit" disabled={busy}>{t('Save lesson')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Questions ─────────────

function QuestionCard({ q, i, m, busy, onEdit, onDelete, onApprove, onReject, selected, onSelect, onMove }: {
  q: QuestionView;
  i: number;
  m: LearningModuleDetail;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  selected: boolean;
  onSelect: (v: boolean) => void;
  onMove?: (d: -1 | 1) => void;
}) {
  const t = useT();
  const lesson = q.lessonId ? m.lessonList.find((l) => l.id === q.lessonId) : null;
  return (
    <article className={cn('rounded-2xl border bg-surface p-4', !q.approved && 'border-amber-300 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-950/20')} data-question-row={q.type} data-approved={q.approved}>
      <div className="flex items-start gap-3">
        {m.canEdit && <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={t('Select question {n}', { n: i + 1 })} className="mt-1 size-4" />}
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold">{i + 1}.</span>
            <Badge tone="primary">{t.maybe(QUESTION_TYPE_LABEL[q.type])}</Badge>
            <Badge>{t.maybe(QUESTION_DIFFICULTY_LABEL[q.difficulty])}</Badge>
            <span className="text-muted-foreground">{t.plural('learning.marks', q.marks)}</span>
            {q.manual && <Badge tone="accent">{t('Marked by a manager')}</Badge>}
            {q.source === 'GENERATED' && <Badge tone="warning"><Wand2 className="me-1 size-3" aria-hidden />{t('Drafted from the material')}</Badge>}
            {q.source === 'BANK' && <Badge><Library className="me-1 size-3" aria-hidden />{t('From the bank')}</Badge>}
            {lesson && <span className="text-muted-foreground">· {lesson.title}</span>}
          </div>
          <p className="whitespace-pre-wrap text-sm font-medium">{q.text}</p>
          {q.options.length > 0 && (
            <ul className="grid gap-1 sm:grid-cols-2">
              {q.options.map((o) => (
                <li key={o.id} className={cn('rounded-lg border px-2 py-1 text-xs', q.correctOptionIds.includes(o.id) && 'border-emerald-400 bg-emerald-50 font-semibold text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100')}>
                  {q.correctOptionIds.includes(o.id) && <Check className="me-1 inline size-3" aria-label={t('Right')} />}{o.text}
                </li>
              ))}
            </ul>
          )}
          {q.type === 'TRUE_FALSE' && q.correctBoolean !== null && <p className="text-xs">{t('Answer: {answer}', { answer: q.correctBoolean ? t('True') : t('False') })}</p>}
          {q.type === 'FILL_BLANK' && <p className="text-xs">{t('Answer: {answer}', { answer: q.blanks.map((b) => b.join(' / ')).join(' · ') })}</p>}
          {q.type === 'MATCHING' && <ul className="text-xs">{q.pairs.map((p) => <li key={p.id}>{p.left} → {p.right}</li>)}</ul>}
          {q.type === 'SHORT' && q.acceptedAnswers.length > 0 && <p className="text-xs">{t('Accepted: {answer}', { answer: q.acceptedAnswers.join(', ') })}</p>}
          {q.rubric && <p className="text-xs text-muted-foreground">{t('Marker looks for: {rubric}', { rubric: q.rubric })}</p>}
          {q.sourceExcerpt && <blockquote className="border-s-2 border-amber-400 ps-2 text-xs italic text-muted-foreground">{t('From the material: “{text}”', { text: q.sourceExcerpt })}</blockquote>}
        </div>
        {m.canEdit && (
          <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
            {onApprove && <Button size="sm" onClick={onApprove} disabled={busy} data-approve><Check className="size-4" aria-hidden />{t('Approve')}</Button>}
            {onReject && <Button size="sm" variant="outline" onClick={onReject} disabled={busy} data-reject><X className="size-4" aria-hidden />{t('Reject')}</Button>}
            {onMove && <Button size="icon" variant="ghost" onClick={() => onMove(-1)} disabled={busy} aria-label={t('Move up')}><ArrowUp className="size-4" aria-hidden /></Button>}
            {onMove && <Button size="icon" variant="ghost" onClick={() => onMove(1)} disabled={busy} aria-label={t('Move down')}><ArrowDown className="size-4" aria-hidden /></Button>}
            <Button size="icon" variant="ghost" onClick={onEdit} aria-label={t('Edit question')}><Pencil className="size-4" aria-hidden /></Button>
            <Button size="icon" variant="ghost" onClick={onDelete} disabled={busy} aria-label={t('Delete question')}><Trash2 className="size-4" aria-hidden /></Button>
          </div>
        )}
      </div>
    </article>
  );
}

function Questions({ m, busy, change, quiet }: { m: LearningModuleDetail; busy: boolean; change: Change; quiet: Change }) {
  const t = useT();
  const [editing, setEditing] = useState<QuestionView | null | 'new'>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bankOpen, setBankOpen] = useState(false);
  const [bankSaved, setBankSaved] = useState<number | null>(null);
  const drafts = m.questionList.filter((q) => !q.approved);
  const approved = m.questionList.filter((q) => q.approved);
  const toggle = (id: string, v: boolean) => setSelected((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; });
  const move = (i: number, d: -1 | 1) => {
    const ids = approved.map((q) => q.id);
    if (i + d < 0 || i + d >= ids.length) return;
    [ids[i], ids[i + d]] = [ids[i + d]!, ids[i]!];
    void quiet(() => learningApi.reorderQuestions(m.id, [...ids, ...drafts.map((q) => q.id)]));
  };
  const saveToBank = async () => {
    try {
      const out = await learningApi.saveToBank(m.id, [...selected]);
      setBankSaved(out.saved);
      setSelected(new Set());
    } catch {
      setBankSaved(null);
    }
  };
  return (
    <div className="space-y-5">
      {m.canEdit && <Generate m={m} busy={busy} change={change} />}
      {m.canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setEditing('new')} data-new-question><Plus className="size-4" aria-hidden />{t('Write a question')}</Button>
          <Button variant="outline" onClick={() => setBankOpen(true)}><Library className="size-4" aria-hidden />{t('Add from the question bank')}</Button>
          {selected.size > 0 && <Button variant="outline" onClick={saveToBank}><Save className="size-4" aria-hidden />{t('Save {n} to the bank', { n: selected.size })}</Button>}
          {bankSaved !== null && <span className="text-sm text-success" role="status">{t('{n} saved to the question bank', { n: bankSaved })}</span>}
        </div>
      )}

      {drafts.length > 0 && (
        <section className="space-y-3" data-review-queue>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-amber-500" aria-hidden />{t('Drafted questions to review ({n})', { n: drafts.length })}</h3>
            {m.canEdit && (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => quiet(() => learningApi.review(m.id, drafts.map((q) => q.id), true))} disabled={busy} data-approve-all><Check className="size-4" aria-hidden />{t('Approve all')}</Button>
                <Button size="sm" variant="outline" onClick={() => quiet(() => learningApi.review(m.id, drafts.map((q) => q.id), false))} disabled={busy}><X className="size-4" aria-hidden />{t('Reject all')}</Button>
              </div>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{t('Check each question against the material. Edit anything that is not right. Only approved questions are in the assessment.')}</p>
          {drafts.map((q, i) => (
            <QuestionCard key={q.id} q={q} i={i} m={m} busy={busy} selected={selected.has(q.id)} onSelect={(v) => toggle(q.id, v)} onEdit={() => setEditing(q)} onDelete={() => quiet(() => learningApi.removeQuestion(m.id, q.id))} onApprove={() => quiet(() => learningApi.review(m.id, [q.id], true))} onReject={() => quiet(() => learningApi.review(m.id, [q.id], false))} />
          ))}
        </section>
      )}

      <section className="space-y-3">
        <h3 className="font-semibold">{t('Assessment questions ({n})', { n: approved.length })} · {t.plural('learning.marks', approved.reduce((s, q) => s + q.marks, 0))}</h3>
        {approved.length ? (
          approved.map((q, i) => (
            <QuestionCard key={q.id} q={q} i={i} m={m} busy={busy} selected={selected.has(q.id)} onSelect={(v) => toggle(q.id, v)} onEdit={() => setEditing(q)} onDelete={() => quiet(() => learningApi.removeQuestion(m.id, q.id))} onMove={(d) => move(i, d)} />
          ))
        ) : (
          <EmptyState icon={ClipboardList} title={t('No questions yet')} body={t('Write questions yourself, or let SampForce draft them from the lesson text and review them.')} />
        )}
      </section>

      <QuestionEditor
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        question={editing === 'new' ? null : editing}
        lessons={m.lessonList}
        onSave={(input) => change(() => (editing && editing !== 'new' ? learningApi.updateQuestion(m.id, editing.id, input) : learningApi.addQuestion(m.id, input)))}
      />
      {bankOpen && <BankDialog m={m} change={change} onClose={() => setBankOpen(false)} />}
    </div>
  );
}

function Generate({ m, busy, change }: { m: LearningModuleDetail; busy: boolean; change: Change }) {
  const t = useT();
  const readable = m.lessonList.filter((l) => l.text.status === 'READY');
  const [types, setTypes] = useState<Set<GeneratableType>>(new Set(['MCQ', 'TRUE_FALSE', 'FILL_BLANK']));
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<QuestionDifficulty>('MEDIUM');
  const [fillSummary, setFillSummary] = useState(true);
  const [variant, setVariant] = useState(0);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const run = async () => {
    try {
      const out = (await change(() => learningApi.generate(m.id, { types: [...types], count, difficulty, fillSummary, variant }))) as GenerateResult;
      setResult(out);
      setVariant((v) => v + 1);
    } catch {
      setResult(null);
    }
  };
  return (
    <section className="overflow-hidden rounded-2xl border bg-surface" data-generate>
      <div className="flex flex-wrap items-center gap-3 bg-gradient-to-r from-violet-600 to-fuchsia-600 p-4 text-white">
        <Wand2 className="size-6" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{t('Create the assignment from the material')}</h3>
          <p className="text-xs text-white/85">{t('SampForce reads the lesson text, video captions and transcripts and drafts questions with rules, without AI. You review every question before it is used.')}</p>
        </div>
      </div>
      <div className="space-y-4 p-4">
        {readable.length ? (
          <p className="text-sm">{t('Readable lessons: {list}', { list: readable.map((l) => l.title).join(', ') })}</p>
        ) : (
          <p className="rounded-lg bg-amber-100 p-2 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">{t('No lesson has text SampForce could read yet. Add a document, a written lesson, a video with captions, or paste a transcript.')}</p>
        )}
        <fieldset className="flex flex-wrap gap-2">
          <legend className="mb-1 text-sm font-medium">{t('Question types')}</legend>
          {GENERATABLE_TYPES.map((ty) => (
            <label key={ty} className="lrn-option flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm">
              <input type="checkbox" checked={types.has(ty)} onChange={(e) => setTypes((s) => { const n = new Set(s); if (e.target.checked) n.add(ty); else n.delete(ty); return n; })} className="accent-violet-600" />
              {t.maybe(QUESTION_TYPE_LABEL[ty])}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5"><Label htmlFor="g-count">{t('How many')}</Label><Input id="g-count" type="number" min={1} max={40} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-24" /></div>
          <div className="space-y-1.5"><Label htmlFor="g-diff">{t('Difficulty')}</Label>
            <select id="g-diff" value={difficulty} onChange={(e) => setDifficulty(e.target.value as QuestionDifficulty)} className="h-10 rounded-md border bg-surface px-2 text-sm">
              {QUESTION_DIFFICULTIES.map((x) => <option key={x} value={x}>{t.maybe(QUESTION_DIFFICULTY_LABEL[x])}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={fillSummary} onChange={(e) => setFillSummary(e.target.checked)} className="size-4" />{t('Also fill empty key points and objectives')}</label>
          <Button onClick={run} disabled={busy || !readable.length || !types.size} className="ms-auto" data-run-generate><Wand2 className="size-4" aria-hidden />{busy ? t('Drafting…') : variant ? t('Draft more questions') : t('Draft questions')}</Button>
        </div>
        {result && (
          <div className="space-y-2 rounded-xl bg-muted/60 p-3 text-sm" role="status" data-generate-result>
            <p className="font-medium">{t.plural('learning.drafted', result.created.length)}{result.summaryFilled ? ` ${t('Key points and objectives were filled in.')}` : ''}</p>
            {result.note && <p className="text-muted-foreground">{t.maybe(result.note)}</p>}
            {result.skipped.length > 0 && (
              <ul className="list-disc ps-5 text-xs text-muted-foreground">{result.skipped.map((s) => <li key={s.lessonId}>{s.title}: {t.maybe(s.reason)}</li>)}</ul>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function BankDialog({ m, change, onClose }: { m: LearningModuleDetail; change: Change; onClose: () => void }) {
  const t = useT();
  const bank = useBank();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const list = (bank.data ?? []).filter((q) => q.text.toLowerCase().includes(search.toLowerCase()));
  const add = async () => {
    await change(() => learningApi.copyFromBank(m.id, [...chosen])).catch(() => undefined);
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogTitle className="text-lg font-semibold">{t('Question bank')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">{t('Questions saved from other modules. Copies are added; the bank keeps the original.')}</DialogDescription>
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search questions')} aria-label={t('Search questions')} className="my-3" />
        {bank.isLoading ? <Skeleton className="h-40" /> : list.length ? (
          <ul className="space-y-2">
            {list.map((q) => (
              <li key={q.id}>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm">
                  <input type="checkbox" checked={chosen.has(q.id)} onChange={(e) => setChosen((s) => { const n = new Set(s); if (e.target.checked) n.add(q.id); else n.delete(q.id); return n; })} className="mt-0.5 size-4" />
                  <span className="min-w-0"><span className="block font-medium">{q.text}</span><span className="text-xs text-muted-foreground">{t.maybe(QUESTION_TYPE_LABEL[q.type])} · {t.plural('learning.marks', q.marks)}</span></span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('The question bank is empty. Select questions in a module and save them to the bank.')}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>{t('Cancel')}</Button>
          <Button onClick={add} disabled={!chosen.size}>{t('Add {n} questions', { n: chosen.size })}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ───────────── Assign ─────────────

function Assign({ m }: { m: LearningModuleDetail }) {
  const t = useT();
  const qc = useQueryClient();
  const assignees = useAssignees();
  const rows = useModuleAssignments(m.id);
  const [search, setSearch] = useState('');
  const [users, setUsers] = useState<Set<string>>(new Set());
  const [workspaces, setWorkspaces] = useState<Set<string>>(new Set());
  const [levels, setLevels] = useState<Set<'MANAGER' | 'EXECUTIVE'>>(new Set());
  const [dueAt, setDueAt] = useState('');
  const [mandatory, setMandatory] = useState(m.mandatory);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const people = useMemo(() => assignees.data ?? [], [assignees.data]);
  const groups = useMemo(() => {
    const g = new Map<string, { id: string; name: string; count: number }>();
    for (const p of people) {
      const x = g.get(p.workspaceId) ?? { id: p.workspaceId, name: p.workspace, count: 0 };
      x.count++;
      g.set(p.workspaceId, x);
    }
    return [...g.values()];
  }, [people]);
  const shown = people.filter((p) => `${p.name} ${p.workspace}`.toLowerCase().includes(search.toLowerCase()));
  const flip = <T,>(set: Set<T>, v: T, on: boolean) => { const n = new Set(set); if (on) n.add(v); else n.delete(v); return n; };
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: [...LEARNING_KEY, 'module', m.id] });
    void qc.invalidateQueries({ queryKey: [...LEARNING_KEY, 'manage'] });
  };

  const assign = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const out = await learningApi.assign(m.id, {
        ...(users.size ? { userIds: [...users] } : {}),
        ...(workspaces.size ? { workspaceIds: [...workspaces] } : {}),
        ...(levels.size ? { levels: [...levels] } : {}),
        ...(dueAt ? { dueAt: new Date(`${dueAt}T23:59:00`).toISOString() } : {}),
        mandatory,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setDone(t('Assigned to {n} people.', { n: out.assigned }) + (out.already ? ` ${t('{n} already had it.', { n: out.already })}` : ''));
      setUsers(new Set());
      setWorkspaces(new Set());
      setLevels(new Set());
      void qc.invalidateQueries({ queryKey: [...LEARNING_KEY, 'module', m.id, 'assignments'] });
      refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const update = async (id: string, input: object) => {
    try {
      await learningApi.updateAssignment(id, input);
      void qc.invalidateQueries({ queryKey: [...LEARNING_KEY, 'module', m.id, 'assignments'] });
    } catch (e) {
      setError(e);
    }
  };
  const remove = async (id: string) => {
    try {
      await learningApi.removeAssignment(id);
      void qc.invalidateQueries({ queryKey: [...LEARNING_KEY, 'module', m.id, 'assignments'] });
      refresh();
    } catch (e) {
      setError(e);
    }
  };

  const count = users.size + workspaces.size + levels.size;
  return (
    <div className="grid gap-6 xl:grid-cols-[24rem_1fr]">
      <section className="lrn-tile space-y-4" data-assign-panel>
        <h3 className="font-semibold">{t('Assign this module')}</h3>
        {m.status !== 'PUBLISHED' ? (
          <p className="rounded-lg bg-amber-100 p-2 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">{t('Publish the module before assigning it.')}</p>
        ) : (
          <>
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">{t('Everyone at a level')}</legend>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['MANAGER', t('All managers')],
                    ['EXECUTIVE', t('All executives')],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="lrn-option flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm"><input type="checkbox" checked={levels.has(k)} onChange={(e) => setLevels((s) => flip(s, k, e.target.checked))} className="accent-violet-600" />{label}</label>
                ))}
              </div>
            </fieldset>
            {groups.length > 1 && (
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">{t('Whole workspaces')}</legend>
                <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
                  {groups.map((g) => (
                    <label key={g.id} className="lrn-option flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm"><input type="checkbox" checked={workspaces.has(g.id)} onChange={(e) => setWorkspaces((s) => flip(s, g.id, e.target.checked))} className="accent-violet-600" />{t.maybe(g.name)} <span className="text-xs text-muted-foreground">({g.count})</span></label>
                  ))}
                </div>
              </fieldset>
            )}
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">{t('People')}</legend>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('Search people')} aria-label={t('Search people')} />
              <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-1">
                {shown.map((p) => (
                  <li key={p.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                      <input type="checkbox" checked={users.has(p.id)} onChange={(e) => setUsers((s) => flip(s, p.id, e.target.checked))} className="size-4" data-assignee={p.name} />
                      <span className="min-w-0 flex-1 truncate">{p.name}</span>
                      <span className="text-xs text-muted-foreground">{t.maybe(p.workspace)}</span>
                    </label>
                  </li>
                ))}
                {!shown.length && <li className="p-2 text-sm text-muted-foreground">{t('Nobody found.')}</li>}
              </ul>
            </fieldset>
            <div className="space-y-1.5"><Label htmlFor="a-due">{t('Deadline (optional)')}</Label><Input id="a-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} className="size-4" />{t('Mandatory')}</label>
            <div className="space-y-1.5"><Label htmlFor="a-note">{t('Message to learners (optional)')}</Label><textarea id="a-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className="w-full rounded-md border bg-surface p-2 text-sm" /></div>
            <ErrorLine error={error} />
            {done && <p className="text-sm text-success" role="status">{done}</p>}
            <Button className="w-full" onClick={assign} disabled={busy || !count} data-assign><UserPlus className="size-4" aria-hidden />{t('Assign')}</Button>
          </>
        )}
      </section>
      <section className="space-y-3">
        <h3 className="font-semibold">{t('Assigned people ({n})', { n: rows.data?.length ?? 0 })}</h3>
        {rows.isLoading ? <Skeleton className="h-40" /> : rows.data?.length ? (
          <div className="overflow-x-auto rounded-2xl border bg-surface">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-3 text-start">{t('Person')}</th>
                  <th className="p-3 text-start">{t('Status')}</th>
                  <th className="p-3 text-end">{t('Progress')}</th>
                  <th className="p-3 text-end">{t('Best score')}</th>
                  <th className="p-3 text-end">{t('Attempts')}</th>
                  <th className="p-3 text-start">{t('Deadline')}</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.data.map((a) => (
                  <tr key={a.id} data-assignment-row={a.user.name}>
                    <td className="p-3"><p className="font-medium">{a.user.name}</p><p className="text-xs text-muted-foreground">{a.user.workspace ? t.maybe(a.user.workspace) : ''}</p></td>
                    <td className="p-3"><StatusBadge status={a.status} overdue={a.overdue} /></td>
                    <td className="p-3 text-end tabular-nums">{a.progress}%</td>
                    <td className="p-3 text-end tabular-nums">{pct(a.bestScore)}</td>
                    <td className="p-3 text-end tabular-nums">{a.attemptsUsed}/{a.attemptsAllowed}</td>
                    <td className="p-3">
                      <input type="date" aria-label={t('Deadline for {name}', { name: a.user.name })} defaultValue={a.dueAt?.slice(0, 10) ?? ''} onBlur={(e) => { const v = e.target.value; if (v !== (a.dueAt?.slice(0, 10) ?? '')) void update(a.id, { dueAt: v ? new Date(`${v}T23:59:00`).toISOString() : null }); }} className="h-8 rounded-md border bg-surface px-1 text-xs" />
                    </td>
                    <td className="p-3">
                      <div className="flex justify-end gap-1">
                        {a.status === 'FAILED' && a.attemptsUsed >= a.attemptsAllowed && (
                          <Button size="sm" variant="outline" onClick={() => update(a.id, { extraAttempts: a.attemptsAllowed - m.maxAttempts + 1 })} data-extra-attempt>{t('One more attempt')}</Button>
                        )}
                        <Button size="icon" variant="ghost" onClick={() => remove(a.id)} aria-label={t('Remove {name}', { name: a.user.name })}><Trash2 className="size-4" aria-hidden /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={UserPlus} title={t('Not assigned to anyone yet')} />
        )}
      </section>
    </div>
  );
}

'use client';

import { LEARNING_MODULE_STATUS_LABEL, type LearningManageView } from '@dealflow/types';
import { Badge, Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Label, Skeleton } from '@dealflow/ui';
import { AlertTriangle, Award, BarChart3, BookOpen, CheckCircle2, ClipboardCheck, FileSpreadsheet, Layers, Plus, Settings2, Target, Users, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { downloadFile } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { learningApi, useCategories, useLearningReport, useManage } from '@/lib/learning';
import { Bar, CategoryChip, dateText, EmptyState, ErrorLine, LevelBadge, pct, Ring, StatTile, StatusBadge } from './bits';

type Tab = 'modules' | 'people' | 'workspaces' | 'reports';

const STATUS_TONE = { DRAFT: 'warning', PUBLISHED: 'success', ARCHIVED: 'neutral' } as const;

/** The manager and Super Workspace dashboard: modules, people, workspaces and the report. */
export function ManageHome() {
  const t = useT();
  const q = useManage();
  const [tab, setTab] = useState<Tab>('modules');
  const [creating, setCreating] = useState(false);
  if (q.isLoading) return <Skeleton className="h-[30rem] rounded-3xl" />;
  if (q.error || !q.data) {
    return <EmptyState icon={AlertTriangle} title={t('Learning management is for Super and Manager Workspaces')} body={t('You can take your own learning on the My learning page.')} action={<Button asChild><Link href="/app/learning">{t('My learning')}</Link></Button>} />;
  }
  const v = q.data;
  const s = v.stats;
  return (
    <div className="space-y-6" data-learning-manage>
      <section className="lrn-hero p-6 sm:p-8" data-tone="manage">
        <div className="relative z-10 flex flex-wrap items-center gap-6">
          <Ring percent={s.completionPercent} size={120} caption={t('Completion')} light />
          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-white/80">{v.level === 'SUPER' ? t('Super Workspace') : t('Manager Workspace')}</p>
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{t('Learning management')}</h2>
            <p className="max-w-xl text-sm text-white/85">{t('{people} people learning · {done} completed · {overdue} overdue · average score {avg}', { people: s.assignedPeople, done: s.completed, overdue: s.overdue, avg: pct(s.averageScore) })}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {v.canCreate && (
              <Button onClick={() => setCreating(true)} className="bg-white text-teal-800 hover:bg-white/90" data-new-module>
                <Plus className="size-4" aria-hidden /> {t('New module')}
              </Button>
            )}
            <Button asChild variant="outline" className="border-white/40 bg-white/10 text-white hover:bg-white/20">
              <Link href="/app/learning/marking"><ClipboardCheck className="size-4" aria-hidden />{t('Marking')}{v.marking > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-xs font-bold text-amber-950">{v.marking}</span>}</Link>
            </Button>
            <Button asChild variant="outline" className="border-white/40 bg-white/10 text-white hover:bg-white/20">
              <Link href="/app/learning/certificates"><Award className="size-4" aria-hidden />{t('Certificates')}</Link>
            </Button>
            {v.canConfigure && (
              <Button asChild variant="outline" className="border-white/40 bg-white/10 text-white hover:bg-white/20">
                <Link href="/app/learning/settings"><Settings2 className="size-4" aria-hidden />{t('Settings')}</Link>
              </Button>
            )}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile icon={Layers} label={t('Modules')} value={s.modules} hint={t('{published} published · {drafts} drafts', { published: s.published, drafts: s.drafts })} from="#0d9488" to="#0ea5e9" />
        <StatTile icon={Users} label={t('People assigned')} value={s.assignedPeople} hint={t('{n} started', { n: s.started })} from="#6366f1" to="#8b5cf6" />
        <StatTile icon={CheckCircle2} label={t('Completed')} value={s.completed} hint={t('{n} passed', { n: s.passed })} from="#10b981" to="#14b8a6" />
        <StatTile icon={AlertTriangle} label={t('Overdue')} value={s.overdue} hint={t('{n} pending', { n: s.pending })} from="#ef4444" to="#f97316" />
        <StatTile icon={XCircle} label={t('Failed')} value={s.failed} from="#f43f5e" to="#db2777" />
        <StatTile icon={ClipboardCheck} label={t('Awaiting marking')} value={s.awaitingMarking} from="#f59e0b" to="#eab308" />
        <StatTile icon={Target} label={t('Average score')} value={pct(s.averageScore)} from="#0ea5e9" to="#6366f1" />
        <StatTile icon={Award} label={t('Certificates issued')} value={s.certificates} from="#a855f7" to="#ec4899" />
      </div>

      <div role="tablist" className="flex flex-wrap gap-2">
        {(
          [
            ['modules', t('Modules'), BookOpen],
            ['people', t('People'), Users],
            ['workspaces', t('Workspaces and categories'), BarChart3],
            ['reports', t('Reports'), FileSpreadsheet],
          ] as const
        ).map(([key, label, Icon]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={cn('inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium', tab === key ? 'border-transparent bg-gradient-to-r from-teal-600 to-indigo-600 text-white shadow' : 'hover:bg-muted')}>
            <Icon className="size-4" aria-hidden /> {label}
          </button>
        ))}
      </div>

      {tab === 'modules' && <ModulesTable v={v} onCreate={() => setCreating(true)} />}
      {tab === 'people' && <PeopleTable v={v} />}
      {tab === 'workspaces' && <Breakdown v={v} />}
      {tab === 'reports' && <Reports v={v} />}
      <NewModuleDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function ModulesTable({ v, onCreate }: { v: LearningManageView; onCreate: () => void }) {
  const t = useT();
  if (!v.modules.length)
    return <EmptyState icon={BookOpen} title={t('No modules yet')} body={t('Create a module from a video link, documents or written lessons, then assign it to your team.')} action={v.canCreate ? <Button onClick={onCreate}><Plus className="size-4" aria-hidden />{t('New module')}</Button> : undefined} />;
  return (
    <div className="overflow-x-auto rounded-2xl border bg-surface">
      <table className="w-full min-w-[56rem] text-sm">
        <thead className="bg-muted/50 text-start text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="p-3 text-start">{t('Module')}</th>
            <th className="p-3 text-start">{t('Status')}</th>
            <th className="p-3 text-end">{t('Lessons')}</th>
            <th className="p-3 text-end">{t('Questions')}</th>
            <th className="p-3 text-end">{t('Assigned')}</th>
            <th className="p-3 text-start">{t('Completion')}</th>
            <th className="p-3 text-end">{t('Average score')}</th>
            <th className="p-3 text-end">{t('Overdue')}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {v.modules.map((m) => {
            const done = m.stats.assigned ? Math.round((m.stats.completed / m.stats.assigned) * 100) : 0;
            return (
              <tr key={m.id} className="hover:bg-muted/30" data-module-row={m.number}>
                <td className="p-3">
                  <Link href={`/app/learning/manage/${m.id}`} className="font-medium hover:underline">{m.title}</Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{m.number}</span>
                    <CategoryChip category={m.category} />
                    <LevelBadge level={m.level} />
                    {m.mandatory && <Badge tone="critical">{t('Mandatory')}</Badge>}
                    {m.ownerWorkspace && <span>{t.maybe(m.ownerWorkspace)}</span>}
                  </div>
                </td>
                <td className="p-3">
                  <Badge tone={STATUS_TONE[m.status]}>{t.maybe(LEARNING_MODULE_STATUS_LABEL[m.status])}</Badge>
                  {m.pendingQuestions > 0 && <p className="mt-1 text-xs text-amber-600">{t('{n} to review', { n: m.pendingQuestions })}</p>}
                </td>
                <td className="p-3 text-end tabular-nums">{m.lessons}</td>
                <td className="p-3 text-end tabular-nums">{m.questions}</td>
                <td className="p-3 text-end tabular-nums">{m.stats.assigned}</td>
                <td className="w-40 p-3">
                  <div className="flex items-center gap-2"><Bar percent={done} label={t('Completion')} className="flex-1" /><span className="w-9 text-end text-xs tabular-nums">{done}%</span></div>
                </td>
                <td className="p-3 text-end tabular-nums">{pct(m.stats.averageScore)}</td>
                <td className={cn('p-3 text-end tabular-nums', m.stats.overdue > 0 && 'font-semibold text-critical')}>{m.stats.overdue}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PeopleTable({ v }: { v: LearningManageView }) {
  const t = useT();
  if (!v.people.length) return <EmptyState icon={Users} title={t('Nobody has learning assigned yet')} />;
  const sorted = [...v.people].sort((a, b) => (b.averageScore ?? -1) - (a.averageScore ?? -1));
  return (
    <div className="overflow-x-auto rounded-2xl border bg-surface">
      <table className="w-full min-w-[48rem] text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="p-3 text-start">{t('Person')}</th>
            <th className="p-3 text-end">{t('Assigned')}</th>
            <th className="p-3 text-end">{t('Completed')}</th>
            <th className="p-3 text-end">{t('Overdue')}</th>
            <th className="p-3 text-end">{t('Failed')}</th>
            <th className="p-3 text-end">{t('Average score')}</th>
            <th className="p-3 text-end">{t('Certificates')}</th>
            <th className="p-3 text-end">{t('Learning time')}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {sorted.map((p, i) => (
            <tr key={p.user.id} data-person-row={p.user.name}>
              <td className="p-3">
                <div className="flex items-center gap-2">
                  <span className={cn('grid size-7 place-items-center rounded-full text-xs font-bold', i === 0 ? 'bg-amber-400 text-amber-950' : i === 1 ? 'bg-slate-300 text-slate-800' : i === 2 ? 'bg-orange-300 text-orange-950' : 'bg-muted')}>{i + 1}</span>
                  <div>
                    <p className="font-medium">{p.user.name}</p>
                    <p className="text-xs text-muted-foreground">{p.user.workspace ? t.maybe(p.user.workspace) : ''}</p>
                  </div>
                </div>
              </td>
              <td className="p-3 text-end tabular-nums">{p.assigned}</td>
              <td className="p-3 text-end tabular-nums">{p.completed}</td>
              <td className={cn('p-3 text-end tabular-nums', p.overdue > 0 && 'font-semibold text-critical')}>{p.overdue}</td>
              <td className="p-3 text-end tabular-nums">{p.failed}</td>
              <td className="p-3 text-end tabular-nums">{pct(p.averageScore)}</td>
              <td className="p-3 text-end tabular-nums">{p.certificates}</td>
              <td className="p-3 text-end tabular-nums">{t('{n} min', { n: p.minutes })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Breakdown({ v }: { v: LearningManageView }) {
  const t = useT();
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="lrn-tile space-y-3">
        <h3 className="font-semibold">{t('By workspace')}</h3>
        {v.byWorkspace.length ? (
          <ul className="space-y-3">
            {v.byWorkspace.map((w) => (
              <li key={w.workspace} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{t.maybe(w.workspace)}</span>
                  <span className="text-xs text-muted-foreground">{t('{people} people · average {avg} · {overdue} overdue', { people: w.people, avg: pct(w.averageScore), overdue: w.overdue })}</span>
                </div>
                <Bar percent={w.completionPercent} label={t.maybe(w.workspace)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('Nothing assigned yet.')}</p>
        )}
      </section>
      <section className="lrn-tile space-y-3">
        <h3 className="font-semibold">{t('By category')}</h3>
        {v.byCategory.length ? (
          <ul className="space-y-3">
            {v.byCategory.map((c) => (
              <li key={c.category} className="space-y-1">
                <div className="flex justify-between text-sm">
                  <span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: c.color }} aria-hidden />{t.maybe(c.category)}</span>
                  <span className="text-xs text-muted-foreground">{t('{n} modules · average {avg}', { n: c.modules, avg: pct(c.averageScore) })}</span>
                </div>
                <Bar percent={c.completionPercent} label={t.maybe(c.category)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t('No modules yet.')}</p>
        )}
      </section>
    </div>
  );
}

function Reports({ v }: { v: LearningManageView }) {
  const t = useT();
  const categories = useCategories();
  const [f, setF] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const query = Object.fromEntries(Object.entries(f).filter(([, x]) => x).map(([k, x]) => [k, k === 'from' ? new Date(`${x}T00:00:00`).toISOString() : k === 'to' ? new Date(`${x}T23:59:59`).toISOString() : x]));
  const r = useLearningReport(query);
  const set = (k: string, x: string) => setF((s) => ({ ...s, [k]: x }));
  const exportXlsx = async () => {
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams(query);
      await downloadFile(`/learning/reports/export${qs.size ? `?${qs}` : ''}`, 'learning-report.xlsx');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const select = 'h-9 rounded-md border bg-surface px-2 text-sm';
  return (
    <div className="space-y-4" data-learning-reports>
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-surface p-4">
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">{t('Module')}</span>
          <select className={select} value={f.moduleId ?? ''} onChange={(e) => set('moduleId', e.target.value)}>
            <option value="">{t('All modules')}</option>
            {v.modules.map((m) => <option key={m.id} value={m.id}>{m.number} · {m.title}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">{t('Category')}</span>
          <select className={select} value={f.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="">{t('All categories')}</option>
            {categories.data?.map((c) => <option key={c.id} value={c.id}>{t.maybe(c.name)}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">{t('Person')}</span>
          <select className={select} value={f.userId ?? ''} onChange={(e) => set('userId', e.target.value)}>
            <option value="">{t('Everyone')}</option>
            {v.people.map((p) => <option key={p.user.id} value={p.user.id}>{p.user.name}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">{t('Status')}</span>
          <select className={select} value={f.status ?? ''} onChange={(e) => set('status', e.target.value)}>
            <option value="">{t('Any status')}</option>
            <option value="NOT_STARTED">{t('Not started')}</option>
            <option value="IN_PROGRESS">{t('In progress')}</option>
            <option value="AWAITING_MARKING">{t('Awaiting marking')}</option>
            <option value="COMPLETED">{t('Completed')}</option>
            <option value="FAILED">{t('Failed')}</option>
            <option value="OVERDUE">{t('Overdue')}</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">{t('Result')}</span>
          <select className={select} value={f.result ?? ''} onChange={(e) => set('result', e.target.value)}>
            <option value="">{t('Any result')}</option>
            <option value="PASSED">{t('Passed')}</option>
            <option value="FAILED">{t('Failed')}</option>
            <option value="PENDING">{t('Pending')}</option>
          </select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">{t('From')}</span>
          <input type="date" className={select} value={f.from ?? ''} onChange={(e) => set('from', e.target.value)} />
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          <span className="block">{t('To')}</span>
          <input type="date" className={select} value={f.to ?? ''} onChange={(e) => set('to', e.target.value)} />
        </label>
        <Button className="ms-auto" onClick={exportXlsx} disabled={busy} data-export-xlsx>
          <FileSpreadsheet className="size-4" aria-hidden /> {busy ? t('Preparing…') : t('Export to Excel')}
        </Button>
      </div>
      <ErrorLine error={error ?? r.error} />
      {r.isLoading ? (
        <Skeleton className="h-60 rounded-2xl" />
      ) : r.data?.length ? (
        <div className="overflow-x-auto rounded-2xl border bg-surface">
          <table className="w-full min-w-[60rem] text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-3 text-start">{t('Person')}</th>
                <th className="p-3 text-start">{t('Module')}</th>
                <th className="p-3 text-start">{t('Status')}</th>
                <th className="p-3 text-end">{t('Progress')}</th>
                <th className="p-3 text-end">{t('Attempts')}</th>
                <th className="p-3 text-end">{t('Best score')}</th>
                <th className="p-3 text-start">{t('Deadline')}</th>
                <th className="p-3 text-start">{t('Completed')}</th>
                <th className="p-3 text-start">{t('Certificate')}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {r.data.map((row) => {
                const a = row.assignment;
                return (
                  <tr key={a.id}>
                    <td className="p-3"><p className="font-medium">{a.user.name}</p><p className="text-xs text-muted-foreground">{a.user.workspace ? t.maybe(a.user.workspace) : ''}{row.manager ? ` · ${t.maybe(row.manager)}` : ''}</p></td>
                    <td className="p-3"><p>{a.moduleTitle}</p><p className="font-mono text-xs text-muted-foreground">{a.moduleNumber}</p></td>
                    <td className="p-3"><StatusBadge status={a.status} overdue={a.overdue} /></td>
                    <td className="p-3 text-end tabular-nums">{a.progress}%</td>
                    <td className="p-3 text-end tabular-nums">{a.attemptsUsed}/{a.attemptsAllowed}</td>
                    <td className="p-3 text-end tabular-nums">{pct(a.bestScore)}</td>
                    <td className="p-3">{dateText(a.dueAt)}</td>
                    <td className="p-3">{dateText(a.completedAt)}</td>
                    <td className="p-3 text-xs">{row.certificateNumber ?? (row.certificateStatus === 'NOT_ELIGIBLE' ? t('No certificate') : t('Not yet'))}{row.certificateStatus === 'REVOKED' && <Badge tone="critical" className="ms-1">{t('Revoked')}</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState icon={FileSpreadsheet} title={t('No assignments match these filters')} />
      )}
    </div>
  );
}

function NewModuleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const router = useRouter();
  const categories = useCategories();
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const m = await learningApi.createModule({ title: title.trim(), ...(categoryId ? { categoryId } : {}) });
      router.push(`/app/learning/manage/${m.id}`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={create} className="space-y-4">
          <DialogTitle className="text-lg font-semibold">{t('New learning module')}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{t('Give it a title. You add lessons, questions and settings next.')}</DialogDescription>
          <div className="space-y-1.5">
            <Label htmlFor="lrn-new-title">{t('Title')}</Label>
            <Input id="lrn-new-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required minLength={3} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lrn-new-cat">{t('Category')}</Label>
            <select id="lrn-new-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="h-10 w-full rounded-md border bg-surface px-2 text-sm">
              <option value="">{t('No category')}</option>
              {categories.data?.map((c) => <option key={c.id} value={c.id}>{t.maybe(c.name)}</option>)}
            </select>
          </div>
          <ErrorLine error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t('Cancel')}</Button>
            <Button type="submit" disabled={busy || title.trim().length < 3}>{busy ? t('Creating…') : t('Create module')}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

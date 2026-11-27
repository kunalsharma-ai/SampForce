'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import { ASSIGNED_TASK_PRIORITIES, type AssignedTaskPriority, type AssignedTaskRow, type AssignedTasksView, TASK_PROGRESS_LABEL, TASK_REACTIONS, type TaskProgress, WORKSPACE_LEVEL_LABEL } from '@dealflow/types';
import { AlertTriangle, CalendarClock, Eye, MessageSquare, OctagonAlert, Play, Plus, SmilePlus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { useT } from '@/lib/i18n';
import { useAssignedTask, useAssignedTaskMutations, useAssignedTasks } from '@/lib/workspace-work';

const PRIORITY_LABEL: Record<AssignedTaskPriority, string> = { HIGH: 'High priority', NORMAL: 'Normal priority', LOW: 'Low priority' };
const STATUS_LABEL = { OPEN: 'Open', DONE: 'Done', CANCELED: 'Cancelled' } as const;
const PROGRESS_TONE: Record<TaskProgress, 'neutral' | 'primary' | 'success' | 'critical'> = { NEW: 'neutral', ACKNOWLEDGED: 'primary', IN_PROGRESS: 'success', BLOCKED: 'critical' };

/** Where an open task stands (redesign R7): not acknowledged, acknowledged, in progress or blocked. */
function ProgressBadge({ progress }: { progress: TaskProgress }) {
  const t = useT();
  return (
    <Badge tone={PROGRESS_TONE[progress]} data-progress={progress}>
      {progress === 'BLOCKED' && <OctagonAlert className="size-3" aria-hidden />}
      {t.maybe(TASK_PROGRESS_LABEL[progress])}
    </Badge>
  );
}

function when(t: ReturnType<typeof useT>, iso: string, time = true): string {
  return new Date(iso).toLocaleString(t.formatLocale, time ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}

/** One task, styled by urgency: high priority is bold with a strong edge, overdue is marked in the critical colour. */
export function TaskCard({ task, onOpen }: { task: AssignedTaskRow; onOpen: (id: string) => void }) {
  const t = useT();
  const high = task.priority === 'HIGH' && task.status === 'OPEN';
  const edge = task.overdue ? 'border-s-critical' : high ? 'border-s-warning' : 'border-s-border';
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(task.id)}
        data-task={task.title}
        className={`w-full rounded-md border border-border border-s-4 ${edge} p-3 text-start transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className={`text-sm ${high ? 'font-bold' : 'font-medium'} ${task.status === 'DONE' ? 'line-through' : ''}`}>{task.title}</span>
          {high && <Badge tone="warning">{t('High priority')}</Badge>}
          {task.priority === 'LOW' && task.status === 'OPEN' && <Badge>{t('Low priority')}</Badge>}
          {task.overdue && (
            <Badge tone="critical">
              <AlertTriangle className="size-3" aria-hidden />
              {t('Overdue')}
            </Badge>
          )}
          {task.status === 'OPEN' && <ProgressBadge progress={task.progress} />}
          {task.status !== 'OPEN' && <Badge tone={task.status === 'DONE' ? 'success' : 'neutral'}>{t.maybe(STATUS_LABEL[task.status])}</Badge>}
        </span>
        {task.status === 'OPEN' && task.progress === 'BLOCKED' && task.blockedReason && (
          <span className="mt-1 block text-xs text-critical">{t('Blocked: {reason}', { reason: task.blockedReason })}</span>
        )}
        <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          {task.dueAt && (
            <span className={task.overdue ? 'font-medium text-critical' : ''}>
              <CalendarClock className="me-1 inline size-3" aria-hidden />
              {t('Due {date}', { date: when(t, task.dueAt) })}
            </span>
          )}
          <span>{t('From {name}', { name: task.createdBy?.name ?? '—' })}</span>
          <span>{t('To {name}', { name: task.assignee?.name ?? task.workspace.name })}</span>
          {task.comments > 0 && (
            <span>
              <MessageSquare className="me-1 inline size-3" aria-hidden />
              {task.comments}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/** The tasks page: tasks for me, tasks I handed down, a new task form and the task's own view. */
export function TasksBoard() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const open = params.get('task');
  const tasks = useAssignedTasks();
  const [tab, setTab] = useState<'forMe' | 'byMe'>('forMe');
  const [creating, setCreating] = useState(false);
  const show = (id: string | null) => router.replace(id ? `/app/tasks?tab=oneoff&task=${id}` : '/app/tasks?tab=oneoff', { scroll: false });

  if (tasks.isPending) return <Skeleton className="h-64" />;
  if (tasks.error) return <ErrorText error={tasks.error} />;
  const data = tasks.data;
  const canAssign = data.assignable.length > 0;
  const list = tab === 'forMe' ? data.forMe : data.byMe;
  const openCount = (rows: AssignedTaskRow[]) => rows.filter((r) => r.status === 'OPEN').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label={t('Tasks')} className="flex gap-1 rounded-md border border-border p-1">
          {(['forMe', 'byMe'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={`rounded px-3 py-1.5 text-sm ${tab === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
            >
              {k === 'forMe' ? t('For me ({count} open)', { count: openCount(data.forMe) }) : t('Assigned by me ({count} open)', { count: openCount(data.byMe) })}
            </button>
          ))}
        </div>
        {canAssign && (
          <Button className="ms-auto" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            {t('New task')}
          </Button>
        )}
      </div>
      <Card>
        <CardContent className="pt-6">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tab === 'forMe' ? t('No tasks for you.') : t('You have not assigned any tasks.')}</p>
          ) : (
            <ul className="space-y-2" aria-label={tab === 'forMe' ? t('Tasks for me') : t('Tasks I assigned')}>
              {list.map((task) => (
                <TaskCard key={task.id} task={task} onOpen={show} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {creating && <NewTaskDialog assignable={data.assignable} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setTab('byMe'); show(id); }} />}
      {open && <TaskDialog id={open} onClose={() => show(null)} />}
    </div>
  );
}

/** "Tasks for you" on the dashboard: open tasks handed down to the person, the urgent ones first. */
export function TasksForYou() {
  const t = useT();
  const router = useRouter();
  const tasks = useAssignedTasks();
  const open = tasks.data?.forMe.filter((r) => r.status === 'OPEN') ?? [];
  if (!tasks.data || open.length === 0) return null;
  return (
    <Card className="border-primary/40" data-tasks-for-you>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>{t('Tasks for you')}</CardTitle>
          <CardDescription>{t('Handed down by the workspace above yours. Open one to comment or mark it done.')}</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => router.push('/app/tasks?tab=oneoff')}>
          {t('All tasks')}
        </Button>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 md:grid-cols-2">
          {open.slice(0, 6).map((task) => (
            <TaskCard key={task.id} task={task} onOpen={(id) => router.push(`/app/tasks?task=${id}`)} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function NewTaskDialog({ assignable, onClose, onCreated }: { assignable: AssignedTasksView['assignable']; onClose: () => void; onCreated: (id: string) => void }) {
  const t = useT();
  const { create } = useAssignedTaskMutations();
  const [f, setF] = useState({ title: '', description: '', workspaceId: assignable[0]?.id ?? '', assigneeUserId: '', priority: 'NORMAL' as AssignedTaskPriority, due: '' });
  const ws = assignable.find((w) => w.id === f.workspaceId);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">{t('New task')}</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">{t('The person is told at once, and again whenever you change the task.')}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(
              {
                title: f.title,
                ...(f.description.trim() ? { description: f.description } : {}),
                workspaceId: f.workspaceId,
                ...(f.assigneeUserId ? { assigneeUserId: f.assigneeUserId } : {}),
                priority: f.priority,
                ...(f.due ? { dueAt: new Date(f.due).toISOString() } : {}),
              },
              { onSuccess: (task) => onCreated(task.id) },
            );
          }}
        >
          <Field id="nt-title" label={t('Title')}>
            <Input id="nt-title" required minLength={2} maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <Field id="nt-description" label={t('Description')}>
            <Textarea id="nt-description" rows={3} maxLength={4000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="nt-workspace" label={t('Workspace')}>
              <Select id="nt-workspace" value={f.workspaceId} onChange={(e) => setF({ ...f, workspaceId: e.target.value, assigneeUserId: '' })}>
                {assignable.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} · {t.maybe(WORKSPACE_LEVEL_LABEL[w.level])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="nt-person" label={t('Person')}>
              <Select id="nt-person" value={f.assigneeUserId} onChange={(e) => setF({ ...f, assigneeUserId: e.target.value })}>
                <option value="">{ws && ws.people.length === 1 ? ws.people[0]!.name : t('Everyone in the workspace')}</option>
                {ws && ws.people.length > 1 && ws.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="nt-priority" label={t('Priority')}>
              <Select id="nt-priority" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as AssignedTaskPriority })}>
                {ASSIGNED_TASK_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t.maybe(PRIORITY_LABEL[p])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="nt-due" label={t('Due')}>
              <Input id="nt-due" type="datetime-local" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />
            </Field>
          </div>
          <ErrorText error={create.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending || !f.workspaceId}>
              {create.isPending ? t('Saving…') : t('Assign task')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const FIELD_LABEL: Record<string, string> = { title: 'Title', description: 'Description', priority: 'Priority', dueAt: 'Due', status: 'Status', progress: 'Progress', blockedReason: 'Blocked because' };

/** The assignee's buttons for where the task stands; blocking asks what is in the way. */
function ProgressControls({ id, progress }: { id: string; progress: TaskProgress }) {
  const t = useT();
  const { progress: save } = useAssignedTaskMutations();
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3" data-task-progress>
      <p className="text-xs font-medium text-muted-foreground">{t('Where does it stand?')}</p>
      <div className="flex flex-wrap gap-2">
        {progress === 'NEW' && (
          <Button size="sm" variant="outline" onClick={() => save.mutate({ id, input: { progress: 'ACKNOWLEDGED' } })} disabled={save.isPending}>
            <Eye className="size-4" aria-hidden />
            {t('Acknowledge')}
          </Button>
        )}
        {progress !== 'IN_PROGRESS' && (
          <Button size="sm" variant="outline" onClick={() => save.mutate({ id, input: { progress: 'IN_PROGRESS' } })} disabled={save.isPending}>
            <Play className="size-4" aria-hidden />
            {t('Start working')}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setBlocking((b) => !b)} aria-expanded={blocking}>
          <OctagonAlert className="size-4" aria-hidden />
          {t('I’m blocked')}
        </Button>
      </div>
      {blocking && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim()) save.mutate({ id, input: { progress: 'BLOCKED', reason } }, { onSuccess: () => { setBlocking(false); setReason(''); } });
          }}
        >
          <Input aria-label={t('What is blocking it?')} placeholder={t('What is blocking it?')} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          <Button type="submit" size="sm" disabled={save.isPending || !reason.trim()}>
            {t('Tell them')}
          </Button>
        </form>
      )}
      <ErrorText error={save.error} />
    </div>
  );
}

/** Quick reactions under a comment: the ones given, with who gave them, and a picker for more. */
function CommentReactions({ id, comment }: { id: string; comment: { id: string; reactions: { emoji: (typeof TASK_REACTIONS)[number]; count: number; mine: boolean; names: string[] }[] } }) {
  const t = useT();
  const { react } = useAssignedTaskMutations();
  const [open, setOpen] = useState(false);
  const toggle = (emoji: (typeof TASK_REACTIONS)[number]) => react.mutate({ id, commentId: comment.id, emoji });
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1" data-reactions>
      {comment.reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => toggle(r.emoji)}
          aria-pressed={r.mine}
          title={r.names.join(', ')}
          aria-label={t('{emoji} by {names}', { emoji: r.emoji, names: r.names.join(', ') })}
          className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors ${r.mine ? 'border-primary bg-primary/10 text-foreground' : 'border-border bg-surface hover:bg-muted'}`}
        >
          <span aria-hidden>{r.emoji}</span>
          {r.count}
        </button>
      ))}
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t('Add a reaction')} className="inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
        <SmilePlus className="size-3.5" aria-hidden />
      </button>
      {open && (
        <span role="group" aria-label={t('Reactions')} className="inline-flex gap-0.5 rounded-full border border-border bg-surface px-1 shadow-sm">
          {TASK_REACTIONS.map((e) => (
            <button key={e} type="button" className="size-7 rounded-full text-base hover:bg-muted" aria-label={t('React with {emoji}', { emoji: e })} onClick={() => { toggle(e); setOpen(false); }}>
              {e}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

function TaskDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const task = useAssignedTask(id);
  const { update, comment } = useAssignedTaskMutations();
  const [body, setBody] = useState('');
  const d = task.data;
  const value = (field: string, v: string | null) => {
    if (v === null) return '—';
    if (field === 'dueAt') return when(t, v);
    if (field === 'priority') return t.maybe(PRIORITY_LABEL[v as AssignedTaskPriority] ?? v);
    if (field === 'status') return t.maybe(STATUS_LABEL[v as keyof typeof STATUS_LABEL] ?? v);
    if (field === 'progress') return t.maybe(TASK_PROGRESS_LABEL[v as TaskProgress] ?? v);
    return v;
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto p-6">
        {!d ? (
          <>
            <DialogTitle className="sr-only">{t('Task')}</DialogTitle>
            {task.error ? <ErrorText error={task.error} /> : <Skeleton className="h-40" />}
          </>
        ) : (
          <div className="space-y-5" data-task-detail>
            <div>
              <DialogTitle className={`text-lg ${d.priority === 'HIGH' ? 'font-bold' : 'font-semibold'}`}>{d.title}</DialogTitle>
              <DialogDescription className="mt-1 flex flex-wrap gap-2 text-sm text-muted-foreground">
                <Badge tone={d.priority === 'HIGH' ? 'warning' : 'neutral'}>{t.maybe(PRIORITY_LABEL[d.priority])}</Badge>
                <Badge tone={d.status === 'DONE' ? 'success' : d.overdue ? 'critical' : 'neutral'}>{d.overdue ? t('Overdue') : t.maybe(STATUS_LABEL[d.status])}</Badge>
                {d.status === 'OPEN' && <ProgressBadge progress={d.progress} />}
              </DialogDescription>
              {d.status === 'OPEN' && d.progress === 'BLOCKED' && d.blockedReason && (
                <p className="mt-2 rounded-md border border-critical/40 bg-critical/10 p-2 text-sm">{t('Blocked: {reason}', { reason: d.blockedReason })}</p>
              )}
            </div>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">{t('Workspace')}</dt><dd>{d.workspace.name}</dd></div>
              <div><dt className="text-muted-foreground">{t('Person')}</dt><dd>{d.assignee?.name ?? t('Everyone in the workspace')}</dd></div>
              <div><dt className="text-muted-foreground">{t('Created by')}</dt><dd>{d.createdBy?.name ?? '—'}</dd></div>
              <div><dt className="text-muted-foreground">{t('Created')}</dt><dd>{when(t, d.createdAt)}</dd></div>
              <div><dt className="text-muted-foreground">{t('Due')}</dt><dd className={d.overdue ? 'font-medium text-critical' : ''}>{d.dueAt ? when(t, d.dueAt) : '—'}</dd></div>
              <div><dt className="text-muted-foreground">{t('Completed')}</dt><dd>{d.completedAt ? when(t, d.completedAt) : '—'}</dd></div>
              <div><dt className="text-muted-foreground">{t('Acknowledged')}</dt><dd>{d.acknowledgedAt ? when(t, d.acknowledgedAt) : '—'}</dd></div>
            </dl>
            {d.description && <p className="whitespace-pre-wrap text-sm">{d.description}</p>}

            {d.canProgress && d.status === 'OPEN' && <ProgressControls id={id} progress={d.progress} />}
            {(d.canChangeStatus || d.canEdit) && (
              <div className="flex flex-wrap gap-2">
                {d.status === 'OPEN' && d.canChangeStatus && (
                  <Button size="sm" onClick={() => update.mutate({ id, input: { status: 'DONE' } })} disabled={update.isPending}>
                    {t('Mark done')}
                  </Button>
                )}
                {d.status !== 'OPEN' && d.canChangeStatus && (
                  <Button size="sm" variant="outline" onClick={() => update.mutate({ id, input: { status: 'OPEN' } })} disabled={update.isPending}>
                    {t('Reopen')}
                  </Button>
                )}
                {d.canEdit && d.status === 'OPEN' && (
                  <>
                    <label className="sr-only" htmlFor="td-priority">{t('Priority')}</label>
                    <Select id="td-priority" className="w-auto" value={d.priority} onChange={(e) => update.mutate({ id, input: { priority: e.target.value as AssignedTaskPriority } })}>
                      {ASSIGNED_TASK_PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {t.maybe(PRIORITY_LABEL[p])}
                        </option>
                      ))}
                    </Select>
                    <Button size="sm" variant="ghost" onClick={() => update.mutate({ id, input: { status: 'CANCELED' } })} disabled={update.isPending}>
                      {t('Cancel task')}
                    </Button>
                  </>
                )}
              </div>
            )}
            <ErrorText error={update.error} />

            <section aria-labelledby="td-comments" className="space-y-2">
              <h3 id="td-comments" className="text-sm font-semibold">{t('Comments and updates')}</h3>
              {d.commentList.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('No comments yet.')}</p>
              ) : (
                <ul className="space-y-2">
                  {d.commentList.map((c) => (
                    <li key={c.id} className="rounded-md bg-muted/40 p-2 text-sm">
                      <p className="text-xs text-muted-foreground">{c.author?.name ?? '—'} · {when(t, c.createdAt)}</p>
                      <p className="whitespace-pre-wrap">{c.body}</p>
                      <CommentReactions id={id} comment={c} />
                    </li>
                  ))}
                </ul>
              )}
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (body.trim()) comment.mutate({ id, body }, { onSuccess: () => setBody('') });
                }}
              >
                <Input aria-label={t('Add a comment')} placeholder={t('Add a comment')} value={body} maxLength={2000} onChange={(e) => setBody(e.target.value)} />
                <Button type="submit" disabled={comment.isPending || !body.trim()}>
                  {t('Post')}
                </Button>
              </form>
              <ErrorText error={comment.error} />
            </section>

            <section aria-labelledby="td-history" className="space-y-2">
              <h3 id="td-history" className="text-sm font-semibold">{t('History')}</h3>
              <ol className="space-y-1 text-xs text-muted-foreground" data-task-history>
                {d.history.map((h) => (
                  <li key={h.id}>
                    {when(t, h.createdAt)} · {h.actor?.name ?? '—'}:{' '}
                    {h.kind === 'created'
                      ? t('created the task')
                      : h.kind === 'commented'
                        ? t('commented')
                        : h.kind === 'progress'
                          ? h.changes.map((c) => (c.field === 'progress' ? t('marked it {state}', { state: value('progress', c.to).toLowerCase() }) : t('Blocked: {reason}', { reason: c.to ?? '' }))).join('; ')
                        : h.changes.map((c) => t('{field}: {from} → {to}', { field: t.maybe(FIELD_LABEL[c.field] ?? c.field), from: value(c.field, c.from), to: value(c.field, c.to) })).join('; ')}
                  </li>
                ))}
              </ol>
            </section>
            <div className="flex justify-end">
              <Button variant="outline" onClick={onClose}>
                {t('Close')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

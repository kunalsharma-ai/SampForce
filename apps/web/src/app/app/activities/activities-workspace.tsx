'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import type { ActivityRow, Page, TaskRow } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { api } from '@/lib/api';
import { formatDate, titleCase, toQuery, useMembers } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import { useCan } from '@/lib/session';

function relatedHref(r: { leadId: string | null; contactId: string | null; opportunityId: string | null; companyId?: string | null }) {
  if (r.opportunityId) return { href: `/app/deals/${r.opportunityId}`, label: 'Deal' };
  if (r.contactId) return { href: `/app/contacts/${r.contactId}`, label: 'Contact' };
  if (r.leadId) return { href: `/app/leads/${r.leadId}`, label: 'Lead' };
  if (r.companyId) return { href: `/app/companies/${r.companyId}`, label: 'Company' };
  return null;
}

export function ActivitiesWorkspace() {
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <TaskList />
      </div>
      <div className="lg:col-span-2">
        <RecentActivity />
      </div>
    </div>
  );
}

function TaskList() {
  const qc = useQueryClient();
  const canWrite = useCan('activities:write');
  const members = useMembers();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [status, setStatus] = useState<'OPEN' | 'DONE'>('OPEN');
  const tasks = useQuery({ queryKey: ['tasks', scope, status], queryFn: () => api<TaskRow[]>(`/tasks${toQuery({ scope, status })}`) });
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['tasks'] });
  const add = useMutation({
    mutationFn: () => api<TaskRow>('/tasks', { method: 'POST', json: { title, dueAt: due ? new Date(`${due}T17:00:00`).toISOString() : null, assigneeId: assigneeId || undefined } }),
    onSuccess: () => {
      setTitle('');
      setDue('');
      void invalidate();
    },
  });
  const setDone = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => api<TaskRow>(`/tasks/${id}`, { method: 'PATCH', json: { status: done ? 'DONE' : 'OPEN' } }),
    onSuccess: () => void invalidate(),
  });

  const overdue = tasks.data?.filter((t) => t.overdue).length ?? 0;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-2 space-y-0">
        <CardTitle className="mr-auto text-base">Tasks {overdue > 0 && <span className="ml-1 text-sm font-normal text-critical">· {overdue} overdue</span>}</CardTitle>
        <label htmlFor="task-scope" className="sr-only">
          Whose tasks
        </label>
        <Select id="task-scope" className="h-8 w-32 text-xs" value={scope} onChange={(e) => setScope(e.target.value as 'mine' | 'all')}>
          <option value="mine">My tasks</option>
          <option value="all">Everyone</option>
        </Select>
        <label htmlFor="task-status" className="sr-only">
          Status
        </label>
        <Select id="task-status" className="h-8 w-28 text-xs" value={status} onChange={(e) => setStatus(e.target.value as 'OPEN' | 'DONE')}>
          <option value="OPEN">Open</option>
          <option value="DONE">Done</option>
        </Select>
      </CardHeader>
      <CardContent className="space-y-3">
        {canWrite && status === 'OPEN' && (
          <form
            className="flex flex-wrap gap-2 rounded-md border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) add.mutate();
            }}
          >
            <label htmlFor="new-task" className="sr-only">
              New task
            </label>
            <Input id="new-task" placeholder="New task…" className="min-w-0 flex-1" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            <label htmlFor="new-task-due" className="sr-only">
              Due date
            </label>
            <Input id="new-task-due" type="date" className="w-40" value={due} onChange={(e) => setDue(e.target.value)} />
            <label htmlFor="new-task-assignee" className="sr-only">
              Assignee
            </label>
            <Select id="new-task-assignee" className="w-40" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Assign to me</option>
              {members.data?.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </Select>
            <Button type="submit" disabled={!title.trim() || add.isPending}>
              Add task
            </Button>
            {add.error && (
              <p role="alert" className="w-full text-sm text-critical">
                {add.error.message}
              </p>
            )}
          </form>
        )}
        {tasks.isPending ? (
          <Skeleton className="h-32" />
        ) : tasks.data?.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{status === 'OPEN' ? 'Nothing to do. Nice work.' : 'No completed tasks yet.'}</p>
        ) : (
          <ul className="divide-y divide-border">
            {tasks.data?.map((t) => {
              const rel = relatedHref(t);
              return (
                <li key={t.id} className="flex items-start gap-3 py-2.5">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-[hsl(var(--primary))]"
                    aria-label={`${t.status === 'DONE' ? 'Reopen' : 'Complete'} ${t.title}`}
                    checked={t.status === 'DONE'}
                    disabled={!canWrite || setDone.isPending}
                    onChange={(e) => setDone.mutate({ id: t.id, done: e.target.checked })}
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${t.status === 'DONE' ? 'text-muted-foreground line-through' : ''}`}>{t.title}</p>
                    <p className="text-xs text-muted-foreground">
                      <span className={t.overdue ? 'font-medium text-critical' : undefined}>{t.dueAt ? `${t.overdue ? 'Overdue · ' : 'Due '}${formatDate(t.dueAt)}` : 'No due date'}</span>
                      {scope === 'all' && ` · ${t.assignee?.name ?? 'Unassigned'}`}
                      {rel && (
                        <>
                          {' · '}
                          <Link href={rel.href} className="text-primary hover:underline">
                            {rel.label}
                          </Link>
                        </>
                      )}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RecentActivity() {
  const list = useQuery({ queryKey: ['activities', 'recent'], queryFn: () => api<Page<ActivityRow>>('/activities?pageSize=25') });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent activity</CardTitle>
      </CardHeader>
      <CardContent>
        {list.isPending ? (
          <Skeleton className="h-32" />
        ) : list.data?.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity logged yet. Open a record and use “Log activity”.</p>
        ) : (
          <ol className="space-y-3">
            {list.data?.items.map((a) => {
              const rel = relatedHref(a);
              return (
                <li key={a.id} className="text-sm">
                  <p>
                    <span className="font-medium">{a.subject}</span> <span className="text-muted-foreground">· {titleCase(a.type)}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {a.owner?.name ?? 'Unknown'} · <time dateTime={a.occurredAt}>{relativeTime(a.occurredAt)}</time>
                    {rel && (
                      <>
                        {' · '}
                        <Link href={rel.href} className="text-primary hover:underline">
                          {rel.label}
                        </Link>
                      </>
                    )}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

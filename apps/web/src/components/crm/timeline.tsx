'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import { ACTIVITY_TYPES, type ActivityRow, type Page, type TaskRow, type TimelineEntity } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Mail, MessageSquare, Phone, StickyNote, Users } from 'lucide-react';
import { useId, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate, titleCase, toQuery } from '@/lib/crm';
import { relativeTime } from '@/lib/format';
import { useCan } from '@/lib/session';
import { RecordTimeline } from './record-timeline';
import { Select, Textarea } from './select';

export type RelatedRef = { leadId: string } | { contactId: string } | { companyId: string } | { opportunityId: string };

const ICONS = { CALL: Phone, EMAIL: Mail, MEETING: Users, NOTE: StickyNote } as const;

/**
 * Activity with a "log activity" form, for any record. With `timeline`, the list below the form is the merged
 * Customer 360 timeline (email, meetings, sequences, stage moves, quotes and more) instead of logged activity only.
 */
export function ActivityTimeline({ related, timeline }: { related: RelatedRef; timeline?: { entity: TimelineEntity; id: string } }) {
  const qc = useQueryClient();
  const formId = useId();
  const canWrite = useCan('activities:write');
  const key = ['activities', related];
  const list = useQuery({ queryKey: key, queryFn: () => api<Page<ActivityRow>>(`/activities${toQuery(related)}`), enabled: !timeline });
  const [type, setType] = useState<(typeof ACTIVITY_TYPES)[number]>('NOTE');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const log = useMutation({
    mutationFn: () => api<ActivityRow>('/activities', { method: 'POST', json: { type, subject, body, ...related } }),
    onSuccess: () => {
      setSubject('');
      setBody('');
      void qc.invalidateQueries({ queryKey: ['activities'] });
      void qc.invalidateQueries({ queryKey: ['timeline'] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare className="size-4 text-muted-foreground" aria-hidden /> {timeline ? 'Timeline' : 'Activity'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canWrite && (
          <form
            className="space-y-2 rounded-md border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (subject.trim()) log.mutate();
            }}
          >
            <div className="flex gap-2">
              <label htmlFor={`${formId}-type`} className="sr-only">
                Activity type
              </label>
              <Select id={`${formId}-type`} className="w-32" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                {ACTIVITY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {titleCase(t)}
                  </option>
                ))}
              </Select>
              <label htmlFor={`${formId}-subject`} className="sr-only">
                Subject
              </label>
              <Input id={`${formId}-subject`} placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
            </div>
            <label htmlFor={`${formId}-body`} className="sr-only">
              Details
            </label>
            <Textarea id={`${formId}-body`} placeholder="Details (optional)" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[64px]" />
            {log.error && (
              <p role="alert" className="text-sm text-critical">
                {log.error.message}
              </p>
            )}
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={!subject.trim() || log.isPending}>
                Log {type.toLowerCase()}
              </Button>
            </div>
          </form>
        )}
        {timeline ? (
          <RecordTimeline entity={timeline.entity} id={timeline.id} />
        ) : list.isPending ? (
          <Skeleton className="h-20" />
        ) : list.data?.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ol className="space-y-3">
            {list.data?.items.map((a) => {
              const Icon = ICONS[a.type];
              return (
                <li key={a.id} className="flex gap-3">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">{a.subject}</span>{' '}
                      <span className="text-muted-foreground">· {titleCase(a.type)}</span>
                      {a.aiAssisted && <Badge tone="accent" className="ml-2">AI-assisted</Badge>}
                    </p>
                    {a.body && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>}
                    <p className="text-xs text-muted-foreground">
                      {a.owner?.name ?? 'Unknown'} · <time dateTime={a.occurredAt}>{relativeTime(a.occurredAt)}</time>
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

type TaskRelated = { leadId: string } | { contactId: string } | { opportunityId: string };

/** Open tasks linked to a record, with quick add and complete. */
export function RecordTasks({ related }: { related: TaskRelated }) {
  const qc = useQueryClient();
  const formId = useId();
  const canWrite = useCan('activities:write');
  const list = useQuery({ queryKey: ['tasks', 'record', related], queryFn: () => api<TaskRow[]>(`/tasks${toQuery({ scope: 'all', ...related })}`) });
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const invalidate = () => qc.invalidateQueries({ queryKey: ['tasks'] });
  const add = useMutation({
    mutationFn: () => api<TaskRow>('/tasks', { method: 'POST', json: { title, dueAt: due ? new Date(`${due}T17:00:00`).toISOString() : null, ...related } }),
    onSuccess: () => {
      setTitle('');
      setDue('');
      void invalidate();
    },
  });
  const complete = useMutation({
    mutationFn: (id: string) => api<TaskRow>(`/tasks/${id}`, { method: 'PATCH', json: { status: 'DONE' } }),
    onSuccess: () => void invalidate(),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="size-4 text-muted-foreground" aria-hidden /> Open tasks
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {list.isPending ? (
          <Skeleton className="h-12" />
        ) : list.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open tasks.</p>
        ) : (
          <ul className="space-y-2">
            {list.data?.map((t) => (
              <li key={t.id} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={`Complete ${t.title}`}
                  className="mt-0.5 size-4 accent-[hsl(var(--primary))]"
                  disabled={!canWrite || complete.isPending}
                  onChange={() => complete.mutate(t.id)}
                />
                <span className="flex-1">
                  {t.title}
                  <span className={`block text-xs ${t.overdue ? 'text-critical' : 'text-muted-foreground'}`}>
                    {t.dueAt ? `${t.overdue ? 'Overdue · ' : 'Due '}${formatDate(t.dueAt)}` : 'No due date'} · {t.assignee?.name ?? 'Unassigned'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {canWrite && (
          <form
            className="grid grid-cols-[1fr_auto] gap-2 border-t border-border pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (title.trim()) add.mutate();
            }}
          >
            <label htmlFor={`${formId}-title`} className="sr-only">
              New task
            </label>
            <Input id={`${formId}-title`} placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} className="col-span-2" maxLength={200} />
            <label htmlFor={`${formId}-due`} className="sr-only">
              Due date
            </label>
            <Input id={`${formId}-due`} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            <Button type="submit" size="sm" variant="outline" disabled={!title.trim() || add.isPending}>
              Add
            </Button>
            {add.error && (
              <p role="alert" className="col-span-2 text-sm text-critical">
                {add.error.message}
              </p>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}

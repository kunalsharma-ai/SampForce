'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import { NEXT_ACTION_LABELS, type NextAction, type NextActionKind, type NextActionList } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, ListTodo, X } from 'lucide-react';
import Link from 'next/link';
import { useId, useState } from 'react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/session';

const TONE: Partial<Record<NextActionKind, 'critical' | 'warning' | 'accent' | 'primary'>> = {
  reply_waiting: 'primary',
  overdue_task: 'critical',
  deal_at_risk: 'critical',
  close_date_passed: 'warning',
  renewal_due: 'warning',
  ai_recommendation: 'accent',
};

/** "Do this next": the signed-in person's ranked list, each item with the rule that put it there. */
export function NextActions() {
  const qc = useQueryClient();
  const canTask = useCan('activities:write');
  const list = useQuery({ queryKey: ['next-actions'], queryFn: () => api<NextActionList>('/next-actions'), refetchInterval: 120_000 });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['next-actions'] });
    void qc.invalidateQueries({ queryKey: ['tasks'] });
  };
  const dismiss = useMutation({
    mutationFn: (v: { key: string; days?: number }) => api('/next-actions/dismiss', { method: 'POST', json: v }),
    onSuccess: refresh,
  });

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListTodo className="size-4 text-muted-foreground" aria-hidden /> Your next best actions
        </CardTitle>
        <CardDescription>Ranked from your replies, tasks, deal health, quotes, renewals and new leads.</CardDescription>
      </CardHeader>
      <CardContent>
        {list.isPending ? (
          <Skeleton className="h-40" />
        ) : list.error ? (
          <p role="alert" className="text-sm text-critical">
            {list.error.message}
          </p>
        ) : list.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing needs you right now.{list.data.dismissed > 0 ? ` ${list.data.dismissed} hidden or snoozed.` : ''}
          </p>
        ) : (
          <ol className="divide-y divide-border">
            {list.data.items.slice(0, 8).map((item) => (
              <NextActionItem key={item.key} item={item} canTask={canTask} onDone={refresh} onDismiss={(days) => dismiss.mutate({ key: item.key, days })} busy={dismiss.isPending} />
            ))}
          </ol>
        )}
        {list.data && list.data.items.length > 8 && <p className="mt-2 text-xs text-muted-foreground">Showing 8 of {list.data.items.length}. Finish or snooze some to see the rest.</p>}
      </CardContent>
    </Card>
  );
}

function NextActionItem({ item, canTask, onDone, onDismiss, busy }: { item: NextAction; canTask: boolean; onDone: () => void; onDismiss: (days?: number) => void; busy: boolean }) {
  const id = useId();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.suggestedTask?.title ?? '');
  const accept = useMutation({
    mutationFn: () =>
      item.recommendationId
        ? api(`/ai/recommendations/${item.recommendationId}/accept`, { method: 'POST', json: { title, dueInDays: item.suggestedTask!.dueInDays } })
        : api('/next-actions/accept', { method: 'POST', json: { key: item.key, title, dueInDays: item.suggestedTask!.dueInDays } }),
    onSuccess: () => {
      setEditing(false);
      onDone();
    },
  });

  return (
    <li className="space-y-1.5 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            <Link href={item.href} className="hover:underline">
              {item.title}
            </Link>
          </p>
          <p className="text-xs text-muted-foreground">{item.reason}</p>
        </div>
        <Badge tone={TONE[item.kind] ?? 'neutral'}>{NEXT_ACTION_LABELS[item.kind]}</Badge>
      </div>
      {editing ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) accept.mutate();
          }}
        >
          <label htmlFor={`${id}-title`} className="sr-only">
            Task title
          </label>
          <Input id={`${id}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="h-8 min-w-48 flex-1 text-sm" />
          <Button type="submit" size="sm" disabled={!title.trim() || accept.isPending}>
            Create task
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap gap-1">
          {item.suggestedTask && canTask && (
            <Button size="sm" variant="outline" className="h-7" onClick={() => setEditing(true)}>
              <Check aria-hidden /> Make it a task
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7" onClick={() => onDismiss(1)} disabled={busy} aria-label={`Snooze "${item.title}" until tomorrow`}>
            <Clock aria-hidden /> Tomorrow
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => onDismiss()} disabled={busy} aria-label={`Hide "${item.title}"`}>
            <X aria-hidden /> Hide
          </Button>
        </div>
      )}
      {accept.error && (
        <p role="alert" className="text-xs text-critical">
          {accept.error.message}
        </p>
      )}
    </li>
  );
}

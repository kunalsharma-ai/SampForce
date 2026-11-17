'use client';

import { TASK_PRIORITIES, type TaskRow, taskUpdateSchema } from '@dealflow/types';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from '@dealflow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { api } from '@/lib/api';
import { titleCase, useMembers } from '@/lib/crm';
import { useT } from '@/lib/i18n';
import { Select, Textarea } from './select';

/** The `date` input value of a due date, in the browser's time zone. */
function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Edits a task's title, details, due date, priority and assignee (ADR 0065). Tasks are due at 17:00 local time. */
export function EditTaskDialog({ task, onClose }: { task: TaskRow | null; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const members = useMembers();
  const [v, setV] = React.useState({ title: '', description: '', due: '', priority: 'NORMAL' as (typeof TASK_PRIORITIES)[number], assigneeId: '' });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (input: Record<string, unknown>) => api<TaskRow>(`/tasks/${task!.id}`, { method: 'PATCH', json: input }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['tasks'] }), qc.invalidateQueries({ queryKey: ['timeline'] })]),
  });
  React.useEffect(() => {
    if (task) setV({ title: task.title, description: task.description ?? '', due: toDateInput(task.dueAt), priority: task.priority, assigneeId: task.assignee?.id ?? '' });
    setErrors({});
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = taskUpdateSchema.safeParse({
      title: v.title,
      description: v.description || null,
      dueAt: v.due ? new Date(`${v.due}T17:00:00`).toISOString() : null,
      priority: v.priority,
      ...(v.assigneeId ? { assigneeId: v.assigneeId } : {}),
    });
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const i of parsed.error.issues) out[String(i.path[0])] ??= t.maybe(i.message);
      setErrors(out);
      return;
    }
    try {
      await save.mutateAsync(parsed.data);
      onClose();
    } catch {
      // Shown below from save.error.
    }
  };

  return (
    <Dialog open={!!task} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg p-6">
        <DialogTitle className="text-lg font-semibold">{t('Edit task')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">{t('Change what the task is, when it is due and who does it.')}</DialogDescription>
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field id="task-edit-title" label={t('Title *')} error={errors.title}>
              <Input value={v.title} onChange={(e) => setV((x) => ({ ...x, title: e.target.value }))} maxLength={200} />
            </Field>
          </div>
          <Field id="task-edit-due" label={t('Due date')}>
            <Input type="date" value={v.due} onChange={(e) => setV((x) => ({ ...x, due: e.target.value }))} />
          </Field>
          <Field id="task-edit-priority" label={t('Priority')}>
            <Select value={v.priority} onChange={(e) => setV((x) => ({ ...x, priority: e.target.value as typeof v.priority }))}>
              {TASK_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {t.maybe(titleCase(p))}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field id="task-edit-assignee" label={t('Assignee')}>
              <Select value={v.assigneeId} onChange={(e) => setV((x) => ({ ...x, assigneeId: e.target.value }))}>
                {!v.assigneeId && <option value="">{t('Unassigned')}</option>}
                {members.data?.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field id="task-edit-description" label={t('Details')} error={errors.description}>
              <Textarea rows={3} value={v.description} onChange={(e) => setV((x) => ({ ...x, description: e.target.value }))} />
            </Field>
          </div>
          {save.error && (
            <p role="alert" className="text-sm text-critical sm:col-span-2">
              {save.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t('Saving…') : t('Save changes')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from '@dealflow/ui';
import type { TaskRow } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useQuickCreate } from '@/stores/quick-create';
import { RecordFormDialog } from './record-form';

/** Global create dialogs, opened from the topbar Create menu and the command palette. */
export function QuickCreateHost() {
  const { kind, close } = useQuickCreate();
  const router = useRouter();
  if (!kind) return null;
  if (kind === 'task') return <TaskDialog onClose={close} />;
  return <RecordFormDialog entity={kind} open onOpenChange={(o) => !o && close()} onSaved={(row) => router.push(`/app/${kind}/${row.id}`)} />;
}

function TaskDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const t = useT();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const create = useMutation({
    mutationFn: () => api<TaskRow>('/tasks', { method: 'POST', json: { title, dueAt: due ? new Date(`${due}T17:00:00`).toISOString() : null } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="p-6">
        <DialogTitle className="text-lg font-semibold">{t('create.task')}</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">{t('Assigned to you. Link tasks to a record from its page.')}</DialogDescription>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim()) create.mutate();
          }}
        >
          <Field id="qc-task-title" label={t('Title *')}>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} autoFocus />
          </Field>
          <Field id="qc-task-due" label={t('Due date')}>
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          {create.error && (
            <p role="alert" className="text-sm text-critical">
              {create.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={!title.trim() || create.isPending}>
              {t('Create task')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import { WORKSPACE_LEVEL_LABEL, type WorkspaceDeleted, type WorkspaceRow } from '@dealflow/types';
import { useEffect, useId, useState } from 'react';
import { Select } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { ConfirmDeletionDialog } from '@/components/security/confirm-deletion-dialog';
import { useT } from '@/lib/i18n';
import { useWorkspaceImpact, useWorkspaceMutations } from '@/lib/workspaces';

/*
 * Deactivating and deleting Manager and Executive Workspaces (workspace redesign W4, spec sections 4, 8 and 15).
 * Deactivating is reversible and asks for a reason and the password. Deleting first shows what it touches, asks which
 * workspace receives the records, then the typed name and the password. The API enforces every step.
 */

/** Reason, then the password. */
export function DeactivateWorkspaceDialog({ row, onClose }: { row: WorkspaceRow; onClose: () => void }) {
  const t = useT();
  const id = useId();
  const { deactivate } = useWorkspaceMutations();
  const [reason, setReason] = useState('');
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  return (
    <>
      <Dialog open={step === 'form'} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-md p-6" data-deactivate-workspace>
          <DialogTitle className="text-lg font-semibold">{t('Deactivate {name}', { name: row.name })}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            {t('Its people, and everyone in the workspaces below it, cannot work until you reactivate it. Nothing is deleted, and its permissions are kept.')}
          </DialogDescription>
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim().length >= 3) setStep('confirm');
            }}
          >
            <Field id={`${id}-reason`} label={t('Reason')} hint={t('Kept in the audit log.')}>
              <Input id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} autoFocus />
            </Field>
            <ErrorText error={deactivate.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                {t('Cancel')}
              </Button>
              <Button type="submit" disabled={reason.trim().length < 3 || deactivate.isPending}>
                {t('Continue')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDeletionDialog
        open={step === 'confirm'}
        title={t('Confirm deactivation')}
        confirmLabel={t('Deactivate')}
        description={t('{name} will be deactivated.', { name: row.name })}
        onCancel={() => setStep('form')}
        onConfirmed={(pass) => {
          setStep('form');
          deactivate.mutate({ id: row.id, reason: reason.trim(), pass }, { onSuccess: onClose });
        }}
      />
    </>
  );
}

/** What it touches and who receives it, then the typed name and the password. */
export function DeleteWorkspaceDialog({ row, onClose, onDeleted }: { row: WorkspaceRow; onClose: () => void; onDeleted: (result: WorkspaceDeleted) => void }) {
  const t = useT();
  const id = useId();
  const impact = useWorkspaceImpact(row.id);
  const { remove } = useWorkspaceMutations();
  const [handoverToId, setHandoverToId] = useState('');
  const [step, setStep] = useState<'impact' | 'confirm'>('impact');
  const data = impact.data;

  // Offer the first workspace that can receive the records, so the common case is one click.
  useEffect(() => {
    if (data && !handoverToId) setHandoverToId(data.handoverOptions.find((o) => o.receiver)?.id ?? '');
  }, [data, handoverToId]);

  const chosen = data?.handoverOptions.find((o) => o.id === handoverToId);
  const ready = !!data && (!data.handoverRequired || !!chosen?.receiver);
  const r = data?.records;
  const recordCount = r ? r.companies + r.contacts + r.leads + r.deals + r.openTasks : 0;

  return (
    <>
      <Dialog open={step === 'impact'} onOpenChange={(o) => !o && !remove.isPending && onClose()}>
        <DialogContent className="max-w-lg p-6" data-delete-workspace>
          <DialogTitle className="text-lg font-semibold">{t('Delete {name}', { name: row.name })}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            {t('Nothing in the CRM is erased: its records move to the workspace you choose. This cannot be undone.')}
          </DialogDescription>
          {!data ? (
            impact.error ? <ErrorText error={impact.error} /> : <Skeleton className="mt-4 h-40" />
          ) : (
            <div className="mt-4 space-y-4 text-sm">
              <dl className="space-y-3 rounded-md border border-border p-3" data-impact>
                <div>
                  <dt className="font-medium">{t('Who loses access')}</dt>
                  <dd className="text-muted-foreground" data-impact-people>
                    {data.people.length ? data.people.map((p) => `${p.name} (${p.email})`).join(', ') : t('Nobody works in it.')}
                    {data.pendingInvites > 0 && <> {t('{count} pending invitations are withdrawn.', { count: data.pendingInvites })}</>}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">{t('Records that move')}</dt>
                  <dd className="text-muted-foreground" data-impact-records>
                    {recordCount
                      ? t('{companies} companies, {contacts} contacts, {leads} leads, {deals} deals and {tasks} open tasks', { companies: r!.companies, contacts: r!.contacts, leads: r!.leads, deals: r!.deals, tasks: r!.openTasks })
                      : t('None')}
                  </dd>
                </div>
                {data.workspacesBelow.length > 0 && (
                  <div>
                    <dt className="font-medium">{t('Executive Workspaces that move, with their people')}</dt>
                    <dd className="text-muted-foreground" data-impact-below>
                      {data.workspacesBelow.map((w) => w.name).join(', ')}
                    </dd>
                  </div>
                )}
              </dl>
              {data.handoverOptions.length > 0 && (data.handoverRequired || data.people.length > 0) && (
                <Field id={`${id}-handover`} label={t('Who receives them')} hint={chosen?.receiver ? t('Records go to {person}.', { person: chosen.receiver }) : t('Choose a workspace with someone in it.')}>
                  <Select id={`${id}-handover`} value={handoverToId} onChange={(e) => setHandoverToId(e.target.value)}>
                    {data.handoverOptions.map((o) => (
                      <option key={o.id} value={o.id} disabled={!o.receiver}>
                        {o.level === 'SUPER' ? t('Super Workspace') : o.name} · {t.maybe(WORKSPACE_LEVEL_LABEL[o.level])}
                        {o.receiver ? ` · ${o.receiver}` : ` · ${t('Nobody in it yet')}`}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {data.handoverRequired && !data.handoverOptions.some((o) => o.receiver) && (
                <p role="alert" className="text-critical">
                  {t('No workspace can receive its records. Create or fill another workspace first.')}
                </p>
              )}
              <ErrorText error={remove.error} />
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={remove.isPending}>
              {t('Cancel')}
            </Button>
            <Button type="button" variant="destructive" disabled={!ready || remove.isPending} onClick={() => setStep('confirm')}>
              {t('Continue')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDeletionDialog
        open={step === 'confirm'}
        confirmName={row.name}
        description={chosen?.receiver ? t('{name} will be deleted and its records given to {person}.', { name: row.name, person: chosen.receiver }) : t('{name} will be deleted.', { name: row.name })}
        confirmLabel={t('Delete workspace')}
        onCancel={() => setStep('impact')}
        onConfirmed={(pass) => {
          setStep('impact');
          remove.mutate(
            { id: row.id, confirmName: row.name, handoverToId: data?.handoverRequired || data?.people.length ? handoverToId || null : null, pass },
            { onSuccess: (result) => (onDeleted(result), onClose()) },
          );
        }}
      />
    </>
  );
}

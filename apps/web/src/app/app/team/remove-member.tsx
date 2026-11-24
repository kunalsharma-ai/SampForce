'use client';

import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Skeleton } from '@dealflow/ui';
import { type MemberRemovalImpact, type MemberRemoved, type MemberRow, PASSWORD_CONFIRMATION_HEADER } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState } from 'react';
import { Select } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { ConfirmDeletionDialog } from '@/components/security/confirm-deletion-dialog';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

/*
 * Removing a person from the workspace completely (Team Management). First what moves and who receives it, then the
 * password. The API enforces every rule: never yourself, never the last owner, only an owner removes an owner.
 */
export function RemoveMemberDialog({ member, onClose, onRemoved }: { member: MemberRow; onClose: () => void; onRemoved: (result: MemberRemoved) => void }) {
  const t = useT();
  const id = useId();
  const qc = useQueryClient();
  const impact = useQuery({
    queryKey: ['member-removal', member.membershipId],
    queryFn: () => api<MemberRemovalImpact>(`/tenants/current/members/${member.membershipId}/removal`),
    retry: false,
  });
  const remove = useMutation({
    mutationFn: ({ handoverToUserId, pass }: { handoverToUserId: string | null; pass: string }) =>
      api<MemberRemoved>(`/tenants/current/members/${member.membershipId}`, { method: 'DELETE', json: { handoverToUserId }, headers: { [PASSWORD_CONFIRMATION_HEADER]: pass } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['members'] });
      void qc.invalidateQueries({ queryKey: ['invitations'] });
    },
  });
  const [receiver, setReceiver] = useState('');
  const [step, setStep] = useState<'impact' | 'confirm'>('impact');
  const data = impact.data;

  // The remover is offered first: handing the records to yourself is the usual choice.
  useEffect(() => {
    if (data && !receiver) setReceiver(data.handoverOptions[0]?.userId ?? '');
  }, [data, receiver]);

  const chosen = data?.handoverOptions.find((o) => o.userId === receiver);
  const ready = !!data && (!data.handoverRequired || !!chosen);
  const r = data?.records;
  const recordCount = r ? Object.values(r).reduce((n, v) => n + v, 0) : 0;

  return (
    <>
      <Dialog open={step === 'impact'} onOpenChange={(o) => !o && !remove.isPending && onClose()}>
        <DialogContent className="max-w-lg p-6" data-remove-member>
          <DialogTitle className="text-lg font-semibold">{t('Remove {name}', { name: member.name })}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            {t('They stop being able to sign in to this workspace and disappear from the members list. Nothing in the CRM is erased: their records go to the person you choose. This cannot be undone, but you can invite them again later.')}
          </DialogDescription>
          {!data ? (
            impact.error ? <ErrorText error={impact.error} /> : <Skeleton className="mt-4 h-32" />
          ) : (
            <div className="mt-4 space-y-4 text-sm">
              <dl className="space-y-3 rounded-md border border-border p-3" data-impact>
                <div>
                  <dt className="font-medium">{t('Person')}</dt>
                  <dd className="text-muted-foreground">
                    {data.name} ({data.email}) · {t.maybe(data.roleName)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">{t('Records that move')}</dt>
                  <dd className="text-muted-foreground" data-impact-records>
                    {recordCount
                      ? t('{companies} companies, {contacts} contacts, {leads} leads, {deals} deals, {rfqs} RFQs, {contracts} contracts and {tasks} open tasks', {
                          companies: r!.companies,
                          contacts: r!.contacts,
                          leads: r!.leads,
                          deals: r!.deals,
                          rfqs: r!.rfqs,
                          contracts: r!.contracts,
                          tasks: r!.openTasks,
                        })
                      : t('None')}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">{t('Invitations deleted')}</dt>
                  <dd className="text-muted-foreground" data-impact-invitations>
                    {data.invitations}
                  </dd>
                </div>
              </dl>
              {data.handoverRequired && data.handoverOptions.length > 0 && (
                <Field id={`${id}-receiver`} label={t('Who receives their records')}>
                  <Select id={`${id}-receiver`} value={receiver} onChange={(e) => setReceiver(e.target.value)}>
                    {data.handoverOptions.map((o) => (
                      <option key={o.userId} value={o.userId}>
                        {o.name} ({o.email})
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {data.handoverRequired && data.handoverOptions.length === 0 && (
                <p role="alert" className="text-critical">
                  {t('Nobody else can receive their records yet.')}
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
        description={chosen && data?.handoverRequired ? t('{name} will be removed and their records given to {person}.', { name: member.name, person: chosen.name }) : t('{name} will be removed from this workspace.', { name: member.name })}
        confirmLabel={t('Remove person')}
        onCancel={() => setStep('impact')}
        onConfirmed={(pass) => {
          setStep('impact');
          remove.mutate({ handoverToUserId: data?.handoverRequired ? receiver || null : null, pass }, { onSuccess: (result) => (onRemoved(result), onClose()) });
        }}
      />
    </>
  );
}

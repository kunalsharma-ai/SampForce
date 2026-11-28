'use client';

import { type CompanyClosed, type CompanyCloseImpact, PASSWORD_CONFIRMATION_HEADER, WORKSPACE_LEVEL_LABEL } from '@dealflow/types';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Skeleton } from '@dealflow/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { DoorClosed } from 'lucide-react';
import { useId, useState } from 'react';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { ConfirmDeletionDialog } from '@/components/security/confirm-deletion-dialog';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { fmtLocale } from '@/lib/i18n/locale';
import { useSession } from '@/lib/session';

/*
 * Close the company (workspace redesign W7, spec section 7). Only an owner in the Super Workspace sees it. First what
 * closing stops (every workspace and the data), then the typed company name and the password, then a second yes.
 * Sign-in stops for everyone at once; SampForce can reopen the company for 30 days, then its data is erased.
 */
export function CloseCompanyCard() {
  const t = useT();
  const me = useSession();
  const [open, setOpen] = useState(false);
  if (me.data?.role !== 'owner' || me.data.workspace.level !== 'SUPER') return null;
  return (
    <Card className="border-critical/40" data-close-company>
      <CardHeader>
        <CardTitle>{t('Close company')}</CardTitle>
        <CardDescription>{t('Stops SampForce for everyone in {company} at once. SampForce can reopen it for 30 days; after that its data is erased.', { company: me.data.tenant.name })}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <DoorClosed className="size-4" aria-hidden />
          {t('Close company')}
        </Button>
      </CardContent>
      {open && <CloseCompanyFlow company={me.data.tenant.name} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function CloseCompanyFlow({ company, onClose }: { company: string; onClose: () => void }) {
  const t = useT();
  const id = useId();
  const impact = useQuery({ queryKey: ['close-impact'], queryFn: () => api<CompanyCloseImpact>('/tenants/current/close-impact') });
  const [reason, setReason] = useState('');
  const [step, setStep] = useState<'impact' | 'confirm' | 'final'>('impact');
  const [pass, setPass] = useState<string | null>(null);
  const close = useMutation({
    mutationFn: (p: string) => api<CompanyClosed>('/tenants/current/close', { method: 'POST', json: { confirmName: company, reason: reason.trim() || undefined, understood: true }, headers: { [PASSWORD_CONFIRMATION_HEADER]: p } }),
    // Everyone, this person included, is signed out now: the sign-in page says until when it can be reopened.
    onSuccess: (r) => window.location.assign(`/login?closed=${encodeURIComponent(r.eraseAfter.slice(0, 10))}`),
  });
  const data = impact.data;
  const r = data?.records;
  const eraseOn = data ? new Intl.DateTimeFormat(fmtLocale(), { dateStyle: 'long' }).format(new Date(data.eraseAfter)) : '';

  return (
    <>
      <Dialog open={step === 'impact'} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-lg p-6" data-close-company-impact>
          <DialogTitle className="text-lg font-semibold">{t('Close {company}', { company })}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">{t('Everyone is signed out and nobody can sign in. Read what this stops before you go on.')}</DialogDescription>
          {!data ? (
            impact.error ? <ErrorText error={impact.error} /> : <Skeleton className="mt-4 h-40" />
          ) : (
            <div className="mt-4 space-y-4 text-sm">
              <dl className="space-y-3 rounded-md border border-border p-3">
                <div>
                  <dt className="font-medium">{t('Workspaces that stop')}</dt>
                  <dd>
                    <ul className="mt-1 space-y-0.5 text-muted-foreground" data-close-workspaces>
                      {data.workspaces.map((w) => (
                        <li key={w.id}>
                          {w.name} · {t.maybe(WORKSPACE_LEVEL_LABEL[w.level])} · {t('{count} people', { count: w.people })}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">{t('Data that is erased after 30 days')}</dt>
                  <dd className="text-muted-foreground" data-close-records>
                    {t('{companies} companies, {contacts} contacts, {leads} inbound contacts, {deals} deals and {tasks} open tasks', { companies: r!.companies, contacts: r!.contacts, leads: r!.leads, deals: r!.deals, tasks: r!.openTasks })}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">{t('Until when it can be reopened')}</dt>
                  <dd className="text-muted-foreground" data-close-erase-date>
                    {t('SampForce support can reopen it with everything in it until {date}. After that it cannot be recovered.', { date: eraseOn })}
                  </dd>
                </div>
              </dl>
              <Field id={`${id}-reason`} label={t('Reason (optional)')} hint={t('Kept in the audit log and shown to SampForce support.')}>
                <Input id={`${id}-reason`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </div>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="button" variant="destructive" disabled={!data} onClick={() => setStep('confirm')}>
              {t('Continue')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDeletionDialog
        open={step === 'confirm'}
        title={t('Confirm closing')}
        confirmName={company}
        description={t('{company} will be closed for everyone.', { company })}
        confirmLabel={t('Continue')}
        onCancel={() => setStep('impact')}
        onConfirmed={(p) => {
          setPass(p);
          setStep('final');
        }}
      />

      <Dialog open={step === 'final'} onOpenChange={(o) => !o && !close.isPending && (setPass(null), setStep('impact'))}>
        <DialogContent className="max-w-md p-6" data-close-company-final>
          <DialogTitle className="text-lg font-semibold">{t('Close {company} now?', { company })}</DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            {t('This is the last step. Everyone, you included, is signed out straight away, and the data is erased on {date} unless SampForce support reopens the company first.', { date: eraseOn })}
          </DialogDescription>
          <ErrorText error={close.error} />
          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={close.isPending} onClick={onClose}>
              {t('Keep the company')}
            </Button>
            <Button type="button" variant="destructive" disabled={!pass || close.isPending} onClick={() => pass && close.mutate(pass)}>
              {t('Close the company')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import type { ContractRow } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { ContractESignature } from '@/components/revenue/esignature';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/crm';
import { CONTRACT_STATUS, formatAmount, todayIso, useContract } from '@/lib/revenue';
import { useCan } from '@/lib/session';
import { useT } from '@/lib/i18n';

const METHOD_LABEL: Record<string, string> = { wet_ink: 'Signed on paper', email_confirmation: 'Confirmed by email', external_esign: 'Signed in an external e-signature tool', docusign: 'Signed with DocuSign' };

export function ContractDetail({ id }: { id: string }) {
  const t = useT();
  const contract = useContract(id);
  const canWrite = useCan('contracts:write');
  if (contract.isPending) return <Skeleton className="h-96" />;
  if (contract.error) return <ErrorText error={contract.error} />;
  const c = contract.data;
  return (
    <div className="space-y-4">
      <Link href="/app/contracts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="rtl:-scale-x-100 size-4" aria-hidden /> {t('All contracts')}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {c.reference} · {c.name}
        </h1>
        <Badge tone={CONTRACT_STATUS[c.status].tone}>{t.maybe(CONTRACT_STATUS[c.status].label)}</Badge>
        {c.renewalDue && <Badge tone="warning">{t('Renewal due')}</Badge>}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t('Details')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <Item label={t('Company')}>{c.company ? <Link className="text-primary hover:underline" href={`/app/companies/${c.company.id}`}>{c.company.name}</Link> : '—'}</Item>
              <Item label={t('Deal')}>{c.deal ? <Link className="text-primary hover:underline" href={`/app/deals/${c.deal.id}`}>{c.deal.name}</Link> : '—'}</Item>
              <Item label={t('From quote')}>{c.quote ? <Link className="text-primary hover:underline" href={`/app/quotes/${c.quote.id}`}>{c.quote.reference}</Link> : '—'}</Item>
              <Item label={t('Owner')}>{c.owner?.name ?? t('Unassigned')}</Item>
              <Item label={t('Value')}>{formatAmount(c.value, c.currency)}</Item>
              <Item label={t('Term')}>
                {t('{start} to {end}', { start: formatDate(c.startDate), end: c.endDate ? formatDate(c.endDate) : t('open-ended') })}
              </Item>
              <Item label={t('Renewal reminder')}>{t.plural('count.daysBeforeEnd', c.renewalNoticeDays)}{c.autoRenew ? ` · ${t('marked to auto-renew')}` : ''}</Item>
              <Item label={t('Signature')}>{c.signedAt ? t('{name} on {date} ({method})', { name: c.signedBy ?? '', date: formatDate(c.signedAt), method: t.maybe(METHOD_LABEL[c.signatureMethod ?? ''] ?? c.signatureMethod ?? '') }) : t('Not signed')}</Item>
              {c.renewedFromId && <Item label={t('Renews')}><Link className="text-primary hover:underline" href={`/app/contracts/${c.renewedFromId}`}>{t('Previous contract')}</Link></Item>}
              {c.renewalId && <Item label={t('Renewal')}><Link className="text-primary hover:underline" href={`/app/contracts/${c.renewalId}`}>{t('Open renewal')}</Link></Item>}
            </dl>
            {c.terms && <p className="mt-4 whitespace-pre-wrap border-t border-border pt-4 text-sm">{c.terms}</p>}
          </CardContent>
        </Card>
        <div className="space-y-4">
          <ContractESignature c={c} />
          {canWrite && <Actions c={c} />}
        </div>
      </div>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Actions({ c }: { c: ContractRow }) {
  const t = useT();
  const qc = useQueryClient();
  const router = useRouter();
  const [signedBy, setSignedBy] = useState('');
  const [signedAt, setSignedAt] = useState(todayIso());
  const [method, setMethod] = useState('wet_ink');
  const [reason, setReason] = useState('');
  const [end, setEnd] = useState(c.endDate ?? '');
  const done = () => qc.invalidateQueries({ queryKey: ['contracts'] });
  const sign = useMutation({ mutationFn: () => api(`/contracts/${c.id}/sign`, { method: 'POST', json: { signedBy, signedAt, method } }), onSuccess: done });
  const terminate = useMutation({ mutationFn: () => api(`/contracts/${c.id}/terminate`, { method: 'POST', json: { reason } }), onSuccess: done });
  const renew = useMutation({
    mutationFn: () => api<ContractRow>(`/contracts/${c.id}/renew`, { method: 'POST' }),
    onSuccess: async (r) => {
      await done();
      router.push(`/app/contracts/${r.id}`);
    },
  });
  const update = useMutation({ mutationFn: (json: object) => api(`/contracts/${c.id}`, { method: 'PATCH', json }), onSuccess: done });

  return (
    <>
      {c.status === 'DRAFT' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('Record signature')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                sign.mutate();
              }}
            >
              <Field id="sign-by" label={t('Signed by')}>
                <Input id="sign-by" required value={signedBy} onChange={(e) => setSignedBy(e.target.value)} maxLength={200} />
              </Field>
              <Field id="sign-at" label={t('Signed on')}>
                <Input id="sign-at" type="date" required value={signedAt} onChange={(e) => setSignedAt(e.target.value)} />
              </Field>
              <Field id="sign-method" label={t('How')}>
                <Select id="sign-method" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {Object.entries(METHOD_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {t.maybe(v)}
                    </option>
                  ))}
                </Select>
              </Field>
              <p className="text-xs text-muted-foreground">{t('This records who signed and how. DealFlow does not collect signatures itself yet.')}</p>
              <Button type="submit" size="sm" disabled={sign.isPending}>
                {t('Mark as signed')}
              </Button>
              <ErrorText error={sign.error} />
            </form>
          </CardContent>
        </Card>
      )}
      {(c.status === 'ACTIVE' || c.status === 'DRAFT') && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('Term and renewal')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                update.mutate({ endDate: end || null });
              }}
            >
              <Field id="c-end-edit" label={t('End date')}>
                <Input id="c-end-edit" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </Field>
              <Button type="submit" size="sm" variant="outline" disabled={update.isPending || end === (c.endDate ?? '')}>
                {t('Save')}
              </Button>
            </form>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={c.autoRenew} disabled={update.isPending} onChange={(e) => update.mutate({ autoRenew: e.target.checked })} /> {t('Marked to auto-renew')}
            </label>
            <ErrorText error={update.error} />
            {c.status === 'ACTIVE' && c.endDate && !c.renewalId && (
              <Button size="sm" className="w-full" disabled={renew.isPending} onClick={() => renew.mutate()}>
                {t('Start renewal')}
              </Button>
            )}
            <ErrorText error={renew.error} />
          </CardContent>
        </Card>
      )}
      {c.status === 'EXPIRED' && c.endDate && !c.renewalId && (
        <Button size="sm" className="w-full" disabled={renew.isPending} onClick={() => renew.mutate()}>
          {t('Start renewal')}
        </Button>
      )}
      {c.status === 'ACTIVE' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('Terminate')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (reason.trim()) terminate.mutate();
              }}
            >
              <Field id="term-reason" label={t('Reason')}>
                <Textarea id="term-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
              </Field>
              <Button type="submit" size="sm" variant="destructive" disabled={!reason.trim() || terminate.isPending}>
                {t('Terminate contract')}
              </Button>
              <ErrorText error={terminate.error} />
            </form>
          </CardContent>
        </Card>
      )}
    </>
  );
}

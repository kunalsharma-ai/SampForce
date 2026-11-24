'use client';

import { type SalesProfile, type SalesProfileInput } from '@dealflow/types';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone } from 'lucide-react';
import * as React from 'react';
import { Textarea } from '@/components/crm/select';
import { InfoTip } from '@/components/info-tip';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/crm';
import { useT } from '@/lib/i18n';

type Form = Record<'companyName' | 'about' | 'services' | 'valueProposition' | 'differentiators' | 'industriesServed' | 'website' | 'signature', string>;

const toLines = (v: string) => [...new Set(v.split('\n').map((x) => x.trim()).filter(Boolean))];
const toForm = (p: SalesProfile): Form => ({
  companyName: p.companyName,
  about: p.about,
  services: p.services.join('\n'),
  valueProposition: p.valueProposition,
  differentiators: p.differentiators.join('\n'),
  industriesServed: p.industriesServed.join('\n'),
  website: p.website,
  signature: p.signature,
});
export const salesProfilePayload = (f: Form): SalesProfileInput => ({
  companyName: f.companyName.trim(),
  about: f.about.trim(),
  services: toLines(f.services),
  valueProposition: f.valueProposition.trim(),
  differentiators: toLines(f.differentiators),
  industriesServed: toLines(f.industriesServed),
  website: f.website.trim(),
  signature: f.signature.trim(),
});

/**
 * Who your organisation is, for AI sales emails (ADR 0077). The Super Workspace keeps it; every Manager and Executive
 * Workspace writes its emails with it, so nobody has to describe the organisation again.
 */
export function SalesProfileSettings() {
  const t = useT();
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ['sales-profile'], queryFn: () => api<SalesProfile>('/tenants/current/sales-profile') });
  const [form, setForm] = React.useState<Form | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saved, setSaved] = React.useState(false);
  React.useEffect(() => {
    if (profile.data) setForm(toForm(profile.data));
  }, [profile.data]);
  const save = useMutation({
    mutationFn: (f: Form) => api<SalesProfile>('/tenants/current/sales-profile', { method: 'PUT', json: salesProfilePayload(f) }),
    onSuccess: (p) => {
      setSaved(true);
      setErrors({});
      qc.setQueryData(['sales-profile'], p);
    },
    onError: (err) => {
      if (err instanceof ApiError) setErrors(Object.fromEntries((err.details ?? []).map((d) => [String(d.path).split('.')[0], t.maybe(d.message)])));
    },
  });
  const p = profile.data;
  const editable = !!p?.editable;
  const field = (k: keyof Form) => ({
    value: form?.[k] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setSaved(false);
      setForm((f) => (f ? { ...f, [k]: e.target.value } : f));
    },
  });

  return (
    <Card id="sales-profile" className="scroll-mt-20">
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Megaphone aria-hidden className="size-4" />
          </span>
          <CardTitle>{t('Sales profile')}</CardTitle>
          <InfoTip topic="settings.salesProfile" />
        </div>
        <CardDescription>
          {editable
            ? t('Who your organisation is and what it offers. AI sales emails in every workspace of your organisation are written with it.')
            : t('Kept by your Super Workspace. AI sales emails in every workspace are written with it.')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!form || !p ? (
          <Skeleton className="h-64" />
        ) : (
          <form
            noValidate
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate(form);
            }}
          >
            <fieldset disabled={!editable} className="contents">
              <Field id="sp-name" label={t('Organisation name in emails')} hint={t('Leave empty to use {name}.', { name: p.workspaceName })} error={errors.companyName}>
                <Input {...field('companyName')} placeholder={p.workspaceName} maxLength={160} />
              </Field>
              <Field id="sp-website" label={t('Website')} error={errors.website}>
                <Input {...field('website')} type="url" placeholder="https://" maxLength={300} />
              </Field>
              <div className="sm:col-span-2">
                <Field id="sp-about" label={t('What your organisation does')} error={errors.about}>
                  <Textarea {...field('about')} rows={3} maxLength={1500} />
                </Field>
              </div>
              <Field id="sp-services" label={t('Services')} hint={t('One per line.')} error={errors.services}>
                <Textarea {...field('services')} rows={5} />
              </Field>
              <Field id="sp-industries" label={t('Industries you serve')} hint={t('One per line.')} error={errors.industriesServed}>
                <Textarea {...field('industriesServed')} rows={5} />
              </Field>
              <div className="sm:col-span-2">
                <Field id="sp-value" label={t('Value proposition')} hint={t('Why customers choose you, in a sentence or two.')} error={errors.valueProposition}>
                  <Textarea {...field('valueProposition')} rows={3} maxLength={1000} />
                </Field>
              </div>
              <Field id="sp-diff" label={t('What sets you apart')} hint={t('One per line.')} error={errors.differentiators}>
                <Textarea {...field('differentiators')} rows={4} />
              </Field>
              <Field id="sp-signature" label={t('Signature added to every email')} hint={t('Optional. For example a phone number or a booking link.')} error={errors.signature}>
                <Textarea {...field('signature')} rows={4} maxLength={600} />
              </Field>
            </fieldset>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              {editable && (
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? t('Saving…') : t('Save sales profile')}
                </Button>
              )}
              <p role="status" className="text-sm text-muted-foreground">
                {saved ? t('Saved.') : save.error && !(save.error instanceof ApiError && save.error.details?.length) ? save.error.message : p.updatedAt ? t('Last changed {when} by {name}.', { when: formatDate(p.updatedAt), name: p.updatedBy?.name ?? '—' }) : ''}
              </p>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

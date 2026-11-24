'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import { type ClientHealthKey, DEFAULT_HEALTH_SETTINGS, HEALTH_SIGNALS, type HealthSettings, type OperatorSettings } from '@dealflow/types';
import { HEALTH_SIGNAL_LABEL } from '@/components/console/client-health';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Textarea } from '@/components/crm/select';
import { PageHeader } from '@/components/page-header';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { can, useOperator } from '../operator-shell';
import { fmtLocale } from '@/lib/i18n/locale';

const SOURCE: Record<OperatorSettings['paymentInstructionsSource'], string> = {
  console: 'Set here',
  config: 'From the OFFLINE_PAYMENT_INSTRUCTIONS deployment setting. Saving here replaces it.',
  none: 'Not set. Open invoices say the SampForce team will send payment details.',
};

export default function OperatorSettingsPage() {
  const me = useOperator();
  const qc = useQueryClient();
  const settings = useQuery({ enabled: !!me.data, queryKey: ['operator', 'settings'], queryFn: () => api<OperatorSettings>('/operator/settings') });
  const [text, setText] = useState('');
  useEffect(() => setText(settings.data?.paymentInstructionsSource === 'console' ? (settings.data.paymentInstructions ?? '') : ''), [settings.data]);
  const save = useMutation({
    mutationFn: (instructions: string) => api<OperatorSettings>('/operator/settings/payment-instructions', { method: 'POST', json: { instructions } }),
    onSuccess: (d) => qc.setQueryData(['operator', 'settings'], d),
  });
  if (!me.data || settings.isPending) return <Skeleton className="h-64" />;
  if (settings.error) return <ErrorText error={settings.error} />;
  const s = settings.data;
  const admin = can(me.data, 'settings.manage');

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Deployment-wide settings. Changes are recorded in the operator log." />
      <Card>
        <CardHeader>
          <CardTitle>Payment instructions</CardTitle>
          <CardDescription>
            Shown on every invoice waiting for payment: your bank account details and anything the payer must quote. Workspaces see the change immediately. {SOURCE[s.paymentInstructionsSource]}
            {s.updatedBy && s.paymentInstructionsSource === 'console' && ` Last changed by ${s.updatedBy} on ${new Date(s.updatedAt!).toLocaleString(fmtLocale())}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {admin ? (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate(text);
              }}
            >
              <Field id="pay-instructions" label="Payment instructions" hint="Up to 2,000 characters. Line breaks are kept. Leave empty and save to remove.">
                <Textarea id="pay-instructions" rows={7} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Bank name\nAccount name\nAccount number\nIFSC / SWIFT code\nQuote the invoice number as the payment reference.'} />
              </Field>
              <Button type="submit" disabled={save.isPending || text.trim() === (s.paymentInstructionsSource === 'console' ? s.paymentInstructions : '')}>
                Save
              </Button>
              {save.isSuccess && <p role="status" className="text-sm text-muted-foreground">Saved. Open invoices now show this.</p>}
              <ErrorText error={save.error} />
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">Only operators with the Admin role can change this.</p>
          )}
          <div>
            <p className="text-sm font-medium">What open invoices show now</p>
            <p className="mt-1 whitespace-pre-line rounded-md border border-border bg-muted/30 p-3 text-sm">{s.paymentInstructions ?? 'The SampForce team will send payment details for this invoice.'}</p>
          </div>
        </CardContent>
      </Card>
      <HealthSettingsCard canEdit={admin} />
    </div>
  );
}

type SavedHealth = HealthSettings & { updatedAt: string | null; updatedBy: string | null };
const SIGNAL_HINT: Record<ClientHealthKey, string> = {
  login: 'Share of the client’s people who signed in in the last 14 days.',
  workspaces: 'Manager and Executive Workspaces in use against the limits. Not counted without limits.',
  features: 'Parts of the CRM used in the last 30 days: contacts, companies, deals, activities, tasks and RFQs.',
  mobile: 'Phone seats used in the last 14 days. Not counted while mobile access is off.',
  payment: 'Paid or waived scores full points, pending half, overdue or past due little or none.',
  support: 'Fewer open tickets, and none older than 48 hours, score higher.',
  subscription: 'Active scores full points, trial less, ending soon without renewal less again.',
};

/** Settings → Health score (ADR 0074, C5): the weight of each signal and where the bands start. */
function HealthSettingsCard({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['operator', 'settings', 'health'], queryFn: () => api<SavedHealth>('/operator/settings/health') });
  const [form, setForm] = useState<HealthSettings | null>(null);
  useEffect(() => {
    if (q.data) setForm({ weights: q.data.weights, thresholds: q.data.thresholds });
  }, [q.data]);
  const save = useMutation({
    mutationFn: (body: HealthSettings) => api<SavedHealth>('/operator/settings/health', { method: 'PUT', json: body }),
    onSuccess: (d) => qc.setQueryData(['operator', 'settings', 'health'], d),
  });
  if (q.error) return <ErrorText error={q.error} />;
  if (!form || !q.data) return <Skeleton className="h-64" />;
  const total = HEALTH_SIGNALS.reduce((a, k) => a + form.weights[k], 0);
  const dirty = JSON.stringify(form) !== JSON.stringify({ weights: q.data.weights, thresholds: q.data.thresholds });
  const bandError = form.thresholds.atRisk >= form.thresholds.healthy ? 'The At risk score must be lower than the Healthy score.' : undefined;
  const weightError = total === 0 ? 'Give at least one signal some weight.' : undefined;
  const num = (v: string) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
  return (
    <Card aria-labelledby="health-settings-h" data-health-settings="">
      <CardHeader>
        <CardTitle id="health-settings-h">Health score</CardTitle>
        <CardDescription>
          How much each signal counts towards a client’s health score. Weights are scaled to 100 over the signals that apply to each client. Saving measures every client again within a few minutes.
          {q.data.updatedBy && ` Last changed by ${q.data.updatedBy} on ${new Date(q.data.updatedAt!).toLocaleString(fmtLocale())}.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(form);
          }}
        >
          <fieldset disabled={!canEdit} className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <legend className="sr-only">Weights</legend>
            {HEALTH_SIGNALS.map((k) => (
              <Field key={k} id={`hw-${k}`} label={`${HEALTH_SIGNAL_LABEL[k]} weight`} hint={SIGNAL_HINT[k]}>
                <Input
                  id={`hw-${k}`}
                  type="number"
                  min={0}
                  max={100}
                  value={form.weights[k]}
                  onChange={(e) => setForm({ ...form, weights: { ...form.weights, [k]: num(e.target.value) } })}
                  className="w-28"
                />
              </Field>
            ))}
          </fieldset>
          {weightError && (
            <p role="alert" className="text-sm text-critical">
              {weightError}
            </p>
          )}
          <p className="text-sm text-muted-foreground" aria-live="polite">
            Weights add up to <span className="tabular font-medium text-foreground">{total}</span>; each is scaled so a client scores out of 100.
          </p>
          <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium">Bands</legend>
            <Field id="ht-healthy" label="Healthy from" hint="Scores at or above this are Healthy.">
              <Input id="ht-healthy" type="number" min={1} max={100} value={form.thresholds.healthy} onChange={(e) => setForm({ ...form, thresholds: { ...form.thresholds, healthy: num(e.target.value) } })} className="w-28" />
            </Field>
            <Field id="ht-risk" label="At risk from" hint="Scores at or above this, and below Healthy, are At risk. Lower scores are Critical." error={bandError}>
              <Input id="ht-risk" aria-invalid={!!bandError} type="number" min={0} max={99} value={form.thresholds.atRisk} onChange={(e) => setForm({ ...form, thresholds: { ...form.thresholds, atRisk: num(e.target.value) } })} className="w-28" />
            </Field>
          </fieldset>
          <ErrorText error={save.error} />
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={!dirty || save.isPending || !!bandError || !!weightError}>
                Save health score settings
              </Button>
              <Button type="button" variant="outline" onClick={() => setForm(DEFAULT_HEALTH_SETTINGS)}>
                Use the defaults
              </Button>
              {save.isSuccess && !dirty && (
                <p role="status" className="text-sm text-muted-foreground">
                  Saved. Every client is measured again within a few minutes.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Only operators who can manage settings can change this.</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

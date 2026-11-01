'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import type { OperatorSettings } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Textarea } from '@/components/crm/select';
import { PageHeader } from '@/components/page-header';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { useOperator } from '../operator-shell';
import { fmtLocale } from '@/lib/i18n/locale';

const SOURCE: Record<OperatorSettings['paymentInstructionsSource'], string> = {
  console: 'Set here',
  config: 'From the OFFLINE_PAYMENT_INSTRUCTIONS deployment setting. Saving here replaces it.',
  none: 'Not set. Open invoices say the DealFlow team will send payment details.',
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
  const admin = me.data.role === 'ADMIN';

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
            <p className="mt-1 whitespace-pre-line rounded-md border border-border bg-muted/30 p-3 text-sm">{s.paymentInstructions ?? 'The DealFlow team will send payment details for this invoice.'}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

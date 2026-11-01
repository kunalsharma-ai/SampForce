'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@dealflow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate, useSupportGrants } from '@/lib/billing';
import { useCan } from '@/lib/session';
import { fmtLocale } from '@/lib/i18n/locale';

/**
 * Time-boxed permission for DealFlow platform support to see this workspace's member list and audit
 * log. Support never sees CRM records, and every look is logged.
 */
export function SupportAccess() {
  const canManage = useCan('tenant:manage');
  const grants = useSupportGrants(canManage);
  const qc = useQueryClient();
  const [hours, setHours] = useState('4');
  const [reason, setReason] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['support-access'] });
  const grant = useMutation({ mutationFn: () => api('/support-access', { method: 'POST', json: { hours: Number(hours), reason } }), onSuccess: () => { setReason(''); void refresh(); } });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/support-access/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  if (!canManage) return null;
  const active = grants.data?.find((g) => g.active);

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Support access {active ? <Badge tone="warning">On until {new Date(active.expiresAt).toLocaleString(fmtLocale())}</Badge> : <Badge>Off</Badge>}
        </CardTitle>
        <CardDescription>Let DealFlow support see this workspace’s members and audit log for a limited time, for example while they help with a problem. Support never sees leads, deals or other CRM records.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {active ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted-foreground">Granted by {active.grantedBy?.name ?? 'a former member'}: “{active.reason}”</span>
            <Button size="sm" variant="outline" onClick={() => revoke.mutate(active.id)} disabled={revoke.isPending}>
              Turn off now
            </Button>
          </div>
        ) : (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              grant.mutate();
            }}
          >
            <Field id="support-hours" label="Hours (1–72)">
              <Input id="support-hours" type="number" min={1} max={72} value={hours} onChange={(e) => setHours(e.target.value)} className="w-24" />
            </Field>
            <Field id="support-reason" label="Reason" className="min-w-64 flex-1">
              <Input id="support-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} maxLength={500} required placeholder="What support is helping with" />
            </Field>
            <Button type="submit" disabled={grant.isPending || reason.trim().length < 5}>
              Grant access
            </Button>
          </form>
        )}
        <ErrorText error={grant.error ?? revoke.error} />
        {!!grants.data?.length && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">History</summary>
            <ul className="mt-2 space-y-1">
              {grants.data.map((g) => (
                <li key={g.id}>
                  {formatDate(g.createdAt)} · {g.reason} · {g.revokedAt ? `turned off ${formatDate(g.revokedAt)}` : g.active ? 'active' : `expired ${formatDate(g.expiresAt)}`}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import type { MobileAccessStatus, OperatorMobileAction, OperatorMobileDetail, OperatorMobileOverview } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/billing';
import { MOBILE_BLOCK, MOBILE_STATUS, PLATFORM_LABEL } from '@/lib/mobile';
import { fmtLocale } from '@/lib/i18n/locale';
import { useOperator } from '../../operator-shell';

/** What the Console can do from each status, with what each step means for the client. */
const ACTIONS: Record<MobileAccessStatus, { action: OperatorMobileAction; label: string; help: string; variant?: 'outline' | 'destructive' }[]> = {
  OFF: [{ action: 'approve', label: 'Enable mobile access', help: 'The Super Workspace can then set up the app and switch it on for its people.' }],
  REQUESTED: [
    { action: 'approve', label: 'Approve request', help: 'The Super Workspace can then set up the app and switch it on for its people.' },
    { action: 'reject', label: 'Reject request', help: 'The client sees your reason and can ask again.', variant: 'outline' },
  ],
  REJECTED: [{ action: 'approve', label: 'Enable mobile access', help: 'Approves without a new request.' }],
  APPROVED: [
    { action: 'suspend', label: 'Suspend', help: 'Phones are refused on their next request. Reinstating lets them carry on as before.', variant: 'outline' },
    { action: 'revoke', label: 'Revoke', help: 'Signs every phone out and clears the client’s activation. You would have to approve again.', variant: 'destructive' },
  ],
  SUSPENDED: [
    { action: 'reinstate', label: 'Reinstate', help: 'Restores the approval and the client’s activation as they were.' },
    { action: 'revoke', label: 'Revoke', help: 'Signs every phone out and clears the client’s activation.', variant: 'destructive' },
  ],
  REVOKED: [{ action: 'approve', label: 'Approve again', help: 'The Super Workspace then has to switch the app on again.' }],
};

const HISTORY_LABEL: Record<string, string> = {
  'mobile.approve': 'Approved',
  'mobile.reject': 'Rejected',
  'mobile.suspend': 'Suspended',
  'mobile.reinstate': 'Reinstated',
  'mobile.revoke': 'Revoked',
  'mobile.limits': 'Phone limit changed',
};

export default function OperatorMobileTenantPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const me = useOperator();
  const key = ['operator', 'mobile', tenantId];
  const q = useQuery({ enabled: !!me.data, queryKey: key, queryFn: () => api<OperatorMobileDetail>(`/operator/mobile/${tenantId}`) });
  // The organisation's name comes from the overview (already loaded when arriving from the list).
  const overview = useQuery({ enabled: !!me.data, queryKey: ['operator', 'mobile'], queryFn: () => api<OperatorMobileOverview>('/operator/mobile') });
  if (!me.data || q.isPending) return <Skeleton className="h-96" />;
  if (q.error) return <ErrorText error={q.error} />;
  const d = q.data;
  const s = d.state;
  const admin = me.data.role === 'ADMIN';
  const name = overview.data?.rows.find((r) => r.tenantId === tenantId)?.name ?? 'Organisation';

  return (
    <div className="space-y-6">
      <Link href="/operator/mobile" className="text-sm text-primary underline-offset-2 hover:underline">
        ← All organisations
      </Link>
      <PageHeader
        title={`${name}: mobile app`}
        description="The Console decides whether this client may use the app; the client’s Super Workspace then switches it on for its people."
        actions={
          <Link href={`/operator/tenants/${tenantId}`} className="text-sm text-primary underline-offset-2 hover:underline">
            Subscription and plan features
          </Link>
        }
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Mobile access
            <Badge tone={MOBILE_STATUS[s.status].tone}>{MOBILE_STATUS[s.status].label}</Badge>
            {s.live ? <Badge tone="success">Phones can sign in</Badge> : <Badge>Phones cannot sign in</Badge>}
          </CardTitle>
          <CardDescription>{s.blockedBy ? MOBILE_BLOCK[s.blockedBy] : `Switched on by the client${s.activatedBy ? ` (${s.activatedBy})` : ''}${s.activatedAt ? ` on ${formatDate(s.activatedAt)}` : ''}.`}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ul className="grid gap-2 sm:grid-cols-3">
            <Step done={s.inPlan} label="Plan includes the mobile app" hint={s.inPlan ? undefined : 'Add “Mobile app” to the plan on the Plans page, or switch it on for this client under Plan features.'} />
            <Step done={s.status === 'APPROVED'} label="Approved by the Console" />
            <Step done={s.activated} label="Switched on by the Super Workspace" />
          </ul>
          {s.request && (
            <div className="rounded-md border border-border p-3">
              <p className="font-medium">Request from {s.request.requestedBy ?? 'the client'} on {formatDate(s.request.requestedAt)}</p>
              {s.request.message && <p className="mt-1 text-muted-foreground">“{s.request.message}”</p>}
            </div>
          )}
          {s.decision && (
            <p className="text-muted-foreground">
              Last decision: {MOBILE_STATUS[s.decision.status].label.toLowerCase()} on {formatDate(s.decision.decidedAt)}
              {s.decision.reason ? `: “${s.decision.reason}”` : ''}
            </p>
          )}
          {admin ? <Decide tenantId={tenantId} status={s.status} /> : <p className="text-muted-foreground">Only console admins can change mobile access.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Phones</CardTitle>
          <CardDescription>
            {s.devices.active} signed in · {s.devices.ios} iPhone · {s.devices.android} Android
            {s.maxDevices ? ` · limit ${s.maxDevices}` : ' · no limit'}. Names show only while the client grants support access.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {d.devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No phones are signed in.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <caption className="sr-only">Signed-in phones</caption>
                <thead className="text-start text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="p-2 text-start font-medium">Phone</th>
                    <th scope="col" className="p-2 text-start font-medium">Person</th>
                    <th scope="col" className="p-2 text-start font-medium">App version</th>
                    <th scope="col" className="p-2 text-start font-medium">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {d.devices.map((x) => (
                    <tr key={x.id} className="border-t border-border">
                      <td className="p-2">
                        {PLATFORM_LABEL[x.platform]} {x.model && <span className="text-muted-foreground">· {x.model}</span>} {x.osVersion && <span className="text-muted-foreground">· {x.osVersion}</span>}
                      </td>
                      <td className="p-2">{x.person ? `${x.person.name} · ${x.person.email}` : <span className="text-muted-foreground">hidden</span>}</td>
                      <td className="p-2">{x.appVersion ?? '—'}</td>
                      <td className="p-2 text-muted-foreground">{new Date(x.lastSeenAt).toLocaleString(fmtLocale())}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {admin && <Limits tenantId={tenantId} current={s.maxDevices} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {d.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No decisions yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {d.history.map((h, i) => (
                <li key={i}>
                  <span className="text-muted-foreground">{new Date(h.at).toLocaleString(fmtLocale())}</span> {HISTORY_LABEL[h.action] ?? h.action}
                  {h.by && <span className="text-muted-foreground"> by {h.by}</span>}
                  {h.reason && <span>: “{h.reason}”</span>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Step({ done, label, hint }: { done: boolean; label: string; hint?: string | undefined }) {
  return (
    <li className={`rounded-md border p-3 ${done ? 'border-success/40 bg-success/5' : 'border-border'}`}>
      <span className="font-medium">{done ? '✓' : '○'} {label}</span>
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </li>
  );
}

function useMobileAction(tenantId: string, path: string, method: 'POST' | 'PUT') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (json: object) => api<OperatorMobileDetail>(`/operator/mobile/${tenantId}/${path}`, { method, json }),
    onSuccess: (d) => {
      qc.setQueryData(['operator', 'mobile', tenantId], d);
      void qc.invalidateQueries({ queryKey: ['operator', 'mobile'], exact: true });
    },
  });
}

function Decide({ tenantId, status }: { tenantId: string; status: MobileAccessStatus }) {
  const [reason, setReason] = useState('');
  const act = useMobileAction(tenantId, 'decision', 'POST');
  const options = ACTIONS[status];
  return (
    <div className="space-y-3 border-t border-border pt-4">
      <Field id="mob-reason" label="Reason (the client sees it; recorded in both audit logs)">
        <Input id="mob-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} placeholder="For example: approved for the field sales team" />
      </Field>
      <div className="flex flex-wrap gap-3">
        {options.map((o) => (
          <div key={o.action} className="max-w-xs space-y-1">
            <Button variant={o.variant ?? 'default'} disabled={act.isPending || reason.trim().length < 5} onClick={() => act.mutate({ action: o.action, reason }, { onSuccess: () => setReason('') })}>
              {o.label}
            </Button>
            <p className="text-xs text-muted-foreground">{o.help}</p>
          </div>
        ))}
      </div>
      <ErrorText error={act.error} />
    </div>
  );
}

function Limits({ tenantId, current }: { tenantId: string; current: number | null }) {
  const [max, setMax] = useState(current ? String(current) : '');
  const [reason, setReason] = useState('');
  const save = useMobileAction(tenantId, 'limits', 'PUT');
  return (
    <form
      className="flex flex-wrap items-end gap-3 border-t border-border pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ maxDevices: max.trim() ? Number(max) : null, reason }, { onSuccess: () => setReason('') });
      }}
    >
      <Field id="mob-max" label="Most phones signed in at once (empty = no limit)">
        <Input id="mob-max" type="number" min={1} value={max} onChange={(e) => setMax(e.target.value)} className="w-40" />
      </Field>
      <Field id="mob-limit-reason" label="Reason" className="min-w-56 flex-1">
        <Input id="mob-limit-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} />
      </Field>
      <Button type="submit" variant="outline" disabled={save.isPending || reason.trim().length < 5}>
        Save limit
      </Button>
      <ErrorText error={save.error} />
    </form>
  );
}

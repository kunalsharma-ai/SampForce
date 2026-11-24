'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dealflow/ui';
import type { ConsoleSecurityPolicy, ConsoleSecurityPolicyUpdate, OperatorLoginEventRow, OperatorSessionRow } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, LockKeyhole, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { ConsoleDenied, ConsoleLoading } from '@/components/console/console-states';
import { PageHeader } from '@/components/page-header';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { selectClass } from '../console-ui';
import { can, useOperator } from '../operator-shell';
import { LoginTable, SessionList } from '../security-ui';

const IDLE = [15, 30, 60, 120, 240, 480];

/**
 * Console security (ADR 0074): the sign-in policy, every open operator session, and the sign-in history with unusual
 * sign-ins flagged. For operators whose role manages security.
 */
export default function ConsoleSecurityPage() {
  const me = useOperator();
  const allowed = can(me.data, 'security.manage');
  const qc = useQueryClient();
  const [onlyUnusual, setOnlyUnusual] = useState(false);
  const policy = useQuery({ enabled: allowed, queryKey: ['operator', 'security', 'policy'], queryFn: () => api<ConsoleSecurityPolicy>('/operator/security/policy') });
  const sessions = useQuery({ enabled: allowed, queryKey: ['operator', 'security', 'sessions'], queryFn: () => api<OperatorSessionRow[]>('/operator/security/sessions') });
  const logins = useQuery({
    enabled: allowed,
    queryKey: ['operator', 'security', 'logins', onlyUnusual],
    queryFn: () => api<OperatorLoginEventRow[]>(`/operator/security/logins?limit=100${onlyUnusual ? '&suspicious=true' : ''}`),
  });
  const save = useMutation({
    mutationFn: (p: ConsoleSecurityPolicyUpdate) => api<ConsoleSecurityPolicy>('/operator/security/policy', { method: 'PUT', json: p }),
    onSuccess: (p) => {
      qc.setQueryData(['operator', 'security', 'policy'], p);
      void qc.invalidateQueries({ queryKey: ['operator', 'me'] });
    },
  });

  if (!me.data) return <ConsoleLoading />;
  if (!allowed) return <ConsoleDenied />;
  const p = policy.data;
  const unusual = (logins.data ?? []).filter((e) => e.suspicious).length;
  const failed = (logins.data ?? []).filter((e) => e.outcome !== 'success').length;

  return (
    <>
      <PageHeader title="Security" description="How operators sign in, who is signed in now, and every sign-in attempt." />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          { label: 'Open sessions', value: sessions.data?.length, icon: MonitorSmartphone },
          { label: 'Failed sign-ins (latest 100)', value: onlyUnusual ? '—' : failed, icon: LockKeyhole },
          { label: 'Unusual sign-ins', value: unusual, icon: AlertTriangle },
        ].map((k) => (
          <Card key={k.label} className="flex items-center gap-3 p-4">
            <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <k.icon className="size-5" aria-hidden />
            </span>
            <span>
              <span className="block text-xs text-muted-foreground">{k.label}</span>
              <span className="block text-xl font-semibold tabular">{k.value ?? '…'}</span>
            </span>
          </Card>
        ))}
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" aria-hidden /> Sign-in policy
          </CardTitle>
          <CardDescription>Applies to every operator. Changes are recorded in the audit log.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ErrorText error={policy.error ?? save.error} />
          {p ? (
            <>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1" checked={p.requireMfa} disabled={save.isPending} onChange={(e) => save.mutate({ requireMfa: e.target.checked })} data-policy="requireMfa" />
                <span>
                  <span className="block font-medium">Require two-step verification</span>
                  <span className="block text-muted-foreground">Operators without it can only open their account page until they turn it on. Turn it on for yourself first.</span>
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label htmlFor="policy-idle" className="font-medium">
                  End a session after
                </label>
                <select id="policy-idle" className={`${selectClass} !w-44`} value={p.idleMinutes} disabled={save.isPending} onChange={(e) => save.mutate({ idleMinutes: Number(e.target.value) })}>
                  {IDLE.map((m) => (
                    <option key={m} value={m}>
                      {m < 60 ? `${m} minutes` : `${m / 60} ${m === 60 ? 'hour' : 'hours'}`} idle
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-sm text-muted-foreground">
                After {p.lockoutAttempts} failed attempts in a row, sign-in pauses for {p.lockoutMinutes} minutes. The answer is the same as a wrong password, so it does not reveal which emails have accounts.
              </p>
            </>
          ) : (
            <ConsoleLoading rows={1} />
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Open sessions</CardTitle>
          <CardDescription>Every browser signed in to the Console now. Signing one out takes effect on its next click.</CardDescription>
        </CardHeader>
        <ErrorText error={sessions.error} />
        {sessions.data ? <SessionList rows={sessions.data} showOperator /> : <ConsoleLoading rows={1} />}
      </Card>

      <section aria-labelledby="sec-logins">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="sec-logins" className="font-medium">
            Sign-in history
          </h2>
          <Button size="sm" variant={onlyUnusual ? 'default' : 'outline'} aria-pressed={onlyUnusual} onClick={() => setOnlyUnusual((v) => !v)}>
            <AlertTriangle className="size-4" aria-hidden /> Only unusual sign-ins
          </Button>
        </div>
        <ErrorText error={logins.error} />
        {logins.data ? <LoginTable rows={logins.data} showOperator /> : <ConsoleLoading rows={1} />}
      </section>
    </>
  );
}

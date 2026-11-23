'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dealflow/ui';
import type { OperatorLoginEventRow, OperatorSessionRow } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { TwoStepCard } from '@/app/app/account/security/two-step-card';
import { ConsoleLoading } from '@/components/console/console-states';
import { PageHeader } from '@/components/page-header';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { useOperator } from '../operator-shell';
import { LoginTable, SessionList } from '../security-ui';

/**
 * The operator's own account (ADR 0074): who they are and their role, two-step verification, the browsers they are
 * signed in on, and their recent sign-ins. When the security policy requires two-step verification, it opens here.
 */
export default function OperatorAccountPage() {
  const me = useOperator();
  const qc = useQueryClient();
  const sessions = useQuery({ enabled: !!me.data, queryKey: ['operator', 'me', 'sessions'], queryFn: () => api<OperatorSessionRow[]>('/operator/me/sessions') });
  const logins = useQuery({ enabled: !!me.data, queryKey: ['operator', 'me', 'logins'], queryFn: () => api<OperatorLoginEventRow[]>('/operator/me/logins') });
  const endOthers = useMutation({
    mutationFn: () => api<{ ended: number }>('/operator/me/sessions/end-others', { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['operator', 'me', 'sessions'] }),
  });
  if (!me.data) return <ConsoleLoading />;
  const others = (sessions.data ?? []).filter((s) => !s.current).length;
  return (
    <>
      <PageHeader title="Account & security" description="Your Console sign-in: two-step verification, open sessions and recent sign-ins." />
      {me.data.mfaSetupRequired && (
        <div role="alert" className="mb-6 flex items-start gap-3 rounded-2xl border border-warning/50 bg-warning/10 p-4" data-mfa-required="">
          <ShieldAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="text-sm">
            <p className="font-medium">Turn on two-step verification to continue</p>
            <p className="text-muted-foreground">The Console’s security policy asks every operator for an authenticator code. The rest of the Console opens once it is on.</p>
          </div>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Ask a Super Admin to change your role.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
                <dt className="text-muted-foreground">Name</dt>
                <dd>{me.data.name}</dd>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="break-all">{me.data.email}</dd>
                <dt className="text-muted-foreground">Role</dt>
                <dd data-account-role>{me.data.roleName}</dd>
                <dt className="text-muted-foreground">Permissions</dt>
                <dd>{me.data.permissions.length} of 22</dd>
              </dl>
            </CardContent>
          </Card>
          <TwoStepCard base="/operator/me/mfa" />
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
              <div>
                <CardTitle>Where you are signed in</CardTitle>
                <CardDescription>Sign out a browser you no longer use.</CardDescription>
              </div>
              {others > 0 && (
                <Button size="sm" variant="outline" disabled={endOthers.isPending} onClick={() => endOthers.mutate()}>
                  Sign out everywhere else
                </Button>
              )}
            </CardHeader>
            <ErrorText error={sessions.error ?? endOthers.error} />
            {sessions.data ? <SessionList rows={sessions.data} /> : <ConsoleLoading rows={1} />}
          </Card>
          <section aria-labelledby="my-logins">
            <h2 id="my-logins" className="mb-3 font-medium">
              Recent sign-ins
            </h2>
            <ErrorText error={logins.error} />
            {logins.data ? <LoginTable rows={logins.data} /> : <ConsoleLoading rows={1} />}
          </section>
        </div>
      </div>
    </>
  );
}

'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import type { MobileAccessState, MobileDeviceRow } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Circle, SlidersHorizontal, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { MOBILE_BLOCK, MOBILE_STATUS, PLATFORM_LABEL } from '@/lib/mobile';
import { useCan } from '@/lib/session';

/**
 * The Super Workspace's side of mobile access (ADR 0072): ask the SampForce team for it, switch it on once approved,
 * and see or sign out the phones in use. Every rule is enforced by the API; this page only shows them.
 */
export function MobileAccessSettings() {
  const t = useT();
  const canManage = useCan('tenant:manage');
  const qc = useQueryClient();
  const state = useQuery({ enabled: canManage, queryKey: ['mobile-access'], queryFn: () => api<MobileAccessState>('/mobile-access') });
  const devices = useQuery({ enabled: canManage, queryKey: ['mobile-access', 'devices'], queryFn: () => api<MobileDeviceRow[]>('/mobile-access/devices') });
  const [message, setMessage] = useState('');
  const onState = (s: MobileAccessState) => {
    qc.setQueryData(['mobile-access'], s);
    void qc.invalidateQueries({ queryKey: ['mobile-access', 'devices'] });
  };
  const request = useMutation({ mutationFn: () => api<MobileAccessState>('/mobile-access/request', { method: 'POST', json: message.trim() ? { message: message.trim() } : {} }), onSuccess: onState });
  const activation = useMutation({ mutationFn: (activated: boolean) => api<MobileAccessState>('/mobile-access/activation', { method: 'PUT', json: { activated } }), onSuccess: onState });
  const signOut = useMutation({
    mutationFn: (id: string) => api<MobileDeviceRow[]>(`/mobile-access/devices/${id}`, { method: 'DELETE' }),
    onSuccess: (rows) => {
      qc.setQueryData(['mobile-access', 'devices'], rows);
      void qc.invalidateQueries({ queryKey: ['mobile-access'], exact: true });
    },
  });

  if (!canManage) return <p className="text-sm text-muted-foreground">{t('Only owners and administrators can manage the mobile app.')}</p>;
  if (state.isPending) return <Skeleton className="h-72" />;
  if (state.error) return <ErrorText error={state.error} />;
  const s = state.data;
  const canAsk = s.status === 'OFF' || s.status === 'REJECTED' || s.status === 'REVOKED';
  const steps = [
    { done: s.inPlan, label: t('Your plan includes the mobile app') },
    { done: s.status === 'APPROVED', label: t('Approved by the SampForce team') },
    { done: s.activated, label: t('Switched on for your organisation') },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Smartphone className="size-5 text-primary" aria-hidden />
            {t('Mobile access')}
            <Badge tone={MOBILE_STATUS[s.status].tone}>{t.maybe(MOBILE_STATUS[s.status].label)}</Badge>
            {s.live && <Badge tone="success">{t('Your people can sign in')}</Badge>}
          </CardTitle>
          <CardDescription>{s.blockedBy ? t.maybe(MOBILE_BLOCK[s.blockedBy]) : t('Your people sign in to the app with their SampForce email and password.')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 text-sm">
          <ol className="grid gap-2 sm:grid-cols-3" aria-label={t('Steps to use the mobile app')}>
            {steps.map((step) => (
              <li key={step.label} className={`flex items-start gap-2 rounded-md border p-3 ${step.done ? 'border-success/40 bg-success/5' : 'border-border'}`}>
                {step.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
                <span>
                  {step.label}
                  <span className="sr-only">{step.done ? ` (${t('done')})` : ` (${t('not yet')})`}</span>
                </span>
              </li>
            ))}
          </ol>

          {s.decision?.reason && (s.status === 'REJECTED' || s.status === 'SUSPENDED' || s.status === 'REVOKED') && (
            <p className="rounded-md border border-warning/40 bg-warning/5 p-3">{t('Reason from the SampForce team: “{reason}”', { reason: s.decision.reason })}</p>
          )}

          {canAsk && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                request.mutate(undefined, { onSuccess: () => setMessage('') });
              }}
            >
              <label htmlFor="mobile-request" className="block font-medium">
                {t('Ask the SampForce team for mobile access')}
              </label>
              <textarea
                id="mobile-request"
                className="min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm"
                maxLength={1000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('Optional: who will use the app and how many phones')}
              />
              <Button type="submit" disabled={request.isPending}>
                {t('Request mobile access')}
              </Button>
            </form>
          )}

          {s.status === 'REQUESTED' && <p>{t('Your request was sent. You can switch the app on here as soon as the SampForce team approves it.')}</p>}

          {s.status === 'APPROVED' && (
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              {s.activated ? (
                <>
                  <p className="flex-1">{t('Mobile access is on. Switching it off signs every phone out; your data and web access stay as they are.')}</p>
                  <Button variant="outline" disabled={activation.isPending} onClick={() => activation.mutate(false)}>
                    {t('Switch mobile access off')}
                  </Button>
                </>
              ) : (
                <>
                  <p className="flex-1">{t('Approved. Switch it on when you are ready for your people to sign in on their phones.')}</p>
                  <Button disabled={activation.isPending || !s.inPlan} onClick={() => activation.mutate(true)}>
                    {t('Switch mobile access on')}
                  </Button>
                </>
              )}
            </div>
          )}
          <ErrorText error={request.error ?? activation.error} />
        </CardContent>
      </Card>

      {s.inPlan && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SlidersHorizontal className="size-5 text-primary" aria-hidden />
              {t('Mobile configuration')}
            </CardTitle>
            <CardDescription>{t('Decide how the app looks and what each workspace level sees and may do, preview it, and publish it to phones.')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/app/settings/mobile/configure" className="inline-flex h-control items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              {t('Open the Configuration Center')}
            </Link>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('Phones signed in')}</CardTitle>
          <CardDescription>
            {s.maxDevices
              ? t('Phones in use: {count} of {max}.', { count: s.devices.active, max: s.maxDevices })
              : t('Phones in use: {count}.', { count: s.devices.active })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {devices.isPending ? (
            <Skeleton className="h-24" />
          ) : !devices.data?.length ? (
            <p className="text-sm text-muted-foreground">{t('No phones are signed in.')}</p>
          ) : (
            <ul className="divide-y divide-border" aria-label={t('Phones signed in')}>
              {devices.data.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{d.person?.name ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.maybe(PLATFORM_LABEL[d.platform])}
                      {d.model ? ` · ${d.model}` : ''}
                      {d.appVersion ? ` · ${t('app {version}', { version: d.appVersion })}` : ''}
                      {` · ${t('last seen {time}', { time: new Date(d.lastSeenAt).toLocaleString(t.formatLocale) })}`}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" disabled={signOut.isPending} onClick={() => signOut.mutate(d.id)} aria-label={t('Sign out {name}’s phone', { name: d.person?.name ?? '' })}>
                    {t('Sign out')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <ErrorText error={devices.error ?? signOut.error} />
        </CardContent>
      </Card>
    </div>
  );
}

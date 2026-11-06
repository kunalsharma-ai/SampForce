'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dealflow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { AUTH_METHOD_LABEL, describeDevice, useSessions } from '@/lib/security';
import { fmtLocale } from '@/lib/i18n/locale';
import { useT } from '@/lib/i18n';
import { InfoTip } from '@/components/info-tip';

/** The caller's live sessions, with sign-out for one device or all the others. */
export function DeviceList() {
  const t = useT();
  const sessions = useSessions();
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ['sessions'] });
  const one = useMutation({ mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: 'DELETE' }), onSuccess: done });
  const others = useMutation({ mutationFn: () => api('/auth/sessions/revoke-others', { method: 'POST' }), onSuccess: done });
  const rows = sessions.data ?? [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle>{t('Signed-in devices')}</CardTitle>
          <InfoTip topic="account.devices" />
        </div>
        <CardDescription>{t('Signing a device out ends its access straight away. If you do not recognise a device, sign it out and change your password.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {sessions.isPending ? (
          <p className="text-sm text-muted-foreground">{t('Loading…')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {rows.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-medium">
                    {describeDevice(s.userAgent)} {s.current && <Badge tone="success">{t('This device')}</Badge>}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {AUTH_METHOD_LABEL[s.method]} · last active {new Date(s.lastActiveAt).toLocaleString(fmtLocale())}
                    {s.ipAddress ? ` · ${s.ipAddress}` : ''}
                  </span>
                </span>
                {!s.current && (
                  <Button size="sm" variant="outline" onClick={() => one.mutate(s.id)} disabled={one.isPending} aria-label={t('Sign out {name}', { name: describeDevice(s.userAgent) })}>
                    {t('Sign out')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {rows.length > 1 && (
          <Button variant="outline" onClick={() => others.mutate()} disabled={others.isPending}>
            {t('Sign out all other devices')}
          </Button>
        )}
        <ErrorText error={one.error ?? others.error ?? sessions.error} />
      </CardContent>
    </Card>
  );
}

'use client';

import { Button, Card, CardContent, Skeleton } from '@dealflow/ui';
import { useEffect, useState } from 'react';
import { rich, useT } from '@/lib/i18n';

type Info = { valid: false } | { valid: true; email: string; workspace: string; unsubscribed: boolean };

/**
 * The page behind the unsubscribe link in sequence emails. It asks for a click before acting, so link
 * scanners that open every URL do not unsubscribe people by accident. Mail apps that support one-click
 * unsubscribe post to the API directly instead.
 */
export function Unsubscribe({ token }: { token: string }) {
  const t = useT();
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const url = `/api/v1/t/u/${encodeURIComponent(token)}`;

  useEffect(() => {
    fetch(url)
      .then(async (r) => setInfo(r.ok ? ((await r.json()) as Info) : { valid: false }))
      .catch(() => setInfo({ valid: false }));
  }, [url]);

  if (!info) return <Skeleton className="h-40 w-full" />;
  if (!info.valid)
    return (
      <Card className="w-full">
        <CardContent className="p-6 text-sm">{t('This unsubscribe link is not valid. Reply to the email and ask the sender to stop emailing you.')}</CardContent>
      </Card>
    );
  return (
    <Card className="w-full">
      <CardContent className="space-y-4 p-6">
        {info.unsubscribed ? (
          <div role="status" className="space-y-2">
            <h1 className="text-lg font-semibold">{t('You are unsubscribed')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('{workspace} will not send more sequence emails to {email}.', { workspace: info.workspace, email: info.email })}
            </p>
          </div>
        ) : (
          <>
            <h1 className="text-lg font-semibold">{t('Stop emails from {workspace}?', { workspace: info.workspace })}</h1>
            <p className="text-sm text-muted-foreground">
              {rich(t('We will stop sending follow-up emails to {email} and add it to their do-not-email list.'), { email: <span className="font-medium text-foreground">{info.email}</span> })}
            </p>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const r = await fetch(url, { method: 'POST' });
                  if (!r.ok) throw new Error();
                  setInfo((await r.json()) as Info);
                } catch {
                  setError(t('Something went wrong. Please try again.'));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {t('Unsubscribe')}
            </Button>
            {error && (
              <p role="alert" className="text-sm text-critical">
                {error}
              </p>
            )}
          </>
        )}
        <p className="text-xs text-muted-foreground">{t('Sent with DealFlow on behalf of {workspace}.', { workspace: info.workspace })}</p>
      </CardContent>
    </Card>
  );
}

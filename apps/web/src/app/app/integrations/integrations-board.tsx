'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Skeleton } from '@dealflow/ui';
import { DOMAIN_EVENT_TYPES, type DomainEventType, type ProviderStatus, type WebhookCreated, type WebhookRow } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy, RefreshCw, Trash2 } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useIntegrations, useWebhooks } from '@/lib/automation';
import { relativeTime } from '@/lib/format';
import { useCan } from '@/lib/session';
import { rich, useT } from '@/lib/i18n';

const OUTCOME: Record<string, string> = {
  oauth_state_invalid: 'The sign-in link expired or belonged to another session. Try connecting again.',
  access_denied: 'The connection was canceled at the provider.',
  missing_code: 'The provider did not return an authorization code.',
};

export function MailboxConnections() {
  const t = useT();
  const params = useSearchParams();
  const qc = useQueryClient();
  const status = useIntegrations();
  const canConnect = useCan('activities:write');
  const connected = params.get('connected');
  const error = params.get('error');
  const refresh = () => qc.invalidateQueries({ queryKey: ['integrations'] });
  const connect = useMutation({
    mutationFn: (p: string) => api<{ url: string }>(`/integrations/${p}/connect`, { method: 'POST' }),
    onSuccess: ({ url }) => window.location.assign(url),
  });
  const sync = useMutation({
    mutationFn: (p: string) => api<{ emails: number; meetings: number }>(`/integrations/${p}/sync`, { method: 'POST' }),
    onSettled: () => Promise.all([refresh(), qc.invalidateQueries({ queryKey: ['emails'] }), qc.invalidateQueries({ queryKey: ['meetings'] })]),
  });
  const disconnect = useMutation({ mutationFn: (p: string) => api(`/integrations/${p}`, { method: 'DELETE' }), onSuccess: refresh });

  return (
    <section aria-labelledby="mailbox-heading" className="space-y-3">
      <h2 id="mailbox-heading" className="text-base font-semibold">
        {t('Your mailbox and calendar')}
      </h2>
      {connected && <p className="rounded-md border border-success/40 bg-success/10 p-3 text-sm">{t('Connected. The first sync runs within a few minutes, or press Sync now.')}</p>}
      {error && (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 p-3 text-sm text-critical">
          {OUTCOME[error] ? t.maybe(OUTCOME[error]) : t('The connection did not complete ({error}).', { error })}
        </p>
      )}
      {status.isPending ? (
        <Skeleton className="h-32" />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {status.data?.map((p) => (
            <ProviderCard
              key={p.provider}
              p={p}
              canConnect={canConnect}
              busy={connect.isPending || sync.isPending || disconnect.isPending}
              onConnect={() => connect.mutate(p.provider.toLowerCase())}
              onSync={() => sync.mutate(p.provider.toLowerCase())}
              onDisconnect={() => window.confirm(t('Disconnect this account? Synced email and meetings stay on your records.')) && disconnect.mutate(p.provider.toLowerCase())}
            />
          ))}
        </div>
      )}
      {sync.data && <p className="text-sm text-muted-foreground" aria-live="polite">{t('Sync finished: {emails} new emails, {meetings} meetings updated.', { emails: sync.data.emails, meetings: sync.data.meetings })}</p>}
      {(connect.error ?? sync.error ?? disconnect.error) && (
        <p role="alert" className="text-sm text-critical">
          {(connect.error ?? sync.error ?? disconnect.error)!.message}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {t('Each person connects their own account. SampForce reads mail and calendar events only to find conversations and meetings with your contacts and leads, stores only those, and keeps tokens encrypted. Sending is limited per person per day.')}
      </p>
    </section>
  );
}

function ProviderCard({ p, canConnect, busy, onConnect, onSync, onDisconnect }: { p: ProviderStatus; canConnect: boolean; busy: boolean; onConnect: () => void; onSync: () => void; onDisconnect: () => void }) {
  const t = useT();
  const c = p.connection;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          {p.name}
          {!p.configured ? (
            <Badge>{t('Not set up on this installation')}</Badge>
          ) : c?.status === 'CONNECTED' ? (
            <Badge tone="success">{t('Connected')}</Badge>
          ) : c?.status === 'ERROR' ? (
            <Badge tone="critical">{t('Needs attention')}</Badge>
          ) : (
            <Badge>{t('Not connected')}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {!p.configured && <p className="text-muted-foreground">{t('An operator must add {settings} (an OAuth app registered with the provider) before anyone can connect.', { settings: new Intl.ListFormat(t.language, { type: 'conjunction' }).format(p.missingConfig) })}</p>}
        {c && (
          <div className="space-y-1">
            <p>{c.accountEmail}</p>
            <p className="text-xs text-muted-foreground">{c.lastSyncAt ? t('Last synced {time}', { time: relativeTime(c.lastSyncAt) }) : t('Not synced yet')}</p>
            {c.lastError && <p className="text-xs text-critical">{c.lastError}</p>}
          </div>
        )}
        {p.configured && canConnect && (
          <div className="flex flex-wrap gap-2">
            {(!c || c.status === 'ERROR') && (
              <Button size="sm" onClick={onConnect} disabled={busy}>
                {c ? t('Reconnect') : t('Connect')}
              </Button>
            )}
            {c?.status === 'CONNECTED' && (
              <Button size="sm" variant="outline" onClick={onSync} disabled={busy}>
                <RefreshCw aria-hidden /> {t('Sync now')}
              </Button>
            )}
            {c && (
              <Button size="sm" variant="ghost" onClick={onDisconnect} disabled={busy}>
                {t('Disconnect')}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function WebhooksManager() {
  const t = useT();
  const canManage = useCan('integrations:manage');
  const qc = useQueryClient();
  const hooks = useWebhooks(canManage);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<DomainEventType[]>(['deal.won']);
  const [secret, setSecret] = useState<WebhookCreated | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['webhooks'] });
  const create = useMutation({
    mutationFn: () => api<WebhookCreated>('/webhooks', { method: 'POST', json: { url, events } }),
    onSuccess: (w) => {
      setSecret(w);
      setUrl('');
      void refresh();
    },
  });
  const update = useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => api(`/webhooks/${id}`, { method: 'PATCH', json: { active } }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api(`/webhooks/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const redeliver = useMutation({ mutationFn: ({ id, deliveryId }: { id: string; deliveryId: string }) => api(`/webhooks/${id}/deliveries/${deliveryId}/redeliver`, { method: 'POST' }), onSuccess: refresh });

  if (!canManage) return null;
  return (
    <section aria-labelledby="webhooks-heading" className="space-y-3">
      <h2 id="webhooks-heading" className="text-base font-semibold">
        {t('Outbound webhooks')}
      </h2>
      <p className="text-sm text-muted-foreground">
        {t('SampForce posts signed JSON to your endpoint when the selected events happen. Failed deliveries retry with backoff (about 6 attempts over 9 hours); an endpoint that keeps failing is switched off and admins are notified.')}
      </p>
      <Card>
        <CardContent className="space-y-3 p-4">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="hook-url">{t('Endpoint URL')}</Label>
              <Input id="hook-url" type="url" placeholder="https://example.com/dealflow" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2000} />
            </div>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium">{t('Events')}</legend>
              <div className="grid gap-1 sm:grid-cols-3">
                {DOMAIN_EVENT_TYPES.map((ev) => (
                  <label key={ev} className="flex min-h-6 items-center gap-2 font-mono text-xs">
                    <input
                      type="checkbox"
                      className="size-4 accent-[hsl(var(--primary))]"
                      checked={events.includes(ev)}
                      onChange={(e) => setEvents((cur) => (e.target.checked ? [...cur, ev] : cur.filter((x) => x !== ev)))}
                    />
                    {ev}
                  </label>
                ))}
              </div>
            </fieldset>
            {create.error && (
              <p role="alert" className="text-sm text-critical">
                {create.error.message}
              </p>
            )}
            <Button type="submit" disabled={!url || events.length === 0 || create.isPending}>
              {t('Add webhook')}
            </Button>
          </form>
          {secret && (
            <div role="status" className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              <p className="font-medium">{t('Signing secret, shown once. Store it in your receiver now.')}</p>
              <div className="flex items-center gap-2">
                <code className="break-all text-xs">{secret.secret}</code>
                <Button type="button" variant="ghost" size="icon" aria-label={t('Copy secret')} onClick={() => void navigator.clipboard?.writeText(secret.secret)}>
                  <Copy aria-hidden />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">{rich(t('Verify the {header} header: {format} in hex.'), { header: 'X-SampForce-Signature', format: <code>{'t=<unix time>,v1=HMAC-SHA256(secret, "t.body")'}</code> })}</p>
            </div>
          )}
        </CardContent>
      </Card>
      {hooks.data?.map((h) => (
        <HookCard key={h.id} hook={h} onToggle={(active) => update.mutate({ id: h.id, active })} onDelete={() => window.confirm(t('Delete this webhook?')) && remove.mutate(h.id)} onRedeliver={(deliveryId) => redeliver.mutate({ id: h.id, deliveryId })} />
      ))}
    </section>
  );
}

function HookCard({ hook: h, onToggle, onDelete, onRedeliver }: { hook: WebhookRow; onToggle: (a: boolean) => void; onDelete: () => void; onRedeliver: (id: string) => void }) {
  const t = useT();
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-all text-sm font-medium">{h.url}</span>
          <Badge tone={h.active ? 'success' : 'critical'}>{h.active ? t('On') : t('Off')}</Badge>
          {h.source === 'zapier' && <Badge tone="primary">{t('Made by a Zap')}</Badge>}
          {h.consecutiveFailures > 0 && <Badge tone="warning">{t.plural('count.failuresInRow', h.consecutiveFailures)}</Badge>}
          <div className="ms-auto flex gap-1">
            <Button size="sm" variant="outline" onClick={() => onToggle(!h.active)}>
              {h.active ? t('Switch off') : t('Switch on')}
            </Button>
            <Button size="icon" variant="ghost" aria-label={t('Delete webhook {url}', { url: h.url })} onClick={onDelete}>
              <Trash2 aria-hidden />
            </Button>
          </div>
        </div>
        <p className="font-mono text-xs text-muted-foreground">{h.events.join(', ')}</p>
        {h.disabledReason && <p className="text-xs text-critical">{h.disabledReason}</p>}
        {h.recentDeliveries.length > 0 && (
          <ul className="space-y-1 border-t border-border pt-2">
            {h.recentDeliveries.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={d.status === 'SUCCEEDED' ? 'success' : d.status === 'FAILED' ? 'critical' : 'warning'}>{t.maybe(d.status.charAt(0) + d.status.slice(1).toLowerCase())}</Badge>
                <span className="font-mono">{d.eventType}</span>
                <span className="text-muted-foreground">
                  {t.plural('count.attempts', d.attempts)}
                  {d.responseCode ? ` · HTTP ${d.responseCode}` : ''} · {relativeTime(d.createdAt)}
                </span>
                {d.lastError && d.status !== 'SUCCEEDED' && <span className="text-critical">{d.lastError}</span>}
                {d.status === 'FAILED' && (
                  <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => onRedeliver(d.id)}>
                    {t('Redeliver')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

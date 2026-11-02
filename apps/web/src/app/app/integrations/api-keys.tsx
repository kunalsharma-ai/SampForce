'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Skeleton } from '@dealflow/ui';
import { API_KEY_SCOPES, type ApiKeyCreated, type ApiKeyRow, type ApiKeyScope, type ZapierStatus } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCopy } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useCan } from '@/lib/session';
import { fmtLocale } from '@/lib/i18n/locale';
import { rich, useT } from '@/lib/i18n';

const SCOPE_LABEL: Record<ApiKeyScope, string> = {
  'leads:read': 'Read leads',
  'leads:write': 'Create and change leads',
  'contacts:read': 'Read contacts',
  'contacts:write': 'Create and change contacts',
  'companies:read': 'Read companies',
  'companies:write': 'Create and change companies',
  'deals:read': 'Read deals',
  'deals:write': 'Create and change deals',
  'pipelines:read': 'Read pipelines and stages',
  'activities:read': 'Read tasks and activities',
  'activities:write': 'Create and change tasks and activities',
};

/** Zapier, and the workspace API keys that Zapier, Make, n8n and scripts use. Admins only. */
export function ApiKeysAndZapier() {
  const t = useT();
  const canManage = useCan('integrations:manage');
  const qc = useQueryClient();
  const keys = useQuery({ enabled: canManage, queryKey: ['api-keys'], queryFn: () => api<ApiKeyRow[]>('/api-keys') });
  const zapier = useQuery({ enabled: canManage, queryKey: ['api-keys', 'zapier'], queryFn: () => api<ZapierStatus>('/api-keys/zapier') });
  const [name, setName] = useState('Zapier');
  const [scopes, setScopes] = useState<ApiKeyScope[]>(['leads:read', 'leads:write', 'contacts:read', 'contacts:write', 'deals:read']);
  const [expires, setExpires] = useState('');
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['api-keys'] });
  const create = useMutation({
    mutationFn: () => api<ApiKeyCreated>('/api-keys', { method: 'POST', json: { name, scopes, ...(expires ? { expiresInDays: Number(expires) } : {}) } }),
    onSuccess: (k) => {
      setCreated(k);
      setCopied(false);
      return refresh();
    },
  });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/api-keys/${id}`, { method: 'DELETE' }), onSuccess: () => Promise.all([refresh(), qc.invalidateQueries({ queryKey: ['webhooks'] })]) });
  if (!canManage) return null;
  const active = (keys.data ?? []).filter((k) => !k.revokedAt);
  const error = create.error ?? revoke.error;

  return (
    <section aria-labelledby="api-heading" className="space-y-3">
      <h2 id="api-heading" className="text-base font-semibold">
        {t('Zapier and API keys')}
      </h2>
      <Card role="region" aria-labelledby="zapier-title">
        <CardHeader className="pb-2">
          <CardTitle id="zapier-title" className="flex flex-wrap items-center gap-2 text-sm">
            Zapier
            {zapier.data && (zapier.data.inviteUrl ? <Badge tone="success">{t('Available')}</Badge> : <Badge tone="warning">{t('Pending Configuration')}</Badge>)}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            {t('Start Zaps when leads, contacts, deals or tasks change, and create leads, contacts and tasks from other apps. Zaps connect with an API key from below, and start within seconds through webhooks rather than polling.')}
          </p>
          {zapier.data && !zapier.data.inviteUrl && (
            <p className="text-xs text-muted-foreground">
              {rich(t('The DealFlow app for Zapier is not published on this installation yet. An operator deploys it from {path} and sets {variable}. API keys already work with Make, n8n and scripts.'), { path: <code>integrations/zapier</code>, variable: <code>ZAPIER_INVITE_URL</code> })}
            </p>
          )}
          {zapier.data?.inviteUrl && (
            <Button asChild size="sm" variant="outline">
              <a href={zapier.data.inviteUrl} target="_blank" rel="noreferrer">
                {t('Open DealFlow in Zapier')}
              </a>
            </Button>
          )}
          {zapier.data && zapier.data.subscriptions > 0 && <p className="text-xs text-muted-foreground">{t.plural('count.activeZapTriggers', zapier.data.subscriptions)}</p>}
        </CardContent>
      </Card>

      <Card role="region" aria-labelledby="keys-title">
        <CardHeader className="pb-2">
          <CardTitle id="keys-title" className="text-sm">
            {t('API keys')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            {t('A key acts as you, limited to the scopes you choose and to your own role. It cannot export data, change settings, members, billing or integrations, or use AI. Revoking it stops it at once and removes the Zaps made with it.')}
          </p>
          {keys.isPending ? (
            <Skeleton className="h-16" />
          ) : (keys.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('No API keys yet.')}</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border" aria-label={t('API keys')}>
              {(keys.data ?? []).map((k) => (
                <li key={k.id} className="flex flex-wrap items-center gap-2 p-2">
                  <span className="font-medium">{k.name}</span>
                  <code className="text-xs">{k.prefix}…</code>
                  {k.revokedAt ? <Badge tone="neutral">{t('Revoked')}</Badge> : k.expiresAt && new Date(k.expiresAt) < new Date() ? <Badge tone="warning">{t('Expired')}</Badge> : <Badge tone="success">{t('Active')}</Badge>}
                  <span className="text-xs text-muted-foreground">
                    {t.plural('count.scopes', k.scopes.length)} · {k.createdBy ? t('created {time} by {name}', { time: relativeTime(k.createdAt), name: k.createdBy }) : t('created {time}', { time: relativeTime(k.createdAt) })}
                    {' · '}{k.lastUsedAt ? t('last used {time}', { time: relativeTime(k.lastUsedAt) }) : t('never used')}
                    {k.expiresAt ? ` · ${t('expires {date}', { date: new Date(k.expiresAt).toLocaleDateString(fmtLocale()) })}` : ''}
                    {k.hooks ? ` · ${t.plural('count.zapTriggers', k.hooks)}` : ''}
                  </span>
                  {!k.revokedAt && (
                    <Button size="sm" variant="ghost" className="ms-auto" disabled={revoke.isPending} aria-label={t('Revoke {name}', { name: k.name })} onClick={() => window.confirm(k.hooks ? t.plural('count.revokeKeyWithZaps', k.hooks, { name: k.name }) : t('Revoke {name}? Anything using it stops working now.', { name: k.name })) && revoke.mutate(k.id)}>
                      {t('Revoke')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {created && (
            <div className="space-y-1.5 rounded-md border border-success/40 bg-success/10 p-3" role="status">
              <Label htmlFor="new-api-key">{t('Your new key. Copy it now: it is not shown again.')}</Label>
              <div className="flex gap-2">
                <Input id="new-api-key" readOnly value={created.key} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard?.writeText(created.key);
                    setCopied(true);
                  }}
                >
                  <ClipboardCopy aria-hidden /> {copied ? t('Copied') : t('Copy')}
                </Button>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                {t('Done')}
              </Button>
            </div>
          )}

          {active.length < 25 && (
            <form
              className="space-y-2 rounded-md border border-dashed p-3"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
                <div className="space-y-1.5">
                  <Label htmlFor="api-key-name">{t('Key name')}</Label>
                  <Input id="api-key-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="api-key-expiry">{t('Expires after (days)')}</Label>
                  <Input id="api-key-expiry" type="number" min={1} max={730} placeholder={t('Never')} value={expires} onChange={(e) => setExpires(e.target.value)} />
                </div>
              </div>
              <fieldset className="space-y-1">
                <legend className="text-xs font-medium">{t('Scopes')}</legend>
                <div className="grid gap-1 sm:grid-cols-2">
                  {API_KEY_SCOPES.map((sc) => (
                    <label key={sc} className="flex min-h-6 items-center gap-2 text-xs">
                      <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={scopes.includes(sc)} onChange={(e) => setScopes(e.target.checked ? [...scopes, sc] : scopes.filter((x) => x !== sc))} />
                      {t.maybe(SCOPE_LABEL[sc])}
                    </label>
                  ))}
                </div>
              </fieldset>
              <Button type="submit" size="sm" disabled={create.isPending || !name.trim() || scopes.length === 0}>
                {t('Create key')}
              </Button>
            </form>
          )}
          {error && (
            <p role="alert" className="text-sm text-critical">
              {error.message}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

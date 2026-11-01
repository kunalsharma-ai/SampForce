'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Skeleton } from '@dealflow/ui';
import type { AppEventRow, AppStatus, PaymentsSettings, SlackChannel, TeamsSettings, TwilioSettings, WhatsappSettings } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Select } from '@/components/crm/select';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useCan } from '@/lib/session';

const OUTCOME: Record<string, string> = {
  oauth_state_invalid: 'The connect link expired or belonged to another session. Try connecting again.',
  access_denied: 'The connection was canceled in the app.',
  missing_code: 'The app did not return an authorization code.',
};

const STATE: Record<AppStatus['state'], { label: string; tone: 'neutral' | 'success' | 'critical' | 'warning' }> = {
  pending_configuration: { label: 'Pending Configuration', tone: 'warning' },
  not_connected: { label: 'Not connected', tone: 'neutral' },
  connected: { label: 'Connected', tone: 'success' },
  error: { label: 'Needs reconnecting', tone: 'critical' },
};

/** Apps a workspace admin connects once for everyone: Slack, Microsoft Teams, Zoom, DocuSign, card payments and WhatsApp. */
export function WorkspaceApps() {
  const params = useSearchParams();
  const apps = useQuery({ queryKey: ['apps'], queryFn: () => api<AppStatus[]>('/apps') });
  const app = params.get('app');
  const connected = params.get('app_connected');
  const error = params.get('app_error');
  return (
    <section aria-labelledby="apps-heading" className="space-y-3">
      <h2 id="apps-heading" className="text-base font-semibold">
        Workspace apps
      </h2>
      {app && connected && <p className="rounded-md border border-success/40 bg-success/10 p-3 text-sm">{app === 'zoom' ? 'Zoom is connected. Schedule meetings from any lead, contact or deal.' : app === 'docusign' ? 'DocuSign is connected. Send draft contracts for signature from the contract page.' : 'Connected. Choose a default channel below, then send a test message.'}</p>}
      {app && error && (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 p-3 text-sm text-critical">
          {OUTCOME[error] ?? `The connection did not complete (${error}).`}
        </p>
      )}
      {apps.isPending ? <Skeleton className="h-32" /> : apps.data?.map((a) => (a.key === 'slack' ? <SlackCard key={a.key} app={a} /> : a.key === 'teams' ? <TeamsCard key={a.key} app={a} /> : a.key === 'zoom' || a.key === 'docusign' ? <OAuthAppCard key={a.key} app={a} /> : a.key === 'payments' ? <PaymentsCard key={a.key} app={a} /> : a.key === 'whatsapp' ? <WhatsappCard key={a.key} app={a} /> : a.key === 'twilio' ? <TwilioCard key={a.key} app={a} /> : null))}
    </section>
  );
}

function SlackCard({ app }: { app: AppStatus }) {
  const qc = useQueryClient();
  const canManage = useCan('integrations:manage');
  const s = STATE[app.state];
  const c = app.connection;
  const settings = (c?.settings ?? {}) as { defaultChannelId?: string | null; defaultChannelName?: string | null };
  const [channel, setChannel] = useState(settings.defaultChannelId ?? '');
  useEffect(() => setChannel(settings.defaultChannelId ?? ''), [settings.defaultChannelId]);
  const live = app.state === 'connected';
  const channels = useQuery({ enabled: live && canManage, queryKey: ['apps', 'slack', 'channels'], queryFn: () => api<SlackChannel[]>('/apps/slack/channels') });
  const events = useQuery({ enabled: !!c && canManage, queryKey: ['apps', 'slack', 'events'], queryFn: () => api<AppEventRow[]>('/apps/slack/events') });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['apps'] })]);
  const connect = useMutation({ mutationFn: () => api<{ url: string }>('/apps/slack/connect', { method: 'POST' }), onSuccess: ({ url }) => window.location.assign(url) });
  const save = useMutation({
    mutationFn: () => {
      const ch = channels.data?.find((x) => x.id === channel);
      return api<AppStatus>('/apps/slack/settings', { method: 'PUT', json: { defaultChannelId: ch?.id ?? null, defaultChannelName: ch?.name ?? null } });
    },
    onSuccess: refresh,
  });
  const test = useMutation({ mutationFn: () => api('/apps/slack/test', { method: 'POST', json: {} }), onSettled: () => Promise.all([refresh(), qc.invalidateQueries({ queryKey: ['apps', 'slack', 'events'] })]) });
  const disconnect = useMutation({ mutationFn: () => api('/apps/slack', { method: 'DELETE' }), onSuccess: refresh });
  const error = connect.error ?? save.error ?? test.error ?? disconnect.error ?? channels.error;

  return (
    <Card role="region" aria-labelledby="app-slack">
      <CardHeader className="pb-2">
        <CardTitle id="app-slack" className="flex flex-wrap items-center gap-2 text-sm">
          {app.name}
          <Badge tone={s.tone}>{s.label}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{app.description} Add a “Post to Slack” step to any workflow.</p>
        {app.state === 'pending_configuration' && (
          <p className="text-muted-foreground">
            An operator must add {app.missingConfig.join(' and ')} (the DealFlow Slack app’s credentials) to the deployment before anyone can connect. Nothing is sent until then.
          </p>
        )}
        {c && (
          <div className="space-y-1">
            <p>
              Slack workspace: <strong>{c.accountName}</strong>
            </p>
            <p className="text-xs text-muted-foreground">
              Connected {relativeTime(c.connectedAt)}
              {c.connectedBy ? ` by ${c.connectedBy}` : ''}. {c.lastUsedAt ? `Last message ${relativeTime(c.lastUsedAt)}.` : 'No messages yet.'}
            </p>
            {c.lastError && <p className="text-xs text-critical">{c.lastError}</p>}
          </div>
        )}
        {canManage && live && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="min-w-56 flex-1 space-y-1.5">
              <Label htmlFor="slack-default-channel">Default channel</Label>
              <Select id="slack-default-channel" value={channel} disabled={channels.isPending} onChange={(e) => setChannel(e.target.value)}>
                <option value="">None (each step names its channel)</option>
                {channels.data?.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    #{ch.name}
                    {ch.isPrivate ? ' (private)' : ''}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={save.isPending || channel === (settings.defaultChannelId ?? '')}>
              Save
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={test.isPending || !settings.defaultChannelId} onClick={() => test.mutate()}>
              Send test message
            </Button>
          </form>
        )}
        {test.isSuccess && <p role="status" className="text-sm text-muted-foreground">Test message posted to #{settings.defaultChannelName}.</p>}
        {canManage && app.state !== 'pending_configuration' && (
          <div className="flex flex-wrap gap-2">
            {(!c || app.state === 'error') && (
              <Button size="sm" onClick={() => connect.mutate()} disabled={connect.isPending}>
                {c ? 'Reconnect Slack' : 'Connect Slack'}
              </Button>
            )}
            {c && (
              <Button size="sm" variant="ghost" disabled={disconnect.isPending} onClick={() => window.confirm('Disconnect Slack? Workflow steps that post to Slack will fail until it is connected again.') && disconnect.mutate()}>
                Disconnect
              </Button>
            )}
          </div>
        )}
        {!canManage && <p className="text-xs text-muted-foreground">Workspace admins connect and configure apps.</p>}
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error.message}
          </p>
        )}
        {events.data && events.data.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium">Recent activity</p>
            <ul className="space-y-1 text-xs" aria-label="Recent Slack activity">
              {events.data.slice(0, 5).map((e) => (
                <li key={e.id} className={e.ok ? 'text-muted-foreground' : 'text-critical'}>
                  {relativeTime(e.createdAt)}: {e.summary}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Teams: each channel is added with a URL from the Teams Workflows app. Nothing is saved until Teams accepts a
 * welcome card, so every listed channel has worked at least once.
 */
function TeamsCard({ app }: { app: AppStatus }) {
  const qc = useQueryClient();
  const canManage = useCan('integrations:manage');
  const c = app.connection;
  const settings = (c?.settings ?? { channels: [], defaultChannelId: null }) as unknown as TeamsSettings;
  const channels = settings.channels ?? [];
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [def, setDef] = useState(settings.defaultChannelId ?? '');
  useEffect(() => setDef(settings.defaultChannelId ?? ''), [settings.defaultChannelId]);
  const s = app.state === 'error' ? { label: 'Needs attention', tone: 'critical' as const } : STATE[app.state];
  const events = useQuery({ enabled: !!c && canManage, queryKey: ['apps', 'teams', 'events'], queryFn: () => api<AppEventRow[]>('/apps/teams/events') });
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['apps'] })]);
  const add = useMutation({
    mutationFn: () => api<AppStatus>('/apps/teams/channels', { method: 'POST', json: { name, webhookUrl: url } }),
    onSuccess: () => {
      setName('');
      setUrl('');
      return refresh();
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => api<AppStatus>(`/apps/teams/channels/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const save = useMutation({ mutationFn: () => api<AppStatus>('/apps/teams/settings', { method: 'PUT', json: { defaultChannelId: def || null } }), onSuccess: refresh });
  const test = useMutation({ mutationFn: (channelId: string) => api<{ channel: string }>('/apps/teams/test', { method: 'POST', json: { channelId } }), onSettled: () => refresh() });
  const error = add.error ?? remove.error ?? save.error ?? test.error;

  return (
    <Card role="region" aria-labelledby="app-teams">
      <CardHeader className="pb-2">
        <CardTitle id="app-teams" className="flex flex-wrap items-center gap-2 text-sm">
          {app.name}
          <Badge tone={s.tone}>{s.label}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">{app.description} Add a “Post to Slack or Teams” step to any workflow and choose Microsoft Teams.</p>
        {c?.lastError && <p className="text-xs text-critical">{c.lastError}</p>}
        {channels.length > 0 && (
          <ul className="divide-y divide-border rounded-md border" aria-label="Teams channels">
            {channels.map((ch) => (
              <li key={ch.id} className="flex flex-wrap items-center gap-2 p-2">
                <span className="font-medium">{ch.name}</span>
                {ch.id === settings.defaultChannelId && <Badge>Default</Badge>}
                {ch.lastError && <Badge tone="critical">Not accepting messages</Badge>}
                <span className="text-xs text-muted-foreground">Added {relativeTime(ch.addedAt)}</span>
                {canManage && (
                  <span className="ms-auto flex gap-1">
                    <Button size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate(ch.id)} aria-label={`Send test message to ${ch.name}`}>
                      Test
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={remove.isPending}
                      aria-label={`Remove ${ch.name}`}
                      onClick={() => window.confirm(`Remove ${ch.name}? Workflow steps that post there will fail. Also turn off its workflow in Teams.`) && remove.mutate(ch.id)}
                    >
                      Remove
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {test.isSuccess && <p role="status" className="text-sm text-muted-foreground">Test message posted to {test.data.channel}.</p>}
        {canManage && channels.length > 1 && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="min-w-56 flex-1 space-y-1.5">
              <Label htmlFor="teams-default-channel">Default Teams channel</Label>
              <Select id="teams-default-channel" value={def} onChange={(e) => setDef(e.target.value)}>
                {channels.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    {ch.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={save.isPending || def === (settings.defaultChannelId ?? '')}>
              Save
            </Button>
          </form>
        )}
        {canManage && (
          <form
            className="space-y-2 rounded-md border border-dashed p-3"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <p className="text-xs text-muted-foreground">
              In Teams, open the channel’s <strong>Workflows</strong>, choose “Send webhook alerts to a channel”, and copy the URL it gives you. DealFlow posts a welcome card to check it before saving. The URL is stored encrypted.
            </p>
            <div className="grid gap-2 sm:grid-cols-[12rem_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="teams-channel-name">Channel name</Label>
                <Input id="teams-channel-name" value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="teams-webhook-url">Workflow URL</Label>
                <Input id="teams-webhook-url" type="url" autoComplete="off" value={url} maxLength={2000} required onChange={(e) => setUrl(e.target.value)} />
              </div>
            </div>
            <Button type="submit" size="sm" disabled={add.isPending || !name.trim() || !url.trim()}>
              {add.isPending ? 'Checking with Teams…' : 'Add channel'}
            </Button>
          </form>
        )}
        {!canManage && <p className="text-xs text-muted-foreground">Workspace admins add Teams channels.</p>}
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error.message}
          </p>
        )}
        {events.data && events.data.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium">Recent activity</p>
            <ul className="space-y-1 text-xs" aria-label="Recent Teams activity">
              {events.data.slice(0, 5).map((e) => (
                <li key={e.id} className={e.ok ? 'text-muted-foreground' : 'text-critical'}>
                  {relativeTime(e.createdAt)}: {e.summary}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const OAUTH_COPY: Record<'zoom' | 'docusign', { blurb: string; credentials: string; privacy: string; disconnect: string }> = {
  zoom: {
    blurb: 'Meetings are created in each person’s own Zoom user, matched by their DealFlow email.',
    credentials: 'the DealFlow Zoom app’s credentials',
    privacy: 'Only meetings scheduled from DealFlow with recording chosen have their transcripts imported. Other meetings in the Zoom account are never read.',
    disconnect: 'Disconnect Zoom? Scheduling from records stops; meetings already scheduled stay in Zoom.',
  },
  docusign: {
    blurb: 'Contracts go out from this DocuSign account, one envelope per contract, only after the sender confirms.',
    credentials: 'the DealFlow DocuSign app’s integration key and secret',
    privacy: 'DealFlow reads only envelopes it sent. Signed PDFs stay in DocuSign and are fetched when someone downloads them.',
    disconnect: 'Disconnect DocuSign? Envelopes already sent stay in DocuSign, but their status will no longer update here.',
  },
};

/** Zoom and DocuSign: an admin connects the company's account once through the provider's OAuth. */
function OAuthAppCard({ app }: { app: AppStatus }) {
  const copy = OAUTH_COPY[app.key as 'zoom' | 'docusign'];
  const qc = useQueryClient();
  const canManage = useCan('integrations:manage');
  const s = STATE[app.state];
  const c = app.connection;
  const events = useQuery({ enabled: !!c && canManage, queryKey: ['apps', app.key, 'events'], queryFn: () => api<AppEventRow[]>(`/apps/${app.key}/events`) });
  const connect = useMutation({ mutationFn: () => api<{ url: string }>(`/apps/${app.key}/connect`, { method: 'POST' }), onSuccess: ({ url }) => window.location.assign(url) });
  const disconnect = useMutation({ mutationFn: () => api(`/apps/${app.key}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['apps'] }) });
  const error = connect.error ?? disconnect.error;
  return (
    <Card role="region" aria-labelledby={`app-${app.key}`}>
      <CardHeader className="pb-2">
        <CardTitle id={`app-${app.key}`} className="flex flex-wrap items-center gap-2 text-sm">
          {app.name}
          <Badge tone={s.tone}>{s.label}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {app.description} {copy.blurb}
        </p>
        {app.state === 'pending_configuration' && (
          <p className="text-muted-foreground">An operator must add {app.missingConfig.join(' and ')} ({copy.credentials}) to the deployment before anyone can connect.</p>
        )}
        {app.warnings.map((w) => (
          <p key={w} className="text-xs text-warning">
            {w}
          </p>
        ))}
        {c && (
          <div className="space-y-1">
            <p>
              <strong>{c.accountName}</strong>
            </p>
            <p className="text-xs text-muted-foreground">
              Connected {relativeTime(c.connectedAt)}
              {c.connectedBy ? ` by ${c.connectedBy}` : ''}. {c.lastUsedAt ? `Last used ${relativeTime(c.lastUsedAt)}.` : 'Not used yet.'}
            </p>
            {c.lastError && <p className="text-xs text-critical">{c.lastError}</p>}
            <p className="text-xs text-muted-foreground">{copy.privacy}</p>
          </div>
        )}
        {canManage && app.state !== 'pending_configuration' && (
          <div className="flex flex-wrap gap-2">
            {(!c || app.state === 'error') && (
              <Button size="sm" onClick={() => connect.mutate()} disabled={connect.isPending}>
                {c ? `Reconnect ${app.name}` : `Connect ${app.name}`}
              </Button>
            )}
            {c && (
              <Button size="sm" variant="ghost" disabled={disconnect.isPending} onClick={() => window.confirm(copy.disconnect) && disconnect.mutate()}>
                Disconnect
              </Button>
            )}
          </div>
        )}
        {!canManage && <p className="text-xs text-muted-foreground">Workspace admins connect {app.name}.</p>}
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error.message}
          </p>
        )}
        {events.data && events.data.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium">Recent activity</p>
            <ul className="space-y-1 text-xs" aria-label={`Recent ${app.name} activity`}>
              {events.data.slice(0, 5).map((e) => (
                <li key={e.id} className={e.ok ? 'text-muted-foreground' : 'text-critical'}>
                  {relativeTime(e.createdAt)}: {e.summary}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const PAYMENT_EVENTS: Record<'stripe' | 'razorpay', { name: string; keyHelp: string; hookHelp: string; events: string }> = {
  stripe: {
    name: 'Stripe',
    keyHelp: 'In Stripe, create a restricted key with write access to Checkout Sessions (a secret key also works).',
    hookHelp: 'In Stripe, add a webhook endpoint with the URL below, then paste its signing secret.',
    events: 'checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired',
  },
  razorpay: {
    name: 'Razorpay',
    keyHelp: 'In Razorpay, generate an API key under Account & Settings.',
    hookHelp: 'In Razorpay, add a webhook with the URL below and a secret you choose, then paste that secret.',
    events: 'payment_link.paid, payment_link.expired, payment_link.cancelled',
  },
};

/** Card payments on accepted proposals, into this workspace's own Stripe or Razorpay account. */
function PaymentsCard({ app }: { app: AppStatus }) {
  const qc = useQueryClient();
  const canManage = useCan('integrations:manage');
  const c = app.connection;
  const settings = c?.settings as unknown as PaymentsSettings | undefined;
  const [provider, setProvider] = useState<'stripe' | 'razorpay'>(settings?.provider ?? 'stripe');
  const [secretKey, setSecretKey] = useState('');
  const [keyId, setKeyId] = useState('');
  const [keySecret, setKeySecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [editing, setEditing] = useState(false);
  const s = STATE[app.state];
  const copy = PAYMENT_EVENTS[provider];
  const events = useQuery({ enabled: !!c && canManage, queryKey: ['apps', 'payments', 'events'], queryFn: () => api<AppEventRow[]>('/apps/payments/events') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['apps'] });
  const save = useMutation({
    mutationFn: () => api<AppStatus>('/apps/payments/keys', { method: 'POST', json: provider === 'stripe' ? { provider, secretKey, webhookSecret } : { provider, keyId, keySecret, webhookSecret } }),
    onSuccess: () => {
      setSecretKey('');
      setKeySecret('');
      setWebhookSecret('');
      setEditing(false);
      return refresh();
    },
  });
  const disconnect = useMutation({ mutationFn: () => api('/apps/payments', { method: 'DELETE' }), onSuccess: refresh });
  const error = save.error ?? disconnect.error;
  const showForm = canManage && (!c || editing);
  const ready = webhookSecret.trim() && (provider === 'stripe' ? secretKey.trim() : keyId.trim() && keySecret.trim());

  return (
    <Card role="region" aria-labelledby="app-payments">
      <CardHeader className="pb-2">
        <CardTitle id="app-payments" className="flex flex-wrap items-center gap-2 text-sm">
          {app.name}
          <Badge tone={s.tone}>{s.label}</Badge>
          {settings && <Badge tone={settings.mode === 'live' ? 'success' : 'neutral'}>{settings.mode === 'live' ? 'Live mode' : 'Test mode'}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {app.description} Customers pay on {settings ? PAYMENT_EVENTS[settings.provider].name : 'Stripe or Razorpay'}’s hosted page, so DealFlow never handles card details. A proposal is marked paid only when the provider’s signed webhook confirms the amount.
        </p>
        {app.warnings.map((w) => (
          <p key={w} className="text-xs text-warning">
            {w}
          </p>
        ))}
        {c && settings && (
          <div className="space-y-1">
            <p>
              <strong>{c.accountName}</strong> · {PAYMENT_EVENTS[settings.provider].name}
            </p>
            <p className="text-xs text-muted-foreground">
              Keys checked {relativeTime(c.connectedAt)}
              {c.connectedBy ? ` by ${c.connectedBy}` : ''}. {settings.lastWebhookAt ? `Last confirmation received ${relativeTime(settings.lastWebhookAt)}.` : 'No confirmation received yet.'}
            </p>
            {c.lastError && <p className="text-xs text-critical">{c.lastError}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="payments-webhook-url">Webhook URL</Label>
              <Input id="payments-webhook-url" readOnly value={settings.webhookUrl} onFocus={(e) => e.currentTarget.select()} />
              <p className="text-xs text-muted-foreground">Send these events: {PAYMENT_EVENTS[settings.provider].events}.</p>
            </div>
          </div>
        )}
        {showForm && (
          <form
            className="space-y-2 rounded-md border border-dashed p-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="payments-provider">Provider</Label>
              <Select id="payments-provider" value={provider} onChange={(e) => setProvider(e.target.value as 'stripe' | 'razorpay')}>
                <option value="stripe">Stripe</option>
                <option value="razorpay">Razorpay</option>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {copy.keyHelp} {copy.hookHelp} {!c && 'The webhook URL appears here after the keys are saved; it stays the same if you replace them.'} Keys are checked with a read that charges nothing, then stored encrypted and never shown again. Use test keys first.
            </p>
            {provider === 'stripe' ? (
              <div className="space-y-1.5">
                <Label htmlFor="payments-secret-key">Restricted or secret key</Label>
                <Input id="payments-secret-key" type="password" autoComplete="off" placeholder="rk_test_…" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} />
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="payments-key-id">Key id</Label>
                  <Input id="payments-key-id" autoComplete="off" placeholder="rzp_test_…" value={keyId} onChange={(e) => setKeyId(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payments-key-secret">Key secret</Label>
                  <Input id="payments-key-secret" type="password" autoComplete="off" value={keySecret} onChange={(e) => setKeySecret(e.target.value)} />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="payments-webhook-secret">Webhook secret</Label>
              <Input id="payments-webhook-secret" type="password" autoComplete="off" placeholder={provider === 'stripe' ? 'whsec_…' : ''} value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={save.isPending || !ready}>
                {save.isPending ? `Checking with ${copy.name}…` : c ? 'Replace keys' : 'Check and save'}
              </Button>
              {c && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        )}
        {canManage && c && !editing && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Replace keys
            </Button>
            <Button size="sm" variant="ghost" disabled={disconnect.isPending} onClick={() => window.confirm('Turn off card payments? Customers will no longer see “Pay by card”, and payments still in progress will not be recorded here. Payment history stays on each quote.') && disconnect.mutate()}>
              Disconnect
            </Button>
          </div>
        )}
        {!canManage && <p className="text-xs text-muted-foreground">Workspace admins set up card payments.</p>}
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error.message}
          </p>
        )}
        {events.data && events.data.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium">Recent activity</p>
            <ul className="space-y-1 text-xs" aria-label="Recent card payment activity">
              {events.data.slice(0, 5).map((e) => (
                <li key={e.id} className={e.ok ? 'text-muted-foreground' : 'text-critical'}>
                  {relativeTime(e.createdAt)}: {e.summary}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** WhatsApp Business through the workspace's own Cloud API number in Meta. */
function WhatsappCard({ app }: { app: AppStatus }) {
  const qc = useQueryClient();
  const canManage = useCan('integrations:manage');
  const c = app.connection;
  const settings = c?.settings as unknown as WhatsappSettings | undefined;
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [editing, setEditing] = useState(false);
  const s = app.state === 'error' ? { label: 'Needs new credentials', tone: 'critical' as const } : STATE[app.state];
  const events = useQuery({ enabled: !!c && canManage, queryKey: ['apps', 'whatsapp', 'events'], queryFn: () => api<AppEventRow[]>('/apps/whatsapp/events') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['apps'] });
  const save = useMutation({
    mutationFn: () => api<AppStatus>('/apps/whatsapp/keys', { method: 'POST', json: { phoneNumberId, wabaId, accessToken, appSecret } }),
    onSuccess: () => {
      setAccessToken('');
      setAppSecret('');
      setEditing(false);
      return refresh();
    },
  });
  const disconnect = useMutation({ mutationFn: () => api('/apps/whatsapp', { method: 'DELETE' }), onSuccess: refresh });
  const error = save.error ?? disconnect.error;
  const showForm = canManage && (!c || editing || app.state === 'error');
  const ready = phoneNumberId.trim() && wabaId.trim() && accessToken.trim() && appSecret.trim();

  return (
    <Card role="region" aria-labelledby="app-whatsapp">
      <CardHeader className="pb-2">
        <CardTitle id="app-whatsapp" className="flex flex-wrap items-center gap-2 text-sm">
          {app.name}
          <Badge tone={s.tone}>{s.label}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {app.description} Messages are one to one: a template needs the contact’s recorded consent, free-form replies are allowed for 24 hours after they write, and a STOP reply withdraws consent. There is no bulk sending.
        </p>
        {app.warnings.map((w) => (
          <p key={w} className="text-xs text-warning">
            {w}
          </p>
        ))}
        {c && settings && (
          <div className="space-y-2">
            <p>
              <strong>{settings.verifiedName}</strong> · {settings.displayPhoneNumber}
              {settings.qualityRating && <span className="text-xs text-muted-foreground"> · quality {settings.qualityRating.toLowerCase()}</span>}
            </p>
            <p className="text-xs text-muted-foreground">
              Credentials checked {relativeTime(c.connectedAt)}
              {c.connectedBy ? ` by ${c.connectedBy}` : ''}. {settings.lastWebhookAt ? `Webhook confirmed ${relativeTime(settings.lastWebhookAt)}.` : 'No webhook received yet.'}
            </p>
            {c.lastError && <p className="text-xs text-critical">{c.lastError}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wa-callback-url">Callback URL</Label>
                <Input id="wa-callback-url" readOnly value={settings.webhookUrl} onFocus={(e) => e.currentTarget.select()} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wa-verify-token">Verify token</Label>
                <Input id="wa-verify-token" readOnly value={settings.verifyToken} onFocus={(e) => e.currentTarget.select()} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">In your Meta app, open WhatsApp, Configuration, enter both, and subscribe to the <code>messages</code> field.</p>
          </div>
        )}
        {showForm && (
          <form
            className="space-y-2 rounded-md border border-dashed p-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <p className="text-xs text-muted-foreground">
              From WhatsApp Manager and your Meta app: the phone number id, the WhatsApp Business Account id, a System User access token with <code>whatsapp_business_messaging</code> and <code>whatsapp_business_management</code>, and the App Secret (used to check webhook signatures). DealFlow reads the number to check them, sends nothing, then stores the token and secret encrypted.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wa-phone-id">Phone number id</Label>
                <Input id="wa-phone-id" inputMode="numeric" autoComplete="off" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wa-waba-id">WhatsApp Business Account id</Label>
                <Input id="wa-waba-id" inputMode="numeric" autoComplete="off" value={wabaId} onChange={(e) => setWabaId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wa-token">Access token</Label>
                <Input id="wa-token" type="password" autoComplete="off" placeholder="EA…" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wa-app-secret">App Secret</Label>
                <Input id="wa-app-secret" type="password" autoComplete="off" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={save.isPending || !ready}>
                {save.isPending ? 'Checking with WhatsApp…' : c ? 'Replace credentials' : 'Check and save'}
              </Button>
              {c && editing && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        )}
        {canManage && c && !showForm && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Replace credentials
            </Button>
            <Button size="sm" variant="ghost" disabled={disconnect.isPending} onClick={() => window.confirm('Disconnect WhatsApp? Sending stops and replies will no longer arrive here. Message history and consent records stay on each contact.') && disconnect.mutate()}>
              Disconnect
            </Button>
          </div>
        )}
        {!canManage && <p className="text-xs text-muted-foreground">Workspace admins connect WhatsApp Business.</p>}
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error.message}
          </p>
        )}
        {events.data && events.data.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium">Recent activity</p>
            <ul className="space-y-1 text-xs" aria-label="Recent WhatsApp activity">
              {events.data.slice(0, 5).map((e) => (
                <li key={e.id} className={e.ok ? 'text-muted-foreground' : 'text-critical'}>
                  {relativeTime(e.createdAt)}: {e.summary}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TwilioCard({ app }: { app: AppStatus }) {
  const qc = useQueryClient();
  const canManage = useCan('integrations:manage');
  const c = app.connection;
  const settings = c?.settings as unknown as TwilioSettings | undefined;
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [fromNumber, setFromNumber] = useState('');
  const [editing, setEditing] = useState(false);
  const s = app.state === 'error' ? { label: 'Needs new credentials', tone: 'critical' as const } : STATE[app.state];
  const events = useQuery({ enabled: !!c && canManage, queryKey: ['apps', 'twilio', 'events'], queryFn: () => api<AppEventRow[]>('/apps/twilio/events') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['apps'] });
  const save = useMutation({
    mutationFn: () => api<AppStatus>('/apps/twilio/keys', { method: 'POST', json: { accountSid, authToken, fromNumber } }),
    onSuccess: () => {
      setAuthToken('');
      setEditing(false);
      return refresh();
    },
  });
  const disconnect = useMutation({ mutationFn: () => api('/apps/twilio', { method: 'DELETE' }), onSuccess: refresh });
  const error = save.error ?? disconnect.error;
  const showForm = canManage && (!c || editing || app.state === 'error');
  const ready = accountSid.trim() && authToken.trim() && fromNumber.trim();

  return (
    <Card role="region" aria-labelledby="app-twilio">
      <CardHeader className="pb-2">
        <CardTitle id="app-twilio" className="flex flex-wrap items-center gap-2 text-sm">
          {app.name}
          <Badge tone={s.tone}>{s.label}</Badge>
          {settings?.trial && <Badge tone="warning">Trial account</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {app.description} Each text goes to one contact who has recorded SMS consent, after the sender confirms it or a person approves the workflow step. A STOP reply withdraws consent. There is no bulk sending.
        </p>
        {app.warnings.map((w) => (
          <p key={w} className="text-xs text-warning">
            {w}
          </p>
        ))}
        {c && settings && (
          <div className="space-y-2">
            <p>
              <strong>{settings.friendlyName}</strong> · {settings.fromNumber}
            </p>
            <p className="text-xs text-muted-foreground">
              Credentials checked {relativeTime(c.connectedAt)}
              {c.connectedBy ? ` by ${c.connectedBy}` : ''}. {settings.lastWebhookAt ? `Twilio’s signed requests confirmed ${relativeTime(settings.lastWebhookAt)}.` : 'Nothing received from Twilio yet.'}
            </p>
            {settings.trial && <p className="text-xs text-warning">Trial accounts text only numbers verified in the Twilio console, and Twilio adds a trial notice to each text. Upgrade the Twilio account before texting customers.</p>}
            {c.lastError && <p className="text-xs text-critical">{c.lastError}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="tw-inbound-url">Inbound message URL</Label>
              <Input id="tw-inbound-url" readOnly value={settings.inboundUrl} onFocus={(e) => e.currentTarget.select()} />
            </div>
            <p className="text-xs text-muted-foreground">
              In the Twilio console, open Phone Numbers, {settings.fromNumber}, Messaging configuration, and set “A message comes in” to this URL with HTTP POST. Delivery status needs no setup: each text tells Twilio where to report it.
            </p>
          </div>
        )}
        {showForm && (
          <form
            className="space-y-2 rounded-md border border-dashed p-3"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <p className="text-xs text-muted-foreground">
              From the Twilio console: the Account SID and Auth Token, and a Twilio number on that account that can send SMS. DealFlow reads the account and the number to check them, sends nothing, then stores the token encrypted. The Auth Token also checks the signature on every request Twilio sends.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="tw-sid">Account SID</Label>
                <Input id="tw-sid" autoComplete="off" placeholder="AC…" value={accountSid} onChange={(e) => setAccountSid(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tw-token">Auth Token</Label>
                <Input id="tw-token" type="password" autoComplete="off" value={authToken} onChange={(e) => setAuthToken(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tw-number">Twilio number</Label>
                <Input id="tw-number" inputMode="tel" autoComplete="off" placeholder="+447700900123" value={fromNumber} onChange={(e) => setFromNumber(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={save.isPending || !ready}>
                {save.isPending ? 'Checking with Twilio…' : c ? 'Replace credentials' : 'Check and save'}
              </Button>
              {c && editing && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        )}
        {canManage && c && !showForm && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Replace credentials
            </Button>
            <Button size="sm" variant="ghost" disabled={disconnect.isPending} onClick={() => window.confirm('Disconnect SMS? Sending stops and replies will no longer arrive here. Text history and consent records stay on each contact.') && disconnect.mutate()}>
              Disconnect
            </Button>
          </div>
        )}
        {!canManage && <p className="text-xs text-muted-foreground">Workspace admins connect SMS.</p>}
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error.message}
          </p>
        )}
        {events.data && events.data.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium">Recent activity</p>
            <ul className="space-y-1 text-xs" aria-label="Recent SMS activity">
              {events.data.slice(0, 5).map((e) => (
                <li key={e.id} className={e.ok ? 'text-muted-foreground' : 'text-critical'}>
                  {relativeTime(e.createdAt)}: {e.summary}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

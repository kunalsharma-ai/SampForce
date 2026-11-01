'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Label, Skeleton } from '@dealflow/ui';
import type { AppEventRow, AppStatus, SlackChannel } from '@dealflow/types';
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

/** Apps a workspace admin connects once for everyone: Slack first. */
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
      {app && connected && <p className="rounded-md border border-success/40 bg-success/10 p-3 text-sm">Connected. Choose a default channel below, then send a test message.</p>}
      {app && error && (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 p-3 text-sm text-critical">
          {OUTCOME[error] ?? `The connection did not complete (${error}).`}
        </p>
      )}
      {apps.isPending ? <Skeleton className="h-32" /> : apps.data?.map((a) => (a.key === 'slack' ? <SlackCard key={a.key} app={a} /> : null))}
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

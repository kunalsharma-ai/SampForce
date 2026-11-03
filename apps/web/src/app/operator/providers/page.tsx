'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import type { DeploymentSettingRow, OperatorProviderField, OperatorProviderRow, ProviderSetupGuide, ProviderWebhookStatus } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { ErrorText } from '@/components/revenue/tabs';
import { api, ApiError } from '@/lib/api';
import { useOperator } from '../operator-shell';
import { fmtLocale } from '@/lib/i18n/locale';

const STATE: Record<OperatorProviderRow['state'], { label: string; tone: 'neutral' | 'warning' | 'success' | 'critical' }> = {
  not_configured: { label: 'Not configured', tone: 'neutral' },
  configured: { label: 'Keys set, not tested', tone: 'warning' },
  verified: { label: 'Connection test passed', tone: 'success' },
  failed: { label: 'Connection test failed', tone: 'critical' },
};

const when = (iso: string) => new Date(iso).toLocaleString(fmtLocale());

const onOff = (hint: string | null) => (hint === 'true' ? 'On' : hint === 'false' ? 'Off' : hint);

/** Where a key comes from, without its value: a secret shows only its last four characters. */
function FieldStatus({ f }: { f: OperatorProviderField }) {
  const value = f.secret ? (f.hint ? `ends in ${f.hint}` : 'hidden') : f.input === 'switch' ? onOff(f.hint) : f.hint;
  if (f.source === 'console') {
    return (
      <span className="text-success">
        Saved here{value ? ` · ${value}` : ''}
        {f.updatedAt && <span className="text-muted-foreground"> · {when(f.updatedAt)}{f.updatedBy ? ` by ${f.updatedBy}` : ''}</span>}
      </span>
    );
  }
  if (f.source === 'environment') return <span className="text-success">From deployment secrets{value ? ` · ${value}` : ''}</span>;
  if (f.source === 'default') return <span className="text-muted-foreground">Default{value ? ` · ${value}` : ''}</span>;
  return <span className={f.required ? 'text-critical' : 'text-muted-foreground'}>{f.required ? 'Missing' : 'Not set (optional)'}</span>;
}

function KeyForm({ p, onDone, onCancel }: { p: OperatorProviderRow; onDone: () => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [remove, setRemove] = useState<Set<string>>(new Set());
  const save = useMutation({
    mutationFn: (body: Record<string, string | null>) => api<OperatorProviderRow>(`/operator/providers/${p.key}/keys`, { method: 'POST', json: { values: body } }),
    onSuccess: (row) => {
      qc.setQueryData<OperatorProviderRow[]>(['operator', 'providers'], (rows) => rows?.map((r) => (r.key === row.key ? row : r)));
      onDone();
    },
  });
  const changes: Record<string, string | null> = {};
  for (const f of p.env) {
    if (remove.has(f.name)) changes[f.name] = null;
    else if (values[f.name]?.trim()) changes[f.name] = values[f.name]!;
  }
  const fieldError = (name: string) => (save.error instanceof ApiError ? save.error.details?.find((d) => d.path === `values.${name}`)?.message : undefined);
  return (
    <form
      className="space-y-3 rounded-md border border-border p-3"
      aria-label={`Edit ${p.name} keys`}
      onSubmit={(e) => {
        e.preventDefault();
        if (Object.keys(changes).length) save.mutate(changes);
      }}
    >
      <p className="text-muted-foreground">Leave a box empty to keep the current value. Saved keys are encrypted, used straight away, and secrets are never shown again.</p>
      {p.env.map((f) => {
        const id = `key-${p.key}-${f.name}`;
        const err = fieldError(f.name);
        return (
          <div key={f.name} className="space-y-1">
            <label htmlFor={id} className="font-medium">
              {f.label} <code className="rounded bg-muted px-1 py-0.5 text-xs font-normal">{f.name}</code>
            </label>
            {f.input === 'switch' ? (
              <select
                id={id}
                className="block h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                disabled={remove.has(f.name) || save.isPending}
                value={values[f.name] ?? ''}
                aria-invalid={err ? true : undefined}
                aria-describedby={f.help || err ? `${id}-help` : undefined}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              >
                <option value="">Keep as it is ({onOff(f.hint) ?? 'Off'})</option>
                <option value="true">On</option>
                <option value="false">Off</option>
              </select>
            ) : (
            <Input
              id={id}
              type={f.secret ? 'password' : 'text'}
              autoComplete="off"
              spellCheck={false}
              disabled={remove.has(f.name) || save.isPending}
              placeholder={f.set ? (f.secret ? 'Enter a new value to replace it' : (f.hint ?? '')) : f.required ? 'Required' : 'Optional'}
              value={values[f.name] ?? ''}
              aria-invalid={err ? true : undefined}
              aria-describedby={f.help || err ? `${id}-help` : undefined}
              onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            />
            )}
            {(err || f.help) && (
              <p id={`${id}-help`} className={err ? 'text-xs text-critical' : 'text-xs text-muted-foreground'}>
                {err ?? f.help}
              </p>
            )}
            {f.source === 'console' && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={remove.has(f.name)}
                  onChange={(e) => setRemove((s) => { const n = new Set(s); if (e.target.checked) n.add(f.name); else n.delete(f.name); return n; })}
                />
                Remove the saved value (falls back to the deployment secret or the default)
              </label>
            )}
          </div>
        );
      })}
      {save.error && !(save.error instanceof ApiError && save.error.details?.length) && <ErrorText error={save.error} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!Object.keys(changes).length || save.isPending}>
          {save.isPending ? 'Saving…' : p.checkable ? 'Save keys' : 'Save settings'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** A URL to paste into the provider's console, with a copy button. */
function CopyUrl({ label, url, where }: { label: string; url: string; where: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="space-y-1">
      <p className="text-xs font-medium">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded border border-border bg-muted/40 px-2 py-1 text-xs" title={url}>
          {url}
        </code>
        <Button size="sm" variant="outline" type="button" aria-label={`Copy ${label}`} onClick={() => void navigator.clipboard?.writeText(url).then(() => setCopied(true))}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{where}</p>
    </li>
  );
}

/** Step-by-step setup in the provider's own console, with the URLs to paste there. */
function SetupGuide({ name, guide }: { name: string; guide: ProviderSetupGuide }) {
  return (
    <details className="rounded-md border border-border p-3 [&[open]>summary]:mb-2">
      <summary className="cursor-pointer font-medium">How to set up {name}</summary>
      <div className="space-y-3">
        {guide.consoleUrl && (
          <p>
            <a className="text-primary underline underline-offset-2" href={guide.consoleUrl} target="_blank" rel="noopener noreferrer">
              Open {guide.consoleLabel ?? name}
            </a>
          </p>
        )}
        <ol className="list-decimal space-y-1 pl-5">
          {guide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {guide.urls.length > 0 && (
          <ul className="space-y-2" aria-label={`URLs to paste into ${name}`}>
            {guide.urls.map((u) => (
              <CopyUrl key={u.url} {...u} />
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

const WEBHOOK: Record<ProviderWebhookStatus['state'], { label: string; tone: 'neutral' | 'warning' | 'success' | 'critical' }> = {
  waiting: { label: 'No signed event received yet', tone: 'neutral' },
  verified: { label: 'Signed events arriving', tone: 'success' },
  rejected: { label: 'Last event refused', tone: 'critical' },
  stale: { label: 'No event since the secret changed', tone: 'warning' },
};

/** Whether the provider's signed webhooks reach this deployment: the proof a signing secret and URL are right. */
function WebhookLine({ w }: { w: ProviderWebhookStatus }) {
  const s = WEBHOOK[w.state];
  return (
    <div className="space-y-1 rounded-md border border-border bg-muted/30 p-2" aria-label="Webhook status">
      <p className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">Webhook:</span> <Badge tone={s.tone}>{s.label}</Badge>
      </p>
      {w.lastVerified && <p className="text-xs">Last signed event: {w.lastVerified.event} on {when(w.lastVerified.at)}</p>}
      {w.lastRejected && <p className="text-xs text-critical">Last refused: {when(w.lastRejected.at)}. {w.lastRejected.reason} Check that the secret saved here is the one the provider shows for this URL.</p>}
      {w.state === 'waiting' && <p className="text-xs text-muted-foreground">Add the webhook URL in the provider&apos;s console and send a test event; this turns green when it arrives.</p>}
    </div>
  );
}

function ProviderCard({ p, admin }: { p: OperatorProviderRow; admin: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const check = useMutation({
    mutationFn: () => api<OperatorProviderRow>(`/operator/providers/${p.key}/check`, { method: 'POST', json: {} }),
    onSuccess: (row) => qc.setQueryData<OperatorProviderRow[]>(['operator', 'providers'], (rows) => rows?.map((r) => (r.key === row.key ? row : r))),
  });
  const s = p.checkable ? STATE[p.state] : { label: 'Settings', tone: 'neutral' as const };
  const headingId = `provider-${p.key}`;
  return (
    <Card role="region" aria-labelledby={headingId}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle id={headingId}>{p.name}</CardTitle>
          <Badge tone={s.tone}>{s.label}</Badge>
        </div>
        <CardDescription>{p.usedFor}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <ul className="space-y-1" aria-label={`${p.name} keys`}>
          {p.env.map((v) => (
            <li key={v.name} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{v.name}</code>
              <FieldStatus f={v} />
            </li>
          ))}
        </ul>
        <p>
          <span className="text-muted-foreground">In workspaces: </span>
          {p.appStatus}
        </p>
        {p.webhook && <WebhookLine w={p.webhook} />}
        <SetupGuide name={p.name} guide={p.setup} />
        {saved && !editing && (
          <p className="text-success" aria-live="polite">
            Saved. The API and worker use the new {p.checkable ? 'keys' : 'settings'} within seconds, without a restart.
          </p>
        )}
        {admin &&
          (editing ? (
            <KeyForm
              p={p}
              onDone={() => {
                setEditing(false);
                setSaved(true);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => { setEditing(true); setSaved(false); }}>
              {!p.checkable ? 'Change settings' : p.env.some((f) => f.set && f.source !== 'default') ? 'Update keys' : 'Add keys'}
            </Button>
          ))}
        {p.lastCheck && (
          <p className="rounded-md border border-border bg-muted/30 p-2">
            {p.lastCheck.ok ? 'Passed' : 'Failed'} on {when(p.lastCheck.at)}
            {p.lastCheck.by && ` by ${p.lastCheck.by}`}: {p.lastCheck.message}
            {p.lastCheck.stale && <span className="block text-muted-foreground">Made with different keys from the ones set now, so it no longer counts. Test again.</span>}
          </p>
        )}
        <div className="space-y-2">
          <p className="text-muted-foreground">{p.checkNote}</p>
          {p.checkable &&
            (admin ? (
              <Button type="button" variant="outline" size="sm" disabled={!p.configured || check.isPending} onClick={() => check.mutate()}>
                {check.isPending ? 'Testing…' : 'Test connection'}
              </Button>
            ) : (
              <p className="text-muted-foreground">Only operators with the Admin role can change keys or test connections.</p>
            ))}
          {!p.checkable && !admin && <p className="text-muted-foreground">Only operators with the Admin role can change these settings.</p>}
          {p.checkable && !p.configured && <p className="text-muted-foreground">Add the required keys to enable the test.</p>}
          <ErrorText error={check.error} />
        </div>
      </CardContent>
    </Card>
  );
}

/** The few settings that stay on the server, and why. */
function DeploymentCard() {
  const rows = useQuery({ queryKey: ['operator', 'deployment'], queryFn: () => api<DeploymentSettingRow[]>('/operator/deployment') });
  return (
    <Card role="region" aria-labelledby="deployment-settings">
      <CardHeader>
        <CardTitle id="deployment-settings">Set once on the server</CardTitle>
        <CardDescription>
          Every integration above is set up on this page. These few settings stay in the server&apos;s environment file, because the console itself depends on them. They are set once when the server is installed.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        {rows.isPending ? (
          <Skeleton className="h-24" />
        ) : rows.error ? (
          <ErrorText error={rows.error} />
        ) : (
          <ul className="space-y-2" aria-label="Server settings">
            {rows.data.map((r) => (
              <li key={r.name}>
                <p className="flex flex-wrap items-center gap-x-2">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{r.name}</code>
                  <span className={r.set ? 'text-success' : 'text-muted-foreground'}>{r.set ? (r.value ? `Set · ${r.value}` : 'Set') : 'Not set'}</span>
                </p>
                <p className="text-xs text-muted-foreground">{r.why}</p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function OperatorProvidersPage() {
  const me = useOperator();
  const providers = useQuery({ enabled: !!me.data, queryKey: ['operator', 'providers'], queryFn: () => api<OperatorProviderRow[]>('/operator/providers') });
  if (!me.data || providers.isPending) return <Skeleton className="h-64" />;
  if (providers.error) return <ErrorText error={providers.error} />;
  const keyed = providers.data.filter((p) => p.checkable);
  const missing = keyed.filter((p) => !p.configured).length;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Providers"
        description="Set up every integration here: open a provider's setup guide, create the keys in its console, paste them below and test the connection. Keys saved here are encrypted, take effect within seconds without a restart, and override the server's environment; remove one to fall back. Secrets are never shown again, only their last four characters. Every change and test is recorded in the operator log."
      />
      <p className="text-sm" role="status">
        {missing === 0 ? 'Every provider has its keys set.' : `${missing} of ${keyed.length} providers are missing keys.`}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {providers.data.map((p) => (
          <ProviderCard key={p.key} p={p} admin={me.data!.role === 'ADMIN'} />
        ))}
      </div>
      <DeploymentCard />
    </div>
  );
}

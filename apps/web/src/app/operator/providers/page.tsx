'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import type { OperatorProviderField, OperatorProviderRow } from '@dealflow/types';
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

/** Where a key comes from, without its value: a secret shows only its last four characters. */
function FieldStatus({ f }: { f: OperatorProviderField }) {
  const value = f.secret ? (f.hint ? `ends in ${f.hint}` : 'hidden') : f.hint;
  if (f.source === 'console') {
    return (
      <span className="text-success">
        Saved here{value ? ` · ${value}` : ''}
        {f.updatedAt && <span className="text-muted-foreground"> · {when(f.updatedAt)}{f.updatedBy ? ` by ${f.updatedBy}` : ''}</span>}
      </span>
    );
  }
  if (f.source === 'environment') return <span className="text-success">From deployment secrets{value ? ` · ${value}` : ''}</span>;
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
      <p className="text-muted-foreground">Leave a box empty to keep the current value. Saved keys are encrypted, used straight away, and never shown again.</p>
      {p.env.map((f) => {
        const id = `key-${p.key}-${f.name}`;
        const err = fieldError(f.name);
        return (
          <div key={f.name} className="space-y-1">
            <label htmlFor={id} className="font-medium">
              {f.label} <code className="rounded bg-muted px-1 py-0.5 text-xs font-normal">{f.name}</code>
            </label>
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
                Remove the saved value (falls back to the deployment secret, if there is one)
              </label>
            )}
          </div>
        );
      })}
      {save.error && !(save.error instanceof ApiError && save.error.details?.length) && <ErrorText error={save.error} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!Object.keys(changes).length || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save keys'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
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
  const s = STATE[p.state];
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
        {saved && !editing && (
          <p className="text-success" aria-live="polite">
            Saved. The API and worker use the new keys within seconds, without a restart.
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
              {p.env.some((f) => f.set) ? 'Update keys' : 'Add keys'}
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
          {admin ? (
            <Button type="button" variant="outline" size="sm" disabled={!p.configured || check.isPending} onClick={() => check.mutate()}>
              {check.isPending ? 'Testing…' : 'Test connection'}
            </Button>
          ) : (
            <p className="text-muted-foreground">Only operators with the Admin role can change keys or test connections.</p>
          )}
          {!p.configured && <p className="text-muted-foreground">Add the required keys to enable the test.</p>}
          <ErrorText error={check.error} />
        </div>
      </CardContent>
    </Card>
  );
}

export default function OperatorProvidersPage() {
  const me = useOperator();
  const providers = useQuery({ enabled: !!me.data, queryKey: ['operator', 'providers'], queryFn: () => api<OperatorProviderRow[]>('/operator/providers') });
  if (!me.data || providers.isPending) return <Skeleton className="h-64" />;
  if (providers.error) return <ErrorText error={providers.error} />;
  const missing = providers.data.filter((p) => !p.configured).length;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Providers"
        description="Provider keys for this deployment. Keys saved here are encrypted, take effect within seconds without a restart, and override the deployment's secrets; remove one to fall back. Values are never shown again, only their last four characters. Every change and test is recorded in the operator log."
      />
      <p className="text-sm" role="status">
        {missing === 0 ? 'Every provider has its keys set.' : `${missing} of ${providers.data.length} providers are missing keys.`}
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {providers.data.map((p) => (
          <ProviderCard key={p.key} p={p} admin={me.data!.role === 'ADMIN'} />
        ))}
      </div>
    </div>
  );
}

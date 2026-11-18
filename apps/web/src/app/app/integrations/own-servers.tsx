'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Skeleton } from '@dealflow/ui';
import { OWN_AI_KINDS, OWN_AI_NAMES, type OwnAiKind, type OwnAiStatus, type OwnEmailStatus, type OwnServerTestResult } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Select } from '@/components/crm/select';
import { InfoTip } from '@/components/info-tip';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { type Translator, useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

/** Where each provider's free or paid key comes from. */
const KEY_HELP: Record<OwnAiKind, string> = {
  anthropic: 'console.anthropic.com > API keys',
  openai: 'platform.openai.com > API keys',
  gemini: 'aistudio.google.com > Get API key (free tier)',
  groq: 'console.groq.com > API keys (free tier)',
  openrouter: 'openrouter.ai > Keys (free models end in :free)',
  mistral: 'console.mistral.ai > API keys (free tier)',
  custom_ai: 'Ollama, LM Studio, vLLM or LiteLLM: the address ends in /v1',
};

interface Draft {
  kind: OwnAiKind;
  apiKey: string;
  model: string;
  baseUrl: string;
}

function healthLine(t: Translator, h: { lastOkAt: string | null; lastError: { at: string; message: string } | null }) {
  const failedLast = h.lastError && (!h.lastOkAt || h.lastError.at > h.lastOkAt);
  if (failedLast) return <p className="text-xs text-critical">{t('Failed {time}: {message}', { time: relativeTime(h.lastError!.at), message: h.lastError!.message })}</p>;
  if (h.lastOkAt) return <p className="text-xs text-success">{t('Worked {time}.', { time: relativeTime(h.lastOkAt) })}</p>;
  return <p className="text-xs text-muted-foreground">{t('Not used yet.')}</p>;
}

/**
 * A workspace's own AI keys or AI server, and its own email server (ADR 0068). Workspace admins only: SampForce tries
 * them before the providers the deployment shares.
 */
export function OwnServers() {
  const t = useT();
  const canManage = useCan('integrations:manage');
  return (
    <section aria-labelledby="own-servers-heading" className="space-y-3">
      <div className="flex items-center gap-1.5">
        <h2 id="own-servers-heading" className="text-base font-semibold">
          {t('Your own servers')}
        </h2>
        <InfoTip topic="integrations.own_servers" />
      </div>
      <p className="text-sm text-muted-foreground">
        {t('Use your workspace’s own AI keys or AI server, and your own email server. SampForce tries them first and can fall back to the shared ones. Private or internal addresses work only after the SampForce operator approves them.')}
      </p>
      {canManage ? (
        <>
          <OwnAiCard />
          <OwnEmailCard />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t('A workspace admin sets these up.')}</p>
      )}
    </section>
  );
}

function OwnAiCard() {
  const t = useT();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['own-servers', 'ai'], queryFn: () => api<OwnAiStatus>('/own-servers/ai') });
  const [rows, setRows] = useState<Draft[]>([]);
  const [useShared, setUseShared] = useState(true);
  const [adding, setAdding] = useState<OwnAiKind | ''>('');
  const [tests, setTests] = useState<Partial<Record<OwnAiKind, OwnServerTestResult>>>({});
  const data = status.data;

  useEffect(() => {
    if (!data) return;
    setRows(data.providers.map((p) => ({ kind: p.kind, apiKey: '', model: p.model, baseUrl: p.baseUrl ?? '' })));
    setUseShared(data.useShared);
  }, [data]);

  const onSaved = (next: OwnAiStatus) => {
    qc.setQueryData(['own-servers', 'ai'], next);
    setTests({});
    return qc.invalidateQueries({ queryKey: ['ai'] });
  };
  const save = useMutation({
    mutationFn: () =>
      api<OwnAiStatus>('/own-servers/ai', {
        method: 'PUT',
        json: {
          useShared,
          providers: rows.map((r) => ({
            kind: r.kind,
            ...(r.apiKey.trim() ? { apiKey: r.apiKey.trim() } : {}),
            ...(r.model.trim() ? { model: r.model.trim() } : {}),
            ...(r.kind === 'custom_ai' && r.baseUrl.trim() ? { baseUrl: r.baseUrl.trim() } : {}),
          })),
        },
      }),
    onSuccess: onSaved,
  });
  const remove = useMutation({ mutationFn: () => api<OwnAiStatus>('/own-servers/ai', { method: 'DELETE' }), onSuccess: onSaved });
  const test = useMutation({
    mutationFn: (kind: OwnAiKind) => api<OwnServerTestResult>(`/own-servers/ai/${kind}/test`, { method: 'POST' }),
    onSuccess: (res, kind) => {
      setTests((x) => ({ ...x, [kind]: res }));
      return qc.invalidateQueries({ queryKey: ['own-servers', 'ai'] });
    },
  });

  if (status.isPending) return <Skeleton className="h-40" />;
  const saved = new Map((data?.providers ?? []).map((p) => [p.kind, p]));
  const left = OWN_AI_KINDS.filter((k) => !rows.some((r) => r.kind === k));
  const update = (i: number, patch: Partial<Draft>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const move = (i: number, by: number) =>
    setRows((rs) => {
      const next = [...rs];
      const [r] = next.splice(i, 1);
      next.splice(i + by, 0, r!);
      return next;
    });
  const error = save.error ?? remove.error ?? test.error;

  return (
    <Card role="region" aria-labelledby="own-ai-title">
      <CardHeader className="pb-2">
        <CardTitle id="own-ai-title" className="flex flex-wrap items-center gap-2 text-sm">
          {t('Your own AI providers')}
          <Badge tone={data?.configured ? 'success' : 'neutral'}>{data?.configured ? t('In use') : t('Not set up')}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {t('Add your own API keys (free keys work) or your own server such as Ollama. They are tried in this order, before SampForce’s shared providers, and their answers use no AI credits. Keys are stored encrypted and never shown again.')}
        </p>
        {data?.updatedAt && (
          <p className="text-xs text-muted-foreground">{data.updatedBy ? t('Saved {time} by {name}.', { time: relativeTime(data.updatedAt), name: data.updatedBy }) : t('Saved {time}.', { time: relativeTime(data.updatedAt) })}</p>
        )}
        <form
          className="space-y-3"
          aria-label={t('Your own AI providers')}
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {rows.length > 0 && (
            <ol className="space-y-2" aria-label={t('Your AI providers, in order')}>
              {rows.map((r, i) => {
                const s = saved.get(r.kind);
                const name = t.maybe(OWN_AI_NAMES[r.kind]);
                const id = `own-ai-${r.kind}`;
                const result = tests[r.kind];
                return (
                  <li key={r.kind} className="space-y-2 rounded-md border p-3" aria-label={name}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        {i + 1}. {name}
                      </p>
                      <div className="flex gap-1">
                        <Button type="button" size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('Move {name} up', { name })}>
                          ↑
                        </Button>
                        <Button type="button" size="sm" variant="ghost" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={t('Move {name} down', { name })}>
                          ↓
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} aria-label={t('Remove {name}', { name })}>
                          {t('Remove')}
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{t.maybe(KEY_HELP[r.kind])}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {r.kind === 'custom_ai' && (
                        <div className="space-y-1.5 sm:col-span-2">
                          <Label htmlFor={`${id}-url`}>{t('Server address')}</Label>
                          <Input id={`${id}-url`} autoComplete="off" placeholder="https://ai.example.com/v1" value={r.baseUrl} onChange={(e) => update(i, { baseUrl: e.target.value })} />
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <Label htmlFor={`${id}-key`}>{r.kind === 'custom_ai' ? t('API key (optional)') : t('API key')}</Label>
                        <Input
                          id={`${id}-key`}
                          type="password"
                          autoComplete="off"
                          placeholder={s?.hasKey ? (s.keyHint ? t('Saved, ends in {hint}', { hint: s.keyHint }) : t('Saved')) : ''}
                          value={r.apiKey}
                          onChange={(e) => update(i, { apiKey: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`${id}-model`}>{t('Model')}</Label>
                        <Input id={`${id}-model`} autoComplete="off" placeholder={r.kind === 'custom_ai' ? 'llama3.1' : ''} value={r.model} onChange={(e) => update(i, { model: e.target.value })} />
                      </div>
                    </div>
                    {s && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate(r.kind)}>
                          {test.isPending && test.variables === r.kind ? t('Testing…') : t('Test {name}', { name })}
                        </Button>
                        {!result && healthLine(t, s)}
                      </div>
                    )}
                    {result && (
                      <p role="status" className={result.ok ? 'text-xs text-success' : 'text-xs text-critical'}>
                        {result.ok ? t('Test passed') : t('Test failed')}: {t.maybe(result.message)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {left.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-56 space-y-1.5">
                <Label htmlFor="own-ai-add">{t('Add a provider')}</Label>
                <Select id="own-ai-add" value={adding} onChange={(e) => setAdding(e.target.value as OwnAiKind | '')}>
                  <option value="">{t('Choose…')}</option>
                  {left.map((k) => (
                    <option key={k} value={k}>
                      {t.maybe(OWN_AI_NAMES[k])}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!adding}
                onClick={() => {
                  if (!adding) return;
                  setRows((rs) => [...rs, { kind: adding, apiKey: '', model: '', baseUrl: '' }]);
                  setAdding('');
                }}
              >
                {t('Add')}
              </Button>
            </div>
          )}
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 size-4 accent-[hsl(var(--primary))]" checked={useShared} onChange={(e) => setUseShared(e.target.checked)} />
            <span>
              {t('When these fail, use SampForce’s shared AI providers (they use AI credits).')}
              {data && !data.sharedAvailable && <span className="block text-xs text-muted-foreground">{t('This installation has no shared AI provider at the moment.')}</span>}
            </span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-critical">
              {error.message}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={save.isPending || rows.length === 0}>
              {save.isPending ? t('Saving…') : t('Save AI providers')}
            </Button>
            {data?.configured && (
              <Button type="button" size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
                {t('Stop using own AI providers')}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

const DEFAULT_PORT = { tls: 465, starttls: 587, none: 25 } as const;

function OwnEmailCard() {
  const t = useT();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['own-servers', 'email'], queryFn: () => api<OwnEmailStatus>('/own-servers/email') });
  const data = status.data;
  const [host, setHost] = useState('');
  const [port, setPort] = useState('587');
  const [security, setSecurity] = useState<'tls' | 'starttls' | 'none'>('starttls');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [fromName, setFromName] = useState('');
  const [result, setResult] = useState<OwnServerTestResult | null>(null);

  useEffect(() => {
    if (!data?.configured) return;
    setHost(data.host ?? '');
    setPort(String(data.port ?? 587));
    setSecurity(data.security ?? 'starttls');
    setUsername(data.username ?? '');
    setFromAddress(data.fromAddress ?? '');
    setFromName(data.fromName ?? '');
  }, [data]);

  const onSaved = (next: OwnEmailStatus) => {
    qc.setQueryData(['own-servers', 'email'], next);
    setPassword('');
  };
  const save = useMutation({
    mutationFn: () =>
      api<OwnEmailStatus>('/own-servers/email', {
        method: 'PUT',
        json: { host: host.trim(), port: Number(port), security, username: username.trim(), ...(password ? { password } : {}), fromAddress: fromAddress.trim(), fromName: fromName.trim() },
      }),
    onSuccess: (next) => {
      setResult(null);
      onSaved(next);
    },
  });
  const remove = useMutation({ mutationFn: () => api<OwnEmailStatus>('/own-servers/email', { method: 'DELETE' }), onSuccess: onSaved });
  const test = useMutation({
    mutationFn: () => api<OwnServerTestResult>('/own-servers/email/test', { method: 'POST' }),
    onSuccess: (res) => {
      setResult(res);
      return qc.invalidateQueries({ queryKey: ['own-servers', 'email'] });
    },
  });
  if (status.isPending) return <Skeleton className="h-40" />;
  const error = save.error ?? remove.error ?? test.error;
  const ready = host.trim() && Number(port) > 0 && fromAddress.trim();

  return (
    <Card role="region" aria-labelledby="own-email-title">
      <CardHeader className="pb-2">
        <CardTitle id="own-email-title" className="flex flex-wrap items-center gap-2 text-sm">
          {t('Your own email server')}
          <Badge tone={data?.configured ? 'success' : 'neutral'}>{data?.configured ? t('In use') : t('Not set up')}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {t('Email your workspace sends, such as client portal invitations, replies and portal password resets, goes out through this server (SMTP) from your own address. If it fails, SampForce’s shared email service sends it instead, when there is one.')}
        </p>
        {data?.configured && (
          <div className="space-y-1">
            <p>
              <strong>{data.fromName ? `${data.fromName} <${data.fromAddress}>` : data.fromAddress}</strong> · {data.host}:{data.port}
            </p>
            {healthLine(t, data)}
            {!data.sharedAvailable && <p className="text-xs text-muted-foreground">{t('This installation has no shared email service, so email waits for your server when it is down.')}</p>}
          </div>
        )}
        <form
          className="space-y-2 rounded-md border border-dashed p-3"
          aria-label={t('Your own email server')}
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="own-smtp-host">{t('SMTP server')}</Label>
              <Input id="own-smtp-host" autoComplete="off" placeholder="smtp.example.com" value={host} onChange={(e) => setHost(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="own-smtp-port">{t('Port')}</Label>
              <Input id="own-smtp-port" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="own-smtp-security">{t('Encryption')}</Label>
              <Select
                id="own-smtp-security"
                value={security}
                onChange={(e) => {
                  const v = e.target.value as typeof security;
                  setSecurity(v);
                  if (Object.values(DEFAULT_PORT).includes(Number(port) as 25)) setPort(String(DEFAULT_PORT[v]));
                }}
              >
                <option value="starttls">{t('STARTTLS (usually port 587)')}</option>
                <option value="tls">{t('TLS (usually port 465)')}</option>
                <option value="none">{t('None (approved private server only)')}</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="own-smtp-user">{t('User name')}</Label>
              <Input id="own-smtp-user" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="own-smtp-pass">{t('Password')}</Label>
              <Input id="own-smtp-pass" type="password" autoComplete="new-password" placeholder={data?.hasPassword ? t('Saved') : ''} value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="own-smtp-from">{t('From address')}</Label>
              <Input id="own-smtp-from" type="email" autoComplete="off" placeholder="sales@example.com" value={fromAddress} onChange={(e) => setFromAddress(e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="own-smtp-name">{t('From name (optional)')}</Label>
              <Input id="own-smtp-name" autoComplete="off" value={fromName} onChange={(e) => setFromName(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t('SampForce signs in to check the server before saving it and sends nothing. The password is stored encrypted.')}</p>
          {error && (
            <p role="alert" className="text-sm text-critical">
              {error.message}
            </p>
          )}
          {result && (
            <p role="status" className={result.ok ? 'text-xs text-success' : 'text-xs text-critical'}>
              {result.ok ? t('Test passed') : t('Test failed')}: {t.maybe(result.message)}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={save.isPending || !ready}>
              {save.isPending ? t('Checking the server…') : t('Check and save')}
            </Button>
            {data?.configured && (
              <>
                <Button type="button" size="sm" variant="outline" disabled={test.isPending} onClick={() => test.mutate()}>
                  {test.isPending ? t('Sending…') : t('Send me a test email')}
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate()}>
                  {t('Stop using own email server')}
                </Button>
              </>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

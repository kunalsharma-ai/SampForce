'use client';

import {
  DIALER_AUTH_LABELS,
  DIALER_AUTHS,
  DIALER_CAPABILITIES,
  DIALER_CATEGORY_LABELS,
  DIALER_PLACEHOLDERS,
  DIALER_PROVIDERS,
  type DialerCapability,
  type DialerCategory,
  type DialerConfig,
  type DialerFieldKey,
  type DialerInput,
  dialerInputSchema,
  type DialerProvider,
  type DialerRow,
  type DialerSecret,
  type DialerTestResult,
  providerOf,
} from '@dealflow/types';
import { Badge, Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from '@dealflow/ui';
import { Check, CheckCircle2, ChevronDown, CircleHelp, Copy, ExternalLink, KeyRound, Loader2, Pencil, PlugZap, Plus, RefreshCw, ScrollText, Star, Trash2, X, XCircle } from 'lucide-react';
import * as React from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { formatDateTime } from '@/components/crm/follow-ups';
import { useDialerLogs, useDialerMutations, useDialers } from '@/lib/calls';
import { type MessageKey, useT } from '@/lib/i18n';

/**
 * Dialer settings (ADR 0101): add any dialer from the provider list, set it up with only the settings that provider
 * uses, test the connection for real, switch it on or off, choose the default and read its integration log.
 * Browser SIP and the mobile SIM need the browser phone and the SampForce phone app, which come in the next part,
 * so they are not offered yet rather than offered and faked.
 */
const ADDABLE = new Set(['LINK', 'API', 'TWILIO']);

/** The settings each field has on the form. Providers can rename the label (DialerProvider.labels). */
const FIELDS: Record<DialerFieldKey, { label: MessageKey; hint?: MessageKey; type: 'text' | 'secret' | 'url' | 'phone' | 'list' | 'toggle' | 'select' | 'area' | 'number' | 'params'; section: 'connect' | 'signin' | 'numbers' | 'calls' | 'request'; placeholder?: string; mono?: boolean }> = {
  website: { label: 'Provider website', type: 'url', section: 'connect', placeholder: 'https://' },
  urlTemplate: { label: 'Link your dialer opens', hint: 'tel:, callto:, sip:, your dialer app’s own link, or a web address.', type: 'text', section: 'connect', mono: true },
  apiBaseUrl: { label: 'API address', hint: 'The provider’s API base address, for example https://api.provider.com', type: 'url', section: 'connect', placeholder: 'https://api.provider.com', mono: true },
  account: { label: 'Account id', type: 'text', section: 'signin' },
  apiAuth: { label: 'How SampForce signs in', type: 'select', section: 'signin' },
  apiUser: { label: 'API key or user name', type: 'text', section: 'signin', mono: true },
  apiSecret: { label: 'API secret or token', type: 'secret', section: 'signin' },
  apiHeaderName: { label: 'Header the key goes in', type: 'text', section: 'signin', placeholder: 'x-api-key', mono: true },
  clientId: { label: 'Client id', type: 'text', section: 'signin', mono: true },
  clientSecret: { label: 'Client secret', type: 'secret', section: 'signin' },
  tokenUrl: { label: 'Token address (OAuth 2)', type: 'url', section: 'signin', placeholder: 'https://', mono: true },
  accessToken: { label: 'Access token', type: 'secret', section: 'signin' },
  refreshToken: { label: 'Refresh token', type: 'secret', section: 'signin' },
  sipServer: { label: 'SIP server', type: 'url', section: 'connect', placeholder: 'wss://pbx.example.com:8089/ws', mono: true },
  sipDomain: { label: 'SIP domain', type: 'text', section: 'connect', mono: true },
  sipPort: { label: 'Port', type: 'number', section: 'connect' },
  sipUsername: { label: 'SIP user name', type: 'text', section: 'signin', mono: true },
  sipPassword: { label: 'SIP password', type: 'secret', section: 'signin' },
  extension: { label: 'Extension', type: 'text', section: 'numbers', mono: true },
  agentPhone: { label: 'Your phone number', hint: 'The provider rings this phone first, then connects the person you are calling.', type: 'phone', section: 'numbers', placeholder: '+44 7700 900123' },
  callerIds: { label: 'Caller ids', hint: 'The numbers your calls can show, with the country code. The first is the default.', type: 'list', section: 'numbers', placeholder: '+91 80 4000 1000' },
  registeredNumber: { label: 'Registered number', type: 'phone', section: 'numbers' },
  defaultCountryCode: { label: 'Default country code', hint: 'Added to numbers written without one, for example +91.', type: 'text', section: 'numbers', placeholder: '+91' },
  regions: { label: 'Countries it may call', hint: 'Two-letter codes, such as IN, GB, US. Leave empty to call anywhere.', type: 'list', section: 'numbers', placeholder: 'IN' },
  allowOutgoing: { label: 'Outgoing calls', type: 'toggle', section: 'calls' },
  allowIncoming: { label: 'Incoming calls', hint: 'The provider reports incoming calls to the events address, and they ring here.', type: 'toggle', section: 'calls' },
  recording: { label: 'Recording', type: 'select', section: 'calls' },
  historySync: { label: 'Keep call history in step', type: 'toggle', section: 'calls' },
  customParams: { label: 'Extra values', hint: 'Values the provider wants with every call. Each one becomes a {placeholder} of its own.', type: 'params', section: 'request' },
  webhookUrl: { label: 'Webhook (optional)', hint: 'Every call’s company and employee details are also posted here, signed, so your dialer can show them.', type: 'url', section: 'calls', placeholder: 'https://dialer.example.com/sampforce' },
  callPath: { label: 'Path that places a call', type: 'text', section: 'request', mono: true },
  hangupPath: { label: 'Path that ends a call', hint: 'Sent as DELETE with {providerCallId}. Leave empty if the provider cannot end calls.', type: 'text', section: 'request', mono: true },
  testPath: { label: 'Path for a connection test', hint: 'A request that places no call, such as the account details. Leave empty if there is none.', type: 'text', section: 'request', mono: true },
  apiMethod: { label: 'Method', type: 'select', section: 'request' },
  apiContentType: { label: 'Request format', type: 'select', section: 'request' },
  apiBody: { label: 'Request', hint: 'The call details go in as {placeholders}.', type: 'area', section: 'request', mono: true },
  responseCallIdPath: { label: 'Where the call id is in the answer', type: 'text', section: 'request', placeholder: 'Call.Sid', mono: true },
  deviceId: { label: 'Phone', type: 'text', section: 'numbers' },
};
const SECTIONS: { key: (typeof FIELDS)[DialerFieldKey]['section']; label: MessageKey }[] = [
  { key: 'connect', label: 'Connection' },
  { key: 'signin', label: 'Sign-in and keys' },
  { key: 'numbers', label: 'Numbers' },
  { key: 'calls', label: 'Calls and recordings' },
  { key: 'request', label: 'The request (advanced)' },
];
const STATUS: Record<DialerRow['status'], { label: MessageKey; tone: string }> = {
  UNTESTED: { label: 'Not tested yet', tone: 'bg-slate-500/15 text-slate-700 dark:text-slate-300' },
  CONNECTED: { label: 'Connected', tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  FAILED: { label: 'Not connected', tone: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  NOT_TESTABLE: { label: 'Opens on this device', tone: 'bg-sky-500/15 text-sky-700 dark:text-sky-300' },
};

export function ProviderMark({ provider, size = 'md' }: { provider: Pick<DialerProvider, 'mark' | 'color'>; size?: 'sm' | 'md' }) {
  return (
    <span aria-hidden className={cn('flex shrink-0 items-center justify-center rounded-xl font-bold text-white shadow-sm', size === 'sm' ? 'size-7 text-[0.65rem]' : 'size-10 text-sm')} style={{ background: `linear-gradient(135deg, ${provider.color}, ${provider.color}cc)` }}>
      {provider.mark}
    </span>
  );
}

/** The Dialer settings tab: the person's dialers, and adding another. */
export function DialerSettingsPanel() {
  const t = useT();
  const settings = useDialers();
  const [picking, setPicking] = React.useState(false);
  const [editing, setEditing] = React.useState<{ provider: DialerProvider; row: DialerRow | null } | null>(null);
  const [secret, setSecret] = React.useState<{ name: string; value: string } | null>(null);
  const [logsFor, setLogsFor] = React.useState<DialerRow | null>(null);
  const dialers = settings.data?.dialers ?? [];
  return (
    <section aria-labelledby="dialer-settings" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="dialer-settings" className="text-base font-semibold">
            {t('Dialer settings')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('Add the phone systems you call with. Each one says what it can and cannot do.')}</p>
        </div>
        <Button onClick={() => setPicking(true)}>
          <Plus aria-hidden /> {t('Add a dialer')}
        </Button>
      </div>
      {secret && <SecretNotice secret={secret} onClose={() => setSecret(null)} />}
      <ul className="grid gap-3 lg:grid-cols-2" aria-label={t('My dialers')}>
        <li className="flex items-center gap-3 rounded-2xl border border-dashed border-border p-4">
          <ProviderMark provider={providerOf({ provider: 'phone', kind: 'LINK' })} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t('Phone app')}</p>
            <p className="text-xs text-muted-foreground">{dialers.some((d) => d.isDefault && d.active) ? t('Used when you choose it for a call.') : t('Used for your calls until you add a dialer.')}</p>
          </div>
          <Badge tone="neutral">{t('Built in')}</Badge>
        </li>
        {dialers.map((d) => (
          <DialerCard key={d.id} d={d} onEdit={() => setEditing({ provider: providerOf(d), row: d })} onLogs={() => setLogsFor(d)} onSecret={(value) => setSecret({ name: d.name, value })} />
        ))}
      </ul>
      <ProviderGallery
        open={picking}
        twilio={settings.data?.twilio ?? { connected: false, fromNumber: null }}
        onOpenChange={setPicking}
        onPick={(provider) => {
          setPicking(false);
          setEditing({ provider, row: null });
        }}
      />
      <DialerDialog
        open={!!editing}
        provider={editing?.provider ?? null}
        editing={editing?.row ?? null}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={(d) => {
          setEditing(null);
          if (d.webhookSecret) setSecret({ name: d.name, value: d.webhookSecret });
        }}
      />
      <DialerLogDialog dialer={logsFor} onClose={() => setLogsFor(null)} />
    </section>
  );
}

function DialerCard({ d, onEdit, onLogs, onSecret }: { d: DialerRow; onEdit: () => void; onLogs: () => void; onSecret: (value: string) => void }) {
  const t = useT();
  const m = useDialerMutations();
  const p = providerOf(d);
  const [result, setResult] = React.useState<DialerTestResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const status = STATUS[d.status];
  const run = async () => {
    setError(null);
    try {
      setResult(await m.test.mutateAsync(d.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not test the dialer.'));
    }
  };
  const can = (Object.keys(DIALER_CAPABILITIES) as DialerCapability[]).filter((k) => k !== 'placeCalls');
  return (
    <li data-testid="dialer-card" className={cn('space-y-3 rounded-2xl border bg-surface p-4 shadow-sm transition', d.active ? 'border-border' : 'border-dashed border-border opacity-75')}>
      <div className="flex items-start gap-3">
        <ProviderMark provider={p} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
            {d.name}
            {d.isDefault && <Badge tone="primary">{t('Default')}</Badge>}
            {!d.active && <Badge tone="neutral">{t('Switched off')}</Badge>}
          </p>
          <p className="truncate text-xs text-muted-foreground">{t.maybe(p.name)}</p>
          <p className={cn('mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-semibold', status.tone)} data-testid="dialer-status">
            {d.status === 'CONNECTED' ? <CheckCircle2 aria-hidden className="size-3" /> : d.status === 'FAILED' ? <XCircle aria-hidden className="size-3" /> : <CircleHelp aria-hidden className="size-3" />}
            {t(status.label)}
            {d.statusAt && <span className="font-normal opacity-80">· {formatDateTime(d.statusAt)}</span>}
          </p>
          {d.status === 'FAILED' && d.statusMessage && <p className="mt-1 text-xs text-critical">{d.statusMessage}</p>}
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs font-medium">
          <span className="sr-only sm:not-sr-only">{d.active ? t('On') : t('Off')}</span>
          <button
            type="button"
            role="switch"
            aria-checked={d.active}
            aria-label={t('{name} is on', { name: d.name })}
            onClick={() => m.setActive.mutate({ id: d.id, active: !d.active })}
            className={cn('relative h-6 w-11 rounded-full transition', d.active ? 'bg-emerald-600' : 'bg-muted-foreground/40')}
          >
            <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', d.active ? 'start-[1.375rem]' : 'start-0.5')} />
          </button>
        </label>
      </div>
      <ul className="flex flex-wrap gap-1" aria-label={t('What {name} can do', { name: d.name })}>
        {can.map((k) => (
          <li key={k} className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.68rem]', d.capabilities[k] ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'bg-muted text-muted-foreground line-through decoration-muted-foreground/50')}>
            {d.capabilities[k] ? <Check aria-hidden className="size-3" /> : <X aria-hidden className="size-3" />}
            <span>{t.maybe(DIALER_CAPABILITIES[k])}</span>
            <span className="sr-only">{d.capabilities[k] ? t('available') : t('not available')}</span>
          </li>
        ))}
      </ul>
      {d.eventsUrl && <CopyRow label={t('Events address for the provider')} value={d.eventsUrl} onRenew={() => m.renewEvents.mutate(d.id)} />}
      {result && <TestResult r={result} onClose={() => setResult(null)} />}
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5 border-t border-border pt-3">
        <Button size="sm" variant="outline" onClick={() => void run()} disabled={m.test.isPending}>
          {m.test.isPending && m.test.variables === d.id ? <Loader2 aria-hidden className="animate-spin" /> : <PlugZap aria-hidden />} {t('Test connection')}
        </Button>
        {!d.isDefault && d.active && (
          <Button size="sm" variant="ghost" onClick={() => m.makeDefault.mutate(d.id)}>
            <Star aria-hidden /> {t('Make default')}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onLogs}>
          <ScrollText aria-hidden /> {t('Log')}
        </Button>
        {d.webhookUrl && (
          <Button size="sm" variant="ghost" onClick={async () => onSecret((await m.renewSecret.mutateAsync(d.id)).webhookSecret ?? '')}>
            <KeyRound aria-hidden /> {t('New webhook secret')}
          </Button>
        )}
        <span className="flex-1" />
        <Button size="icon" variant="ghost" className="size-8" aria-label={t('Edit {name}', { name: d.name })} onClick={onEdit}>
          <Pencil aria-hidden className="size-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="size-8 text-critical" aria-label={t('Remove {name}', { name: d.name })} onClick={() => window.confirm(t('Remove the dialer “{name}”? Calls placed with it stay in the history.', { name: d.name })) && m.remove.mutate(d.id)}>
          <Trash2 aria-hidden className="size-3.5" />
        </Button>
      </div>
    </li>
  );
}

function TestResult({ r, onClose }: { r: DialerTestResult; onClose: () => void }) {
  const t = useT();
  return (
    <div role="status" data-testid="dialer-test-result" className={cn('space-y-2 rounded-xl border p-3 text-xs', r.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-critical/40 bg-critical/5')}>
      <div className="flex items-start gap-2">
        <p className="flex-1 font-semibold">{r.message}</p>
        <button type="button" onClick={onClose} aria-label={t('Close')} className="rounded p-0.5 hover:bg-muted">
          <X aria-hidden className="size-3.5" />
        </button>
      </div>
      <ol className="space-y-1">
        {r.steps.map((s, i) => (
          <li key={i} className="flex items-start gap-1.5">
            {s.ok ? <CheckCircle2 aria-hidden className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : <XCircle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-critical" />}
            <span>
              {t.maybe(s.label)}
              {s.detail && <span className="block break-all font-mono text-[0.68rem] text-muted-foreground">{s.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      {r.sample.request && (
        <details>
          <summary className="cursor-pointer font-medium">{t('The request a call sends')}</summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-[0.68rem]">
            {`${r.sample.request.method} ${r.sample.request.url}\n${Object.entries(r.sample.request.headers)
              .map(([k, v]) => `${k}: ${v}`)
              .join('\n')}${r.sample.request.body ? `\n\n${r.sample.request.body}` : ''}`}
          </pre>
        </details>
      )}
    </div>
  );
}

function CopyRow({ label, value, onRenew }: { label: string; value: string; onRenew?: () => void }) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="rounded-xl bg-muted/50 p-2 text-xs">
      <p className="mb-1 font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-1.5">
        <code className="min-w-0 flex-1 truncate font-mono text-[0.68rem]" title={value}>
          {value}
        </code>
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          }}
        >
          <Copy aria-hidden /> {copied ? t('Copied') : t('Copy')}
        </Button>
        {onRenew && (
          <Button size="icon" variant="ghost" className="size-7" aria-label={t('Make a new events address')} title={t('Make a new events address')} onClick={() => window.confirm(t('Make a new events address? The old one stops working, so update it at the provider.')) && onRenew()}>
            <RefreshCw aria-hidden className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function SecretNotice({ secret, onClose }: { secret: { name: string; value: string }; onClose: () => void }) {
  const t = useT();
  return (
    <div role="status" className="space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs">
      <p className="flex items-center gap-1.5 font-semibold">
        <KeyRound aria-hidden className="size-3.5" /> {t('Webhook secret for {name}', { name: secret.name })}
      </p>
      <p>{t('Your dialer checks the X-SampForce-Signature header with this secret. It is shown only now.')}</p>
      <CopyRow label={t('Secret')} value={secret.value} />
      <Button size="sm" variant="ghost" onClick={onClose}>
        {t('Done')}
      </Button>
    </div>
  );
}

/** Choosing a dialer to add: the providers by kind, each with what it can do. */
function ProviderGallery({ open, twilio, onOpenChange, onPick }: { open: boolean; twilio: { connected: boolean; fromNumber: string | null }; onOpenChange: (o: boolean) => void; onPick: (p: DialerProvider) => void }) {
  const t = useT();
  const groups = (Object.keys(DIALER_CATEGORY_LABELS) as DialerCategory[]).map((c) => ({ c, list: DIALER_PROVIDERS.filter((p) => p.category === c && ADDABLE.has(p.kind)) })).filter((g) => g.list.length);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[5vh] flex max-h-[90vh] max-w-3xl flex-col p-0">
        <header className="border-b border-border px-5 pb-3 pt-5 pe-12">
          <DialogTitle className="text-lg font-semibold">{t('Add a dialer')}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{t('Choose how you call. Cloud phone systems ring by themselves and report back; links open an app on this device.')}</DialogDescription>
        </header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {groups.map(({ c, list }) => (
            <section key={c} aria-labelledby={`providers-${c}`}>
              <h3 id={`providers-${c}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t.maybe(DIALER_CATEGORY_LABELS[c])}
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {list.map((p) => {
                  const needsTwilio = p.kind === 'TWILIO' && !twilio.connected;
                  const yes = (Object.keys(p.capabilities) as DialerCapability[]).filter((k) => p.capabilities[k] && k !== 'placeCalls');
                  return (
                    <button
                      key={p.key}
                      type="button"
                      data-provider={p.key}
                      disabled={needsTwilio}
                      onClick={() => onPick(p)}
                      className="flex items-start gap-3 rounded-xl border border-border p-3 text-start transition enabled:hover:border-primary/60 enabled:hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <ProviderMark provider={p} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{t.maybe(p.name)}</span>
                        <span className="block text-xs text-muted-foreground">{needsTwilio ? t('Needs Twilio connected in Integrations by a workspace admin.') : t.maybe(p.description)}</span>
                        {yes.length > 0 && (
                          <span className="mt-1.5 flex flex-wrap gap-1">
                            {yes.slice(0, 4).map((k) => (
                              <span key={k} className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[0.65rem] text-emerald-800 dark:text-emerald-300">
                                {t.maybe(DIALER_CAPABILITIES[k])}
                              </span>
                            ))}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
          <p className="rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">{t('Calling from your mobile SIM and the browser SIP phone come with the SampForce phone app and browser phone. Until then they are not offered, so nothing pretends to be connected.')}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type Draft = { name: string; webhookUrl: string; isDefault: boolean; config: Partial<DialerConfig> & Record<string, unknown>; secrets: Partial<Record<DialerSecret, string | null>> };

/** Setting a dialer up: only the settings its provider uses, in sections, with a header and buttons that stay in view. */
export function DialerDialog({ open, provider, editing, onOpenChange, onSaved }: { open: boolean; provider: DialerProvider | null; editing: DialerRow | null; onOpenChange: (o: boolean) => void; onSaved: (d: DialerRow) => void }) {
  const t = useT();
  const m = useDialerMutations();
  const p = provider ?? DIALER_PROVIDERS[0]!;
  const blank = (): Draft =>
    editing
      ? { name: editing.name, webhookUrl: editing.webhookUrl ?? '', isDefault: editing.isDefault, config: { ...editing.config, urlTemplate: editing.urlTemplate ?? editing.config.urlTemplate, agentPhone: editing.agentPhone ?? editing.config.agentPhone }, secrets: {} }
      : { name: t.maybe(p.name), webhookUrl: '', isDefault: true, config: { allowOutgoing: true, ...p.preset }, secrets: {} };
  const [v, setV] = React.useState<Draft>(blank);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [advanced, setAdvanced] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setV(blank());
      setErrors({});
      setFormError(null);
      // The ready-made providers have their request filled in; "any cloud dialer" needs it set.
      setAdvanced(p.key === 'api');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing, provider]);
  const cfg = (patch: Record<string, unknown>) => setV((x) => ({ ...x, config: { ...x.config, ...patch } }));
  const auth = (v.config.apiAuth as string | undefined) ?? 'NONE';
  const shown = p.fields.filter((f) => {
    if (p.key !== 'api') return true;
    // "Any cloud dialer": only the sign-in settings the chosen sign-in uses.
    if (['apiUser'].includes(f)) return auth === 'BASIC' || auth === 'HEADER';
    if (f === 'apiSecret') return ['BASIC', 'HEADER', 'BEARER'].includes(auth);
    if (f === 'apiHeaderName') return auth === 'HEADER';
    if (['clientId', 'clientSecret', 'tokenUrl', 'refreshToken'].includes(f)) return auth === 'OAUTH2';
    if (f === 'accessToken') return auth === 'BEARER';
    return true;
  });
  if (p.kind === 'API' && !shown.includes('webhookUrl')) shown.push('webhookUrl');
  const label = (f: DialerFieldKey) => (p.labels?.[f] ? t.maybe(p.labels[f]!) : t(FIELDS[f].label));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const config = { ...v.config };
    delete config.urlTemplate;
    delete config.agentPhone;
    const input = {
      name: v.name,
      kind: p.kind,
      provider: p.key,
      urlTemplate: p.kind === 'LINK' ? ((v.config.urlTemplate as string) ?? '') : null,
      agentPhone: (v.config.agentPhone as string) || null,
      webhookUrl: v.webhookUrl || null,
      config,
      secrets: Object.keys(v.secrets).length ? v.secrets : undefined,
      isDefault: v.isDefault,
    };
    const parsed = dialerInputSchema.safeParse(input);
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const i of parsed.error.issues) out[String(i.path.at(-1) === undefined ? i.path[0] : i.path[0] === 'config' ? i.path[1] : i.path[0])] ??= t.maybe(i.message);
      setErrors(out);
      if (Object.keys(out).some((k) => FIELDS[k as DialerFieldKey]?.section === 'request')) setAdvanced(true);
      return;
    }
    setErrors({});
    try {
      const body = parsed.data as DialerInput;
      const saved = editing ? await m.update.mutateAsync({ id: editing.id, input: body }) : await m.create.mutateAsync(body);
      onSaved(saved);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };
  const busy = m.create.isPending || m.update.isPending;
  const sections = SECTIONS.map((s) => ({ ...s, fields: shown.filter((f) => FIELDS[f]?.section === s.key && f !== 'deviceId') })).filter((s) => s.fields.length);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[5vh] flex max-h-[90vh] max-w-2xl flex-col p-0" aria-describedby="dialer-dialog-description">
        <header className="flex items-start gap-3 border-b border-border px-5 pb-3 pt-5 pe-12">
          <ProviderMark provider={p} />
          <div className="min-w-0">
            <DialogTitle className="text-lg font-semibold">{editing ? t('Edit dialer') : t('Add {provider}', { provider: t.maybe(p.name) })}</DialogTitle>
            <DialogDescription id="dialer-dialog-description" className="text-sm text-muted-foreground">
              {t.maybe(p.description)}
            </DialogDescription>
          </div>
        </header>
        <form id="dialer-form" onSubmit={submit} className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4" noValidate>
          {p.setupHelp && (
            <p className="flex gap-2 rounded-xl bg-sky-500/10 p-3 text-xs text-sky-900 dark:text-sky-200">
              <CircleHelp aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                {t.maybe(p.setupHelp)}
                {p.website && (
                  <a href={p.website} target="_blank" rel="noreferrer" className="ms-1 inline-flex items-center gap-0.5 font-medium underline">
                    {t('Open the provider’s site')} <ExternalLink aria-hidden className="size-3" />
                  </a>
                )}
              </span>
            </p>
          )}
          <Field id="dialer-name" label={t('Dialer name')} error={errors.name}>
            <Input value={v.name} onChange={(e) => setV((x) => ({ ...x, name: e.target.value }))} maxLength={80} />
          </Field>
          {sections.map((s) => {
            const collapsible = s.key === 'request' && p.key !== 'api';
            const body = (
              <div className="grid gap-4 sm:grid-cols-2">
                {s.fields.map((f) => (
                  <DialerField key={f} f={f} label={label(f)} error={errors[f]} v={v} editing={editing} cfg={cfg} setV={setV} />
                ))}
              </div>
            );
            return (
              <fieldset key={s.key} className="space-y-3 rounded-2xl border border-border p-4">
                <legend className="px-1 text-sm font-semibold">{t(s.label)}</legend>
                {collapsible ? (
                  <>
                    <button type="button" aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)} className="flex items-center gap-1 text-xs font-medium text-primary">
                      <ChevronDown aria-hidden className={cn('size-3.5 transition', advanced && 'rotate-180')} /> {advanced ? t('Hide the request') : t('Show the request {provider} is sent', { provider: t.maybe(p.name) })}
                    </button>
                    {advanced && body}
                  </>
                ) : (
                  body
                )}
              </fieldset>
            );
          })}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.isDefault} onChange={(e) => setV((x) => ({ ...x, isDefault: e.target.checked }))} className="size-4 accent-[hsl(var(--primary))]" />
            {t('Use for my calls by default')}
          </label>
          {formError && (
            <p role="alert" className="text-sm text-critical">
              {formError}
            </p>
          )}
        </form>
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-popover px-5 py-3">
          {Object.keys(errors).length > 0 && <p className="me-auto text-xs text-critical">{t('Check the settings marked in red.')}</p>}
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button type="submit" form="dialer-form" disabled={busy}>
            {busy ? t('Saving…') : t('Save dialer')}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function DialerField({ f, label, error, v, editing, cfg, setV }: { f: DialerFieldKey; label: string; error?: string; v: Draft; editing: DialerRow | null; cfg: (p: Record<string, unknown>) => void; setV: React.Dispatch<React.SetStateAction<Draft>> }) {
  const t = useT();
  const def = FIELDS[f];
  const id = `dialer-${f}`;
  const hint = def.hint ? t(def.hint) : undefined;
  const value = f === 'webhookUrl' ? v.webhookUrl : v.config[f];
  const wide = ['area', 'params', 'url'].includes(def.type) || f === 'urlTemplate' || f === 'callPath';
  const area = React.useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  if (def.type === 'secret') {
    const key = f as DialerSecret;
    const saved = editing?.secretsSaved[key] && v.secrets[key] !== null;
    return (
      <div className="space-y-1">
        <Field id={id} label={label} error={error} hint={saved ? t('Saved. Leave empty to keep it.') : t('Stored encrypted. Never shown again.')}>
          <Input type="password" autoComplete="new-password" value={v.secrets[key] ?? ''} onChange={(e) => setV((x) => ({ ...x, secrets: { ...x.secrets, [key]: e.target.value || undefined } }))} placeholder={saved ? '••••••••' : ''} />
        </Field>
        {saved && (
          <button type="button" className="text-xs text-critical hover:underline" onClick={() => setV((x) => ({ ...x, secrets: { ...x.secrets, [key]: null } }))}>
            {t('Remove the saved value')}
          </button>
        )}
      </div>
    );
  }
  if (def.type === 'toggle') {
    return (
      <label className="flex items-start gap-2 rounded-xl border border-border p-3 text-sm">
        <input type="checkbox" checked={!!value} onChange={(e) => cfg({ [f]: e.target.checked })} className="mt-0.5 size-4 accent-[hsl(var(--primary))]" />
        <span>
          <span className="font-medium">{label}</span>
          {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
        </span>
      </label>
    );
  }
  if (def.type === 'select') {
    const options: [string, string][] =
      f === 'apiAuth'
        ? DIALER_AUTHS.map((a) => [a, t.maybe(DIALER_AUTH_LABELS[a])])
        : f === 'recording'
          ? [
              ['OFF', t('Off')],
              ['ON_DEMAND', t('When I start it on a call')],
              ['ALWAYS', t('Every call')],
            ]
          : f === 'apiMethod'
            ? [['POST', 'POST'], ['GET', 'GET'], ['PUT', 'PUT']]
            : [['JSON', 'JSON'], ['FORM', t('Form (key=value&…)')]];
    return (
      <Field id={id} label={label} error={error} hint={f === 'recording' ? t('Only where the workspace’s recording policy allows it, and after consent when it asks for it.') : hint}>
        <Select value={String(value ?? options[0]![0])} onChange={(e) => cfg({ [f]: e.target.value })}>
          {options.map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
      </Field>
    );
  }
  if (def.type === 'list') {
    const list = (value as string[] | undefined) ?? [];
    return (
      <div className={cn('sm:col-span-2')}>
        <Field id={id} label={label} error={error} hint={hint}>
          <Input value={list.join(', ')} onChange={(e) => cfg({ [f]: e.target.value.split(/[,;\n]+/).map((x) => (f === 'regions' ? x.trim().toUpperCase() : x.trim())).filter(Boolean) })} placeholder={def.placeholder} className={cn(def.mono && 'font-mono text-xs')} />
        </Field>
      </div>
    );
  }
  if (def.type === 'params') {
    const list = (value as { key: string; value: string }[] | undefined) ?? [];
    const set = (next: { key: string; value: string }[]) => cfg({ customParams: next });
    return (
      <div className="space-y-2 sm:col-span-2">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {list.map((p, i) => (
          <div key={i} className="flex gap-2">
            <Input aria-label={t('Name')} value={p.key} onChange={(e) => set(list.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} className="w-40 font-mono text-xs" placeholder="appId" />
            <Input aria-label={t('Value')} value={p.value} onChange={(e) => set(list.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} className="flex-1 font-mono text-xs" />
            <Button type="button" size="icon" variant="ghost" aria-label={t('Remove')} onClick={() => set(list.filter((_, j) => j !== i))}>
              <Trash2 aria-hidden className="size-3.5" />
            </Button>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={() => set([...list, { key: '', value: '' }])} disabled={list.length >= 20}>
          <Plus aria-hidden /> {t('Add a value')}
        </Button>
        {error && <p className="text-xs text-critical">{error}</p>}
      </div>
    );
  }
  const placeholders = f === 'urlTemplate' || f === 'apiBody' || f === 'callPath';
  const insert = (key: string) => {
    const el = area.current;
    const s = String(value ?? '');
    const at = el?.selectionStart ?? s.length;
    cfg({ [f]: `${s.slice(0, at)}{${key}}${s.slice(el?.selectionEnd ?? at)}` });
    requestAnimationFrame(() => el?.focus());
  };
  return (
    <div className={cn('space-y-2', wide && 'sm:col-span-2')}>
      <Field id={id} label={label} error={error} hint={hint}>
        {def.type === 'area' ? (
          <Textarea ref={area} value={String(value ?? '')} onChange={(e) => cfg({ [f]: e.target.value })} className="min-h-24 font-mono text-xs" spellCheck={false} />
        ) : (
          <Input
            ref={area}
            value={String(value ?? '')}
            onChange={(e) => (f === 'webhookUrl' ? setV((x) => ({ ...x, webhookUrl: e.target.value })) : cfg({ [f]: def.type === 'number' ? (e.target.value ? Number(e.target.value) : null) : e.target.value }))}
            placeholder={def.placeholder}
            inputMode={def.type === 'phone' ? 'tel' : def.type === 'url' ? 'url' : def.type === 'number' ? 'numeric' : undefined}
            className={cn(def.mono && 'font-mono text-xs')}
            spellCheck={false}
          />
        )}
      </Field>
      {placeholders && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('Insert a call detail')}>
          {Object.entries(DIALER_PLACEHOLDERS).map(([key, l]) => (
            <button key={key} type="button" title={t.maybe(l)} onClick={() => insert(key)} className="rounded-full border border-border bg-muted/50 px-2 py-0.5 font-mono text-[0.68rem] hover:border-primary hover:text-primary">
              {`{${key}}`}
            </button>
          ))}
          {(v.config.customParams as { key: string }[] | undefined)?.filter((c) => c.key).map((c) => (
            <button key={c.key} type="button" onClick={() => insert(c.key)} className="rounded-full border border-violet-400/50 bg-violet-500/10 px-2 py-0.5 font-mono text-[0.68rem]">
              {`{${c.key}}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const LOG_ACTION: Record<string, MessageKey> = { TEST: 'Test', PLACE: 'Call placed', HANGUP: 'Call ended', EVENT: 'Event from the provider', RECORDING: 'Recording', WEBHOOK: 'Webhook', TOKEN: 'Sign-in token' };

/** The dialer's integration log: every request to the provider and every event back. Keys never appear in it. */
function DialerLogDialog({ dialer, onClose }: { dialer: DialerRow | null; onClose: () => void }) {
  const t = useT();
  const logs = useDialerLogs(dialer?.id ?? null);
  return (
    <Dialog open={!!dialer} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="top-[5vh] flex max-h-[85vh] max-w-2xl flex-col p-0">
        <header className="border-b border-border px-5 pb-3 pt-5 pe-12">
          <DialogTitle className="text-lg font-semibold">{t('Integration log: {name}', { name: dialer?.name ?? '' })}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">{t('Each request to the provider and each event it sent back. Keys are never written here.')}</DialogDescription>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          {logs.isPending ? (
            <Loader2 aria-hidden className="mx-auto my-8 animate-spin" />
          ) : !logs.data?.length ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('Nothing logged yet. Test the connection or place a call.')}</p>
          ) : (
            <ol className="divide-y divide-border text-sm" aria-label={t('Integration log')}>
              {logs.data.map((l) => (
                <li key={l.id} className="flex items-start gap-2 py-2">
                  {l.ok ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-critical" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {t(LOG_ACTION[l.action] ?? 'Test')}
                      {l.httpStatus != null && <span className="ms-2 font-mono text-xs text-muted-foreground">HTTP {l.httpStatus}</span>}
                      {l.attempt > 1 && <span className="ms-2 text-xs text-muted-foreground">{t('attempt {n}', { n: String(l.attempt) })}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{l.message}</p>
                  </div>
                  <time className="shrink-0 text-xs text-muted-foreground" dateTime={l.at}>
                    {formatDateTime(l.at)}
                  </time>
                </li>
              ))}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

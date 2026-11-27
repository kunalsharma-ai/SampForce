'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Skeleton } from '@dealflow/ui';
import type { AppEventRow, AppStatus, PaymentsSettings, SampbidxSettings, TwilioSettings, WhatsappSettings } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Select } from '@/components/crm/select';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useCan } from '@/lib/session';
import { inSentence, rich, type Translator, useT } from '@/lib/i18n';
import { InfoTip } from '@/components/info-tip';

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

function connectedLine(t: Translator, c: { connectedAt: string; connectedBy?: string | null }) {
  return c.connectedBy ? t('Connected {time} by {name}.', { time: relativeTime(c.connectedAt), name: c.connectedBy }) : t('Connected {time}.', { time: relativeTime(c.connectedAt) });
}

function checkedLine(t: Translator, c: { connectedAt: string; connectedBy?: string | null }) {
  return c.connectedBy ? t('Credentials checked {time} by {name}.', { time: relativeTime(c.connectedAt), name: c.connectedBy }) : t('Credentials checked {time}.', { time: relativeTime(c.connectedAt) });
}

/** Apps a workspace admin connects once for everyone: DocuSign, card payments, WhatsApp, SMS and SampBidx. */
export function WorkspaceApps() {
  const t = useT();
  const params = useSearchParams();
  const apps = useQuery({ queryKey: ['apps'], queryFn: () => api<AppStatus[]>('/apps') });
  const app = params.get('app');
  const connected = params.get('app_connected');
  const error = params.get('app_error');
  return (
    <section aria-labelledby="apps-heading" className="space-y-3">
      <div className="flex items-center gap-1.5">
        <h2 id="apps-heading" className="text-base font-semibold">
          {t('Workspace apps')}
        </h2>
        <InfoTip topic="integrations.apps" />
      </div>
      {app === 'docusign' && connected && <p className="rounded-md border border-success/40 bg-success/10 p-3 text-sm">{t('DocuSign is connected. Send draft contracts for signature from the contract page.')}</p>}
      {app && error && (
        <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 p-3 text-sm text-critical">
          {OUTCOME[error] ? t.maybe(OUTCOME[error]) : t('The connection did not complete ({error}).', { error })}
        </p>
      )}
      {apps.isPending ? <Skeleton className="h-32" /> : apps.data?.map((a) => (a.key === 'docusign' ? <OAuthAppCard key={a.key} app={a} /> : a.key === 'payments' ? <PaymentsCard key={a.key} app={a} /> : a.key === 'whatsapp' ? <WhatsappCard key={a.key} app={a} /> : a.key === 'twilio' ? <TwilioCard key={a.key} app={a} /> : a.key === 'sampbidx' ? <SampbidxCard key={a.key} app={a} /> : null))}
    </section>
  );
}

const OAUTH_COPY: Record<'docusign', { blurb: string; credentials: string; privacy: string; disconnect: string }> = {
  docusign: {
    blurb: 'Contracts go out from this DocuSign account, one envelope per contract, only after the sender confirms.',
    credentials: 'the SampForce DocuSign app’s integration key and secret',
    privacy: 'SampForce reads only envelopes it sent. Signed PDFs stay in DocuSign and are fetched when someone downloads them.',
    disconnect: 'Disconnect DocuSign? Envelopes already sent stay in DocuSign, but their status will no longer update here.',
  },
};

/** DocuSign: an admin connects the company's account once through the provider's OAuth. */
function OAuthAppCard({ app }: { app: AppStatus }) {
  const t = useT();
  const copy = OAUTH_COPY[app.key as 'docusign'];
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
          {t.maybe(app.name)}
          <Badge tone={s.tone}>{t.maybe(s.label)}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {t.maybe(app.description)} {t.maybe(copy.blurb)}
        </p>
        {app.state === 'pending_configuration' && (
          <p className="text-muted-foreground">{t('An operator must add {settings} ({credentials}) in the operator console under Providers before anyone can connect.', { settings: new Intl.ListFormat(t.language, { type: 'conjunction' }).format(app.missingConfig), credentials: t.maybe(copy.credentials) })}</p>
        )}
        {app.warnings.map((w) => (
          <p key={w} className="text-xs text-warning">
            {t.maybe(w)}
          </p>
        ))}
        {c && (
          <div className="space-y-1">
            <p>
              <strong>{c.accountName}</strong>
            </p>
            <p className="text-xs text-muted-foreground">
              {connectedLine(t, c)} {c.lastUsedAt ? t('Last used {time}.', { time: relativeTime(c.lastUsedAt) }) : t('Not used yet.')}
            </p>
            {c.lastError && <p className="text-xs text-critical">{c.lastError}</p>}
            <p className="text-xs text-muted-foreground">{t.maybe(copy.privacy)}</p>
          </div>
        )}
        {canManage && app.state !== 'pending_configuration' && (
          <div className="flex flex-wrap gap-2">
            {(!c || app.state === 'error') && (
              <Button size="sm" onClick={() => connect.mutate()} disabled={connect.isPending}>
                {c ? t('Reconnect {name}', { name: app.name }) : t('Connect {name}', { name: app.name })}
              </Button>
            )}
            {c && (
              <Button size="sm" variant="ghost" disabled={disconnect.isPending} onClick={() => window.confirm(t.maybe(copy.disconnect)) && disconnect.mutate()}>
                {t('Disconnect')}
              </Button>
            )}
          </div>
        )}
        {!canManage && <p className="text-xs text-muted-foreground">{t('Workspace admins connect {name}.', { name: app.name })}</p>}
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error.message}
          </p>
        )}
        {events.data && events.data.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium">{t('Recent activity')}</p>
            <ul className="space-y-1 text-xs" aria-label={t('Recent {name} activity', { name: app.name })}>
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
  const t = useT();
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
          {t.maybe(app.name)}
          <Badge tone={s.tone}>{t.maybe(s.label)}</Badge>
          {settings && <Badge tone={settings.mode === 'live' ? 'success' : 'neutral'}>{settings.mode === 'live' ? t('Live mode') : t('Test mode')}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {t.maybe(app.description)} {t('Customers pay on the hosted page of {provider}, so SampForce never handles card details. A proposal is marked paid only when the provider’s signed webhook confirms the amount.', { provider: settings ? PAYMENT_EVENTS[settings.provider].name : t('Stripe or Razorpay') })}
        </p>
        {app.warnings.map((w) => (
          <p key={w} className="text-xs text-warning">
            {t.maybe(w)}
          </p>
        ))}
        {c && settings && (
          <div className="space-y-1">
            <p>
              <strong>{c.accountName}</strong> · {PAYMENT_EVENTS[settings.provider].name}
            </p>
            <p className="text-xs text-muted-foreground">
              {c.connectedBy ? t('Keys checked {time} by {name}.', { time: relativeTime(c.connectedAt), name: c.connectedBy }) : t('Keys checked {time}.', { time: relativeTime(c.connectedAt) })}{' '}
              {settings.lastWebhookAt ? t('Last confirmation received {time}.', { time: relativeTime(settings.lastWebhookAt) }) : t('No confirmation received yet.')}
            </p>
            {c.lastError && <p className="text-xs text-critical">{c.lastError}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="payments-webhook-url">{t('Webhook URL')}</Label>
              <Input id="payments-webhook-url" readOnly value={settings.webhookUrl} onFocus={(e) => e.currentTarget.select()} />
              <p className="text-xs text-muted-foreground">{t('Send these events: {events}.', { events: PAYMENT_EVENTS[settings.provider].events })}</p>
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
              <Label htmlFor="payments-provider">{t('Provider')}</Label>
              <Select id="payments-provider" value={provider} onChange={(e) => setProvider(e.target.value as 'stripe' | 'razorpay')}>
                <option value="stripe">Stripe</option>
                <option value="razorpay">Razorpay</option>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              {t.maybe(copy.keyHelp)} {t.maybe(copy.hookHelp)} {!c && t('The webhook URL appears here after the keys are saved; it stays the same if you replace them.')} {t('Keys are checked with a read that charges nothing, then stored encrypted and never shown again. Use test keys first.')}
            </p>
            {provider === 'stripe' ? (
              <div className="space-y-1.5">
                <Label htmlFor="payments-secret-key">{t('Restricted or secret key')}</Label>
                <Input id="payments-secret-key" type="password" autoComplete="off" placeholder="rk_test_…" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} />
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="payments-key-id">{t('Key id')}</Label>
                  <Input id="payments-key-id" autoComplete="off" placeholder="rzp_test_…" value={keyId} onChange={(e) => setKeyId(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payments-key-secret">{t('Key secret')}</Label>
                  <Input id="payments-key-secret" type="password" autoComplete="off" value={keySecret} onChange={(e) => setKeySecret(e.target.value)} />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="payments-webhook-secret">{t('Webhook secret')}</Label>
              <Input id="payments-webhook-secret" type="password" autoComplete="off" placeholder={provider === 'stripe' ? 'whsec_…' : ''} value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={save.isPending || !ready}>
                {save.isPending ? t('Checking with {name}…', { name: copy.name }) : c ? t('Replace keys') : t('Check and save')}
              </Button>
              {c && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  {t('Cancel')}
                </Button>
              )}
            </div>
          </form>
        )}
        {canManage && c && !editing && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              {t('Replace keys')}
            </Button>
            <Button size="sm" variant="ghost" disabled={disconnect.isPending} onClick={() => window.confirm(t('Turn off card payments? Customers will no longer see “Pay by card”, and payments still in progress will not be recorded here. Payment history stays on each quote.')) && disconnect.mutate()}>
              {t('Disconnect')}
            </Button>
          </div>
        )}
        {!canManage && <p className="text-xs text-muted-foreground">{t('Workspace admins set up card payments.')}</p>}
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error.message}
          </p>
        )}
        {events.data && events.data.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium">{t('Recent activity')}</p>
            <ul className="space-y-1 text-xs" aria-label={t('Recent card payment activity')}>
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
  const t = useT();
  const qc = useQueryClient();
  const canManage = useCan('integrations:manage');
  const c = app.connection;
  const settings = c?.settings as unknown as WhatsappSettings | undefined;
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [editing, setEditing] = useState(false);
  const s = app.state === 'error' ? { label: t('Needs new credentials'), tone: 'critical' as const } : STATE[app.state];
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
          {t.maybe(app.name)}
          <Badge tone={s.tone}>{t.maybe(s.label)}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {t.maybe(app.description)} {t('Messages are one to one: a template needs the contact’s recorded consent, free-form replies are allowed for 24 hours after they write, and a STOP reply withdraws consent. There is no bulk sending.')}
        </p>
        {app.warnings.map((w) => (
          <p key={w} className="text-xs text-warning">
            {t.maybe(w)}
          </p>
        ))}
        {c && settings && (
          <div className="space-y-2">
            <p>
              <strong>{settings.verifiedName}</strong> · {settings.displayPhoneNumber}
              {settings.qualityRating && <span className="text-xs text-muted-foreground"> · {t('quality {rating}', { rating: inSentence(t, t.maybe(settings.qualityRating.charAt(0) + settings.qualityRating.slice(1).toLowerCase())) })}</span>}
            </p>
            <p className="text-xs text-muted-foreground">
              {checkedLine(t, c)} {settings.lastWebhookAt ? t('Webhook confirmed {time}.', { time: relativeTime(settings.lastWebhookAt) }) : t('No webhook received yet.')}
            </p>
            {c.lastError && <p className="text-xs text-critical">{c.lastError}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wa-callback-url">{t('Callback URL')}</Label>
                <Input id="wa-callback-url" readOnly value={settings.webhookUrl} onFocus={(e) => e.currentTarget.select()} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wa-verify-token">{t('Verify token')}</Label>
                <Input id="wa-verify-token" readOnly value={settings.verifyToken} onFocus={(e) => e.currentTarget.select()} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{rich(t('In your Meta app, open WhatsApp, Configuration, enter both, and subscribe to the {field} field.'), { field: <code>messages</code> })}</p>
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
              {rich(t('From WhatsApp Manager and your Meta app: the phone number id, the WhatsApp Business Account id, a System User access token with {messaging} and {management}, and the App Secret (used to check webhook signatures). SampForce reads the number to check them, sends nothing, then stores the token and secret encrypted.'), { messaging: <code>whatsapp_business_messaging</code>, management: <code>whatsapp_business_management</code> })}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wa-phone-id">{t('Phone number id')}</Label>
                <Input id="wa-phone-id" inputMode="numeric" autoComplete="off" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wa-waba-id">{t('WhatsApp Business Account id')}</Label>
                <Input id="wa-waba-id" inputMode="numeric" autoComplete="off" value={wabaId} onChange={(e) => setWabaId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wa-token">{t('Access token')}</Label>
                <Input id="wa-token" type="password" autoComplete="off" placeholder="EA…" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wa-app-secret">{t('App Secret')}</Label>
                <Input id="wa-app-secret" type="password" autoComplete="off" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={save.isPending || !ready}>
                {save.isPending ? t('Checking with WhatsApp…') : c ? t('Replace credentials') : t('Check and save')}
              </Button>
              {c && editing && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  {t('Cancel')}
                </Button>
              )}
            </div>
          </form>
        )}
        {canManage && c && !showForm && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              {t('Replace credentials')}
            </Button>
            <Button size="sm" variant="ghost" disabled={disconnect.isPending} onClick={() => window.confirm(t('Disconnect WhatsApp? Sending stops and replies will no longer arrive here. Message history and consent records stay on each contact.')) && disconnect.mutate()}>
              {t('Disconnect')}
            </Button>
          </div>
        )}
        {!canManage && <p className="text-xs text-muted-foreground">{t('Workspace admins connect WhatsApp Business.')}</p>}
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error.message}
          </p>
        )}
        {events.data && events.data.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium">{t('Recent activity')}</p>
            <ul className="space-y-1 text-xs" aria-label={t('Recent WhatsApp activity')}>
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
  const t = useT();
  const qc = useQueryClient();
  const canManage = useCan('integrations:manage');
  const c = app.connection;
  const settings = c?.settings as unknown as TwilioSettings | undefined;
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [fromNumber, setFromNumber] = useState('');
  const [editing, setEditing] = useState(false);
  const s = app.state === 'error' ? { label: t('Needs new credentials'), tone: 'critical' as const } : STATE[app.state];
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
          {t.maybe(app.name)}
          <Badge tone={s.tone}>{t.maybe(s.label)}</Badge>
          {settings?.trial && <Badge tone="warning">{t('Trial account')}</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {t.maybe(app.description)} {t('Each text goes to one contact who has recorded SMS consent, after the sender confirms it or a person approves the workflow step. A STOP reply withdraws consent. There is no bulk sending.')}
        </p>
        {app.warnings.map((w) => (
          <p key={w} className="text-xs text-warning">
            {t.maybe(w)}
          </p>
        ))}
        {c && settings && (
          <div className="space-y-2">
            <p>
              <strong>{settings.friendlyName}</strong> · {settings.fromNumber}
            </p>
            <p className="text-xs text-muted-foreground">
              {checkedLine(t, c)} {settings.lastWebhookAt ? t('Twilio’s signed requests confirmed {time}.', { time: relativeTime(settings.lastWebhookAt) }) : t('Nothing received from Twilio yet.')}
            </p>
            {settings.trial && <p className="text-xs text-warning">{t('Trial accounts text only numbers verified in the Twilio console, and Twilio adds a trial notice to each text. Upgrade the Twilio account before texting customers.')}</p>}
            {c.lastError && <p className="text-xs text-critical">{c.lastError}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="tw-inbound-url">{t('Inbound message URL')}</Label>
              <Input id="tw-inbound-url" readOnly value={settings.inboundUrl} onFocus={(e) => e.currentTarget.select()} />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('In the Twilio console, open Phone Numbers, {number}, Messaging configuration, and set “A message comes in” to this URL with HTTP POST. Delivery status needs no setup: each text tells Twilio where to report it.', { number: settings.fromNumber })}
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
              {t('From the Twilio console: the Account SID and Auth Token, and a Twilio number on that account that can send SMS. SampForce reads the account and the number to check them, sends nothing, then stores the token encrypted. The Auth Token also checks the signature on every request Twilio sends.')}
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="tw-sid">{t('Account SID')}</Label>
                <Input id="tw-sid" autoComplete="off" placeholder="AC…" value={accountSid} onChange={(e) => setAccountSid(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tw-token">{t('Auth Token')}</Label>
                <Input id="tw-token" type="password" autoComplete="off" value={authToken} onChange={(e) => setAuthToken(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tw-number">{t('Twilio number')}</Label>
                <Input id="tw-number" inputMode="tel" autoComplete="off" placeholder="+447700900123" value={fromNumber} onChange={(e) => setFromNumber(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={save.isPending || !ready}>
                {save.isPending ? t('Checking with Twilio…') : c ? t('Replace credentials') : t('Check and save')}
              </Button>
              {c && editing && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  {t('Cancel')}
                </Button>
              )}
            </div>
          </form>
        )}
        {canManage && c && !showForm && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              {t('Replace credentials')}
            </Button>
            <Button size="sm" variant="ghost" disabled={disconnect.isPending} onClick={() => window.confirm(t('Disconnect SMS? Sending stops and replies will no longer arrive here. Text history and consent records stay on each contact.')) && disconnect.mutate()}>
              {t('Disconnect')}
            </Button>
          </div>
        )}
        {!canManage && <p className="text-xs text-muted-foreground">{t('Workspace admins connect SMS.')}</p>}
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error.message}
          </p>
        )}
        {events.data && events.data.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium">{t('Recent activity')}</p>
            <ul className="space-y-1 text-xs" aria-label={t('Recent SMS activity')}>
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
 * SampBidx (ADR 0061): the address of SampBidx's API and its key, checked before saving, plus the callback URL and
 * signing secret SampBidx uses to report progress. The developer guide for SampBidx's side is linked.
 */
function SampbidxCard({ app }: { app: AppStatus }) {
  const t = useT();
  const qc = useQueryClient();
  const canManage = useCan('integrations:manage');
  const c = app.connection;
  const settings = c?.settings as unknown as SampbidxSettings | undefined;
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [editing, setEditing] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const s = app.state === 'error' ? { label: t('Needs a new API key'), tone: 'critical' as const } : STATE[app.state];
  const events = useQuery({ enabled: !!c && canManage, queryKey: ['apps', 'sampbidx', 'events'], queryFn: () => api<AppEventRow[]>('/apps/sampbidx/events') });
  const secret = useQuery({ enabled: !!c && canManage && showSecret, queryKey: ['apps', 'sampbidx', 'secret'], queryFn: () => api<{ callbackUrl: string; secret: string }>('/apps/sampbidx/callback-secret') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['apps'] });
  const save = useMutation({
    mutationFn: () => api<AppStatus>('/apps/sampbidx/keys', { method: 'POST', json: { baseUrl, apiKey } }),
    onSuccess: () => {
      setApiKey('');
      setEditing(false);
      return refresh();
    },
  });
  const rotate = useMutation({
    mutationFn: () => api<{ callbackUrl: string; secret: string }>('/apps/sampbidx/callback-secret/rotate', { method: 'POST', json: {} }),
    onSuccess: (d) => {
      qc.setQueryData(['apps', 'sampbidx', 'secret'], d);
      setShowSecret(true);
    },
  });
  const disconnect = useMutation({ mutationFn: () => api('/apps/sampbidx', { method: 'DELETE' }), onSuccess: refresh });
  const error = save.error ?? disconnect.error ?? rotate.error;
  const showForm = canManage && (!c || editing || app.state === 'error');
  useEffect(() => {
    if (showForm && settings?.baseUrl && !baseUrl) setBaseUrl(settings.baseUrl);
  }, [showForm, settings?.baseUrl, baseUrl]);

  return (
    <Card role="region" aria-labelledby="app-sampbidx-name" id="app-sampbidx" className="scroll-mt-20">
      <CardHeader className="pb-2">
        <CardTitle id="app-sampbidx-title" className="flex flex-wrap items-center gap-2 text-sm">
          <span id="app-sampbidx-name">{t.maybe(app.name)}</span>
          <Badge tone={s.tone}>{t.maybe(s.label)}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {t.maybe(app.description)} {t('There are two ways to send: fill in the RFQ and attach its files, then press Send to SampBidx on the RFQ; or transfer the RFQ email itself from the RFQs page.')}
        </p>
        {app.warnings.map((w) => (
          <p key={w} className="text-xs text-warning">
            {t.maybe(w)}
          </p>
        ))}
        {c && settings && (
          <div className="space-y-2">
            <p>
              <strong>{settings.accountName}</strong> · <span className="break-all">{settings.baseUrl}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {checkedLine(t, c)} {settings.lastCallbackAt ? t('SampBidx’s signed status updates confirmed {time}.', { time: relativeTime(settings.lastCallbackAt) }) : t('No status update from SampBidx yet.')}
            </p>
            {c.lastError && <p className="text-xs text-critical">{c.lastError}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="sbx-callback-url">{t('Status callback URL')}</Label>
              <Input id="sbx-callback-url" readOnly value={settings.callbackUrl} onFocus={(e) => e.currentTarget.select()} />
            </div>
            {canManage && (
              <div className="space-y-1.5">
                <Label htmlFor="sbx-secret">{t('Callback signing secret')}</Label>
                {showSecret && secret.data ? (
                  <Input id="sbx-secret" readOnly value={secret.data.secret} onFocus={(e) => e.currentTarget.select()} />
                ) : (
                  <div>
                    <Button size="sm" variant="outline" onClick={() => setShowSecret(true)}>
                      {t('Show the signing secret')}
                    </Button>
                  </div>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t('Give SampBidx this URL and secret. SampBidx posts each status change (received, in review, bidding, quoted, won, lost) to the URL, signed with the secret; anything unsigned is refused.')}
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
              {t('From SampBidx: the address of its API and an API key for SampForce. SampForce calls SampBidx once to check them and sends nothing else, then stores the key encrypted.')}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="sbx-base">{t('SampBidx API address')}</Label>
                <Input id="sbx-base" type="url" autoComplete="off" placeholder="https://sampbidx.example.com/api" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sbx-key">{t('API key')}</Label>
                <Input id="sbx-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={save.isPending || !baseUrl.trim() || !apiKey.trim()}>
                {save.isPending ? t('Checking with SampBidx…') : c ? t('Replace the key') : t('Check and save')}
              </Button>
              {c && editing && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  {t('Cancel')}
                </Button>
              )}
            </div>
          </form>
        )}
        {canManage && c && !showForm && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              {t('Change address or key')}
            </Button>
            <Button size="sm" variant="outline" disabled={rotate.isPending} onClick={() => window.confirm(t('Make a new signing secret? Status updates signed with the old one are refused from now on, so give SampBidx the new one straight away.')) && rotate.mutate()}>
              {t('New signing secret')}
            </Button>
            <Button size="sm" variant="ghost" disabled={disconnect.isPending} onClick={() => window.confirm(t('Disconnect SampBidx? Sending stops. What was already sent stays listed on each RFQ.')) && disconnect.mutate()}>
              {t('Disconnect')}
            </Button>
          </div>
        )}
        {!canManage && <p className="text-xs text-muted-foreground">{t('Workspace admins connect SampBidx.')}</p>}
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error.message}
          </p>
        )}
        {events.data && events.data.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium">{t('Recent activity')}</p>
            <ul className="space-y-1 text-xs" aria-label={t('Recent SampBidx activity')}>
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

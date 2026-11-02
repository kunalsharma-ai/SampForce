'use client';

import type { ScimTokenView, SecuritySettings, SsoConnectionInput } from '@dealflow/types';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@dealflow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Select } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api, ApiError } from '@/lib/api';
import { useRoles } from '@/lib/billing';
import { useSecuritySettings } from '@/lib/security';
import { useCan } from '@/lib/session';
import { fmtLocale } from '@/lib/i18n/locale';
import { rich, useT } from '@/lib/i18n';

function Copyable({ label, value }: { label: string; value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded border border-border bg-muted/40 px-2 py-1 text-xs">{value}</code>
        <Button size="sm" variant="outline" type="button" aria-label={t('Copy {name}', { name: label })} onClick={() => void navigator.clipboard?.writeText(value).then(() => setCopied(true))}>
          {copied ? t('Copied') : t('Copy')}
        </Button>
      </div>
    </div>
  );
}

function Toggle({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label htmlFor={id} className="flex items-start gap-3 text-sm">
      <input id={id} type="checkbox" className="mt-0.5 size-4 accent-[hsl(var(--primary))]" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

export function WorkspaceSecurity() {
  const t = useT();
  const canManage = useCan('tenant:manage');
  const settings = useSecuritySettings(canManage);
  if (!canManage) return <p className="text-sm text-muted-foreground">{t('Only workspace owners and admins can change security settings.')}</p>;
  if (settings.isPending) return <p className="text-sm text-muted-foreground">{t('Loading…')}</p>;
  if (!settings.data) return <ErrorText error={settings.error} />;
  return (
    <div className="space-y-6">
      <MfaPolicy s={settings.data} />
      <SingleSignOn s={settings.data} />
      <Scim s={settings.data} />
    </div>
  );
}

function MfaPolicy({ s }: { s: SecuritySettings }) {
  const t = useT();
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (requireMfa: boolean) => api('/security/mfa-policy', { method: 'PUT', json: { requireMfa } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['security-settings'] }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t('Two-step verification')} {s.requireMfa ? <Badge tone="success">{t('Required')}</Badge> : <Badge>{t('Optional')}</Badge>}
        </CardTitle>
        <CardDescription>
          {t('When required, people who have not turned it on can only reach the setup page until they do. People who sign in with single sign-on are verified by your identity provider instead.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          {s.membersWithoutMfa === 0 ? t('Every active member has it on.') : t.plural('count.membersWithoutMfa', s.membersWithoutMfa)}{' '}
          <Link href="/app/team" className="text-primary underline underline-offset-2">
            {t('See members')}
          </Link>
        </p>
        {!s.callerHasMfa && !s.requireMfa && (
          <p className="text-muted-foreground">
            {rich(t('Turn it on for your own account first, on {link}.'), {
              link: (
                <Link href="/app/account/security" className="text-primary underline underline-offset-2">
                  {t('Account security')}
                </Link>
              ),
            })}
          </p>
        )}
        <Button variant={s.requireMfa ? 'outline' : 'default'} disabled={save.isPending || (!s.requireMfa && !s.callerHasMfa)} onClick={() => save.mutate(!s.requireMfa)}>
          {s.requireMfa ? t('Make it optional') : t('Require for everyone')}
        </Button>
        <ErrorText error={save.error} />
      </CardContent>
    </Card>
  );
}

const EMPTY: SsoConnectionInput = { loginSlug: '', issuer: '', clientId: '', clientSecret: '', allowedDomains: [], jitProvisioning: false, defaultRoleId: null, enabled: false, enforced: false };

function SingleSignOn({ s }: { s: SecuritySettings }) {
  const t = useT();
  const qc = useQueryClient();
  const roles = useRoles();
  const [form, setForm] = useState<SsoConnectionInput>(EMPTY);
  const [domains, setDomains] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (s.sso) {
      setForm({ ...s.sso, clientSecret: '' });
      setDomains(s.sso.allowedDomains.join(', '));
    }
  }, [s.sso]);
  const set = <K extends keyof SsoConnectionInput>(k: K, v: SsoConnectionInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = useMutation({
    mutationFn: () =>
      api('/security/sso', {
        method: 'PUT',
        json: { ...form, clientSecret: form.clientSecret || undefined, allowedDomains: domains.split(/[\s,]+/).map((d) => d.trim()).filter(Boolean) },
      }),
    onMutate: () => setFieldErrors({}),
    onError: (e) => {
      if (e instanceof ApiError && e.details) setFieldErrors(Object.fromEntries(e.details.map((d) => [d.path, d.message])));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['security-settings'] }),
  });
  const remove = useMutation({ mutationFn: () => api('/security/sso', { method: 'DELETE' }), onSuccess: () => { setForm(EMPTY); setDomains(''); void qc.invalidateQueries({ queryKey: ['security-settings'] }); } });
  const assignable = (roles.data ?? []).filter((r) => r.key !== 'owner');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {t('Single sign-on (OpenID Connect)')}
          {s.sso?.enabled ? <Badge tone="success">{t('On')}</Badge> : <Badge>{t('Off')}</Badge>}
          {s.sso?.enforced && <Badge tone="accent">{t('Required')}</Badge>}
        </CardTitle>
        <CardDescription>
          {t('Create an OpenID Connect web application in your identity provider with the redirect URI below, then enter its details. People sign in from “Sign in with SSO” using the sign-in name.')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Copyable label={t('Redirect URI (give this to your identity provider)')} value={s.redirectUri} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="sso-slug" label={t('Sign-in name')} hint={t('What people type on the sign-in page.')} error={fieldErrors.loginSlug}>
              <Input id="sso-slug" value={form.loginSlug} onChange={(e) => set('loginSlug', e.target.value)} placeholder="acme" autoCapitalize="none" spellCheck={false} />
            </Field>
            <Field id="sso-issuer" label={t('Issuer URL')} hint={t('Exactly as your provider shows it.')} error={fieldErrors.issuer}>
              <Input id="sso-issuer" value={form.issuer} onChange={(e) => set('issuer', e.target.value)} placeholder="https://acme.okta.com" spellCheck={false} />
            </Field>
            <Field id="sso-client" label={t('Client ID')} error={fieldErrors.clientId}>
              <Input id="sso-client" value={form.clientId} onChange={(e) => set('clientId', e.target.value)} spellCheck={false} />
            </Field>
            <Field id="sso-secret" label={t('Client secret')} hint={s.sso?.hasClientSecret ? t('Stored encrypted. Leave empty to keep it.') : undefined} error={fieldErrors.clientSecret}>
              <Input id="sso-secret" type="password" autoComplete="off" value={form.clientSecret ?? ''} onChange={(e) => set('clientSecret', e.target.value)} />
            </Field>
            <Field id="sso-domains" label={t('Allowed email domains')} hint={t('Comma-separated. Empty allows any address your provider signs in.')} className="sm:col-span-2">
              <Input id="sso-domains" value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="acme.com, acme.co.uk" spellCheck={false} />
            </Field>
          </div>
          <div className="space-y-3 rounded-md border border-border p-4">
            <Toggle id="sso-jit" label={t('Add people on first sign-in')} hint={t('Without this, only invited people (or people added through SCIM) can sign in.')} checked={form.jitProvisioning} onChange={(v) => set('jitProvisioning', v)} />
            {form.jitProvisioning && (
              <Field id="sso-role" label={t('Role for new people')} error={fieldErrors.defaultRoleId} className="max-w-xs">
                <Select id="sso-role" value={form.defaultRoleId ?? ''} onChange={(e) => set('defaultRoleId', e.target.value || null)}>
                  <option value="">{t('Choose a role')}</option>
                  {assignable.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Toggle id="sso-enabled" label={t('Turn on single sign-on')} hint={t('DealFlow checks your provider’s discovery document when you save.')} checked={form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v, enforced: v && f.enforced }))} />
            <Toggle
              id="sso-enforced"
              label={t('Require single sign-on')}
              hint={s.sso?.lastVerifiedAt ? t('Members can no longer use a password for this workspace. Owners keep password sign-in as a way back in.') : t('Available after someone signs in with single sign-on once.')}
              checked={form.enforced}
              disabled={!form.enabled || !s.sso?.lastVerifiedAt}
              onChange={(v) => set('enforced', v)}
            />
          </div>
          {s.sso?.lastVerifiedAt && <p className="text-xs text-muted-foreground">{t('Last successful sign-in through your provider: {date}', { date: new Date(s.sso.lastVerifiedAt).toLocaleString(fmtLocale()) })}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t('Checking provider…') : t('Save')}
            </Button>
            {s.sso && (
              <Button type="button" variant="outline" disabled={remove.isPending} onClick={() => window.confirm(t('Remove single sign-on? People who only sign in through it will lose access until they are given a password.')) && remove.mutate()}>
                {t('Remove')}
              </Button>
            )}
            {save.isSuccess && <span role="status" className="self-center text-sm text-success">{t('Saved.')}</span>}
          </div>
          <ErrorText error={save.error ?? remove.error} />
        </form>
      </CardContent>
    </Card>
  );
}

function Scim({ s }: { s: SecuritySettings }) {
  const t = useT();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<(ScimTokenView & { token: string }) | null>(null);
  const done = () => qc.invalidateQueries({ queryKey: ['security-settings'] });
  const create = useMutation({ mutationFn: () => api<ScimTokenView & { token: string }>('/security/scim-tokens', { method: 'POST', json: { name } }), onSuccess: (item) => { setCreated(item); setName(''); void done(); } });
  const revoke = useMutation({ mutationFn: (id: string) => api(`/security/scim-tokens/${id}`, { method: 'DELETE' }), onSuccess: done });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('SCIM provisioning')}</CardTitle>
        <CardDescription>
          {t('Let your identity provider add, update and remove people automatically (SCIM 2.0, users only). Removing someone there suspends or removes them here. Owners are never changed through SCIM.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Copyable label={t('SCIM base URL')} value={s.scimBaseUrl} />
        {created && (
          <div role="status" className="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <p>
              <strong>{t('Copy this token now.')}</strong> {t('It will not be shown again.')}
            </p>
            <Copyable label={t('Token “{name}”', { name: created.name })} value={created.token} />
            <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
              {t('Done')}
            </Button>
          </div>
        )}
        {s.scimTokens.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border text-sm">
            {s.scimTokens.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{item.name}</span> <code className="text-xs text-muted-foreground">{item.prefix}…</code>
                  <span className="block text-xs text-muted-foreground">
                    {t('Created {date}', { date: new Date(item.createdAt).toLocaleDateString(fmtLocale()) })} · {item.lastUsedAt ? t('last used {date}', { date: new Date(item.lastUsedAt).toLocaleString(fmtLocale()) }) : t('not used yet')}
                  </span>
                </span>
                <Button size="sm" variant="outline" onClick={() => window.confirm(t('Revoke “{name}”? Provisioning with it stops at once.', { name: item.name })) && revoke.mutate(item.id)} aria-label={t('Revoke {name}', { name: item.name })}>
                  {t('Revoke')}
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field id="scim-name" label={t('New token name')} className="min-w-56 flex-1">
            <Input id="scim-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('Okta provisioning')} maxLength={80} />
          </Field>
          <Button type="submit" disabled={create.isPending || !name.trim()}>
            {t('Create token')}
          </Button>
        </form>
        <ErrorText error={create.error ?? revoke.error} />
      </CardContent>
    </Card>
  );
}

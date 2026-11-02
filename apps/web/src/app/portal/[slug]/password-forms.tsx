'use client';

import { Button, Card, CardContent, Input } from '@dealflow/ui';
import { portalForgotSchema, portalLoginSchema } from '@dealflow/types';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { portalPath, usePortalBranding } from '@/lib/portal';
import { PortalFrame } from './portal-frame';
import { useT } from '@/lib/i18n';

export function LoginForm({ slug }: { slug: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'login' | 'forgot' | 'sent'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = mode === 'login' ? portalLoginSchema.safeParse({ email, password }) : portalForgotSchema.safeParse({ email });
    if (!parsed.success) return setError(t.maybe(parsed.error.issues[0]!.message));
    setPending(true);
    try {
      if (mode === 'login') {
        await api(portalPath(`/portals/${slug}/login`), { method: 'POST', json: parsed.data });
        await qc.invalidateQueries({ queryKey: ['client-portal'] });
      } else {
        await api(portalPath(`/portals/${slug}/password/forgot`), { method: 'POST', json: parsed.data });
        setMode('sent');
      }
    } catch (err) {
      setError(t.maybe((err as Error).message));
    } finally {
      setPending(false);
    }
  }

  if (mode === 'sent')
    return (
      <div className="space-y-3 text-sm">
        <p role="status">{t('If {email} has portal access, a reset link is on its way. It works for 60 minutes.', { email })}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => setMode('login')}>
          {t('Back to sign in')}
        </Button>
      </div>
    );
  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <h1 className="text-xl font-semibold">{mode === 'login' ? t('Sign in') : t('Reset your password')}</h1>
      <Field id="portal-email" label={t('Email')}>
        <Input id="portal-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      {mode === 'login' && (
        <Field id="portal-password" label={t('Password')}>
          <Input id="portal-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
      )}
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {mode === 'login' ? t('Sign in') : t('Send reset link')}
        </Button>
        <Button type="button" variant="link" size="sm" onClick={() => { setError(null); setMode(mode === 'login' ? 'forgot' : 'login'); }}>
          {mode === 'login' ? t('Forgot your password?') : t('Back to sign in')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('Access is by invitation from your account manager.')}</p>
    </form>
  );
}

/** Choosing a password, from an invitation or a reset link. */
export function PasswordPage({ slug, token, mode }: { slug: string; token: string; mode: 'accept' | 'reset' }) {
  const t = useT();
  const branding = usePortalBranding(slug);
  const router = useRouter();
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) return setError(t('Use at least 10 characters'));
    if (password !== confirm) return setError(t('The two passwords do not match'));
    setPending(true);
    try {
      if (mode === 'accept') {
        await api(portalPath('/invitations/accept'), { method: 'POST', json: { token, password } });
        await qc.invalidateQueries({ queryKey: ['client-portal'] });
        router.push(`/portal/${slug}`);
      } else {
        await api(portalPath('/password/reset'), { method: 'POST', json: { token, password } });
        setDone(true);
      }
    } catch (err) {
      setError(t.maybe((err as Error).message));
    } finally {
      setPending(false);
    }
  }

  return (
    <PortalFrame branding={branding.data ?? null} missing={branding.isError}>
      <Card>
        <CardContent className="p-6">
          {!token ? (
            <p className="text-sm">{t('This link is missing its code. Open the link from your email again.')}</p>
          ) : done ? (
            <div className="space-y-3 text-sm">
              <p role="status">{t('Your password is changed. Any other signed-in devices were signed out.')}</p>
              <Button asChild size="sm">
                <Link href={`/portal/${slug}`}>{t('Sign in')}</Link>
              </Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={submit} noValidate>
              <h1 className="text-xl font-semibold">{mode === 'accept' ? t('Choose a password to open your portal') : t('Choose a new password')}</h1>
              <Field id="pw-new" label={t('Password')} hint={t('At least 10 characters.')}>
                <Input id="pw-new" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </Field>
              <Field id="pw-confirm" label={t('Confirm password')}>
                <Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </Field>
              {error && (
                <p role="alert" className="text-sm text-critical">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={pending}>
                {mode === 'accept' ? t('Open portal') : t('Save password')}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </PortalFrame>
  );
}

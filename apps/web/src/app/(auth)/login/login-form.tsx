'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Field, Input } from '@dealflow/ui';
import { type LoginInput, type LoginResponse, loginSchema } from '@dealflow/types';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FloatingField } from '@/components/forms/floating-field';
import { SignInResult, useSignInResult } from '@/components/sign-in/sign-in-result';
import { markWelcome } from '@/components/sign-in/welcome-overlay';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';

/** Only same-app relative paths are accepted as post-login redirects. */
function safeNext(next: string | null): string {
  return next && next.startsWith('/app') && !next.startsWith('//') ? next : '/app';
}

export function LoginForm() {
  const router = useRouter();
  const t = useT();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<string | null>(null);
  // Checked as soon as a field is left, and again on every change after that.
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), mode: 'onTouched', defaultValues: { email: '', password: '' } });
  const result = useSignInResult();

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api<LoginResponse>('/auth/login', { method: 'POST', json: values });
      if (res.mfaRequired && res.challenge) return setChallenge(res.challenge);
      markWelcome();
      await result.success();
      router.replace(safeNext(params.get('next')));
    } catch (err) {
      result.error();
      setError(err instanceof ApiError ? err.message : t('Could not reach SampForce. Check your connection.'));
    }
  });

  if (challenge) {
    return (
      <SecondFactor
        challenge={challenge}
        onDone={() => {
          markWelcome();
          router.replace(safeNext(params.get('next')));
        }}
        onRestart={() => {
          setChallenge(null);
          form.setValue('password', '');
        }}
      />
    );
  }

  return (
    <div className="space-y-6" {...result.attrs} onInput={result.reset}>
      <SignInResult state={result.state === 'success' ? 'success' : 'idle'} round={result.round} />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('Sign in')}</h1>
        <p className="text-sm text-muted-foreground">{t('Welcome back to your revenue workspace.')}</p>
      </div>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FloatingField id="email" label={t('Work email')} error={form.formState.errors.email?.message}>
          <Input type="email" autoComplete="email" {...form.register('email')} />
        </FloatingField>
        <FloatingField id="password" reveal label={t('Password')} error={form.formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...form.register('password')} />
        </FloatingField>
        <p className="-mt-2 text-end text-sm">
          <Link href="/forgot-password" className="text-primary hover:underline">
            {t('Forgot your password?')}
          </Link>
        </p>
        {params.get('closed') && !error && (
          <p role="status" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm" data-company-closed>
            {t('Your company was closed and everyone was signed out. SampForce support can reopen it until {date}.', { date: params.get('closed')! })}
          </p>
        )}
        {error && (
          <>
            {result.state === 'error' && <SignInResult state="error" round={result.round} />}
            <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
              {error}
            </p>
          </>
        )}
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting || result.state === 'success'}>
          {form.formState.isSubmitting ? t('Signing in…') : t('Sign in')}
        </Button>
      </form>
      <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        {t('or')}
        <span className="h-px flex-1 bg-border" />
      </div>
      <Link href="/login/sso" className="flex h-10 w-full items-center justify-center rounded-md border border-border text-sm font-medium hover:bg-muted">
        {t('Sign in with SSO')}
      </Link>
      <p className="text-center text-sm text-muted-foreground">
        {t('New to SampForce?')}{' '}
        <Link href="/signup" className="font-medium text-primary hover:underline">
          {t('Start free')}
        </Link>
      </p>
    </div>
  );
}

/** Second step for accounts with two-step verification: an authenticator code, or a recovery code. */
function SecondFactor({ challenge, onDone, onRestart }: { challenge: string; onDone: () => void; onRestart: () => void }) {
  const t = useT();
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api('/auth/mfa/verify', { method: 'POST', json: { challenge, code } });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'MFA_CHALLENGE_EXPIRED') return onRestart();
      setError(err instanceof ApiError ? err.message : t('Could not reach SampForce. Check your connection.'));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t('Two-step verification')}</h1>
        <p className="text-sm text-muted-foreground">
          {useRecovery ? t('Enter one of the recovery codes you saved when you turned on two-step verification. Each code works once.') : t('Enter the 6-digit code from your authenticator app.')}
        </p>
      </div>
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field id="mfa-code" label={useRecovery ? t('Recovery code') : t('Authentication code')}>
          <Input
            key={useRecovery ? 'recovery' : 'totp'}
            autoFocus
            autoComplete="one-time-code"
            inputMode={useRecovery ? 'text' : 'numeric'}
            maxLength={useRecovery ? 16 : 6}
            pattern={useRecovery ? undefined : '[0-9]*'}
            placeholder={useRecovery ? 'xxxxx-xxxxx' : '123456'}
            value={code}
            onChange={(e) => setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        {error && (
          <p role="alert" className="rounded-md border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy || code.length < 6}>
          {busy ? t('Checking…') : t('Verify')}
        </Button>
      </form>
      <div className="flex justify-between text-sm">
        <button type="button" className="font-medium text-primary hover:underline" onClick={() => { setUseRecovery((v) => !v); setCode(''); setError(null); }}>
          {useRecovery ? t('Use your authenticator app') : t('Use a recovery code')}
        </button>
        <button type="button" className="text-muted-foreground hover:underline" onClick={onRestart}>
          {t('Back')}
        </button>
      </div>
    </div>
  );
}

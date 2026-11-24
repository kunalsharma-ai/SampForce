'use client';

import { Button, Input } from '@dealflow/ui';
import type { OperatorLoginResult } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogoOnRed } from '@/components/logo';
import {
  RevealText,
  SCENE_COPY,
  SceneBackground,
  SceneGreeting,
  SceneStage,
  WorkspaceBadge,
} from '@/components/sign-in/sign-in-scene';
import { SignInStylePicker, useSignInStyle } from '@/components/sign-in/sign-in-style';
import { SignInResult, useSignInResult } from '@/components/sign-in/sign-in-result';
import { markWelcome } from '@/components/sign-in/welcome-overlay';
import { PasswordInput } from '@/components/forms/password-input';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';

const POINTS = [
  {
    icon: ShieldCheck,
    title: 'Two-step verification',
    text: 'An authenticator code after your password, with one-time recovery codes.',
  },
  {
    icon: KeyRound,
    title: 'Roles and permissions',
    text: 'Each operator sees and changes only what their role allows.',
  },
  {
    icon: Activity,
    title: 'Every action recorded',
    text: 'Sign-ins, views and changes go to an audit log nobody can edit.',
  },
];

/**
 * The Console sign-in (ADR 0074): password, then an authenticator or recovery code when two-step verification is on.
 * "Keep me signed in" lasts seven days; a session still ends after the idle time the security policy sets.
 */
export default function OperatorLogin() {
  const router = useRouter();
  const style = useSignInStyle();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const result = useSignInResult();

  const done = async (r: OperatorLoginResult) => {
    if (r.mfaRequired && r.challenge) {
      setChallenge(r.challenge);
      return;
    }
    markWelcome();
    await result.success();
    await qc.invalidateQueries({ queryKey: ['operator'] });
    router.replace(r.mfaSetupRequired ? '/operator/account?setup=1' : '/operator');
  };
  const login = useMutation({
    mutationFn: () =>
      api<OperatorLoginResult>('/operator/login', {
        method: 'POST',
        json: { email, password, remember },
      }),
    onSuccess: done,
    onError: result.error,
  });
  const verify = useMutation({
    mutationFn: () =>
      api<OperatorLoginResult>('/operator/login/mfa', {
        method: 'POST',
        json: { challenge, code, remember },
      }),
    onSuccess: done,
    onError: () => {
      setCode('');
      result.error();
    },
  });

  return (
    <main
      className="sfs-root relative min-h-screen overflow-hidden"
      data-sign-in-scene="console"
      {...style.attrs}
    >
      <SceneBackground variant="console" />
      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.15fr_1fr]">
        <section
          aria-label="SampForce Console"
          className="flex flex-col gap-5 p-6 sm:p-10 lg:gap-6 lg:p-12"
        >
          <div className="flex items-center justify-between gap-3">
            <LogoOnRed />
            <SignInStylePicker style={style} translate={false} />
          </div>
          <div className="sfs-hero-text flex flex-col gap-3 lg:max-w-2xl">
            <SceneGreeting variant="console" translate={false} />
            <h2 className="text-[color:var(--sfs-ink)] text-3xl font-extrabold leading-[1.12] tracking-tight sm:text-4xl lg:text-[3.4rem]">
              <RevealText text={SCENE_COPY.console.headline} />
            </h2>
            <p className="sfs-sub max-w-lg text-base text-[color:var(--sfs-ink-soft)] lg:text-lg">
              {SCENE_COPY.console.sub}
            </p>
            <ul className="sfs-sub mt-1 hidden flex-wrap gap-2 lg:flex">
              {POINTS.map((p) => (
                <li
                  key={p.title}
                  title={p.text}
                  className="inline-flex items-center gap-2 rounded-full bg-[color:var(--sfs-chip)] px-3 py-1.5 text-sm font-medium text-[color:var(--sfs-ink)] ring-1 ring-[color:var(--sfs-chip-ring)]"
                >
                  <p.icon className="size-4 text-[color:var(--sfs-gold)]" aria-hidden />
                  {p.title}
                </li>
              ))}
            </ul>
          </div>
          <div className="sfs-stage relative min-h-[150px] flex-1 sm:min-h-[220px] lg:min-h-[240px]">
            <SceneStage variant="console" className="absolute inset-0 h-full w-full" />
          </div>
          <p className="hidden text-xs text-[color:var(--sfs-ink-mute)] lg:block">
            Platform staff only. Workspace accounts sign in at the main SampForce sign-in page.
          </p>
        </section>

        <section className="flex items-start justify-center px-4 pb-10 sm:px-6 lg:items-center lg:p-10">
          <div className="sfs-card-frame w-full max-w-md" data-card-variant="console">
            <div
              className="sfs-card bg-background p-6 text-foreground sm:p-8"
              {...result.attrs}
              onInput={result.reset}
            >
              <SignInResult
                state={result.state === 'success' ? 'success' : 'idle'}
                round={result.round}
                translate={false}
                opening="Opening the Console…"
              />
              <div className="mb-6">
                <WorkspaceBadge variant="console" translate={false} />
              </div>
              {challenge ? (
                <>
                  <h1 className="text-2xl font-semibold tracking-tight">Two-step verification</h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Enter the 6-digit code from your authenticator app, or one of your recovery
                    codes.
                  </p>
                  <form
                    className="mt-8 space-y-5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      verify.mutate();
                    }}
                  >
                    <Field id="op-code" label="Authentication code">
                      <Input
                        id="op-code"
                        autoComplete="one-time-code"
                        inputMode="text"
                        autoFocus
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        required
                        className="h-11 text-center font-mono text-lg tracking-[0.3em]"
                      />
                    </Field>
                    {result.state === 'error' && verify.error && (
                      <SignInResult state="error" round={result.round} translate={false} />
                    )}
                    <ErrorText error={verify.error} />
                    <Button type="submit" className="h-11 w-full" disabled={verify.isPending}>
                      Verify
                    </Button>
                    <button
                      type="button"
                      className="w-full text-center text-sm text-primary underline-offset-2 hover:underline"
                      onClick={() => {
                        setChallenge(null);
                        setCode('');
                        setPassword('');
                        verify.reset();
                      }}
                    >
                      Back to sign-in
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <h1 className="text-2xl font-semibold tracking-tight">Operator sign-in</h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Sign in to the SampForce Console.
                  </p>
                  <form
                    className="mt-8 space-y-5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      login.mutate();
                    }}
                  >
                    <Field id="op-email" label="Email">
                      <Input
                        id="op-email"
                        placeholder=" "
                        type="email"
                        autoComplete="username"
                        className="h-11"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </Field>
                    <Field id="op-password" label="Password">
                      <PasswordInput
                        id="op-password"
                        autoComplete="current-password"
                        className="h-11"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                    </Field>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={remember}
                          onChange={(e) => setRemember(e.target.checked)}
                        />
                        Keep me signed in for 7 days
                      </label>
                      <Link
                        href="/operator/forgot-password"
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        Forgot your password?
                      </Link>
                    </div>
                    {result.state === 'error' && login.error && (
                      <SignInResult state="error" round={result.round} translate={false} />
                    )}
                    <ErrorText error={login.error} />
                    <Button type="submit" className="h-11 w-full" disabled={login.isPending}>
                      Sign in
                    </Button>
                  </form>
                  <p className="mt-8 text-xs text-muted-foreground">
                    Workspace accounts cannot sign in here. A Super Admin adds operators from the
                    Console.
                  </p>
                </>
              )}
              <p className="sfs-trust mt-6 flex items-center justify-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
                <Lock className="size-3.5" aria-hidden /> Secure, encrypted sign-in · every action
                recorded
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

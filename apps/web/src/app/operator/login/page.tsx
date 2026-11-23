'use client';

import { Button, Input } from '@dealflow/ui';
import type { OperatorLoginResult } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, KeyRound, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogoOnRed } from '@/components/logo';
import {
  AnimatedMark,
  RevealText,
  SCENE_COPY,
  SceneBackground,
  WorkspaceBadge,
} from '@/components/sign-in/sign-in-scene';
import { markWelcome } from '@/components/sign-in/welcome-overlay';
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
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const done = async (r: OperatorLoginResult) => {
    if (r.mfaRequired && r.challenge) {
      setChallenge(r.challenge);
      return;
    }
    await qc.invalidateQueries({ queryKey: ['operator'] });
    markWelcome();
    router.replace(r.mfaSetupRequired ? '/operator/account?setup=1' : '/operator');
  };
  const login = useMutation({
    mutationFn: () =>
      api<OperatorLoginResult>('/operator/login', {
        method: 'POST',
        json: { email, password, remember },
      }),
    onSuccess: done,
  });
  const verify = useMutation({
    mutationFn: () =>
      api<OperatorLoginResult>('/operator/login/mfa', {
        method: 'POST',
        json: { challenge, code, remember },
      }),
    onSuccess: done,
    onError: () => setCode(''),
  });

  return (
    <main
      className="sfs-root relative min-h-screen overflow-hidden bg-[#140405] text-white"
      data-sign-in-scene="console"
    >
      <SceneBackground variant="console" />
      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.15fr_1fr]">
        <section
          aria-label="SampForce Console"
          className="flex flex-col gap-6 p-6 sm:p-10 lg:justify-between lg:p-12"
        >
          <div className="flex items-center gap-3">
            <LogoOnRed />
          </div>
          <div className="sfs-hero-text flex flex-col gap-5 lg:max-w-xl">
            <WorkspaceBadge variant="console" translate={false} />
            <div className="flex items-center gap-5 lg:block">
              <AnimatedMark className="size-20 shrink-0 sm:size-24 lg:mb-6 lg:size-40" />
              <div className="min-w-0">
                <h2 className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl lg:text-5xl">
                  <RevealText text={SCENE_COPY.console.headline} />
                </h2>
                <p className="sfs-sub mt-3 max-w-md text-base text-white/90 lg:text-lg">
                  {SCENE_COPY.console.sub}
                </p>
                <ul className="mt-8 hidden space-y-4 lg:block">
                  {POINTS.map((p) => (
                    <li key={p.title} className="flex gap-4">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 text-white ring-1 ring-white/15">
                        <p.icon className="size-5" aria-hidden />
                      </span>
                      <span>
                        <span className="block font-medium">{p.title}</span>
                        <span className="block text-sm text-white/80">{p.text}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          <p className="hidden text-xs text-white/75 lg:block">
            Platform staff only. Workspace accounts sign in at the main SampForce sign-in page.
          </p>
        </section>

        <section className="flex items-start justify-center px-4 pb-10 sm:px-6 lg:items-center lg:p-10">
          <div
            data-card-variant="console"
            className="sfs-card w-full max-w-sm rounded-2xl bg-background p-6 text-foreground shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] ring-1 ring-white/10 sm:p-8"
          >
            {challenge ? (
              <>
                <h1 className="text-2xl font-semibold tracking-tight">Two-step verification</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Enter the 6-digit code from your authenticator app, or one of your recovery codes.
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
                      type="email"
                      autoComplete="username"
                      className="h-11"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </Field>
                  <Field id="op-password" label="Password">
                    <Input
                      id="op-password"
                      type="password"
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
          </div>
        </section>
      </div>
    </main>
  );
}

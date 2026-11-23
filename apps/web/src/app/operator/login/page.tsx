'use client';

import { Button, Input } from '@dealflow/ui';
import type { OperatorLoginResult } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Activity, KeyRound, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Logo } from '@/components/logo';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';

const POINTS = [
  { icon: ShieldCheck, title: 'Two-step verification', text: 'An authenticator code after your password, with one-time recovery codes.' },
  { icon: KeyRound, title: 'Roles and permissions', text: 'Each operator sees and changes only what their role allows.' },
  { icon: Activity, title: 'Every action recorded', text: 'Sign-ins, views and changes go to an audit log nobody can edit.' },
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
    router.replace(r.mfaSetupRequired ? '/operator/account?setup=1' : '/operator');
  };
  const login = useMutation({
    mutationFn: () => api<OperatorLoginResult>('/operator/login', { method: 'POST', json: { email, password, remember } }),
    onSuccess: done,
  });
  const verify = useMutation({
    mutationFn: () => api<OperatorLoginResult>('/operator/login/mfa', { method: 'POST', json: { challenge, code, remember } }),
    onSuccess: done,
    onError: () => setCode(''),
  });

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section
        aria-label="SampForce Console"
        className="relative hidden overflow-hidden bg-slate-950 p-12 text-white lg:flex lg:flex-col"
      >
        <div className="pointer-events-none absolute -end-24 -top-24 size-96 rounded-full bg-primary/40 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-32 -start-16 size-[28rem] rounded-full bg-accent/30 blur-3xl" aria-hidden />
        <div className="relative flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-xl bg-white/90 shadow-lg">
            <Logo compact />
          </span>
          <span className="text-lg font-semibold">SampForce Console</span>
        </div>
        <div className="relative mt-auto max-w-lg">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">The control center for every SampForce client.</h2>
          <p className="mt-4 text-base text-slate-300">Clients, subscriptions, workspaces, support and platform health in one place, for the people who run SampForce.</p>
          <ul className="mt-10 space-y-5">
            {POINTS.map((p) => (
              <li key={p.title} className="flex gap-4">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 text-white">
                  <p.icon className="size-5" aria-hidden />
                </span>
                <span>
                  <span className="block font-medium">{p.title}</span>
                  <span className="block text-sm text-slate-300">{p.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-12 text-xs text-slate-400">Platform staff only. Workspace accounts sign in at the main SampForce sign-in page.</p>
      </section>

      <section className="flex items-center justify-center bg-background p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Logo compact />
            <span className="font-semibold">SampForce Console</span>
          </div>
          {challenge ? (
            <>
              <h1 className="text-2xl font-semibold tracking-tight">Two-step verification</h1>
              <p className="mt-2 text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
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
              <p className="mt-2 text-sm text-muted-foreground">Sign in to the SampForce Console.</p>
              <form
                className="mt-8 space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  login.mutate();
                }}
              >
                <Field id="op-email" label="Email">
                  <Input id="op-email" type="email" autoComplete="username" className="h-11" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </Field>
                <Field id="op-password" label="Password">
                  <Input id="op-password" type="password" autoComplete="current-password" className="h-11" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </Field>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                    Keep me signed in for 7 days
                  </label>
                  <Link href="/operator/forgot-password" className="text-primary underline-offset-2 hover:underline">
                    Forgot your password?
                  </Link>
                </div>
                <ErrorText error={login.error} />
                <Button type="submit" className="h-11 w-full" disabled={login.isPending}>
                  Sign in
                </Button>
              </form>
              <p className="mt-8 text-xs text-muted-foreground">Workspace accounts cannot sign in here. A Super Admin adds operators from the Console.</p>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

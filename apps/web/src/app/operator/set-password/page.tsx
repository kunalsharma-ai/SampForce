'use client';

import { Button, Card, CardContent, CardHeader, Input } from '@dealflow/ui';
import { OPERATOR_PASSWORD_MIN, type OperatorTokenInfo } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';

/**
 * Choosing an operator password from an invitation or reset link (ADR 0074). The token travels in the address's
 * fragment, so it never reaches server logs; each link works once.
 */
export default function OperatorSetPassword() {
  const router = useRouter();
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [mismatch, setMismatch] = useState(false);
  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.hash.slice(1)).get('token');
    setToken((prev) => prev ?? fromLink ?? '');
    // The token leaves the address bar at once, so it is not left in history or shared by a copied address.
    window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const info = useQuery({
    enabled: !!token,
    queryKey: ['operator-link', token],
    queryFn: () => api<OperatorTokenInfo>(`/operator/password/link?token=${encodeURIComponent(token!)}`),
    retry: false,
  });
  const save = useMutation({
    mutationFn: () => api('/operator/password', { method: 'POST', json: { token, password } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['operator'] });
      router.replace('/operator');
    },
  });
  const invite = info.data?.purpose !== 'reset';
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <h1 className="text-lg font-semibold">{info.data ? (invite ? 'Welcome to the SampForce Console' : 'Choose a new password') : 'Choose your password'}</h1>
          {info.data && (
            <p className="text-sm text-muted-foreground">
              {invite ? `Hello ${info.data.name}. ` : ''}Choose the password for {info.data.email}.
            </p>
          )}
        </CardHeader>
        <CardContent>
          {token === '' || info.error ? (
            <div className="space-y-3">
              <ErrorText error={info.error ?? new Error('This link has expired or was already used. Ask for a new one.')} />
              <Link href="/operator/login" className="text-sm text-primary underline-offset-2 hover:underline">
                Go to sign-in
              </Link>
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (password !== again) return setMismatch(true);
                setMismatch(false);
                save.mutate();
              }}
            >
              <Field id="sp-password" label="New password" hint={`At least ${OPERATOR_PASSWORD_MIN} characters, with letters and a number or symbol.`}>
                <Input id="sp-password" type="password" autoComplete="new-password" minLength={OPERATOR_PASSWORD_MIN} value={password} onChange={(e) => setPassword(e.target.value)} required />
              </Field>
              <Field id="sp-again" label="Type it again">
                <Input id="sp-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
              </Field>
              {mismatch && (
                <p role="alert" className="text-sm text-critical">
                  The two passwords are different.
                </p>
              )}
              <ErrorText error={save.error} />
              <Button type="submit" className="w-full" disabled={save.isPending || !info.data}>
                Save password and sign in
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

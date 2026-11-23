'use client';

import { Button, Card, CardContent, CardHeader, Input } from '@dealflow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';

export default function OperatorLogin() {
  const router = useRouter();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api('/operator/login', { method: 'POST', json: { email, password } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['operator'] });
      router.replace('/operator');
    },
  });
  return (
    <Card className="mx-auto mt-10 max-w-sm">
      <CardHeader>
        <h1 className="text-lg font-semibold">Operator sign-in</h1>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            login.mutate();
          }}
        >
          <Field id="op-email" label="Email">
            <Input id="op-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field id="op-password" label="Password">
            <Input id="op-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <ErrorText error={login.error} />
          <Button type="submit" className="w-full" disabled={login.isPending}>
            Sign in
          </Button>
          <Link href="/operator/forgot-password" className="block text-center text-sm text-primary underline-offset-2 hover:underline">
            Forgot your password?
          </Link>
          <p className="text-xs text-muted-foreground">Workspace accounts cannot sign in here. A Super Admin adds operators from the Console.</p>
        </form>
      </CardContent>
    </Card>
  );
}
